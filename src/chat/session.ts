// === 自建实现: chat 会话持久化——UUID 标识 + JSONL 事件流追加 + 崩溃容错重建 ===
//
// 上游：src/chat/index.ts（runOnce/runRepl 逐 step 追加、启动时载入）；下游：node:fs。
// 设计契约：docs/design/chat-session-continue.md（--session 裸用新建 / --session <uuid> 严格续跑）。
// 纪律：默认不落盘（不带 --session 时本模块不被触达）；JSONL 逐行 appendFileSync——不缓存 fd、
// 不写缓冲，行落盘即持久，崩溃（含网络崩溃/Ctrl+C）只丢在途 step；追加粒度 = step 完成
// （assistant+tool 成对），盘上历史恒停在完整步边界；system 提示不落盘（每次现拼）。
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ModelMessage } from "ai";
import type { StopReason } from "./loop.js";

/** 会话格式版本（header 行携带）；读时不兼容即报错，不尝试迁移（设计 §4.3 守卫 3）。 */
export const SESSION_VERSION = 1;

/** 会话 id 严格形态：UUID。斜杠/点号/自由文本一律被拒——路径穿越与 typo 分叉同死于这一条。 */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * chat 会话（内存形态；盘上是 `<baseDir>/sessions/chat-<id>.jsonl` 事件流）。
 * messages 从事件流重建，含 <<VAULT_DATA>> 包裹的 tool-result 原文——文件含 vault 内容。
 */
export interface ChatSession {
  version: number;
  /** 会话 id（UUID），即文件名 `chat-<id>.jsonl`。 */
  id: string;
  createdAt: string;
  /** 产出会话的模型（slug）；续跑时与当前解析不同 → 打提示仍允许（设计 §4.3 守卫 5）。 */
  model?: string;
  /** 归一为数组；续跑一致性守卫按 resolve 后排序比对。 */
  vault: string[];
  db: string;
  /** header 元信息（创建时预算），不构成续跑约束——--max-steps 每轮独立（设计 §4.1）。 */
  maxSteps: number;
  /** 最后一个正常收尾轮次的停止原因；error-storm 续跑时给警告（设计 §4.3 守卫 2）。 */
  lastStopReason?: StopReason;
  /** 已正常收尾的轮次数（turn 收尾行计数）；下一轮次 = turns + 1。 */
  turns: number;
  /** 上轮中断/崩溃半程（文件尾部有 message 行却无 turn 收尾）：消息已截到最近一致边界。 */
  interrupted?: boolean;
  messages: ModelMessage[];
}

/** 校验会话 id 形态（UUID）。 */
export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

/** 会话文件完整路径：`<baseDir>/sessions/chat-<id>.jsonl`。 */
export function sessionPath(baseDir: string, id: string): string {
  return join(baseDir, "sessions", `chat-${id}.jsonl`);
}

/** vault 输入归一为数组（chat 支持单根/多根）。 */
export function normalizeVault(vault: string | string[]): string[] {
  return Array.isArray(vault) ? vault : [vault];
}

/** JSONL 行判别：header / 消息 / 轮次收尾。 */
type SessionLine =
  | {
      kind: "session";
      version: number;
      id: string;
      createdAt: string;
      model?: string;
      vault: string[];
      db: string;
      maxSteps: number;
    }
  | { kind: "message"; turn: number; ts: string; message: ModelMessage }
  | { kind: "turn"; turn: number; ts: string; stopReason: StopReason; steps?: number };

function writeLine(path: string, line: SessionLine): void {
  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");
}

/**
 * 新建会话（裸 `--session` 的唯一入口：UUID 由系统生成，禁止自由文本名）。
 * header 行即落盘——「已创建 → 路径」的打印因此永远为真。
 */
export function createSession(
  baseDir: string,
  init: { vault: string | string[]; db: string; model?: string; maxSteps: number },
): { session: ChatSession; path: string } {
  const session: ChatSession = {
    version: SESSION_VERSION,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    model: init.model,
    vault: normalizeVault(init.vault),
    db: init.db,
    maxSteps: init.maxSteps,
    turns: 0,
    messages: [],
  };
  const path = sessionPath(baseDir, session.id);
  mkdirSync(dirname(path), { recursive: true });
  writeLine(path, {
    kind: "session",
    version: session.version,
    id: session.id,
    createdAt: session.createdAt,
    model: session.model,
    vault: session.vault,
    db: session.db,
    maxSteps: session.maxSteps,
  });
  return { session, path };
}

/**
 * 历史一致性修剪：若末尾是「带 tool-call 却无 tool 结果跟进」的 assistant 消息
 * （同批两行被崩溃劈开的唯一非法形态），截掉它。返回是否截过。
 */
function trimOrphanToolCall(messages: ModelMessage[]): boolean {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return false;
  const hasToolCall = last.content.some((p) => (p as { type?: string }).type === "tool-call");
  if (!hasToolCall) return false;
  messages.pop();
  return true;
}

/**
 * 载入会话（`--session <uuid>` 严格语义：非法形态/不存在/header 损坏/version 不符 → 抛错，
 * 绝不静默开新会话）。崩溃容错：仅**末尾半截行**容忍跳过（崩溃写一半的合法形态）并置
 * interrupted；中间行损坏报错。末尾无 turn 收尾行的消息属于中断轮次 → 置 interrupted 并
 * 截掉可能的孤儿 tool-call，保证喂回模型的历史恒一致。
 *
 * @behavior Given id 非 UUID 形态 When 载入 Then 抛「无效会话 id」
 * @behavior Given 文件不存在 When 载入 Then 抛「会话不存在」
 * @behavior Given 末尾半截 JSON 行 When 载入 Then 跳过该行并置 interrupted
 * @behavior Given 中间行损坏 When 载入 Then 抛「损坏」
 */
export function loadSession(baseDir: string, id: string): ChatSession {
  if (!isSessionId(id)) {
    throw new Error(`无效会话 id「${id}」（须为 UUID；自由文本名不允许）。`);
  }
  const path = sessionPath(baseDir, id);
  if (!existsSync(path)) {
    throw new Error(`会话 ${id} 不存在（${path}）。先用裸 --session 新建会话。`);
  }
  const rawLines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  const lines: SessionLine[] = [];
  let tailTruncated = false;
  for (const [i, raw] of rawLines.entries()) {
    try {
      lines.push(JSON.parse(raw) as SessionLine);
    } catch {
      if (i === rawLines.length - 1) {
        // 崩溃写一半的半截尾行：跳过，历史到上一完整行为止。
        tailTruncated = true;
      } else {
        throw new Error(
          `会话文件损坏（${path} 第 ${i + 1} 行）：不是合法 JSON。不静默开新会话，请人工检查或删除后重建。`,
        );
      }
    }
  }
  const header = lines[0];
  if (!header || header.kind !== "session") {
    throw new Error(`会话文件损坏（${path}）：首行不是会话头。不静默开新会话。`);
  }
  if (header.version !== SESSION_VERSION) {
    throw new Error(
      `会话文件版本不兼容（${path}）：version=${String(header.version)}，期望 ${SESSION_VERSION}。不尝试迁移。`,
    );
  }
  const messages: ModelMessage[] = [];
  let lastStopReason: StopReason | undefined;
  let turns = 0;
  /** 已读到的最后一个 turn 收尾行号；其后的 message 行属于中断轮次。 */
  let lastTurnEndIndex = 0;
  for (const [i, line] of lines.entries()) {
    if (line.kind === "message") messages.push(line.message);
    else if (line.kind === "turn") {
      turns++;
      lastStopReason = line.stopReason;
      lastTurnEndIndex = i;
    }
  }
  // 中断轮判定：尾部 message 行没有对应 turn 收尾（或尾行被崩溃截断）。
  const hasTrailingMessages =
    lines.length - 1 > lastTurnEndIndex && lines.at(-1)?.kind === "message";
  const orphaned = trimOrphanToolCall(messages);
  const interrupted = tailTruncated || hasTrailingMessages || orphaned || undefined;
  return {
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    model: header.model,
    vault: header.vault,
    db: header.db,
    maxSteps: header.maxSteps,
    lastStopReason,
    turns,
    interrupted,
    messages,
  };
}

/**
 * 会话追加器：一次运行的写口。turn 从会话已收尾轮次 +1 起算；
 * appendUser/appendSteps/endTurn 逐行追加，endTurn 后轮次自增。
 */
export interface SessionLog {
  readonly path: string;
  readonly id: string;
  /** 当前轮次（追加消息与收尾用）。 */
  readonly turn: number;
  /** 轮开始：追加用户消息行。 */
  appendUser(message: ModelMessage): void;
  /** step 完成：追加该步的 assistant/tool 消息行（成对，完整步边界）。 */
  appendSteps(messages: ModelMessage[]): void;
  /** 轮正常收尾：写 turn 行并自增轮次；abort/崩溃不调——尾部无收尾行即中断标记。 */
  endTurn(stopReason: StopReason, steps?: number): void;
}

/** 打开会话写口（新建或续跑后各一次）。 */
export function openSessionLog(path: string, session: ChatSession): SessionLog {
  let turn = session.turns + 1;
  return {
    path,
    id: session.id,
    get turn() {
      return turn;
    },
    appendUser(message) {
      writeLine(path, { kind: "message", turn, ts: new Date().toISOString(), message });
    },
    appendSteps(messages) {
      // 同一批一次写入：assistant/tool 成对，崩溃最坏劈在中间，读侧 trimOrphanToolCall 兜底。
      writeLineBatch(
        path,
        messages.map((message) => ({
          kind: "message" as const,
          turn,
          ts: new Date().toISOString(),
          message,
        })),
      );
    },
    endTurn(stopReason, steps) {
      writeLine(path, { kind: "turn", turn, ts: new Date().toISOString(), stopReason, steps });
      turn++;
    },
  };
}

/** 一批行一次 appendFileSync（减少同批被崩溃劈开的窗口到一次写调用内）。 */
function writeLineBatch(path: string, lines: SessionLine[]): void {
  if (lines.length === 0) return;
  appendFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""), "utf8");
}

/** 路径数组 → resolve 后排序的规范串（比对用，顺序无关）。 */
function canonicalPaths(paths: string[]): string {
  return paths
    .map((p) => resolve(p))
    .toSorted()
    .join("\n");
}

/**
 * 续跑一致性守卫（设计 §4.3 守卫 1）：会话的 vault/db 与本次解析结果不一致 → 返回报错文案；
 * 一致 → null。防跨天续跑对着换过的库误写（chat 写工具无确认闸，这是唯一事前防线）。
 * 路径按 resolve 后比对（会话可能记的是相对路径，本次解析亦可能相对）。
 */
export function checkSessionTarget(
  session: ChatSession,
  current: { vault: string | string[]; db: string },
): string | null {
  if (canonicalPaths(session.vault) !== canonicalPaths(normalizeVault(current.vault))) {
    return `会话 ${session.id} 属于另一个 vault（记录：${session.vault.join(", ")}），拒绝续跑。`;
  }
  if (resolve(session.db) !== resolve(current.db)) {
    return `会话 ${session.id} 属于另一个索引库（记录：${session.db}），拒绝续跑。`;
  }
  return null;
}

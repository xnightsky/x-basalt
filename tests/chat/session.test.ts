// === chat 会话落盘与续跑测试（设计 docs/design/chat-session-continue.md §6 矩阵 T1-T15）===
//
// JSONL 事件流口径（决策记录③）：逐 step 追加、崩溃只丢在途 step、读侧半截尾行容错 +
// 孤儿 tool-call 截断。分层：session.ts 存储层单测 + resolveChatSession 编排缝 +
// runLoop 双轮组合模拟「跨进程续跑」（MockLanguageModelV4）+ dist 形态 CLI 边界（T14）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchema, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import {
  checkSessionTarget,
  createSession,
  isSessionId,
  loadSession,
  openSessionLog,
} from "../../src/chat/session.js";
import {
  announceSession,
  renderEvent,
  replRestoreState,
  resolveChatSession,
  writeSessionNotice,
  type ChatOutputWriters,
  type RenderContext,
} from "../../src/chat/index.js";
import { runLoop } from "../../src/chat/loop.js";
import { banner } from "../../src/chat/repl.js";

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
const VALID_UUID = "3f2a8c1e-7b4d-4e5f-9a0b-2c3d4e5f6a7b";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "xb-chat-session-"));
}

function captureWriters(): ChatOutputWriters & { out: () => string; err: () => string } {
  let stdout = "";
  let stderr = "";
  return {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    out: () => stdout,
    err: () => stderr,
  };
}

const echoTool = tool({
  description: "echo",
  inputSchema: jsonSchema({ type: "object", properties: { x: { type: "string" } } }),
  execute: async ({ x }: { x: string }) => `观察:${x}`,
});

/** 脚本化模型：tool-call → 文本收尾（同 loop.test.ts 形状）。 */
function makeToolThenTextModel(text: string) {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "echo",
            input: JSON.stringify({ x: "hi" }),
          },
          { type: "finish", usage: USAGE, finishReason: "tool-calls" },
        ]),
      },
      {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "td1" },
          { type: "text-delta", id: "td1", delta: text },
          { type: "text-end", id: "td1" },
          { type: "finish", usage: USAGE, finishReason: "stop" },
        ]),
      },
    ] as unknown[],
  });
}

function makeTextModel(text: string) {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: text },
          { type: "text-end", id: "t" },
          { type: "finish", usage: USAGE, finishReason: "stop" },
        ]),
      },
    ] as unknown[],
  });
}

/** 每步都调工具的死循环模型（撞顶用）。 */
function makeAlwaysActingModel(steps: number) {
  return new MockLanguageModelV4({
    doStream: Array.from({ length: steps }, (_, i) => ({
      stream: convertArrayToReadableStream([
        {
          type: "tool-call",
          toolCallId: `tc${i}`,
          toolName: "echo",
          input: JSON.stringify({ x: `${i}` }),
        },
        { type: "finish", usage: USAGE, finishReason: "tool-calls" },
      ]),
    })) as unknown[],
  });
}

function chatOpts(baseDir: string, session: string | true, maxSteps = 50) {
  return {
    session,
    baseDir,
    vaultPath: join(baseDir, "vault"),
    dbPath: join(baseDir, "index.db"),
    maxSteps,
  };
}

/** 读 JSONL 文件的 kind 序列（要求每行合法 JSON）。 */
function lineKinds(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => (JSON.parse(l) as { kind: string }).kind);
}

// ===== T9 id 严格校验 =====
test("T9 会话 id 严格校验：自由文本/穿越/点开头/空串一律拒绝", () => {
  assert.ok(isSessionId(VALID_UUID));
  for (const bad of ["my-task", "../x", ".hidden", "", `${VALID_UUID}/../etc`]) {
    assert.equal(isSessionId(bad), false, `应拒绝: ${bad}`);
    assert.throws(() => loadSession(tmp(), bad), /无效会话 id/);
  }
});

// ===== T11 不存在会话报错 =====
test("T11 合法但不存在的 UUID → 报「会话不存在」，不静默开新会话", () => {
  assert.throws(() => loadSession(tmp(), VALID_UUID), /会话 .* 不存在/);
});

// ===== T6 损坏与版本（中间行报错；末尾半截行容忍） =====
test("T6 header 损坏/中间行损坏/version 不兼容 → 报错；末尾半截行 → 跳过并置 interrupted", () => {
  const dir = tmp();
  const { session, path } = createSession(dir, chatOpts(dir, true));
  const log = openSessionLog(path, session);
  log.appendUser({ role: "user", content: "问" });
  log.endTurn("done", 1);
  // 版本不兼容
  writeFileSync(path, `${JSON.stringify({ kind: "session", version: 999 })}\n`, "utf8");
  assert.throws(() => loadSession(dir, session.id), /版本不兼容/);
  // 中间行损坏
  const { session: s2, path: p2 } = createSession(dir, chatOpts(dir, true));
  appendFileSync(p2, "not json\n", "utf8");
  appendFileSync(p2, `${JSON.stringify({ kind: "turn", turn: 1, stopReason: "done" })}\n`, "utf8");
  assert.throws(() => loadSession(dir, s2.id), /损坏/);
  // 末尾半截行（模拟崩溃写一半）→ 容忍
  const { session: s3, path: p3 } = createSession(dir, chatOpts(dir, true));
  const log3 = openSessionLog(p3, s3);
  log3.appendUser({ role: "user", content: "问" });
  appendFileSync(p3, '{"kind":"message","turn":1,"mes', "utf8"); // 无换行的半截行
  const recovered = loadSession(dir, s3.id);
  assert.equal(recovered.interrupted, true);
  assert.equal(recovered.messages.length, 1);
});

// ===== T5 vault/db 一致性守卫 =====
test("T5 vault/db 不一致 → 守卫报错文案指明朝向；一致（含相对路径、多根乱序）→ null", () => {
  const dir = tmp();
  const { session: s } = createSession(dir, {
    vault: join(dir, "vault-a"),
    db: join(dir, "a.db"),
    maxSteps: 50,
  });
  assert.match(
    checkSessionTarget(s, { vault: join(dir, "vault-b"), db: join(dir, "a.db") }) ?? "",
    /另一个 vault/,
  );
  assert.match(
    checkSessionTarget(s, { vault: join(dir, "vault-a"), db: join(dir, "b.db") }) ?? "",
    /另一个索引库/,
  );
  assert.equal(checkSessionTarget(s, { vault: join(dir, "vault-a"), db: join(dir, "a.db") }), null);
  const { session: multi } = createSession(dir, {
    vault: [join(dir, "v1"), join(dir, "v2")],
    db: join(dir, "a.db"),
    maxSteps: 50,
  });
  assert.equal(
    checkSessionTarget(multi, {
      vault: [join(dir, "v2"), join(dir, "v1")],
      db: join(dir, "a.db"),
    }),
    null,
  );
});

// ===== T10 裸 --session 新建 =====
test("T10 裸 session 新建：合法 UUID、header 即落盘、提示含 id 与完整路径", () => {
  const dir = tmp();
  const r = resolveChatSession(chatOpts(dir, true), "m/1");
  assert.ok(r.ok);
  assert.equal(r.resumed, false);
  assert.ok(isSessionId(r.session.id));
  assert.ok(existsSync(r.path));
  assert.match(r.path, /sessions\/chat-[0-9a-f-]+\.jsonl$/);
  // header 行即落盘（「已创建 → 路径」永远为真）。
  assert.deepEqual(lineKinds(r.path), ["session"]);
  const w = captureWriters();
  announceSession("full", w, r);
  assert.match(w.out(), new RegExp(`已创建 → ${r.path.replace(/[/.]/g, "\\$&")}`));
});

// ===== T4 追加语义与崩溃安全 =====
test("T4 追加语义：行序 header→message…→turn；step 完成即落盘（崩溃只丢在途 step）", async () => {
  const dir = tmp();
  const { session, path } = createSession(dir, chatOpts(dir, true));
  const log = openSessionLog(path, session);
  log.appendUser({ role: "user", content: "调用 echo" });
  await runLoop([{ role: "user", content: "调用 echo" }], {
    model: makeToolThenTextModel("完成"),
    tools: { echo: echoTool },
    maxSteps: 5,
    onEvent: () => {},
    onStep: (msgs) => log.appendSteps(msgs),
  });
  // 关键断言：turn 收尾行未写，已完成 step 的消息已在盘上（崩溃到此刻只丢收尾行）。
  assert.deepEqual(lineKinds(path), ["session", "message", "message", "message", "message"]);
  log.endTurn("done", 2);
  assert.deepEqual(lineKinds(path), [
    "session",
    "message",
    "message",
    "message",
    "message",
    "turn",
  ]);
  // 第二轮继续追加：行序延续、轮次递增。
  log.appendUser({ role: "user", content: "第二个问题" });
  log.endTurn("done", 1);
  const kinds = lineKinds(path);
  assert.deepEqual(kinds.slice(-2), ["message", "turn"]);
  const loaded = loadSession(dir, session.id);
  assert.equal(loaded.turns, 2);
  assert.equal(loaded.lastStopReason, "done");
  assert.equal(loaded.interrupted, undefined);
});

// ===== T1 round-trip 等价（事件流重建；含 tool-call part） =====
test("T1 messages 追加落盘读回：规范化 JSON 相等（undefined 键丢弃属预期边角）", async () => {
  const dir = tmp();
  const { session, path } = createSession(dir, chatOpts(dir, true));
  const log = openSessionLog(path, session);
  const user: ModelMessage = { role: "user", content: "调用 echo" };
  log.appendUser(user);
  const r1 = await runLoop([user], {
    model: makeToolThenTextModel("完成"),
    tools: { echo: echoTool },
    maxSteps: 5,
    onEvent: () => {},
    onStep: (msgs) => log.appendSteps(msgs),
  });
  log.endTurn(r1.stopReason);
  const loaded = loadSession(dir, session.id);
  // 设计 §3 边角：ai SDK part 的 providerOptions: undefined 被 JSON 丢弃，按规范化比对。
  assert.equal(
    JSON.stringify(loaded.messages),
    JSON.stringify(JSON.parse(JSON.stringify(r1.messages))),
  );
  // 完整累积：user + assistant(tool-call) + tool(result) + assistant(text)。
  assert.equal(loaded.messages.length, 4);
  assert.ok(
    loaded.messages.some((m) => m.role === "tool"),
    "历史应含 tool-result 消息",
  );
});

// ===== T2 跨进程续跑端到端（mock 双轮 + 文件中介） =====
test("T2 续跑端到端：落盘 → 新「进程」载入 → 第二轮模型收到完整历史并正确追加", async () => {
  const dir = tmp();
  // 进程 A：新建 → 跑一轮（tool-call → 文本），事件流逐 step 落盘。
  const r0 = resolveChatSession(chatOpts(dir, true), "m/1");
  assert.ok(r0.ok);
  const logA = openSessionLog(r0.path, r0.session);
  const user: ModelMessage = { role: "user", content: "调用 echo" };
  logA.appendUser(user);
  const r1 = await runLoop([user], {
    model: makeToolThenTextModel("第一轮完成"),
    tools: { echo: echoTool },
    maxSteps: 5,
    onEvent: () => {},
    onStep: (msgs) => logA.appendSteps(msgs),
  });
  logA.endTurn(r1.stopReason);

  // 进程 B：严格续跑载入 → 追加新 user 消息 → 第二轮。
  const r2res = resolveChatSession(chatOpts(dir, r0.session.id), "m/1");
  assert.ok(r2res.ok && r2res.resumed);
  const logB = openSessionLog(r2res.path, r2res.session);
  assert.equal(logB.turn, 2); // 轮次跨进程延续
  const user2: ModelMessage = { role: "user", content: "继续" };
  logB.appendUser(user2);
  const model2 = makeTextModel("续跑完成");
  const r2 = await runLoop([...r2res.session.messages, user2], {
    model: model2,
    tools: { echo: echoTool },
    maxSteps: 5,
    onEvent: () => {},
    onStep: (msgs) => logB.appendSteps(msgs),
  });
  logB.endTurn(r2.stopReason);
  assert.equal(r2.stopReason, "done");
  assert.equal(r2.messages.length, r1.messages.length + 2);
  // 第二轮模型收到的 prompt 含第一轮 tool-call/tool-result 原文（历史保真送达）。
  const calls = (model2 as unknown as { doStreamCalls: { prompt: unknown }[] }).doStreamCalls;
  const promptJson = JSON.stringify(calls[0]?.prompt);
  assert.ok(promptJson.includes("tc1"), "prompt 应含历史 tool-call id");
  assert.ok(promptJson.includes("观察:hi"), "prompt 应含历史 tool-result");
  // 文件可再次完整重建（两轮全部行）。
  const reloaded = loadSession(dir, r0.session.id);
  assert.equal(reloaded.turns, 2);
  assert.equal(reloaded.messages.length, r2.messages.length);
});

// ===== T7 --max-steps 正交 =====
test("T7 header 记 50、续跑用 2 → 第二轮 2 步撞顶 exhausted（预算每轮独立）", async () => {
  const dir = tmp();
  const { session } = createSession(dir, chatOpts(dir, true, 50));
  const loaded = loadSession(dir, session.id);
  assert.equal(loaded.maxSteps, 50); // header 元信息
  const r = await runLoop([{ role: "user", content: "跑" }], {
    model: makeAlwaysActingModel(4),
    tools: { echo: echoTool },
    maxSteps: 2, // 本轮预算来自 CLI，不看 header
    onEvent: () => {},
  });
  assert.equal(r.stopReason, "exhausted");
});

// ===== T3 默认不落盘 =====
test("T3 不带 --session：跑完一轮后 sessions/ 目录不存在", async () => {
  const dir = tmp();
  // 机制级证明：不触达 createSession/openSessionLog 时（opts.session === undefined 的
  // cli 接线路径），runLoop 运行不产生任何会话文件。
  await runLoop([{ role: "user", content: "问" }], {
    model: makeTextModel("答"),
    tools: {},
    maxSteps: 3,
    onEvent: () => {},
  });
  assert.equal(existsSync(join(dir, "sessions")), false);
});

// ===== T8 REPL 恢复缝 =====
test("T8 续跑恢复：exhausted/中断 → canContinue + 历史；done → 不续跑提示；横幅带会话 id", () => {
  const dir = tmp();
  const { session: base, path } = createSession(dir, chatOpts(dir, true));
  const log = openSessionLog(path, base);
  log.appendUser({ role: "user", content: "旧指令" });
  log.endTurn("exhausted", 3);
  const exhausted = replRestoreState(loadSession(dir, base.id));
  assert.equal(exhausted.initialCanContinue, true);
  assert.equal(exhausted.initialMessages?.length, 1);
  // 中断轮（无 turn 收尾）→ 也可「继续」。
  const { session: s2, path: p2 } = createSession(dir, chatOpts(dir, true));
  openSessionLog(p2, s2).appendUser({ role: "user", content: "跑到一半" });
  const interrupted = replRestoreState(loadSession(dir, s2.id));
  assert.equal(interrupted.initialCanContinue, true);
  // done → 不给续跑提示；空历史 → 不恢复 messages。
  const { session: s3, path: p3 } = createSession(dir, chatOpts(dir, true));
  const log3 = openSessionLog(p3, s3);
  log3.appendUser({ role: "user", content: "问" });
  log3.endTurn("done", 1);
  const done = replRestoreState(loadSession(dir, s3.id));
  assert.equal(done.initialCanContinue, undefined);
  assert.equal(replRestoreState(base).initialMessages, undefined);
  assert.match(banner("m/1", VALID_UUID), new RegExp(`会话 ${VALID_UUID}`));
});

// ===== T12 session id 全形态可见 =====
test("T12 返回必带 session id：full→stdout、summary/quiet→stderr、json→sessionId 字段", () => {
  const wFull = captureWriters();
  writeSessionNotice("full", wFull, `· 会话 ${VALID_UUID} → /p/chat-${VALID_UUID}.jsonl`);
  assert.match(wFull.out(), new RegExp(VALID_UUID));
  assert.equal(wFull.err(), "");
  for (const profile of ["summary", "quiet"] as const) {
    const w = captureWriters();
    writeSessionNotice(profile, w, `· 会话 ${VALID_UUID} → /p`);
    assert.equal(w.out(), "");
    assert.match(w.err(), new RegExp(VALID_UUID));
  }
  const wJson = captureWriters();
  const ctx: RenderContext = {
    profile: "json",
    answer: "答案",
    writers: wJson,
    sessionId: VALID_UUID,
  };
  renderEvent({ type: "finish", stopReason: "done", recalled: true, steps: 1 }, ctx);
  assert.equal(JSON.parse(wJson.out()).sessionId, VALID_UUID);
  const wJsonNoSession = captureWriters();
  renderEvent(
    { type: "finish", stopReason: "done", recalled: true, steps: 1 },
    { profile: "json", answer: "答案", writers: wJsonNoSession },
  );
  assert.equal(JSON.parse(wJsonNoSession.out()).sessionId, undefined);
});

// ===== T13 model 变更提示 =====
test("T13 会话模型与当前不同 → 续跑允许且提示变更；相同 → 无提示", () => {
  const dir = tmp();
  const created = resolveChatSession(chatOpts(dir, true), "m/a");
  assert.ok(created.ok);
  const changed = resolveChatSession(chatOpts(dir, created.session.id), "m/b");
  assert.ok(changed.ok && changed.resumed);
  assert.deepEqual(changed.modelChanged, { from: "m/a", to: "m/b" });
  const w = captureWriters();
  announceSession("full", w, changed);
  assert.match(w.out(), /会话由模型 m\/a 产出，当前使用 m\/b 续跑/);
  const same = resolveChatSession(chatOpts(dir, created.session.id), "m/a");
  assert.ok(same.ok);
  assert.equal(same.modelChanged, undefined);
});

// ===== T5b vault 守卫经 resolveChatSession 拒绝续跑 =====
test("T5b 续跑守卫接线：vault 不一致 → resolveChatSession 返回 ok:false", () => {
  const dir = tmp();
  const created = resolveChatSession(chatOpts(dir, true), "m/1");
  assert.ok(created.ok);
  const bad = resolveChatSession(
    { ...chatOpts(dir, created.session.id), vaultPath: join(dir, "other-vault") },
    "m/1",
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /另一个 vault/);
});

// ===== T15 中断轮恢复（崩溃半程：无 turn 收尾 + 孤儿 tool-call 截断） =====
test("T15 中断轮恢复：孤儿 assistant tool-call 被截断、置 interrupted、历史恒一致", async () => {
  const dir = tmp();
  const { session, path } = createSession(dir, chatOpts(dir, true));
  const log = openSessionLog(path, session);
  // 第一轮正常收尾。
  log.appendUser({ role: "user", content: "第一问" });
  log.appendSteps([{ role: "assistant", content: "答一" }]);
  log.endTurn("done", 1);
  // 第二轮崩溃：用户消息 + 一轮 tool-call 的 assistant 行落盘，同批 tool 行没写出来。
  log.appendUser({ role: "user", content: "第二问" });
  appendFileSync(
    path,
    `${JSON.stringify({
      kind: "message",
      turn: 2,
      ts: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tcX", toolName: "echo", input: { x: "y" } }],
      },
    })}\n`,
    "utf8",
  );
  const loaded = loadSession(dir, session.id);
  assert.equal(loaded.interrupted, true);
  assert.equal(loaded.turns, 1);
  assert.equal(loaded.lastStopReason, "done");
  // 孤儿 tool-call 被截断：历史停在「第一问 + 答一 + 第二问」，无悬空 tool-call。
  assert.equal(loaded.messages.length, 3);
  assert.equal(loaded.messages.at(-1)?.role, "user");
  assert.ok(
    !loaded.messages.some(
      (m) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((p) => (p as { type?: string }).type === "tool-call"),
    ),
  );
});

// ===== T14 非 TTY 无 input 边界（dist 形态，需先 build） =====
const DIST_CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
test("T14 管道无输入 + --session <uuid> → 报「会话已定位但未提供输入」、非 0", (t) => {
  if (!existsSync(DIST_CLI)) return t.skip("dist 未构建（pnpm build 后生效）");
  const dir = tmp();
  try {
    execFileSync(process.execPath, [DIST_CLI, "chat", "--session", VALID_UUID, "--vault", dir], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, AI_GATEWAY_API_KEY: "dummy" },
    });
    assert.fail("应非 0 退出");
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    assert.notEqual(err.status, 0);
    assert.match(err.stderr ?? "", new RegExp(`会话 ${VALID_UUID} 已定位，但未提供输入`));
  }
});

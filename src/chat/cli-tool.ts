// === 自建实现: chat cli 单工具——唯一执行口（切 C 核心，2026-07-30 拍板）===
//
// 上游：tools.ts（buildTools 装配）；下游：execFile 执行 cli.js。
// 纪律（chat-tool-surface.md §0 两条）：①工具 schema 与 CLI 一处定义——本壳不做参数语义
// 解释，只透传 argv；②模型永远不拼 shell 字符串——参数走数组，execFile 无 shell。
// 防递归：allowlist 结构性排除 chat/watch；spawn env 注入 X_BASALT_CHAT_CHILD=1 兜底。
// 动态 base：模型传 { args: ["base", "-"], source } → source 写 stdin（第一步 stdin 入参落地后可用）。
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jsonSchema, tool, type Tool } from "ai";
import { resolveVaultLayout } from "../utils/path.js";
import type { Safety } from "./safety.js";
import { classifyError, structuredMessage } from "./tool-errors.js";
import type { ToolContext } from "./tools.js";

/**
 * 允许的顶层子命令（读+写白名单）。**刻意排除**：
 * - `watch`：常驻监听、永不返回——会挂死 chat 会话（chat-tool-surface.md §风险）；
 * - `chat`：AI 递归入口——模型不得嵌套起 AI loop（结构性排除 + env 兜底双保险）。
 * 其余（parse/index/scan/query/search/base/skills/meta/run/links/lint）均为一次性命令。
 */
export const CLI_ALLOWLIST = new Set([
  "parse",
  "index",
  "scan",
  "query",
  "search",
  "base",
  "skills",
  "meta",
  "run",
  "links",
  "lint",
]);

/** 子进程超时（ms）：CLI 命令都该毫秒级返回；超时杀掉防挂死。 */
const CHILD_TIMEOUT_MS = 60_000;

/**
 * 接受 `--vault <path>` 选项的子命令（注入形态：选项）。
 * 来源核对 src/cli.ts：query(351)/search(379)/base(415)/run(731) 均有 `.option("--vault")`。
 */
const VAULT_OPTION_COMMANDS = new Set(["query", "search", "base", "run"]);

/**
 * 接受 `[vault...]` 位置参数的子命令（注入形态：并列目录）。
 * 来源核对 src/cli.ts：index(244)/scan(272)/links(921,927)/lint(965) 均有 `.argument("[vault...]")`。
 */
const VAULT_ARG_COMMANDS = new Set(["index", "scan", "links", "lint"]);

/**
 * 接受 `--db <path>` 选项的子命令。links/lint 无 --db（只读诊断不碰索引库），注入会报
 * `unknown option`；parse/meta/skills 亦无。来源核对 src/cli.ts。
 */
const DB_COMMANDS = new Set(["index", "scan", "query", "search", "base", "run"]);

/** 带值的文件型命令选项；定位位置参数时必须连同后一个 argv 一起跳过。 */
const FILE_COMMAND_VALUE_OPTIONS = new Set(["--format", "--type", "--set"]);

/**
 * 返回命令中位置参数的 argv 下标，供 chat 在不改变 Commander 参数顺序的前提下改写文件路径。
 *
 * @behavior
 * Given 文件参数前有 `--format yaml` 或重复 `--set key=value`
 * When 定位位置参数
 * Then 跳过选项及其值，只返回真正的位置参数下标
 */
function positionalIndexes(args: string[], start: number): number[] {
  const indexes: number[] = [];
  for (let i = start; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      for (let j = i + 1; j < args.length; j++) indexes.push(j);
      break;
    }
    if (arg.startsWith("-")) {
      if (FILE_COMMAND_VALUE_OPTIONS.has(arg)) i++;
      continue;
    }
    indexes.push(i);
  }
  return indexes;
}

/**
 * 把 chat 从索引结果取得的 vault 主键还原为物理文件路径。
 *
 * `parse` / `meta` 的公开 CLI 有意保持“直接接收文件路径”，不承担 vault 布局解析；chat 却会把
 * query/search 返回的 `file.path` 原样交给它们。单根嵌套目录和多根命名空间下，主键不等于 cwd
 * 相对路径，因此必须在这层已持有 ToolContext 的边界完成转换，避免读失败或写中 cwd 下的同名文件。
 *
 * @behavior
 * Given 单根 vault 位于 cwd 的嵌套目录且索引主键为 `a.md`
 * When chat 调用 parse/meta
 * Then 子进程收到该 vault 内 `a.md` 的绝对路径
 *
 * @behavior
 * Given 多根 vault 主键为 `plans/a.md`
 * When chat 调用 parse/meta
 * Then 按根命名空间解析到 plans 根，而不是 cwd 下的 `plans/a.md`
 */
function resolveFileArgs(args: string[], vaultPath: string | string[]): string[] {
  const command = args[0];
  let fileIndex: number | undefined;
  if (command === "parse") {
    [fileIndex] = positionalIndexes(args, 1);
  } else if (command === "meta") {
    const metaCommand = args[1];
    const positions = positionalIndexes(args, 2);
    fileIndex = metaCommand === "apply" ? positions[1] : positions[0];
    if (metaCommand === "profile") fileIndex = undefined;
  }
  if (fileIndex === undefined || args[fileIndex] === undefined) return args;

  const rewritten = [...args];
  rewritten[fileIndex] = resolveVaultLayout(vaultPath).toAbs(args[fileIndex] as string);
  return rewritten;
}

/** 防递归兜底环境变量：chat 启动检测到即拒（见 src/cli.ts chat 命令）。 */
export const CHAT_CHILD_ENV = "X_BASALT_CHAT_CHILD";

/** 默认 cli 入口：按运行时形态解析。
 * dev/测试（本文件在 src/chat/ 下）→ 同目录树 ../cli.ts（TS 源码，node --import tsx 可跑）；
 * 生产构建（本文件在 dist/chat/ 下）→ ../cli.js（编译产物，裸 node 可跑）。
 * 不依赖调用方注入：cli 工具对 cli.ts（chat 命令）零改动即可在两种形态下工作。
 */
function defaultCliEntry(): string {
  // dist 形态：dist/chat/cli-tool.js → ../cli.js 存在即用编译产物（生产无 tsx）。
  const prod = fileURLToPath(new URL("../cli.js", import.meta.url));
  if (existsSync(prod)) return prod;
  // dev 形态：src/chat/cli-tool.ts → ../cli.ts（tsx 直跑）。
  return fileURLToPath(new URL("../cli.ts", import.meta.url));
}

/**
 * 执行一条 CLI 命令：argv 数组直传（无 shell），按子命令形态注入 vault/db，source 走 stdin。
 * 手写 promise（不用 promisify(execFile)）：后者无法传 stdin 写 source。
 *
 * 注入按子命令分类（2026-08-03 根因修复，kimi/用户走查确认）——此前对所有子命令统一追加
 * `--vault`，但只有部分命令接受该选项，其余报 `unknown option '--vault'` 触发模型死循环：
 *   - query/search/base/run：`--vault <path>` 选项；
 *   - index/scan/links/lint：`[vault...]` **位置参数**（追加目录）；
 *   - parse/meta/skills：无 vault 选项，故不注入 flag；但 parse/meta 的文件参数会在 chat 壳层先由
 *     vault 主键还原为绝对路径，避免索引键被 CLI 按 cwd 误解；
 *   - `--db` 仅注入到有该选项的命令（index/scan/query/search/base/run）；links/lint 无 --db，注入会报错。
 */
async function execCli(
  cliEntry: string,
  args: string[],
  ctx: ToolContext,
  source?: string,
): Promise<{ stdout: string; stderr: string }> {
  const resolvedArgs = resolveFileArgs(args, ctx.vaultPath);
  const sub = resolvedArgs[0] ?? "";
  // 用户显式给了就不注入（显式优先，与 CLI 语义一致）；多根 vault 展开为重复 --vault 或并列位置参数。
  const userVault = resolvedArgs.filter((a) => a === "--vault");
  const userDb = resolvedArgs.some((a) => a === "--db");
  const vaultDirs = Array.isArray(ctx.vaultPath) ? ctx.vaultPath : [ctx.vaultPath];
  const usesVaultOption = VAULT_OPTION_COMMANDS.has(sub);
  const usesVaultArg = VAULT_ARG_COMMANDS.has(sub);
  const vaultFlags =
    userVault.length > 0 || !(usesVaultOption || usesVaultArg)
      ? []
      : usesVaultOption
        ? vaultDirs.flatMap((v) => ["--vault", v])
        : vaultDirs; // 位置参数形态：直接并列目录（commander [vault...] variadic 收集）
  const dbFlags =
    userDb || ctx.dbPath === undefined || !DB_COMMANDS.has(sub) ? [] : ["--db", ctx.dbPath];
  // cli 入口为 TS 源码时需要 --import tsx（dev 态/测试）；编译产物 .js 裸 node 即可。
  const entry = cliEntry.endsWith(".ts") ? ["--import", "tsx", cliEntry] : [cliEntry];
  const argv = [...entry, ...resolvedArgs, ...vaultFlags, ...dbFlags];

  const child = execFile(process.execPath, argv, {
    env: { ...process.env, [CHAT_CHILD_ENV]: "1" },
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024, // 16 MiB：query/base 大结果不截进程侧，由 safety 层截断
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) =>
      settle(() => {
        // 区分超时被杀（execFile 的 timeout 到期自动 SIGTERM，error.code=ETIMEDOUT 或 err.killed）
        // 与启动失败：前者给可自纠的超时提示，后者才是环境问题。
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        const timedOut = e.code === "ETIMEDOUT" || e.killed === true;
        reject(
          new Error(
            structuredMessage(
              new Error(
                timedOut
                  ? `CLI 子进程超时（>${CHILD_TIMEOUT_MS}ms 已终止）——命令可能过重，缩小范围或换子命令`
                  : `CLI 子进程启动失败：${err.message}`,
              ),
              "unknown",
            ),
          ),
        );
      }),
    );
    child.on("close", (code) =>
      settle(() => {
        if (code === 0) resolve({ stdout, stderr });
        else {
          const detail = stderr.trim() || stdout.trim();
          reject(
            new Error(
              structuredMessage(
                new Error(`CLI 退出码 ${code}：${detail || "(无输出)"}`),
                classifyError(new Error(detail)),
              ),
            ),
          );
        }
      }),
    );
    // timeout 到期：execFile 自动 SIGTERM 子进程并走 error 事件（kill 由 node 内置处理）。
    if (source !== undefined) child.stdin?.end(source, "utf8");
    else child.stdin?.end();
  });
}

/**
 * 造 cli 单工具。
 *
 * @param ctx       vault/db 上下文（注入用）
 * @param safety    输出边界包裹 + 截断
 * @param cliEntry  cli 入口文件绝对路径（缺省 src/cli.ts，dev 态 tsx 可直跑）
 */
export function buildCliTool(ctx: ToolContext, safety: Safety, cliEntry?: string): Tool {
  return tool({
    description:
      "执行 x-basalt CLI 命令的唯一入口（一条命令=一次调用）。args 是命令与参数数组（子命令 + flags + 位置参数，逐项原样传递、不要拼成字符串）。可用子命令：parse/index/scan/query/search/base/skills/meta/run/links/lint（watch/chat 不允许）。query 查结构化字段、search 查正文、parse 解析单文件 AST、批量写用 run、.base view 查询用 base（可传 source 字段作为 .base 定义内容经 stdin 读取，免落盘）。结果含 total/counts 计数——数总量直接读 total，不要翻页枚举。写命令会直接落盘。不知道 CLI 语法先 skills_get 取 core。",
    inputSchema: jsonSchema<{ args: string[]; source?: string }>({
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "CLI 命令与参数（如 ['query', 'LIST FROM #x'] 或 ['base', '-']）",
        },
        source: {
          type: "string",
          description: "可选：作为 stdin 传给子进程（如 base - 的 .base 定义内容）",
        },
      },
      required: ["args"],
      additionalProperties: false,
    }),
    execute: async ({ args, source }) => {
      const sub = args[0];
      if (sub === undefined || !CLI_ALLOWLIST.has(sub)) {
        throw new Error(
          structuredMessage(
            new Error(
              `不允许的子命令 "${sub ?? "(空)"}"。可用：${[...CLI_ALLOWLIST].join("/")}（watch/chat 禁止）`,
            ),
            "invalid",
          ),
        );
      }
      const { stdout, stderr } = await execCli(cliEntry ?? defaultCliEntry(), args, ctx, source);
      // stdout/stderr 合并：CLI 错误信息常走 stderr，模型都要看。
      const content = [stdout, stderr].filter(Boolean).join("\n");
      return safety.wrap(safety.truncate(content));
    },
  });
}

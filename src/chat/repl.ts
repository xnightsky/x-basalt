// === 自建实现: chat REPL——node:readline 最小交互（无 TUI 框架），累积对话+观察历史 ===
//
// 上游：src/chat/index.ts；下游：runLoop。
// 交互打磨（最小实现，不引 ink/blessed）：启动横幅 + 操作提示、help 速查、examples 示例指令、
// 撞顶后提示符引导续跑、退出语。纪律：Ctrl+C 只中断当前轮、不回退历史；空闲提示符 Ctrl+C 由 Node
// 默认 SIGINT 处理，readline 关闭、进程自然退出。撞步数顶（stopReason='exhausted'）后本轮未完成——
// 用户可输入「继续」用现有上下文续跑，治「轮询撞顶就静默停」。
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import type { ModelMessage, ToolSet } from "ai";
import { runLoop, type LoopEvent } from "./loop.js";
import { NO_RECALL_NOTICE, RECALL_TOOL_NAMES } from "./tools.js";
import type { Tracer } from "./trace.js";

/** 一行输入的语义解释结果（把控制流从 readline IO 中挤出来，便于独立、确定性测试/复用）。 */
export type ReplAction =
  | { kind: "quit" }
  | { kind: "skip" }
  | { kind: "help" }
  | { kind: "examples" }
  | { kind: "continue" }
  | { kind: "message"; content: string };

/**
 * 解释一行 REPL 输入。
 * @param canContinue 上一轮是否撞顶未完成（仅此时「继续/continue/go」才触发续跑，避免误触发）。
 * @behavior quit/exit/q（trim）→ quit；空行 → skip；help/?/：help → help；examples/例子 → examples
 * @behavior canContinue 且为 继续/continue/go → continue（不追加新消息、用现有上下文续跑）
 * @behavior 其余 → message（trim 后内容）
 */
export function interpretLine(raw: string, canContinue: boolean): ReplAction {
  const line = raw.trim();
  if (line === "quit" || line === "exit" || line === "q") return { kind: "quit" };
  if (line === "") return { kind: "skip" };
  if (line === "help" || line === ":help" || line === "?" || line === "？") return { kind: "help" };
  if (line === "examples" || line === ":examples" || line === "例子" || line === "示例")
    return { kind: "examples" };
  if (canContinue && (line === "继续" || line === "continue" || line === "go"))
    return { kind: "continue" };
  return { kind: "message", content: line };
}

/** 启动横幅（最小 TUI：一行说清这是什么 + 怎么求助/看示例/退出）。 */
export function banner(model?: string): string {
  const m = model ? ` · 模型 ${model}` : "";
  return `x-basalt chat${m}\n自然语言驱动 vault；输入 examples 看可玩示例，help 看用法，quit 退出。`;
}

/** 帮助速查（命令 + 操作）。 */
export function helpText(): string {
  return [
    "命令：",
    "  help / ? / ：help    显示本帮助",
    "  examples / 例子      列出可直接试玩的示例指令",
    "  quit / exit / q      退出",
    "  继续 / continue / go 撞步数顶未完成时，用现有上下文接着跑（仅撞顶后可用）",
    "操作：",
    "  Ctrl+C               中断当前轮、回到提示符；空闲提示符按一次退出",
  ].join("\n");
}

/**
 * 可直接试玩的示例指令（让用户「拿来即玩」，不必先懂 DQL/工具）。
 * 覆盖读 / 写 / 能力·排错三类；最后一条故意写错，用来观察「结构化错误 + 换策略自纠」行为。
 * 注：示例针对当前 --vault 指向的库；带 <…> 的请替换成库里真实文件名。
 */
export function examplePrompts(): string {
  return [
    "可玩示例（针对你 --vault 指向的库；先建好索引，<…> 换成真实文件名）：",
    "  读：",
    "    这个 vault 一共有多少篇笔记？",
    "    列出所有带 #spec 标签的笔记",
    "    查 type 是 research 的笔记",
    "    读 <某篇>.md 的 frontmatter 有哪些字段",
    "    扫一下有哪些文件还没进索引",
    "  写（会直接改文件，建议先在测试库上玩）：",
    "    给 <某篇>.md 把 status 设成 done",
    "    把 <某篇>.md 的 tags 规范化",
    "  能力 / 排错：",
    "    你能做什么？",
    "    x-basalt 支持哪些 DQL 写法？",
    "    用 DQL「FOOBAR 乱写」查一下 —— 看它撞错后怎么换法自纠",
  ].join("\n");
}

/** 提示符：撞顶后变体提示「可继续」，让续跑可发现。 */
const PROMPT = "\nchat> ";
const PROMPT_CONTINUE = "\nchat（输入「继续」接着跑，或直接给新指令）> ";

/**
 * REPL 循环：每行输入追加为 user 消息，跑一轮 runLoop，累积返回的 messages 作下一轮上下文。
 * 启动打印横幅；help/examples 打印文本不跑模型；quit 打印退出语；撞顶（exhausted）后换提示符引导续跑。
 * 输入中 Ctrl+C → abort 当前轮、回到提示符；空闲提示符 Ctrl+C → 退出。
 */
export async function runRepl(
  model: unknown,
  tools: ToolSet,
  opts: { maxSteps: number },
  cfg: { system: string; onEvent: (e: LoopEvent) => void; model?: string; tracer?: Tracer },
): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(`${banner(cfg.model)}\n`);
  // 空闲提示符下的 Ctrl+C：优雅退出并触发 finally 打印 trace 路径；运行中 Ctrl+C 由 runLoop 的 abort 处理。
  let isRunning = false;
  let shouldQuit = false;
  rl.on("SIGINT", () => {
    if (isRunning) return;
    shouldQuit = true;
    rl.close();
  });
  // system 不进 messages（v7 禁止），每轮经 runLoop 的 system 参数传；messages 只累积 user/assistant/tool。
  let messages: ModelMessage[] = [];
  let canContinue = false; // 上一轮是否撞顶未完成
  try {
    for (;;) {
      const action = interpretLine(
        await rl.question(canContinue ? PROMPT_CONTINUE : PROMPT),
        canContinue,
      );
      if (action.kind === "quit") {
        process.stdout.write("再见。\n");
        return 0;
      }
      if (action.kind === "skip") continue;
      if (action.kind === "help") {
        process.stdout.write(`${helpText()}\n`);
        continue;
      }
      if (action.kind === "examples") {
        process.stdout.write(`${examplePrompts()}\n`);
        continue;
      }
      // message：追加新用户消息；continue：不追加，直接用现有（含上轮未完成）messages 续跑。
      if (action.kind === "message") messages.push({ role: "user", content: action.content });
      const ac = new AbortController();
      const onSigint = (): void => ac.abort();
      process.on("SIGINT", onSigint);
      isRunning = true;
      try {
        const r = await runLoop(messages, {
          model,
          tools,
          maxSteps: opts.maxSteps,
          onEvent: cfg.onEvent,
          abortSignal: ac.signal,
          system: cfg.system,
          recallToolNames: RECALL_TOOL_NAMES,
          noRecallNotice: NO_RECALL_NOTICE,
        });
        messages = r.messages;
        canContinue = r.stopReason === "exhausted";
      } catch (e) {
        if (shouldQuit) return 130;
        // 中断/出错后不提供「继续」（上下文可能不一致），下一行须是新指令。
        canContinue = false;
        if (ac.signal.aborted) process.stdout.write("\n· 已中断当前轮\n");
        else process.stderr.write(`\n✗ ${(e as Error).message}\n`);
      } finally {
        process.off("SIGINT", onSigint);
        isRunning = false;
      }
    }
  } finally {
    rl.close();
    cfg.tracer?.close();
    if (cfg.tracer?.isActive()) process.stdout.write(`· trace → ${resolve(cfg.tracer.path)}\n`);
  }
}

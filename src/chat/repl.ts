// === 自建实现: chat REPL——readline 循环，累积对话+观察历史，SIGINT 中断当前轮，quit/exit/q 退出 ===
//
// 上游：src/chat/index.ts；下游：runLoop。纪律：Ctrl+C 只中断当前轮、不回退历史；
// 空闲提示符 Ctrl+C 由 Node 默认 SIGINT 处理，readline 会关闭、进程自然退出。
import { createInterface } from "node:readline/promises";
import type { ModelMessage, ToolSet } from "ai";
import { runLoop, type LoopEvent } from "./loop.js";

/**
 * REPL 循环：每行输入追加为 user 消息，跑一轮 runLoop，累积返回的 messages 作下一轮上下文。
 * quit/exit/q（trim、忽略大小写）退出；输入中 Ctrl+C → abort 当前轮、回到提示符；空闲提示符 Ctrl+C → 退出。
 */
export async function runRepl(
  model: unknown,
  tools: ToolSet,
  opts: { maxSteps: number },
  cfg: { system: string; onEvent: (e: LoopEvent) => void },
): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let messages: ModelMessage[] = [{ role: "system", content: cfg.system }];
  try {
    for (;;) {
      const line = (await rl.question("\nchat> ")).trim();
      if (line === "quit" || line === "exit" || line === "q") return 0;
      if (line === "") continue;
      messages.push({ role: "user", content: line });
      const ac = new AbortController();
      const onSigint = (): void => ac.abort();
      process.on("SIGINT", onSigint);
      try {
        messages = await runLoop(messages, { model, tools, maxSteps: opts.maxSteps, onEvent: cfg.onEvent, abortSignal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) process.stdout.write("\n· 已中断当前轮\n");
        else process.stderr.write(`\n✗ ${(e as Error).message}\n`);
      } finally {
        process.off("SIGINT", onSigint);
      }
    }
  } finally {
    rl.close();
  }
}

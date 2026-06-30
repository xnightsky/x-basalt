// === 自建实现: chat agentic 循环——streamText 多步驱动 plan→act→observe，可中断 ===
//
// 上游：index.ts/repl.ts；下游：ai 的 streamText。读写工具都自动跑（写工具直接落盘）。
// 流式回显推理与每步动作（无确认闸下的可观测兜底）；abortSignal 接 Ctrl+C；stopWhen 限步防失控。
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

export interface LoopEvent {
  type: "text" | "tool-call" | "tool-result" | "finish";
  text?: string;
  toolName?: string;
}

export interface LoopDeps {
  /** provider.createModel 产物（unknown，避免顶层耦合 SDK 运行时类型）。 */
  model: unknown;
  tools: ToolSet;
  maxSteps: number;
  onEvent: (e: LoopEvent) => void;
  /** Ctrl+C/SIGINT 接入：abort 时中断在途模型调用与循环。 */
  abortSignal?: AbortSignal;
  /**
   * 系统提示。**必须经此参数传给 streamText 的 system 选项，绝不能塞进 messages**——
   * ai@7.0.6 默认禁止 messages 里出现 system 角色（InvalidPromptError），系统提示是顶层独立项。
   */
  system?: string;
}

/**
 * 跑一轮 agentic 循环：messages → 模型 → SDK 自动多步 → 流式回显 → 返回追加消息后的完整 messages。
 *
 * @behavior Given 模型发 tool-call When 跑 Then 对应 tool.execute 执行、结果自动喂回模型续推
 * @behavior Given abortSignal 已 abort When 跑 Then 中断（streamText 抛 AbortError，调用方吞掉）
 * @behavior Given 达到 maxSteps When 跑 Then stopWhen 终止
 */
export async function runLoop(messages: ModelMessage[], deps: LoopDeps): Promise<ModelMessage[]> {
  // 已在入口外被 abort：直接中断，避免调模型/执行工具（streamText 对预 abort 的处理
  // 仍会先调一次 doStream，故在调用前显式拦截）。
  if (deps.abortSignal?.aborted) {
    throw new DOMException("This operation was aborted", "AbortError");
  }
  const result = streamText({
    model: deps.model as Parameters<typeof streamText>[0]["model"],
    system: deps.system, // 顶层系统提示；v7 禁止 system 进 messages
    tools: deps.tools,
    messages,
    stopWhen: stepCountIs(deps.maxSteps),
    abortSignal: deps.abortSignal,
  });
  for await (const part of result.fullStream) {
    // 注：part 字段名以 ai@7.0.6 为准（text-delta 的 .text/.delta、tool-call 的 .toolName）。
    if (part.type === "text-delta") {
      deps.onEvent({
        type: "text",
        text:
          (part as { text?: string; delta?: string }).text ?? (part as { delta?: string }).delta,
      });
    } else if (part.type === "tool-call") {
      deps.onEvent({ type: "tool-call", toolName: part.toolName });
    } else if (part.type === "tool-result") {
      deps.onEvent({ type: "tool-result", toolName: part.toolName });
    }
  }
  deps.onEvent({ type: "finish" });
  const response = await result.response;
  return [...messages, ...(response.messages as ModelMessage[])];
}

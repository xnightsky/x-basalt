// === 自建实现: chat agentic 循环——streamText 多步驱动 plan→act→observe，可中断 ===
//
// 上游：index.ts/repl.ts；下游：ai 的 streamText。读写工具都自动跑（写工具直接落盘）。
// 流式回显推理与每步动作（无确认闸下的可观测兜底）；abortSignal 接 Ctrl+C；stopWhen 限步防失控。
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

/**
 * 循环停止原因：
 * - done：模型自然收尾（finishReason==='stop'，话说完了）；
 * - exhausted：撞 maxSteps 顶时模型还想继续调工具（finishReason==='tool-calls'），即「话说一半被截断」。
 * 区分二者是为了不再「撞顶静默停」——exhausted 下提示用户、REPL 可续跑。
 */
export type StopReason = "done" | "exhausted";

export interface LoopEvent {
  type: "text" | "tool-call" | "tool-result" | "tool-error" | "finish";
  text?: string;
  toolName?: string;
  /** tool-call：模型传入的入参（SDK 已从 JSON 解析为对象）。 */
  input?: unknown;
  /** tool-result：execute 的返回值（读工具为 safety 包裹后的字符串）。 */
  output?: unknown;
  /** tool-error：execute 抛出的错误（SDK 捕获后以 tool-error part 下发，此前被整段丢弃）。 */
  error?: unknown;
  /** finish：本轮停止原因，供渲染层区分「· 完成」与「⚠ 撞步数顶、可续」。 */
  stopReason?: StopReason;
  /** finish：本轮 token 用量（provider 返回则带；缺失字段省略）。 */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

/** runLoop 返回：累积后的消息 + 停止原因（供 REPL 决定是否支持「继续」续跑）。 */
export interface LoopResult {
  messages: ModelMessage[];
  stopReason: StopReason;
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
 * @behavior Given 达到 maxSteps 且模型还想调工具 When 跑 Then 停并返回 stopReason='exhausted'
 * @behavior Given 模型自然收尾 When 跑 Then 返回 stopReason='done'
 */
export async function runLoop(messages: ModelMessage[], deps: LoopDeps): Promise<LoopResult> {
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
  for await (const part of result.stream) {
    // 注：part 字段名以 ai@7.0.x 为准——text-delta 的 .text/.delta、tool-call 的 .toolName/.input、
    // tool-result 的 .output、tool-error 的 .error。input/output/error 此前被丢弃，是本次可观测性修复点。
    if (part.type === "text-delta") {
      deps.onEvent({
        type: "text",
        text:
          (part as { text?: string; delta?: string }).text ?? (part as { delta?: string }).delta,
      });
    } else if (part.type === "tool-call") {
      deps.onEvent({ type: "tool-call", toolName: part.toolName, input: part.input });
    } else if (part.type === "tool-result") {
      deps.onEvent({ type: "tool-result", toolName: part.toolName, output: part.output });
    } else if (part.type === "tool-error") {
      deps.onEvent({ type: "tool-error", toolName: part.toolName, error: part.error });
    }
  }
  // 区分自然完成 vs 撞步数顶：步数已达 maxSteps 且最后一步仍在调工具（toolCalls 非空＝模型还想继续动作，
  // 只是被 stopWhen 截断）→ exhausted；否则 done。不用 finishReason 判定——它在 mock/部分 provider 下
  // 聚合为 'other' 不可靠，而 step.toolCalls 是 provider 无关的「还想动作」信号。
  const [steps, usage] = await Promise.all([result.steps, result.usage]);
  const stillActing = (steps.at(-1)?.toolCalls?.length ?? 0) > 0;
  const exhausted = steps.length >= deps.maxSteps && stillActing;
  const stopReason: StopReason = exhausted ? "exhausted" : "done";
  deps.onEvent({
    type: "finish",
    stopReason,
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? undefined,
          outputTokens: usage.outputTokens ?? undefined,
          totalTokens: usage.totalTokens ?? undefined,
        }
      : undefined,
  });
  const response = await result.response;
  return { messages: [...messages, ...(response.messages as ModelMessage[])], stopReason };
}

// === 自建实现: chat agentic 循环——streamText 多步驱动 plan→act→observe，可中断 ===
//
// 上游：index.ts/repl.ts；下游：ai 的 streamText。读写工具都自动跑（写工具直接落盘）。
// 流式回显推理与每步动作（无确认闸下的可观测兜底）；abortSignal 接 Ctrl+C；stopWhen 限步防失控。
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

/**
 * 循环停止原因：
 * - done：模型自然收尾（finishReason==='stop'，话说完了）；
 * - exhausted：撞 maxSteps 顶时模型还想继续调工具（finishReason==='tool-calls'），即「话说一半被截断」；
 * - error-storm：连续工具失败达 maxToolErrors 阈值（2026-08-03 护栏）——AI 死循环止血：
 *   模型反复用错误入参调工具（如 cli 注入的 --vault 对部分子命令无效），每次失败都换法重试但始终失败。
 */
export type StopReason = "done" | "exhausted" | "error-storm";

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
  /**
   * finish：本轮"未从 vault 召回"的如实标注（P1）。仅当本轮产出了实质文本答复、却**零** vault 检索
   * 工具调用时置为 {@link LoopDeps.noRecallNotice} 文案；否则不置。渲染层据此在收尾处提示，避免调用方
   * 把「模型通用知识作答」误当「已从 vault 召回」上报。
   */
  noRecallNotice?: string;
  /** finish：本轮是否实际调用过任一 vault 召回工具，供结构化输出如实标注来源。 */
  recalled?: boolean;
  /** finish：SDK 实际完成的步骤数，供结构化输出报告，不参与停止原因判定。 */
  steps?: number;
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
  /**
   * 计入"已从 vault 召回"的工具名集合（P1）：模型调用了其中任一工具即视为真的查过 vault，
   * 收尾不加标注。skills_* 取的是本 CLI 规范、不算 vault 召回，故不列入。与 {@link noRecallNotice}
   * 配套：二者同时提供才启用"零 vault 工具 → 如实标注"检测。
   */
  recallToolNames?: string[];
  /**
   * 连续工具失败阈值（错误风暴护栏，2026-08-03）：流内累计**连续** tool-error 达此值即
   * 强制中断（stopReason='error-storm'）。缺省 5。
   *
   * 为什么是「连续」而非「累计」：模型正常多步任务中偶发 1-2 次失败（写命令路径错、
   * DQL 拼错）是健康的自纠信号（A≠B 换法），不该打断；只有**连续**失败才说明模型
   * 陷在同一类错误里死循环（本次 cli --vault 注入 bug 的形态）。成功一次即重置计数。
   */
  maxToolErrors?: number;
  /**
   * "未从 vault 召回"标注文案（P1）。本轮产出实质文本答复却零 {@link recallToolNames} 调用时，
   * 经 finish 事件的 {@link LoopEvent.noRecallNotice} 下发给渲染层。未提供 = 不启用该检测（行为不变）。
   */
  noRecallNotice?: string;
}

/**
 * 触发"未召回"标注的最短答复字符数（P1 降噪阈值）：短于此的输出多为寒暄/澄清/拒答，
 * 给它们贴"未从 vault 召回"既无意义又打扰；实质知识答复通常远长于此。取值偏保守，宁可少标不误扰。
 */
const NO_RECALL_MIN_ANSWER_CHARS = 40;

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
  // 错误风暴护栏（2026-08-03）：内部 controller 在连续 tool-error 达阈值时主动 abort，
  // 与外部 abortSignal（Ctrl+C）区分——外部中断由调用方吞掉（行为不变），内部护栏中断
  // 转为 stopReason='error-storm'。用 AbortSignal.any 组合两者，任一触发即停。
  const stormAbort = new AbortController();
  const maxToolErrors = deps.maxToolErrors ?? 5;
  const combined =
    deps.abortSignal !== undefined
      ? AbortSignal.any([deps.abortSignal, stormAbort.signal])
      : stormAbort.signal;
  const result = streamText({
    model: deps.model as Parameters<typeof streamText>[0]["model"],
    system: deps.system, // 顶层系统提示；v7 禁止 system 进 messages
    tools: deps.tools,
    messages,
    stopWhen: stepCountIs(deps.maxSteps),
    abortSignal: combined,
  });
  // P1「未从 vault 召回」检测：累计实质答复长度 + 是否调用过 recall 工具。
  const recallSet = new Set(deps.recallToolNames ?? []);
  let answerChars = 0;
  let usedRecallTool = false;
  // 错误风暴护栏：连续 tool-error 计数（成功一次即重置）。
  let consecutiveToolErrors = 0;
  // 达阈值标记：abort 后 SDK 可能不向迭代器抛 AbortError（finish 事件照常），
  // 故不用 catch 判定，改在 stopReason 判定处优先检查此标记（实测 mock 下 abort 后
  // stream 正常结束、steps 正常返回，AbortError 不抛到迭代器——2026-08-03 实测）。
  let stormTriggered = false;
  for await (const part of result.stream) {
    // 注：part 字段名以 ai@7.0.x 为准——text-delta 的 .text/.delta、tool-call 的 .toolName/.input、
    // tool-result 的 .output、tool-error 的 .error。input/output/error 此前被丢弃，是本次可观测性修复点。
    if (part.type === "text-delta") {
      const text =
        (part as { text?: string; delta?: string }).text ?? (part as { delta?: string }).delta;
      answerChars += text?.length ?? 0;
      deps.onEvent({ type: "text", text });
    } else if (part.type === "tool-call") {
      if (recallSet.has(part.toolName)) usedRecallTool = true;
      deps.onEvent({ type: "tool-call", toolName: part.toolName, input: part.input });
    } else if (part.type === "tool-result") {
      // 成功一次即重置连续失败计数：偶发失败是自纠信号，只有连续失败才是死循环。
      consecutiveToolErrors = 0;
      deps.onEvent({ type: "tool-result", toolName: part.toolName, output: part.output });
    } else if (part.type === "tool-error") {
      consecutiveToolErrors++;
      deps.onEvent({ type: "tool-error", toolName: part.toolName, error: part.error });
      if (consecutiveToolErrors >= maxToolErrors) {
        stormTriggered = true;
        stormAbort.abort(); // 触发 streamText 中断（不再消费后续步骤，省 token/时间）
      }
    }
  }
  // 区分自然完成 vs 撞步数顶 vs 错误风暴：护栏标记优先（连续失败达阈值即 error-storm，
  // 不论步骤数——死循环必须强制停，不该等撞 maxSteps）。
  const [steps, usage] = await Promise.all([result.steps, result.usage]);
  const stillActing = (steps.at(-1)?.toolCalls?.length ?? 0) > 0;
  const exhausted = steps.length >= deps.maxSteps && stillActing;
  const stopReason: StopReason = stormTriggered ? "error-storm" : exhausted ? "exhausted" : "done";
  // P1：本轮产出了实质文本答复、却零 vault 检索工具调用 → 如实标注（配了 noRecallNotice 才启用）。
  const noRecallNotice =
    deps.noRecallNotice && !usedRecallTool && answerChars >= NO_RECALL_MIN_ANSWER_CHARS
      ? deps.noRecallNotice
      : undefined;
  deps.onEvent({
    type: "finish",
    stopReason,
    noRecallNotice,
    recalled: usedRecallTool,
    steps: steps.length,
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? undefined,
          outputTokens: usage.outputTokens ?? undefined,
          totalTokens: usage.totalTokens ?? undefined,
        }
      : undefined,
  });
  // === 自建实现 ===
  // 完整历史必须逐 step 拼接：ai@7 的 `result.response.messages` 只含**最后一步**（实测：
  // step0=assistant(tool-call)+tool(result)、step1=assistant(text) 时，final response.messages
  // 只有 assistant(text)）。只拼 final 会让多轮/续跑丢失全部工具调用与观察——模型下轮看不到
  // 自己查过什么（2026-09-20 session 落盘实测暴露）。
  const stepMessages = steps.flatMap((s) => s.response.messages as ModelMessage[]);
  return { messages: [...messages, ...stepMessages], stopReason };
}

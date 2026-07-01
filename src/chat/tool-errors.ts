// === 自建实现: chat 工具错误结构化层——分类底层错误、包成「带换策略建议」的清晰消息回灌模型 ===
//
// 上游：tools.ts（buildTools 末尾包裹每个工具的 execute）；下游：被包裹的原工具 execute。
//
// 定位（据 dogfood 实测修正，见 docs/research/2026-06-30-chat-gap-vs-agent-browser.md §2.1 取舍）：
//   chat 读多写少、工具皆一次性独立调用（无会话级读写事务/状态），并发写锁竞争几乎不存在——
//   故「对同一调用机械精准重试」收益低，**不做退避重试循环**。
//   真正值钱的是：失败时给模型一条**结构化、可据以换策略**的错误（分类标签 + 自纠方向），
//   引导它「换个写法/字段/工具/路径再试（A≠B）」，而非对同一操作反复微调瞎试。
//   ——即把「重试」从代码层挪到模型策略层。
//
// 取舍备注：若未来确认写侧需要 SQLITE_BUSY 并发兜底，再在此加「极简单次重试」，不预先精密化。

/** 错误归类：决定给模型的自纠/换策略建议（transient 仅用于措辞，本层不据此重试）。 */
export type ErrorClass = "transient" | "not-found" | "dql" | "invalid" | "unknown";

/** 瞬时错误 code（仅用于分类措辞；SQLite 写锁/文件占用/临时不可用）。 */
const TRANSIENT_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_LOCKED",
  "SQLITE_PROTOCOL",
  "EBUSY",
  "EAGAIN",
  "EWOULDBLOCK",
  "EMFILE",
  "ENFILE",
  "ETIMEDOUT",
]);

/** 各类错误给模型的「换策略」建议（核心：引导 A≠B 的多样尝试，而非硬重试）。 */
const ADVICE: Record<ErrorClass, string> = {
  transient: "可能文件被占用或库忙，稍后再试或缩小批量。",
  "not-found":
    "目标不存在：若是笔记路径，先用 scan/meta_get 确认存在或换路径；若是索引库打不开，先建索引（index/scan）或检查 --db。别对同一目标硬试。",
  dql: "DQL 文法可能写错。常见坑：判属性有无用裸字段真值 `WHERE field` 或 `!field`（对标官方 isTruthy；`= null`/`!= null` 是显式键存在判断，把 0/空串视为「有」）；DQL 无 OFFSET（分页在工具 offset/size 层）。换个写法/字段再试、别对同一句反复微调；仍不确定再 skills_get 取 obsidian-base-spec。",
  invalid: "入参不合法：对照工具 schema 检查参数名与类型，调整后再试。",
  unknown: "换一种工具或思路再试，别重复同一失败操作。",
};

/**
 * 错误归类：优先按错误类型名（最鲁棒，不随文案变），再退回 code，最后 message 关键字启发式。
 * @behavior name==='DqlSyntaxError'（只读 query 最高频失败）→ dql
 * @behavior code ∈ TRANSIENT_CODES → transient；code==='ENOENT' → not-found
 * @behavior 否则按 message 关键字判 dql/not-found/invalid，皆不命中 → unknown
 */
export function classifyError(e: unknown): ErrorClass {
  const name = (e as { name?: unknown })?.name;
  // DQL 语法错误是只读 query 场景的主要失败面，按类型名稳判，给「去查文法 + 换写法」建议。
  if (name === "DqlSyntaxError") return "dql";
  const code = (e as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (TRANSIENT_CODES.has(code)) return "transient";
    // ENOENT=笔记文件不存在；SQLITE_CANTOPEN=索引库未建/打不开（只读 query 高频）——都归 not-found，建议见 ADVICE。
    if (code === "ENOENT" || code === "SQLITE_CANTOPEN") return "not-found";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/\bDQL\b|dataview|Expecting|NoViableAlt|MismatchedToken|EarlyExit|无法解析|语法/i.test(msg)) return "dql";
  if (/ENOENT|no such file|unable to open database|不存在/i.test(msg)) return "not-found";
  if (/SQLITE_BUSY|database is locked|resource busy|EBUSY|EAGAIN/i.test(msg)) return "transient";
  if (/invalid|required|不合法|必填|缺少|类型/i.test(msg)) return "invalid";
  return "unknown";
}

/** 把底层错误包成「[工具失败·分类] 原因 + 换策略建议」的结构化消息（供模型自纠）。 */
export function structuredMessage(orig: unknown, cls: ErrorClass): string {
  const base = orig instanceof Error ? orig.message : String(orig);
  const advice = ADVICE[cls];
  return `[工具失败·${cls}] ${base}${advice ? ` ${advice}` : ""}`;
}

/** 工具 execute 的宽松签名（不同工具入参各异，统一按 unknown 处理）。 */
type AnyExecute = (args: unknown, options: unknown) => unknown;

/**
 * 包裹单个工具 execute：捕获底层错误 → 分类 → 抛出结构化错误（保留 cause）。无重试循环。
 * abortSignal 来自 AI SDK 注入工具 execute 第二参的 options.abortSignal：已 abort 则直接中断、不执行。
 *
 * @behavior 执行成功 → 透传返回值
 * @behavior 执行抛错 → 按分类包成结构化错误抛出（带换策略建议），不重试
 * @behavior 调用前 abortSignal 已 abort → 抛 AbortError，不调底层
 */
export function wrapExecute(execute: AnyExecute): AnyExecute {
  return async (args, options) => {
    const signal = (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
    if (signal?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    try {
      return await execute(args, options);
    } catch (e) {
      const err = new Error(structuredMessage(e, classifyError(e)));
      if (e instanceof Error) (err as { cause?: unknown }).cause = e;
      // 抛出（而非返回）结构化错误：AI SDK 把它作为 tool-error，在「同一轮的下一步」喂回模型，
      // 模型据此换策略自纠（已用 mock 端到端验证：失败后第 2 步的 prompt 确含此结构化文本）。
      // 边界：抛出的错误不会留进 streamText 的 response.messages（即跨 REPL 轮累积的历史）——
      // 自纠发生在轮内即够；若将来需让错误进跨轮历史，改为 return structuredMessage(...)（变普通 tool-result）。
      throw err;
    }
  };
}

/**
 * 包裹整个 ToolSet：对每个带 execute 的工具套上 wrapExecute，其余字段原样保留。
 * 重建对象（不原地改），避免 mutate AI SDK tool() 产物。
 */
export function wrapToolErrors<T extends Record<string, unknown>>(tools: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(tools)) {
    const exec = (t as { execute?: unknown }).execute;
    out[name] =
      typeof exec === "function" ? { ...(t as object), execute: wrapExecute(exec as AnyExecute) } : t;
  }
  return out as T;
}

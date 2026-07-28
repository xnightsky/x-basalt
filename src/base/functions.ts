/**
 * base 模块 P1 函数白名单注册表：name / receiver / arity / returnType / scenarioIds / lazy / impl。
 *
 * 名字集合单一真相源是 expressions.ts 的 {@link BASE_FUNCTION_NAMES}（P0 浅扫描同款），
 * 本注册表必须恰好覆盖该集合——模块加载即做一致性自检，缺名/多名直接 throw，防两处漂移。
 *
 * 分派口径（设计 §9）：全局调用查 receiver="global"；方法调用按 receiver 运行时类型查
 * （string/number/list/object/file），查不到回退 "any" 组（isTruthy/isType/toString）；
 * 类型不匹配（如 `number.contains`）由 evaluator 转行级类型错误。
 *
 * 上游：P1 evaluator.ts 查表分派；预算回调经 {@link BaseFunctionContext} 注入。
 * 下游：P1 engine.ts（间接）。
 * 设计真相源：docs/design/bases-engine.md §9；
 * 语法真相源：docs/design/bases-syntax.md §4.4。
 */

import { linkKey, pathKey } from "../utils/path.js";
import { BASE_FUNCTION_NAMES } from "./expressions.js";
import { baseRegexTest } from "./regexp.js";
import {
  BaseTypeError,
  BaseUnsupportedError,
  DAY_MS,
  MISSING,
  compareValues,
  createDateValue,
  createDurationValue,
  isDateValue,
  isDurationValue,
  isFileValue,
  isLinkValue,
  createLinkValue,
  parseDateLike,
  parseDurationLike,
  safeGetOwn,
  truthy,
  typedEqual,
  typeNameOf,
  type BaseDateValue,
  type BaseFileValue,
  type BaseLinkValue,
  type BaseValue,
} from "./values.js";

// === 自建实现 ===

/**
 * 函数挂载点：global=全局函数；any=任意 receiver 可用；其余按 receiver 运行时类型分派。
 *
 * `"number"` 自 2026-07-28 覆盖率片一起独立成组（此前 number 方法挂 "any" 组并在 impl 内
 * 自验 receiver）——组内已有 6 个方法（abs/ceil/floor/round/toFixed/isEmpty），独立分派后
 * `"x".abs()` 得到「类型 string 不支持方法 abs」而非「参数类型错误」，诊断更准确。
 * `"date"` 同理于片二加入（format/time/relative/isEmpty）；duration/link 仍无独立组
 * （只命中 "any"），其内部字段不外露为成员。
 * 新增分派组必须同步改 evaluator.ts 的 `receiverGroupOf()`，否则该组永远查不到。
 */
export type BaseFunctionReceiver =
  | "global"
  | "any"
  | "string"
  | "number"
  | "date"
  | "link"
  | "list"
  | "object"
  | "file";

/**
 * 函数实现上下文（evaluator 注入）：
 * 集合产物元素数与 typedEqual 元素比较都扣预算，函数 impl 不直接感知 limits 数值。
 * P2a：`clock` 供 time 组（today/now）读注入时钟（EvalContext.clock，缺省 `() => new Date()`）。
 */
export interface BaseFunctionContext {
  /**
   * 产物规模硬上限检查；超限抛 BaseBudgetError。
   * list 类计元素数（`list(...)` 参数数、`keys()`/`values()`/`split()` 结果数），
   * string 类计字符数（`repeat()`/`replace()` 可放大长度，须在**分配之前**预检）。
   */
  checkCollectionSize(count: number): void;
  /** list 成员比较（typedEqual）每比较一对元素回调一次（扣 maxOperations）。 */
  spendElementCompare(): void;
  /** 注入时钟（today/now 的时间来源；测试注入固定 clock 保证字节稳定，FORM-006）。 */
  clock(): Date;
  /**
   * 行集内的 file 解析（片三；`file(path)` / `link.asFile()`）。
   * **缺省表示本上下文不提供数据集解析**——impl 须报 `BaseUnsupportedError` 而非静默 MISSING
   * （自定义汇总语境有意不注入，见 evaluator 的 EvalContext.resolveFile）。
   */
  resolveFile?: (target: string) => BaseFileValue | undefined;
}

/** 白名单注册项（设计 §9 要求的声明字段全量）。 */
export interface BaseFunctionEntry {
  readonly name: string;
  readonly receiver: BaseFunctionReceiver;
  readonly arity: { readonly min: number; readonly max: number };
  /** 返回类型的可读声明（文档/诊断用途；P1 不做静态类型检查；P2a 补 date/datetime）。 */
  readonly returnType: "boolean" | "number" | "string" | "list" | "any" | "date" | "datetime";
  /** 场景矩阵编号（docs/design/bases-scenarios.md §4）。 */
  readonly scenarioIds: readonly string[];
  /**
   * lazy 分派：arg 表达式不预求值，evaluator 走特殊路径不调 impl。
   * - `if`：lazy branch——只计算被选择分支（暂定，待 oracle）；
   * - `filter`/`map`/`reduce`（P2b）：list 高阶方法，evaluator 逐元素在隐式作用域
   *   `{ value, index, acc }` 下求值 arg AST（BASE-LIST-001）。
   */
  readonly lazy?: boolean;
  /**
   * 实现。receiver=null 表示全局函数。参数类型错误/arity 外的元素类型错误抛
   * {@link BaseTypeError}（evaluator 叠加节点 offset 转行级诊断）；arity 不符由 evaluator 先验。
   */
  readonly impl: (
    receiver: BaseValue | null,
    args: BaseValue[],
    ctx: BaseFunctionContext,
    entry: BaseFunctionEntry,
  ) => BaseValue;
}

/** 人读签名（类型错误消息用）。 */
function signatureOf(entry: BaseFunctionEntry): string {
  const { min, max } = entry.arity;
  const params =
    max === Number.POSITIVE_INFINITY
      ? min === 0
        ? "..."
        : `${min}+`
      : min === max
        ? `${min}`
        : `${min}..${max}`;
  const head = entry.receiver === "global" ? entry.name : `${entry.receiver}.${entry.name}`;
  return `${head}(arity ${params})`;
}

/** 参数类型错误：带函数签名，便于行级诊断定位到具体调用。 */
function argTypeError(entry: BaseFunctionEntry, message: string): BaseTypeError {
  return new BaseTypeError(`函数 ${signatureOf(entry)} 参数类型错误：${message}`);
}

/** 期望 string 参数，否则抛类型错误。 */
function expectString(entry: BaseFunctionEntry, v: BaseValue, what: string): string {
  if (typeof v !== "string") throw argTypeError(entry, `${what} 须为 string`);
  return v;
}

/**
 * 防御性 receiver 校验（P2b list 高阶组用）：registry 分派已按 receiver 运行时类型查表，
 * 正常路径到 impl 时 receiver 必为 list；本校验只挡「绕过 lookupBaseFunction 直调 impl」的
 * 编程错误面，是注册表分派之后的剩余防线。
 */
function expectListReceiver(entry: BaseFunctionEntry, r: BaseValue | null): BaseValue[] {
  if (!Array.isArray(r)) {
    throw argTypeError(entry, `receiver 须为 list，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/** 同 {@link expectListReceiver}：string 组分派后的剩余防线（挡绕过 registry 直调 impl）。 */
function expectStringReceiver(entry: BaseFunctionEntry, r: BaseValue | null): string {
  if (typeof r !== "string") {
    throw argTypeError(entry, `receiver 须为 string，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/** 同 {@link expectListReceiver}：number 组分派后的剩余防线。 */
function expectNumberReceiver(entry: BaseFunctionEntry, r: BaseValue | null): number {
  if (typeof r !== "number") {
    throw argTypeError(entry, `receiver 须为 number，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/** 期望整数参数（可负；NaN/Infinity/小数/非 number 一律类型错误，不静默取整）。 */
function expectInteger(entry: BaseFunctionEntry, v: BaseValue, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw argTypeError(entry, `${what} 须为整数`);
  }
  return v;
}

/** 期望非负整数参数（同 {@link expectInteger} 再加 `>= 0`）。 */
function expectNonNegativeInteger(entry: BaseFunctionEntry, v: BaseValue, what: string): number {
  const n = expectInteger(entry, v, what);
  if (n < 0) throw argTypeError(entry, `${what} 须为非负整数`);
  return n;
}

/**
 * 渲染类函数统一拒绝（`escapeHTML`/`html`/`image`/`icon`）：
 * 它们进白名单**只为把报错从 `base/unknown-function`（「这函数不存在」，误导）
 * 升级为 `base/unsupported-feature`（「官方有、本引擎不做」，准确）**。
 * x-basalt 是无头查询内核，不产出 HTML/图标/图片（设计 §1）。
 */
function rejectRenderFunction(entry: BaseFunctionEntry): never {
  throw new BaseUnsupportedError(
    `函数 "${entry.name}" 是渲染类能力：x-basalt 为无头查询内核，不产出 HTML/图片/图标（设计 §1）`,
  );
}

/**
 * `max`/`min` 共用：变长 number 参数取极值。
 *
 * 自建口径：**只收变长 number 实参，不收单个 list 参**（官方签名即 `max(...values)`；
 * `containsAll` 那种「单 list 也收」的糖是成员语义的历史包袱，不外扩）。
 * 非 number 参 → 行级类型错误，不静默跳过。非有限值（YAML `.inf`）原样参与，
 * 与既有 `round`/`mean` 的口径一致（不额外做有限性收窄）。
 */
function extremumOf(entry: BaseFunctionEntry, args: BaseValue[], kind: "max" | "min"): number {
  let best: number | undefined;
  for (const a of args) {
    if (typeof a !== "number") {
      throw argTypeError(entry, `参数须全为 number，实为 ${typeNameOf(a)}`);
    }
    if (best === undefined) best = a;
    else best = kind === "max" ? Math.max(best, a) : Math.min(best, a);
  }
  // arity.min=1 已由 evaluator 先验，best 必已赋值；防御性兜底不静默返 0。
  if (best === undefined) throw argTypeError(entry, `${kind} 至少需要一个参数`);
  return best;
}

/** 同 {@link expectListReceiver}：date 组分派后的剩余防线。 */
function expectDateReceiver(entry: BaseFunctionEntry, r: BaseValue | null): BaseDateValue {
  if (r === null || !isDateValue(r)) {
    throw argTypeError(entry, `receiver 须为 date/datetime，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/** 左补零（格式化 token 用）。 */
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

// === Obsidian 规范来源: Bases date.format(format)（官方用 moment 风格 token）===
/**
 * 支持的格式 token → 取值（**全部按 UTF 无时区解释**，与 date/datetime 值域口径一致）。
 *
 * 自建收窄（暂定口径，待 oracle）：**只做与语言无关的数字 token**。
 * `MMMM`（月名）/`dddd`（星期名）/`A`（AM-PM）等本地化 token 一律报错而不是静默输出英文——
 * 官方那些 token 随界面语言变，产出的字节不是稳定 schema（设计 §14「不复刻本地化显示名」），
 * 静默给一种语言比报错更糟。字面文本用 `[方括号]` 转义（同 moment）。
 */
function dateFormatTokens(d: Date): Readonly<Record<string, string>> {
  return {
    YYYY: pad(d.getUTCFullYear(), 4),
    YY: pad(d.getUTCFullYear() % 100),
    MM: pad(d.getUTCMonth() + 1),
    M: String(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    D: String(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    H: String(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    m: String(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
    s: String(d.getUTCSeconds()),
  };
}

/** 支持的 token 名（诊断消息用；取值表的键即全集）。 */
const DATE_FORMAT_TOKEN_NAMES: readonly string[] = Object.keys(dateFormatTokens(new Date(0)));

/**
 * 按 token 表格式化 date（手写扫描）。
 *
 * **分词规则 = 同一字符的最长游程**（moment 的真实 token 语法：`MM`/`MMMM` 是两个不同 token，
 * 而不是「`MM` 重复两次」）。这条不能省：按「最长已知 token 优先」扫描会把 `MMMM` 贪婪切成
 * `MM`+`MM` 静默输出 `0808`，而用户写 `MMMM` 要的是月名——静默给错数字比报错糟得多。
 * 游程整体查表：查不到（`MMMM`/`dddd`/`A`/`Z` 等本地化或未实现 token）即报错。
 * 非字母字符原样透出；`[文本]` 转义字面量（同 moment）。
 */
function formatDateValue(entry: BaseFunctionEntry, epochMs: number, fmt: string): string {
  const table = dateFormatTokens(new Date(epochMs));
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i] as string;
    if (ch === "[") {
      // 字面量转义 `[文本]`；未闭合 `[` 视为格式串写错，报错而非静默当普通字符。
      const end = fmt.indexOf("]", i + 1);
      if (end === -1) throw argTypeError(entry, "格式串中的 `[` 未闭合（字面文本须写作 [文本]）");
      out += fmt.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (!/[A-Za-z]/u.test(ch)) {
      out += ch; // 非字母（`-` `:` 空格 `/` 等）原样透出
      i += 1;
      continue;
    }
    let end = i;
    while (end < fmt.length && fmt[end] === ch) end += 1;
    const runToken = fmt.slice(i, end);
    const value = table[runToken];
    if (value === undefined) {
      throw argTypeError(
        entry,
        `不支持的格式 token "${runToken}"（支持 ${DATE_FORMAT_TOKEN_NAMES.join("/")}；月名/星期名/时区等本地化 token 不做——随界面语言变、非稳定输出；字面文本请写 [文本]）`,
      );
    }
    out += value;
    i = end;
  }
  return out;
}

// === 自建实现: relative()（官方输出随界面语言变，不可复刻，故定义自有确定性口径）===
/** 相对时间的单位阶梯（由大到小；month=30day、year=365day 沿用值域既有固定约定）。 */
const RELATIVE_STEPS: readonly (readonly [string, number])[] = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["week", 7 * DAY_MS],
  ["day", DAY_MS],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

/**
 * 人读相对时间（相对注入 clock）。
 *
 * 自建口径（暂定，待 oracle）：**固定英文**、固定阶梯，形如 `3 days ago` / `in 2 hours`，
 * 1 秒内为 `just now`。不本地化：官方该函数的输出随 Obsidian 界面语言变化，
 * 本就不是稳定 schema（设计 §14），复刻不了也不该复刻；固定串至少保证字节稳定。
 * 时间源恒为注入 clock（`ctx.clock()`），故同 clock 重跑结果一致。
 */
function relativeFromNow(epochMs: number, now: number): string {
  const diff = now - epochMs; // >0 表示过去
  const abs = Math.abs(diff);
  if (abs < 1_000) return "just now";
  const step = RELATIVE_STEPS.find(([, ms]) => abs >= ms) ?? RELATIVE_STEPS.at(-1);
  const [unit, unitMs] = step as readonly [string, number];
  const n = Math.floor(abs / unitMs);
  const phrase = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff > 0 ? `${phrase} ago` : `in ${phrase}`;
}

/** 同 {@link expectListReceiver}：link 组分派后的剩余防线。 */
function expectLinkReceiver(entry: BaseFunctionEntry, r: BaseValue | null): BaseLinkValue {
  if (r === null || !isLinkValue(r)) {
    throw argTypeError(entry, `receiver 须为 link，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/** 同 {@link expectListReceiver}：file 组分派后的剩余防线。 */
function expectFileReceiver(entry: BaseFunctionEntry, r: BaseValue | null): BaseFileValue {
  if (r === null || !isFileValue(r)) {
    throw argTypeError(entry, `receiver 须为 file，实为 ${typeNameOf(r as BaseValue)}`);
  }
  return r;
}

/**
 * 取「链接目标字符串」：接受 string / link / file 三种形态（片三 `linksTo`/`file()`/`link()` 共用）。
 * 这是 `linksTo` 相对既有 `hasLink(string)` 的增量——后者只收字符串，前者收**类型化的**目标，
 * 于是 `file.linksTo(link(...))` / `file.linksTo(file(...))` 可写。
 */
function linkTargetOf(entry: BaseFunctionEntry, v: BaseValue, what: string): string {
  if (typeof v === "string") return v;
  if (isLinkValue(v)) return v.target;
  if (isFileValue(v)) return v.path;
  throw argTypeError(entry, `${what} 须为 string/link/file，实为 ${typeNameOf(v)}`);
}

/**
 * 取行集 file 解析器；未注入即「本上下文不提供数据集解析」→ unsupported，而非静默 MISSING。
 * 触发点只有一个：自定义汇总求值（禁止访问行外状态，见 evaluator 的 EvalContext.resolveFile）。
 */
function requireResolver(
  entry: BaseFunctionEntry,
  ctx: BaseFunctionContext,
): (target: string) => BaseFileValue | undefined {
  if (ctx.resolveFile === undefined) {
    throw new BaseUnsupportedError(
      `函数 "${entry.name}" 需要数据集行集才能解析文件，当前求值上下文不提供（自定义汇总的 values 作用域禁止访问行外状态）`,
    );
  }
  return ctx.resolveFile;
}

/**
 * `slice` 共用的索引校验（string/list 两组同款）：start 必传、end 可选，均须为整数。
 * 负索引与越界钳制**沿用 JS `slice` 语义**（自建口径，官方未定义；标注待 oracle）。
 */
function sliceArgs(entry: BaseFunctionEntry, args: BaseValue[]): [number, number | undefined] {
  const start = expectInteger(entry, args[0] as BaseValue, "start");
  const end = args.length >= 2 ? expectInteger(entry, args[1] as BaseValue, "end") : undefined;
  return [start, end];
}

/**
 * containsAll/containsAny 参数归一（设计 §9 / 语法 §4.4）：
 * 接受变长参数（`x.containsAll("a","b")`）或单个 list 参数（`x.containsAll(["a","b"])`）。
 *
 * 空 needle 集口径（自建冻结）：containsAll → true（空集全称成立）、containsAny → false
 * （空集无任一），与主流集合语义一致；官方 oracle 未覆盖，注释存证。
 *
 * @param requireString - string 版要求元素全为 string；list 版不限制元素类型（typedEqual 比较）
 */
function collectNeedles(
  entry: BaseFunctionEntry,
  args: BaseValue[],
  requireString: boolean,
): BaseValue[] {
  const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (requireString) {
    for (const item of items) {
      if (typeof item !== "string") throw argTypeError(entry, "元素须全为 string");
    }
  }
  return items;
}

// === Obsidian 规范来源: Bases 函数白名单（设计 §9 / 语法 §4.4，名字集合复用 BASE_FUNCTION_NAMES）===

const ENTRIES: readonly BaseFunctionEntry[] = [
  // ---- global ----
  {
    name: "if",
    receiver: "global",
    arity: { min: 3, max: 3 },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-005"],
    // 暂定 lazy（待 oracle）：只计算被选择分支，未选分支的副作用/错误不污染结果；
    // evaluator 对 lazy 条目走特殊路径，impl 永不应被调用（防御性 throw）。
    lazy: true,
    impl: () => {
      throw new BaseTypeError("lazy 函数 if 不应经 impl 调用（evaluator 特殊路径）");
    },
  },
  {
    name: "list",
    receiver: "global",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-005"],
    impl: (_r, args, ctx) => {
      // 参数数即产物元素数，受 maxCollectionItems 硬上限约束（设计 §12）。
      ctx.checkCollectionSize(args.length);
      return [...args];
    },
  },
  {
    name: "number",
    receiver: "global",
    arity: { min: 1, max: 1 },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    impl: (_r, args, _ctx, entry) => {
      const v = args[0] as BaseValue;
      if (typeof v === "number") return v; // number 原样返回
      if (typeof v === "string") {
        // trim 后整体可解析为有限 number 才转换（" 1 "→1、"1px"→错误）；
        // 转换失败行为 P1 冻结为「行级类型错误」（BASE-EXPR-005 可观察）。
        const t = v.trim();
        if (t !== "") {
          const n = Number(t);
          if (Number.isFinite(n)) return n;
        }
      }
      // null/MISSING/boolean/list/object/不可解析字符串一律类型错误，不静默塌 0。
      throw argTypeError(entry, "不可转换为 number");
    },
  },
  {
    name: "max",
    receiver: "global",
    arity: { min: 1, max: Number.POSITIVE_INFINITY },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases max(...values) ===
    impl: (_r, args, _ctx, entry) => extremumOf(entry, args, "max"),
  },
  {
    name: "min",
    receiver: "global",
    arity: { min: 1, max: Number.POSITIVE_INFINITY },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases min(...values) ===
    impl: (_r, args, _ctx, entry) => extremumOf(entry, args, "min"),
  },

  // ---- 渲染类（白名单 + 显式拒绝；2026-07-28 覆盖率片一）----
  // arity 一律放宽到 0..∞：目的是让**任何**写法都命中「本引擎不做」这条诊断，
  // 而不是先被 arity 校验挡成「参数个数不符」——后者会误导读出方以为改改参数就能用。
  {
    name: "html",
    receiver: "global",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases html()（渲染类，x-basalt 不做）===
    impl: (_r, _args, _ctx, entry) => rejectRenderFunction(entry),
  },
  {
    name: "image",
    receiver: "global",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases image()（渲染类，x-basalt 不做）===
    impl: (_r, _args, _ctx, entry) => rejectRenderFunction(entry),
  },
  {
    name: "icon",
    receiver: "global",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases icon()（渲染类，x-basalt 不做）===
    impl: (_r, _args, _ctx, entry) => rejectRenderFunction(entry),
  },
  {
    name: "random",
    receiver: "global",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases random()（官方有；x-basalt 显式拒绝，理由见下）===
    impl: (_r, _args, _ctx, entry) => {
      // 用户 2026-07-28 拍板：**直接拒绝**，不注入种子、不放弃字节稳定。
      // random() 与本引擎的核心契约「同一 DB + 同一 .base + 同一注入 clock 重跑，
      // JSON.stringify 全等」直接冲突——那条保证是 x-basalt 相对官方 CLI 最硬的卖点
      // （官方实测连自己重放都不一致），不为一个叶子函数让路。
      throw new BaseUnsupportedError(
        `函数 "${entry.name}" 与 x-basalt 的字节稳定保证冲突：同一输入必得同一输出是本引擎的核心契约，故不提供随机数。如需随机抽样请在调用侧对结果洗牌`,
      );
    },
  },
  {
    name: "escapeHTML",
    // 挂 string 组而非 any：官方签名即 string 方法，`5.escapeHTML()` 应得
    // 「类型 number 不支持方法」这条正确诊断，不该被 unsupported 掩盖。
    receiver: "string",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "any",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.escapeHTML()（渲染类，x-basalt 不做）===
    impl: (_r, _args, _ctx, entry) => rejectRenderFunction(entry),
  },

  // ---- time（P2a；从 ctx.clock 读注入时钟，测试必须注入固定 clock——FORM-006）----
  {
    name: "today",
    receiver: "global",
    arity: { min: 0, max: 0 },
    returnType: "date",
    scenarioIds: ["BASE-FORM-006"],
    impl: (_r, _args, ctx) => {
      // 拍板：today 锚定 UTC 日历日（当日 UTC 00:00），无头执行不取宿主时区，
      // 保证同一 vault 在不同时区机器上结果字节一致。
      const d = ctx.clock();
      return createDateValue("date", Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    },
  },
  {
    name: "now",
    receiver: "global",
    arity: { min: 0, max: 0 },
    returnType: "datetime",
    scenarioIds: ["BASE-FORM-006"],
    impl: (_r, _args, ctx) => createDateValue("datetime", ctx.clock().getTime()),
  },

  // ---- date/duration 构造（2026-07-28 覆盖率片二）----
  // 快照说明：`date()`/`duration()` 晚于本仓 2026-07-22 冻结快照，本片显式采纳
  // （语法 §1.1 漂移记录同步更新）。`%` 取模仍未采纳。
  {
    name: "date",
    receiver: "global",
    arity: { min: 1, max: 1 },
    returnType: "date",
    scenarioIds: ["BASE-TYPE-005"],
    // === Obsidian 规范来源: Bases date(value) 构造 ===
    impl: (_r, args, _ctx, entry) => {
      const v = args[0] as BaseValue;
      // 幂等：已是 date/datetime 原样返回（`date(date(x)) == date(x)`）。
      if (isDateValue(v)) return v;
      if (typeof v === "string") {
        // 严格 ISO（与 frontmatter 推断同一函数，保证「属性里能识别的」与「date() 能构造的」
        // 是同一集合，不出现两套日期口径）。
        const d = parseDateLike(v);
        if (d !== undefined) return d;
        throw argTypeError(
          entry,
          `"${v}" 不是严格 ISO 日期（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm[:ss] 可带 Z/±hh:mm）`,
        );
      }
      // === 自建实现 ===
      // number → 按 epoch 毫秒构造 datetime：让 `date(file.ctime)` 可用（ctime/mtime 在值域
      // 里就是 epoch 毫秒，算术层的 wrapEpochForArith 已按同一口径处理，此处与之一致）。
      if (typeof v === "number") {
        if (!Number.isFinite(v)) throw argTypeError(entry, "epoch 毫秒须为有限数值");
        return createDateValue("datetime", v);
      }
      throw argTypeError(entry, `不可转换为 date，实为 ${typeNameOf(v)}`);
    },
  },
  {
    name: "duration",
    receiver: "global",
    arity: { min: 1, max: 1 },
    returnType: "any",
    scenarioIds: ["BASE-TYPE-005"],
    // === Obsidian 规范来源: Bases duration(value) 构造 ===
    impl: (_r, args, _ctx, entry) => {
      const v = args[0] as BaseValue;
      if (isDurationValue(v)) return v; // 幂等
      if (typeof v === "string") {
        const d = parseDurationLike(v);
        if (d !== undefined) return d;
        throw argTypeError(
          entry,
          `"${v}" 不是合法 duration（形如 "1day"/"1 day"/"2 hours"，或官方短单位 y/M/w/d/h/m/s——短单位大小写敏感：M=月、m=分）`,
        );
      }
      // === 自建实现 ===
      // number → 毫秒：与 toOutputValue 把 duration 输出成毫秒数的口径互为逆，可往返。
      if (typeof v === "number") {
        if (!Number.isFinite(v)) throw argTypeError(entry, "毫秒数须为有限数值");
        return createDurationValue(v, "millisecond");
      }
      throw argTypeError(entry, `不可转换为 duration，实为 ${typeNameOf(v)}`);
    },
  },

  // ---- file/link 构造（2026-07-28 覆盖率片三）----
  // 快照说明：`link()`/`file()` 同 date()/duration()，晚于 2026-07-22 冻结快照，本片采纳。
  // 文法说明：`file` 是关键字 token，`file(...)` 的调用形态由 parser 的 rootRef 分支支持。
  {
    name: "file",
    receiver: "global",
    arity: { min: 1, max: 1 },
    returnType: "any",
    scenarioIds: ["BASE-FILE-001"],
    // === Obsidian 规范来源: Bases file(path) 构造 ===
    impl: (_r, args, ctx, entry) => {
      const v = args[0] as BaseValue;
      if (isFileValue(v)) return v; // 幂等
      const target = linkTargetOf(entry, v, "路径");
      // 解析范围 = **当前查询的行集**（不查库、不碰文件系统）：markdown 模式解析不到附件，
      // all-files 模式才能——`file()` 看得见的东西与查询数据集口径一致。
      // 解析不到 → MISSING（读侧不塌缩；投影时才成 null），不伪造空 file 值。
      return requireResolver(entry, ctx)(target) ?? MISSING;
    },
  },
  {
    name: "link",
    receiver: "global",
    arity: { min: 1, max: 2 },
    returnType: "any",
    scenarioIds: ["BASE-TYPE-006"],
    // === Obsidian 规范来源: Bases link(target, display?) 构造 ===
    impl: (_r, args, _ctx, entry) => {
      const v = args[0] as BaseValue;
      const display =
        args.length === 2 ? expectString(entry, args[1] as BaseValue, "显示文本") : undefined;
      // 幂等分支：已是 link 且未换显示文本 → 原样；给了 display → 换显示文本的新 link。
      if (isLinkValue(v) && display === undefined) return v;
      const target = linkTargetOf(entry, v, "链接目标");
      // link 是**纯值构造**，不解析行集：指向不存在的文件也合法（wikilink 本就允许悬空），
      // 与 file() 的「解析不到 → MISSING」是有意的两种口径。
      return createLinkValue({ target, ...(display !== undefined ? { display } : {}) });
    },
  },

  // ---- link 方法组（2026-07-28 覆盖率片三新增分派组）----
  {
    name: "asFile",
    receiver: "link",
    arity: { min: 0, max: 0 },
    returnType: "any",
    scenarioIds: ["BASE-TYPE-006", "BASE-FILE-001"],
    // === Obsidian 规范来源: Bases link.asFile() ===
    impl: (r, _args, ctx, entry) => {
      const link = expectLinkReceiver(entry, r);
      // 用原始 target（未归一）走解析器三级匹配：bare `[[A]]` 也能命中 `Projects/A.md`。
      // 悬空链接 → MISSING（与 file() 同口径）。
      return requireResolver(entry, ctx)(link.target) ?? MISSING;
    },
  },

  // ---- date 方法组（2026-07-28 覆盖率片二新增分派组）----
  {
    name: "format",
    receiver: "date",
    arity: { min: 1, max: 1 },
    returnType: "string",
    scenarioIds: ["BASE-TYPE-005"],
    // === Obsidian 规范来源: Bases date.format(format) ===
    impl: (r, args, _ctx, entry) => {
      const d = expectDateReceiver(entry, r);
      const fmt = expectString(entry, args[0] as BaseValue, "格式串");
      return formatDateValue(entry, d.epochMs, fmt);
    },
  },
  {
    name: "time",
    receiver: "date",
    arity: { min: 0, max: 0 },
    returnType: "any",
    scenarioIds: ["BASE-TYPE-005"],
    // === Obsidian 规范来源: Bases date.time() ===
    impl: (r, _args, _ctx, entry) => {
      const d = expectDateReceiver(entry, r);
      // === 自建实现（暂定口径，待 oracle）===
      // 返回**当日 UTC 零点起的 duration**，而不是 "HH:mm" 字符串：duration 是既有类型，
      // 可比较（`t > 12hours`）、可算术；要字符串用 format("HH:mm") 即可，不需要两条路。
      // precision="date" 的值恒为 0 duration（其 epoch 就是当日 UTC 00:00）。
      // 取模两次是为负 epoch（1970 前的日期）也落在 [0, DAY_MS)。
      return createDurationValue(((d.epochMs % DAY_MS) + DAY_MS) % DAY_MS, "millisecond");
    },
  },
  {
    name: "relative",
    receiver: "date",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-TYPE-005", "BASE-FORM-006"],
    // === Obsidian 规范来源: Bases date.relative() ===
    impl: (r, _args, ctx, entry) => {
      const d = expectDateReceiver(entry, r);
      // 时间源恒为注入 clock（与 today/now 同源）——否则本函数会破坏字节稳定。
      return relativeFromNow(d.epochMs, ctx.clock().getTime());
    },
  },
  {
    name: "isEmpty",
    receiver: "date",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-TYPE-005"],
    // === Obsidian 规范来源: Bases date.isEmpty() ===
    // 同 number.isEmpty：date 值恒非空；「属性缺失」是 MISSING，走既有传播路径。
    impl: (r, _args, _ctx, entry) => {
      expectDateReceiver(entry, r);
      return false;
    },
  },

  // ---- any（任意 receiver 回退组；方法形态，arity 只计显式实参，receiver 即被判定值）----
  {
    name: "isTruthy",
    receiver: "any",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-PROP-004"],
    impl: (r) => truthy(r as BaseValue),
  },
  {
    name: "isType",
    receiver: "any",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-PROP-004"],
    impl: (r, args, _ctx, entry) => {
      const name = expectString(entry, args[0] as BaseValue, "类型名");
      // 合法类型名集合（设计 §9）；未知名 → 类型错误（不静默 false，防拼写漂移）。
      switch (name) {
        case "string":
          return typeof r === "string";
        case "number":
          return typeof r === "number";
        case "boolean":
          return typeof r === "boolean";
        case "list":
          return Array.isArray(r);
        case "object":
          return typeof r === "object" && r !== null && !Array.isArray(r) && !isFileValue(r);
        case "null":
          // 暂定（无 oracle 数据）：仅**显式 null** 命中 "null"，MISSING 不命中。
          // 注意这与 oracle ① 冻结的 equality **有意不一致**——`missing == null` 为 true，
          // 但 `missing.isType("null")` 仍为 false：`isType` 问的是「这个值是什么类型」，
          // 官方观察只覆盖了 `==`，没覆盖 isType，故不外推。要判空用 `x == null` 或 `isEmpty()`。
          return r === null;
        default:
          throw argTypeError(entry, `未知类型名 "${name}"`);
      }
      // MISSING/file 对上述六名全 false：MISSING 不是任何一种具名类型（暂定，待 oracle）；
      // file 是独立运行时类型，不在 P1 六名之内。
    },
  },
  {
    name: "toString",
    receiver: "any",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-005"],
    impl: (r, _args, _ctx, entry) => {
      // P1 冻结口径：string 原样；number/boolean 经 String()；null/MISSING → ""；
      // list/object/file → 类型错误（不定义其字符串化，避免 "[object Object]" 式泄漏）。
      if (typeof r === "string") return r;
      if (typeof r === "number" || typeof r === "boolean") return String(r);
      if (r === null || r === MISSING) return "";
      throw argTypeError(entry, "list/object/file 不支持 toString");
    },
  },

  // ---- string ----
  {
    name: "contains",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r, args, _ctx, entry) =>
      (r as string).includes(expectString(entry, args[0] as BaseValue, "子串")),
  },
  {
    name: "containsAll",
    receiver: "string",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r, args, _ctx, entry) =>
      collectNeedles(entry, args, true).every((n) => (r as string).includes(n as string)),
  },
  {
    name: "containsAny",
    receiver: "string",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r, args, _ctx, entry) =>
      collectNeedles(entry, args, true).some((n) => (r as string).includes(n as string)),
  },
  {
    name: "startsWith",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r, args, _ctx, entry) =>
      (r as string).startsWith(expectString(entry, args[0] as BaseValue, "前缀")),
  },
  {
    name: "endsWith",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r, args, _ctx, entry) =>
      (r as string).endsWith(expectString(entry, args[0] as BaseValue, "后缀")),
  },
  {
    name: "lower",
    receiver: "string",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r) => (r as string).toLowerCase(),
  },
  {
    name: "trim",
    receiver: "string",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    impl: (r) => (r as string).trim(),
  },

  // ---- string 机械叶子（2026-07-28 覆盖率片一，计划 docs/plans/2026-07-28-bases-functions.md）----
  {
    name: "replace",
    receiver: "string",
    arity: { min: 2, max: 2 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.replace(pattern, replacement) ===
    impl: (r, args, ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      const needle = expectString(entry, args[0] as BaseValue, "被替换子串");
      const replacement = expectString(entry, args[1] as BaseValue, "替换文本");
      // === 自建实现 ===
      // 字面子串**全局**替换，非 regex（regex 整体延后到 matches 片，需先做 ReDoS 防护
      // BASE-SEC-004）。用 split/join 而非 String.replaceAll，是为了让替换文本里的
      // `$&`/`$1` 保持字面量——replaceAll 会把它们当替换模式展开。
      // 空 needle → 类型错误：JS 语义是「每个字符间插入」，属反直觉行为，不静默提供。
      if (needle === "") throw argTypeError(entry, "被替换子串不可为空串");
      const out = s.split(needle).join(replacement);
      // 替换可放大长度（`"aaa".replace("a", <长串>)`），产物规模受硬上限约束。
      ctx.checkCollectionSize(out.length);
      return out;
    },
  },
  {
    name: "repeat",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.repeat(count) ===
    impl: (r, args, ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      const n = expectNonNegativeInteger(entry, args[0] as BaseValue, "重复次数");
      // 先按「结果长度」预检再构造：`"x".repeat(1e9)` 必须在分配之前被预算拦下。
      ctx.checkCollectionSize(s.length * n);
      return s.repeat(n);
    },
  },
  {
    name: "reverse",
    receiver: "string",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.reverse() ===
    impl: (r, _args, _ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      // === 自建实现 ===
      // 按 Unicode code point 反转（[...s] 迭代按 code point），不按 UTF-16 code unit——
      // 后者会拆坏代理对产出非法字符串。已知限制：组合字符簇（变音符、ZWJ emoji 序列）
      // 仍会被拆散，无 Intl.Segmenter 依赖下不做字素簇分割，注释存证。
      return [...s].toReversed().join("");
    },
  },
  {
    name: "slice",
    receiver: "string",
    arity: { min: 1, max: 2 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.slice(start, end?) ===
    impl: (r, args, _ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      // 自建口径（待 oracle）：负索引从尾部计、越界钳制，均沿用 JS slice 语义；
      // 索引按 UTF-16 code unit（与 JS 一致），与 reverse 的 code point 口径不同——
      // slice 保 JS 兼容（索引可预期），reverse 保字符串合法性，两处取舍不同故注释存证。
      const [start, end] = sliceArgs(entry, args);
      return end === undefined ? s.slice(start) : s.slice(start, end);
    },
  },
  {
    name: "split",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.split(separator) ===
    impl: (r, args, ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      const sep = expectString(entry, args[0] as BaseValue, "分隔符");
      // 空分隔符按 JS 语义逐 UTF-16 code unit 切分（与 replace 的「空串报错」取舍不同：
      // split("") 是有意义且常用的行为，replace("") 不是）。产物元素数受硬上限。
      const out = s.split(sep);
      ctx.checkCollectionSize(out.length);
      return out;
    },
  },
  {
    name: "title",
    receiver: "string",
    arity: { min: 0, max: 0 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.title()（title case）===
    impl: (r, _args, _ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      // === 自建实现（暂定口径，待 oracle）===
      // 「按空白切词 → 词首大写 + 词余小写」，空白原样保留。官方精确口径未知
      // （是否只大写首词、是否保留词内已有大写均未定义）；此实现确定性且幂等。
      // 内部固定字面 regex（非用户输入、线性匹配），不涉 ReDoS 面。
      return s.replace(/\S+/gu, (word) => {
        const [first, ...rest] = [...word];
        return (first ?? "").toUpperCase() + rest.join("").toLowerCase();
      });
    },
  },
  {
    name: "matches",
    receiver: "string",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003", "BASE-SEC-004"],
    // === Obsidian 规范来源: Bases string.matches(regex) ===
    impl: (r, args, _ctx, entry) => {
      const s = expectStringReceiver(entry, r);
      const pattern = expectString(entry, args[0] as BaseValue, "正则源");
      // pattern 是**字符串**而非 regex 字面量——文法层继续拒绝 `/…/` 字面量（语法 §4.3）。
      // ReDoS 三层防护（静态拒绝灾难性构造 / 限长 / 有界编译缓存）见 regexp.ts；
      // 不合法或不安全 → BaseInvalidRegexError → 行级 base/invalid-regex，**不静默不匹配**
      // （与 DQL 侧 regexmatch 降级为 0 的策略有意不同，理由见 regexp.ts 文件头）。
      return baseRegexTest(pattern, s);
    },
  },
  {
    name: "isEmpty",
    receiver: "string",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-003"],
    // === Obsidian 规范来源: Bases string.isEmpty() ===
    // 长度 0 即空（不 trim——`" "` 非空，与 list/object 的「元素/键个数为 0」同层次口径）。
    impl: (r, _args, _ctx, entry) => expectStringReceiver(entry, r).length === 0,
  },

  // ---- number（2026-07-28 覆盖率片一新增分派组；round 由 "any" 组迁入）----
  {
    name: "abs",
    receiver: "number",
    arity: { min: 0, max: 0 },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases number.abs() ===
    impl: (r, _args, _ctx, entry) => Math.abs(expectNumberReceiver(entry, r)),
  },
  {
    name: "ceil",
    receiver: "number",
    arity: { min: 0, max: 0 },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases number.ceil() ===
    impl: (r, _args, _ctx, entry) => Math.ceil(expectNumberReceiver(entry, r)),
  },
  {
    name: "floor",
    receiver: "number",
    arity: { min: 0, max: 0 },
    returnType: "number",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases number.floor() ===
    impl: (r, _args, _ctx, entry) => Math.floor(expectNumberReceiver(entry, r)),
  },
  {
    name: "toFixed",
    receiver: "number",
    arity: { min: 0, max: 1 },
    returnType: "string",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases number.toFixed(precision)（返回 string，与 round 返 number 不同）===
    impl: (r, args, _ctx, entry) => {
      const n = expectNumberReceiver(entry, r);
      const digits =
        args.length === 1 ? expectNonNegativeInteger(entry, args[0] as BaseValue, "digits") : 0;
      // JS toFixed 定义域为 0..100，越界抛 RangeError（非 BaseTypeError，会穿透行级通道
      // 变成引擎级异常）——前置拦成行级类型错误。
      if (digits > 100) throw argTypeError(entry, "digits 须在 0..100（JS toFixed 定义域）");
      return n.toFixed(digits);
    },
  },
  {
    name: "isEmpty",
    receiver: "number",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-005"],
    // === Obsidian 规范来源: Bases number.isEmpty() ===
    // 自建口径：number 恒非空（`0` 是有值的 0，不是「空」）。「属性缺失」是 MISSING，
    // 走 receiver=MISSING 的既有路径（any 组查不到 → MISSING 传播），不由本条覆盖。
    impl: (r, _args, _ctx, entry) => {
      expectNumberReceiver(entry, r);
      return false;
    },
  },

  // ---- list ----
  {
    name: "contains",
    receiver: "list",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r, args, ctx) => {
      // list 成员比较用 typed equality（设计 §9）：数字 ≠ 数字字符串。
      const list = r as BaseValue[];
      const needle = args[0] as BaseValue;
      return list.some((item) => {
        ctx.spendElementCompare();
        return typedEqual(item, needle, ctx.spendElementCompare);
      });
    },
  },
  {
    name: "containsAll",
    receiver: "list",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r, args, ctx, entry) => {
      const list = r as BaseValue[];
      const needles = collectNeedles(entry, args, false);
      return needles.every((needle) =>
        list.some((item) => {
          ctx.spendElementCompare();
          return typedEqual(item, needle, ctx.spendElementCompare);
        }),
      );
    },
  },
  {
    name: "containsAny",
    receiver: "list",
    arity: { min: 0, max: Number.POSITIVE_INFINITY },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r, args, ctx, entry) => {
      const list = r as BaseValue[];
      const needles = collectNeedles(entry, args, false);
      return needles.some((needle) =>
        list.some((item) => {
          ctx.spendElementCompare();
          return typedEqual(item, needle, ctx.spendElementCompare);
        }),
      );
    },
  },
  {
    name: "isEmpty",
    receiver: "list",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r) => (r as BaseValue[]).length === 0,
  },

  // ---- list 高阶方法（P2b 片一，BASE-LIST-001 / BASE-SEC-005）----
  {
    name: "filter",
    receiver: "list",
    arity: { min: 1, max: 1 },
    returnType: "list",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.filter(expr)（官方 Bases 函数文档，隐式 value/index 作用域）===
    // lazy：arg 是表达式而非预求值参数——evaluator 逐元素在隐式作用域 { value, index }
    // 下求值 arg AST，按 truthy 保留（与 if 同款 lazy 接线，impl 永不应被调用，防御性 throw）。
    lazy: true,
    impl: () => {
      throw new BaseTypeError("lazy 函数 filter 不应经 impl 调用（evaluator 特殊路径）");
    },
  },
  {
    name: "map",
    receiver: "list",
    arity: { min: 1, max: 1 },
    returnType: "list",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.map(expr)（隐式 value/index 作用域）===
    // lazy：同 filter，evaluator 逐元素求值并收集结果。
    lazy: true,
    impl: () => {
      throw new BaseTypeError("lazy 函数 map 不应经 impl 调用（evaluator 特殊路径）");
    },
  },
  {
    name: "reduce",
    receiver: "list",
    arity: { min: 2, max: 2 },
    returnType: "any",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.reduce(expr, init)（隐式 value/index/acc 作用域）===
    // lazy：第二参数 init 由 evaluator 在元素作用域外先求值一次作 acc 初值，
    // 随后逐元素在 { value, index, acc } 下求值 arg 并更新 acc。
    lazy: true,
    impl: () => {
      throw new BaseTypeError("lazy 函数 reduce 不应经 impl 调用（evaluator 特殊路径）");
    },
  },
  {
    name: "flat",
    receiver: "list",
    arity: { min: 0, max: 1 },
    returnType: "list",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.flat(depth=1) ===
    impl: (r, args, ctx, entry) => {
      const list = expectListReceiver(entry, r);
      // depth 缺省 1；须非负整数（NaN/Infinity/负数/小数/非 number 一律类型错误，不静默取整）。
      let depth = 1;
      if (args.length === 1) {
        const d = args[0] as BaseValue;
        if (typeof d !== "number" || !Number.isInteger(d) || d < 0) {
          throw argTypeError(entry, "depth 须为非负整数");
        }
        depth = d;
      }
      // 只拍平 list 元素，非 list 元素原样保留；depth=0 → 浅拷贝（不拍平）。
      // 递归深度受实际嵌套层数约束（仅遇 list 才下钻），与 depth 上限无关。
      const out: BaseValue[] = [];
      const walk = (items: BaseValue[], d: number): void => {
        for (const item of items) {
          if (d > 0 && Array.isArray(item)) walk(item, d - 1);
          else out.push(item);
        }
      };
      walk(list, depth);
      // 产物元素数受 maxCollectionItems 硬上限（SEC-005；拍平可能放大元素数）。
      ctx.checkCollectionSize(out.length);
      return out;
    },
  },
  {
    name: "sort",
    receiver: "list",
    arity: { min: 0, max: 0 },
    returnType: "list",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.sort()（方法名，与 view 的 sort 配置无关）===
    impl: (r, _args, ctx, entry) => {
      const list = expectListReceiver(entry, r);
      const out = [...list];
      // === 自建实现 ===
      // 两两 compareValues 升序：number↔number / string↔string / date↔date / duration↔duration
      // 可比；混合类型 / boolean / list / object / link 等不可比组合由 compareValues 抛
      // BaseTypeError → evaluator 转行级类型错误。
      // 暂定口径（待 oracle）：null/MISSING 元素恒排最后（沿用 sortKeyCompare 的「空值最后」
      // 口径，但不引入其跨类型分组的确定性行为——本片混合类型直接报错）。
      out.sort((a, b) => {
        const aEmpty = a === null || a === MISSING;
        const bEmpty = b === null || b === MISSING;
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
        ctx.spendElementCompare(); // 每次比较扣 maxOperations（SEC-005）
        return compareValues(a, b);
      });
      return out;
    },
  },
  {
    name: "unique",
    receiver: "list",
    arity: { min: 0, max: 0 },
    returnType: "list",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.unique() ===
    impl: (r, _args, ctx, entry) => {
      const list = expectListReceiver(entry, r);
      // typedEqual 去重，保留首现，顺序稳定；O(n²) 比较由 maxOperations 预算兜底（SEC-005），
      // 产物不大于输入（输入已受限），无需再 checkCollectionSize。
      const out: BaseValue[] = [];
      outer: for (const item of list) {
        ctx.spendElementCompare(); // 每次元素迭代扣一
        for (const kept of out) {
          if (typedEqual(item, kept, ctx.spendElementCompare)) continue outer;
        }
        out.push(item);
      }
      return out;
    },
  },
  {
    name: "join",
    receiver: "list",
    arity: { min: 0, max: 1 },
    returnType: "string",
    scenarioIds: ["BASE-LIST-001"],
    // === Obsidian 规范来源: Bases list.join(separator="") ===
    impl: (r, args, _ctx, entry) => {
      const list = expectListReceiver(entry, r);
      const sep = args.length === 1 ? expectString(entry, args[0] as BaseValue, "separator") : "";
      // 元素只许 string/number/boolean（number/boolean 经 String() 转换）；
      // null/MISSING/list/object/file/品牌值一律类型错误（不静默塌 ""，与 toString 的分层口径一致）。
      const parts: string[] = [];
      for (const item of list) {
        if (typeof item === "string") parts.push(item);
        else if (typeof item === "number" || typeof item === "boolean") parts.push(String(item));
        else {
          throw argTypeError(
            entry,
            `元素类型 ${typeNameOf(item)} 不支持 join（仅 string/number/boolean）`,
          );
        }
      }
      return parts.join(sep);
    },
  },
  {
    name: "reverse",
    receiver: "list",
    arity: { min: 0, max: 0 },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-004"],
    // === Obsidian 规范来源: Bases list.reverse() ===
    impl: (r, _args, _ctx, entry) => {
      // 必须产新数组：receiver 可能是行的 note 属性数组，原地 reverse 会污染行状态
      // （同 sort 的既有口径），破坏「同输入同输出」的字节稳定保证。
      const list = expectListReceiver(entry, r);
      return list.toReversed();
    },
  },
  {
    name: "slice",
    receiver: "list",
    arity: { min: 1, max: 2 },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-004"],
    // === Obsidian 规范来源: Bases list.slice(start, end?) ===
    impl: (r, args, _ctx, entry) => {
      const list = expectListReceiver(entry, r);
      // 与 string.slice 同口径：负索引/越界钳制沿用 JS slice 语义（自建，待 oracle）。
      // 产物不大于输入（输入已受限），无需 checkCollectionSize。
      const [start, end] = sliceArgs(entry, args);
      return end === undefined ? list.slice(start) : list.slice(start, end);
    },
  },

  // ---- list 聚合 / number 舍入（P2b 片三，BASE-SUM-001 / SUM-002；
  // 官方自定义汇总示例 `values.mean().round(3)` 必需）----
  {
    name: "mean",
    receiver: "list",
    arity: { min: 0, max: 0 },
    returnType: "number",
    scenarioIds: ["BASE-SUM-001"],
    // === Obsidian 规范来源: Bases list.mean()（官方自定义汇总示例 values.mean()）===
    impl: (r, _args, _ctx, entry) => {
      const list = expectListReceiver(entry, r);
      // 空列表 → 行级类型错误（均值无定义，不静默塌 0）；元素须全为 number。
      if (list.length === 0) {
        throw argTypeError(entry, "空列表无均值（mean 只定义在非空 number 列表上）");
      }
      let sum = 0;
      for (const item of list) {
        if (typeof item !== "number") {
          throw argTypeError(entry, `元素须全为 number，实为 ${typeNameOf(item)}`);
        }
        sum += item;
      }
      return sum / list.length;
    },
  },
  {
    name: "round",
    // 2026-07-28 覆盖率片一：由 "any" 组迁入 "number" 组（官方即 number 方法）。
    // 可观察变化：`"x".round()` 的 message 由「参数类型错误：receiver 须为 number」
    // 变为「类型 string 不支持方法 round」，rule 仍为 base/property-type-mismatch。
    receiver: "number",
    arity: { min: 0, max: 1 },
    returnType: "number",
    scenarioIds: ["BASE-SUM-001"],
    // === Obsidian 规范来源: Bases number.round(digits=0)（官方示例 values.mean().round(3)）===
    impl: (r, args, _ctx, entry) => {
      const n = expectNumberReceiver(entry, r);
      // digits 缺省 0；须非负整数（NaN/Infinity/负数/小数/非 number 一律类型错误，不静默取整）。
      const digits =
        args.length === 1 ? expectNonNegativeInteger(entry, args[0] as BaseValue, "digits") : 0;
      // 放缩 Math.round；IEEE 754 边界（如 1.005 → 1）不做十进制修正，注释存证。
      const factor = 10 ** digits;
      return Math.round(n * factor) / factor;
    },
  },

  // ---- object ----
  {
    name: "isEmpty",
    receiver: "object",
    arity: { min: 0, max: 0 },
    returnType: "boolean",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r) => objectEntries(r as Record<string, BaseValue>).length === 0,
  },
  {
    name: "keys",
    receiver: "object",
    arity: { min: 0, max: 0 },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r, _args, ctx) => {
      const entries = objectEntries(r as Record<string, BaseValue>);
      ctx.checkCollectionSize(entries.length);
      return entries.map(([k]) => k);
    },
  },
  {
    name: "values",
    receiver: "object",
    arity: { min: 0, max: 0 },
    returnType: "list",
    scenarioIds: ["BASE-EXPR-004"],
    impl: (r, _args, ctx) => {
      const entries = objectEntries(r as Record<string, BaseValue>);
      ctx.checkCollectionSize(entries.length);
      return entries.map(([, v]) => v);
    },
  },

  // ---- file ----
  {
    name: "hasTag",
    receiver: "file",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-FILE-003"],
    impl: (r, args, _ctx, entry) => {
      const t = expectString(entry, args[0] as BaseValue, "tag").toLowerCase();
      // 口径固定（计划「关键取舍」#7）：精确相等或嵌套前缀（`area` 命中 `area` 与 `area/x`），
      // 大小写不敏感。
      return (r as { tags: readonly string[] }).tags.some((tag) => {
        const tl = tag.toLowerCase();
        return tl === t || tl.startsWith(`${t}/`);
      });
    },
  },
  {
    name: "inFolder",
    receiver: "file",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-FILE-002"],
    impl: (r, args, _ctx, entry) => {
      const f = expectString(entry, args[0] as BaseValue, "目录");
      const folder = (r as { folder: string }).folder;
      // 命中目录本身及其子目录；不命中前缀同名目录（`Projects` 不命中 `Projects2`，
      // 靠 `f + "/"` 边界保证）；大小写敏感（计划「关键取舍」#7）。
      return folder === f || folder.startsWith(`${f}/`);
    },
  },
  {
    name: "hasLink",
    receiver: "file",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-FILE-005"],
    impl: (r, args, _ctx, entry) => {
      const t = expectString(entry, args[0] as BaseValue, "链接目标");
      // 路径感知匹配（复用 utils/path 共享原语，设计 §3 允许）；与 `linksTo` 共用
      // matchesAnyLink，两者对同一目标必给同一答案。
      return matchesAnyLink((r as { links: readonly string[] }).links, t);
    },
  },
  {
    name: "hasProperty",
    receiver: "file",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-FILE-004"],
    impl: (r, args, _ctx, entry) => {
      const k = expectString(entry, args[0] as BaseValue, "属性名");
      // 只判 frontmatter own key 存在性，不看值 falsy（BASE-FILE-004）；
      // 经 safeGetOwn 同款安全过滤：被禁键（__proto__ 等）/getter 一律视为不存在。
      const properties = (r as { properties: Record<string, BaseValue> }).properties;
      return safeGetOwn(properties, k).status === "ok";
    },
  },

  // ---- file 互转（2026-07-28 覆盖率片三）----
  {
    name: "asLink",
    receiver: "file",
    arity: { min: 0, max: 1 },
    returnType: "any",
    scenarioIds: ["BASE-TYPE-006"],
    // === Obsidian 规范来源: Bases file.asLink(display?) ===
    impl: (r, args, _ctx, entry) => {
      const f = expectFileReceiver(entry, r);
      const display =
        args.length === 1 ? expectString(entry, args[0] as BaseValue, "显示文本") : undefined;
      // target 用完整 vault 相对路径（而非 basename）：路径唯一、不受同名文件影响；
      // Link 值的相等比较本就走归一后的 pathKey，带不带扩展名不影响命中。
      return createLinkValue({ target: f.path, ...(display !== undefined ? { display } : {}) });
    },
  },
  {
    name: "linksTo",
    receiver: "file",
    arity: { min: 1, max: 1 },
    returnType: "boolean",
    scenarioIds: ["BASE-FILE-005"],
    // === Obsidian 规范来源: Bases file.linksTo(target) ===
    impl: (r, args, ctx, entry) => {
      const f = expectFileReceiver(entry, r);
      const arg = args[0] as BaseValue;
      // === 自建实现：两种入参 → 两种匹配语义（实测踩到，注释存证）===
      // string / link 入参 = **文本目标**：走与 `hasLink` 完全相同的路径感知文本匹配
      // （两者对同一字符串必给同一答案，测试锁定）。
      //
      // file 入参 = **那个具体文件**：必须走解析，不能走文本匹配。
      // 反例：Alpha 里写的是 bare `[[Beta]]`，而 `file("Beta").path` 是 `Projects/Beta.md`；
      // 文本匹配时目标含 `/` 会进 qualified 分支，pathKey("Beta")="beta" ≠ "projects/beta"
      // → 明明链上了却判 false。改为「把每条出链解析一遍，比解析后的 path」才正确。
      if (isFileValue(arg)) {
        const resolve = requireResolver(entry, ctx);
        return f.links.some((t) => resolve(t)?.path === arg.path);
      }
      const target = linkTargetOf(entry, arg, "链接目标");
      return matchesAnyLink(f.links, target);
    },
  },
];

/**
 * 出链路径感知匹配（`hasLink` 与 `linksTo` 共用，防两处口径分叉）：
 * target 含 `/` → qualified 分支，`pathKey` 精确相等；否则 bare 分支，`linkKey`（小写 basename）相等。
 */
function matchesAnyLink(links: readonly string[], target: string): boolean {
  if (target.includes("/")) {
    const tk = pathKey(target);
    return links.some((t) => pathKey(t) === tk);
  }
  const tk = linkKey(target);
  return links.some((t) => linkKey(t) === tk);
}

/**
 * object 的 own enumerable string key 条目（经 safeGetOwn 安全过滤）。
 * wrapValue 已剔除禁键/getter，此处再过滤一层是防御 row 直接传入未包装对象。
 */
function objectEntries(obj: Record<string, BaseValue>): [string, BaseValue][] {
  const out: [string, BaseValue][] = [];
  for (const key of Object.keys(obj)) {
    const r = safeGetOwn(obj, key);
    if (r.status === "ok") out.push([key, r.value as BaseValue]);
  }
  return out;
}

/** 注册表索引：`${receiver}:${name}` → entry。 */
const REGISTRY = new Map<string, BaseFunctionEntry>();
for (const entry of ENTRIES) {
  const key = `${entry.receiver}:${entry.name}`;
  if (REGISTRY.has(key)) {
    throw new Error(`base 函数注册表重复条目：${key}`);
  }
  REGISTRY.set(key, entry);
}

// 模块加载即一致性自检：注册表名字集合必须恰好等于 BASE_FUNCTION_NAMES（单一真相源），
// 缺名/多名直接 throw——两处漂移属于编程错误，应在加载期暴露而非运行期静默。
{
  const registered = new Set(ENTRIES.map((e) => e.name));
  const missing = [...BASE_FUNCTION_NAMES].filter((n) => !registered.has(n));
  const extra = [...registered].filter((n) => !BASE_FUNCTION_NAMES.has(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `base 函数注册表与 BASE_FUNCTION_NAMES 漂移：缺 [${missing.join(", ")}]，多 [${extra.join(", ")}]`,
    );
  }
}

/**
 * 查注册表。方法分派顺序：先按 receiver 运行时类型查，查不到回退 "any" 组；
 * 均查不到返回 undefined（由 evaluator 转行级类型错误，如 `number.contains`）。
 *
 * @param receiver - "global" 表示全局调用；其余为方法 receiver 的运行时类型
 */
export function lookupBaseFunction(
  name: string,
  receiver: BaseFunctionReceiver,
): BaseFunctionEntry | undefined {
  if (receiver === "global") return REGISTRY.get(`global:${name}`);
  return REGISTRY.get(`${receiver}:${name}`) ?? REGISTRY.get(`any:${name}`);
}

/** 全部注册项（只读；测试/文档枚举用）。 */
export const BASE_FUNCTION_REGISTRY: readonly BaseFunctionEntry[] = ENTRIES;

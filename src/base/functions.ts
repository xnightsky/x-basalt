/**
 * base 模块 P1 函数白名单注册表：name / receiver / arity / returnType / scenarioIds / lazy / impl。
 *
 * 名字集合单一真相源是 expressions.ts 的 {@link BASE_FUNCTION_NAMES}（P0 浅扫描同款），
 * 本注册表必须恰好覆盖该集合——模块加载即做一致性自检，缺名/多名直接 throw，防两处漂移。
 *
 * 分派口径（设计 §9）：全局调用查 receiver="global"；方法调用按 receiver 运行时类型查
 * （string/list/object/file），查不到回退 "any" 组（isTruthy/isType/toString）；
 * 类型不匹配（如 `number.contains`）由 evaluator 转行级类型错误。
 *
 * 上游：P1 evaluator.ts 查表分派；预算回调经 {@link BaseFunctionContext} 注入。
 * 下游：P1 engine.ts（间接）。
 * 设计真相源：docs/specs/2026-07-22-bases-headless-engine-design.md §9；
 * 语法真相源：docs/specs/2026-07-26-bases-syntax.md §4.4。
 */

import { linkKey, pathKey } from "../utils/path.js";
import { BASE_FUNCTION_NAMES } from "./expressions.js";
import {
  BaseTypeError,
  MISSING,
  compareValues,
  createDateValue,
  isFileValue,
  safeGetOwn,
  truthy,
  typedEqual,
  typeNameOf,
  type BaseValue,
} from "./values.js";

// === 自建实现 ===

/** 函数挂载点：global=全局函数；any=任意 receiver 可用；其余按 receiver 运行时类型分派。 */
export type BaseFunctionReceiver = "global" | "any" | "string" | "list" | "object" | "file";

/**
 * 函数实现上下文（evaluator 注入）：
 * 集合产物元素数与 typedEqual 元素比较都扣预算，函数 impl 不直接感知 limits 数值。
 * P2a：`clock` 供 time 组（today/now）读注入时钟（EvalContext.clock，缺省 `() => new Date()`）。
 */
export interface BaseFunctionContext {
  /** 集合产物元素数硬上限检查（list(...) 参数数、keys()/values() 结果数）；超限抛 BaseBudgetError。 */
  checkCollectionSize(count: number): void;
  /** list 成员比较（typedEqual）每比较一对元素回调一次（扣 maxOperations）。 */
  spendElementCompare(): void;
  /** 注入时钟（today/now 的时间来源；测试注入固定 clock 保证字节稳定，FORM-006）。 */
  clock(): Date;
}

/** 白名单注册项（设计 §9 要求的声明字段全量）。 */
export interface BaseFunctionEntry {
  readonly name: string;
  readonly receiver: BaseFunctionReceiver;
  readonly arity: { readonly min: number; readonly max: number };
  /** 返回类型的可读声明（文档/诊断用途；P1 不做静态类型检查；P2a 补 date/datetime）。 */
  readonly returnType: "boolean" | "number" | "string" | "list" | "any" | "date" | "datetime";
  /** 场景矩阵编号（docs/testing/2026-07-22-bases-scenario-matrix.md §4）。 */
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
          // 暂定（待 oracle BASE-PROP-004）：MISSING ≠ null（与 typedEqual 暂定口径一致），
          // 仅显式 null 命中 "null"。
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
    receiver: "any", // number 无独立分派组（receiverGroupOf 对 number 返 null → 回退 any 组）
    arity: { min: 0, max: 1 },
    returnType: "number",
    scenarioIds: ["BASE-SUM-001"],
    // === Obsidian 规范来源: Bases number.round(digits=0)（官方示例 values.mean().round(3)）===
    impl: (r, args, _ctx, entry) => {
      // receiver 落在 any 组（含非 number 类型）：impl 自验，非 number 一律行级类型错误。
      if (typeof r !== "number") {
        throw argTypeError(entry, `receiver 须为 number，实为 ${typeNameOf(r as BaseValue)}`);
      }
      // digits 缺省 0；须非负整数（NaN/Infinity/负数/小数/非 number 一律类型错误，不静默取整）。
      let digits = 0;
      if (args.length === 1) {
        const d = args[0] as BaseValue;
        if (typeof d !== "number" || !Number.isInteger(d) || d < 0) {
          throw argTypeError(entry, "digits 须为非负整数");
        }
        digits = d;
      }
      // 放缩 Math.round；IEEE 754 边界（如 1.005 → 1）不做十进制修正，注释存证。
      const factor = 10 ** digits;
      return Math.round(r * factor) / factor;
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
      const links = (r as { links: readonly string[] }).links;
      // 路径感知匹配（复用 utils/path 共享原语，设计 §3 允许）：
      // t 含 `/` → qualified 分支，pathKey 精确相等；否则 bare 分支，linkKey（小写 basename）相等。
      if (t.includes("/")) {
        const tk = pathKey(t);
        return links.some((target) => pathKey(target) === tk);
      }
      const tk = linkKey(t);
      return links.some((target) => linkKey(target) === tk);
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
];

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

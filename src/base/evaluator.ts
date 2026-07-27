/**
 * base 模块 P1 evaluator：带 {@link BaseExecutionLimits} 预算的纯 AST 解释器。
 *
 * 输入是 parser.ts 产出的 {@link BaseExpr} 与一行 {@link BaseRow}，输出 {@link BaseValue}。
 * 严禁 eval / new Function / vm / 动态 import——全部求值走本文件的显式分派。
 *
 * 行级错误契约（设计 §11「runtime 行级问题主位置指表达式」，供 engine 对齐）：
 * - 求值中的类型错误 / 未知属性 / 安全拒绝，叠加表达式内 UTF-16 offset 经
 *   `ctx.onRowError` 上报一次，随后本函数返回 MISSING（error value，不 throw）；
 * - **filter 语境下该表达式按 false 处理**（truthy(MISSING)=false）；
 *   **projection 语境由调用方决定**（engine 下一步把 missing 投影为 null，并把 file.path 叠进诊断）；
 * - 预算耗尽（{@link BaseBudgetError}）**不在此处吞掉**，继续上抛——engine 捕获后转
 *   `base/execution-budget` 诊断 + 空结果，绝不返回部分结果。
 *
 * 上游：P1 planner 解析出的 BaseExpr；row 由 P1 source.ts 构造（note 为 frontmatter 原始对象）。
 * 下游：P1 engine.ts（filter/projection/sort 均经本入口）。
 * 设计真相源：docs/specs/2026-07-22-bases-headless-engine-design.md §7/§8/§9/§12。
 */

import { BASE_RULES, type BaseRuleId } from "./errors.js";
import { lookupBaseFunction, type BaseFunctionContext } from "./functions.js";
import type { BaseExecutionLimits, BaseExpr } from "./types.js";
import {
  BaseBudgetError,
  BaseTypeError,
  MISSING,
  arithAdd,
  arithDiv,
  arithMul,
  arithNeg,
  arithSub,
  compareValues,
  createDateValue,
  createDurationValue,
  isDateValue,
  isDurationValue,
  isFileValue,
  isLinkValue,
  parseDateLike,
  parseWikilinkValue,
  safeGetOwn,
  truthy,
  typedEqual,
  typeNameOf,
  wrapValue,
  type BaseFileValue,
  type BaseValue,
  type BaseDateValue,
  type BaseDurationValue,
  type BaseLinkValue,
} from "./values.js";

// === 自建实现 ===

export { BaseBudgetError } from "./values.js";

/** 判别预算耗尽信号（engine 据此转 `base/execution-budget` 诊断 + 空结果）。 */
export function isBaseBudgetError(e: unknown): e is BaseBudgetError {
  return e instanceof BaseBudgetError;
}

/**
 * 一行运行时数据（设计 §10）。
 * `note` 为 frontmatter **原始对象**（未包装），求值时经 safeGetOwn + wrapValue 安全读取；
 * `file` 为带品牌的 file 运行时值。
 */
export interface BaseRow {
  note: Record<string, unknown>;
  file: BaseFileValue;
}

/**
 * 行级错误上报（求值不 throw 的配套通道）。
 * `offset` 为表达式内 UTF-16 code unit offset（0-based）——engine 叠加 YAML scalar 起点
 * 换算完整文件行列，并把 row 的 file.path 附进 message/target（本层不感知文件）。
 */
export interface BaseRowErrorInfo {
  rule: BaseRuleId;
  message: string;
  offset: number;
  target?: string;
}

/**
 * 查询级共享操作数计数器：由 engine 每次 query 建一个、传给该次查询的**全部**行/列求值，
 * 使 {@link BaseExecutionLimits.maxTotalOperations} 能跨行累计（单次求值的 maxOperations
 * 每次调用重置，挡不住「每行都烧到上限」）。engine 侧的 groupBy 分桶与 summaries 迭代
 * 也扣同一个计数器，保证一次查询只有一份总额。
 */
export interface BaseSharedOperationBudget {
  used: number;
}

/** 求值上下文：执行预算 + 行级错误回调 + 注入时钟（P2a）。 */
export interface EvalContext {
  limits: BaseExecutionLimits;
  onRowError?: (info: BaseRowErrorInfo) => void;
  /** 查询级共享操作数计数器（缺省时只受单次 maxOperations 约束，用于单元测试直调场景）。 */
  sharedBudget?: BaseSharedOperationBudget;
  /**
   * 注入时钟（P2a；today/now 的时间来源，缺省 `() => new Date()`）。
   * 测试必须注入固定 clock，保证重复运行字节一致（FORM-006）。
   */
  clock?: () => Date;
  /**
   * 公式求值回调（P2a）：由 engine 提供「按依赖序逐行求值 + 每行每公式缓存」的实现；
   * evaluator 不直接管依赖图（循环/未定义引用已由 planner 静态拒绝）。
   * 缺省时 `formula.*` 保持 P1 口径：行级 base/unsupported-feature（不静默 MISSING）。
   */
  formulas?: { get(name: string): BaseValue };
  /**
   * types.json 显式类型表（P2b 片二，BASE-TYPE-001）：prop → 声明类型（小写）。
   * 由 engine 每次查询从 vaultRoots 读取注入；缺省/空表 → note 属性读取走既有推断链（不回归）。
   */
  propertyTypes?: Record<string, string>;
  /**
   * 自定义汇总求值的隐式 `values` 作用域（P2b 片三，SUM-002 暂定，待 oracle）：
   * 目标列跨行值列表（null/MISSING 已由 engine 剔除）。设置后求值**无行上下文**：
   * 裸 `values`（AST 层与 `note.values` 同形，统一取作用域，注释存证）解析为该列表；
   * 其余 note/file 属性一律 MISSING（禁止访问行外状态）；HOF 隐式作用域
   * （value/index/acc）照常优先于本绑定；formula.* / this.* 保持既有拒绝口径。
   */
  summaryValues?: BaseValue[];
}

/** 行级求值错误内部信号：带 rule 与表达式内 offset，evaluateExpression 捕获后上报并返回 MISSING。 */
class BaseRowEvalError extends Error {
  constructor(
    readonly rule: BaseRuleId,
    readonly offset: number,
    message: string,
    readonly target?: string,
  ) {
    super(message);
  }
}

/** 单次 evaluateExpression 调用的可变预算状态（不跨行复用，避免行间串计数）。 */
interface EvalState {
  ops: number;
  callDepth: number;
  limits: BaseExecutionLimits;
  /** 注入时钟（P2a；经 fnCtx 传给 time 组函数 impl）。 */
  clock: () => Date;
  /** 公式求值回调（P2a；engine 注入，见 EvalContext.formulas）。 */
  formulas?: { get(name: string): BaseValue };
  /** types.json 显式类型表（P2b 片二；engine 注入，见 EvalContext.propertyTypes）。 */
  propertyTypes?: Record<string, string>;
  /**
   * 行级错误直报通道（P2b）：声明类型冲突等**非终止** warning 由此上报后继续求值；
   * 终止性行级错误仍走 BaseRowEvalError throw（evaluateExpression 捕获上报并返回 MISSING）。
   */
  onRowError?: (info: BaseRowErrorInfo) => void;
  /**
   * HOF 隐式作用域栈（P2b，BASE-LIST-001）：filter/map/reduce 逐元素求值时压栈一帧，
   * 嵌套 HOF 内层帧遮蔽外层同名键；identifier 解析先查栈（内层优先）再走 note 属性。
   */
  scopes: HofScopeFrame[];
  /** 自定义汇总隐式 `values` 作用域（P2b 片三，SUM-002 暂定；见 EvalContext.summaryValues）。 */
  summaryValues?: BaseValue[];
  /** 查询级共享操作数计数器（见 EvalContext.sharedBudget）。 */
  sharedBudget?: BaseSharedOperationBudget;
}

/**
 * HOF 隐式作用域帧（P2b）：filter/map 只含 value/index；reduce 另含 acc。
 * acc 用可选键 + `in` 判定——map 内引用外层 reduce 的 acc 可穿透内层帧命中外层（栈式查找）。
 */
interface HofScopeFrame {
  value: BaseValue;
  index: number;
  acc?: BaseValue;
}

/**
 * 扣 operations 预算（每次 AST 节点求值 / 函数调用 / typedEqual 元素比较计一，设计 §12）。
 * 两级同时扣：单次求值的 maxOperations（本行本表达式复杂度）与查询级
 * maxTotalOperations（跨行累计总额，见 {@link BaseSharedOperationBudget}）。
 */
function spend(state: EvalState, offset: number): void {
  state.ops += 1;
  if (state.ops > state.limits.maxOperations) {
    throw new BaseBudgetError(
      `表达式求值操作数超过预算上限 ${state.limits.maxOperations}（offset ${offset}，防资源耗尽）`,
    );
  }
  spendShared(state.sharedBudget, state.limits);
}

/** 扣查询级共享操作数总额（engine 的 groupBy/summaries 迭代亦复用本函数，口径统一）。 */
export function spendShared(
  budget: BaseSharedOperationBudget | undefined,
  limits: BaseExecutionLimits,
): void {
  if (budget === undefined) return;
  budget.used += 1;
  if (budget.used > limits.maxTotalOperations) {
    throw new BaseBudgetError(
      `本次查询累计操作数超过总预算上限 ${limits.maxTotalOperations}（跨行累计，防资源耗尽）`,
    );
  }
}

/** file property 清单（语法 §4.2）：name/basename/path/folder/ext/size/ctime/mtime/properties/tags/links。 */
function getFileField(file: BaseFileValue, name: string, offset: number): BaseValue {
  switch (name) {
    case "name":
      return file.name;
    case "basename":
      return file.basename;
    case "path":
      return file.path;
    case "folder":
      return file.folder;
    case "ext":
      return file.ext;
    case "size":
      return file.size;
    case "ctime":
      return file.ctime;
    case "mtime":
      return file.mtime;
    case "properties":
      return file.properties;
    case "tags":
      return file.tags as BaseValue;
    case "links":
      return file.links as BaseValue;
    default:
      // 未知 file 属性（如 file.foo）→ 行级错误，不静默 MISSING（计划「关键取舍」#4）。
      throw new BaseRowEvalError(
        BASE_RULES.unknownProperty,
        offset,
        `未知 file 属性 "${name}"`,
        name,
      );
  }
}

/** 方法 receiver 的运行时分派组；number/boolean 返回 null（只能命中 "any" 组）。 */
function receiverGroupOf(v: BaseValue): "string" | "list" | "object" | "file" | null {
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object" && v !== null) {
    if (isFileValue(v)) return "file";
    // date/duration/link（P2a）不是 object 组：其内部字段（epochMs/ms/path）不外露为成员，
    // 只命中 "any" 组（isTruthy/isType/toString）；专属方法属后续片评估。
    if (isDateValue(v) || isDurationValue(v) || isLinkValue(v)) return null;
    return "object";
  }
  return null;
}

/** 是否 P2a 品牌值（date/duration/link）：member/index 访问一律行级类型错误，防内部字段泄漏。 */
function isBrandedTypedValue(v: BaseValue): v is BaseDateValue | BaseDurationValue | BaseLinkValue {
  return isDateValue(v) || isDurationValue(v) || isLinkValue(v);
}

/** member/index 共用的 object 安全取键：缺失 → MISSING；拒绝 → 行级错误（BASE-SEC-001）。 */
function getObjectMember(obj: Record<string, BaseValue>, key: string, offset: number): BaseValue {
  const r = safeGetOwn(obj, key);
  if (r.status === "ok") return r.value as BaseValue;
  if (r.status === "missing") return MISSING;
  // 安全白名单拒绝（__proto__/prototype/constructor/getter）：行级错误，不返回值。
  throw new BaseRowEvalError(
    BASE_RULES.unknownProperty,
    offset,
    `属性 "${key}" 被安全白名单拒绝（禁原型链/getter 访问）`,
    key,
  );
}

function evalNode(expr: BaseExpr, row: BaseRow, state: EvalState): BaseValue {
  spend(state, expr.offset); // 每个 AST 节点求值计一
  switch (expr.kind) {
    case "literal":
      return expr.value;

    case "list": {
      const items = expr.items.map((item) => evalNode(item, row, state));
      // list 字面量元素数与运行时集合共用 maxCollectionItems 上限（设计 §12）。
      if (items.length > state.limits.maxCollectionItems) {
        throw new BaseBudgetError(
          `list 字面量元素数 ${items.length} 超过预算上限 ${state.limits.maxCollectionItems}`,
        );
      }
      return items;
    }

    case "property":
      return evalProperty(expr, row, state);

    case "member": {
      const target = evalNode(expr.target, row, state);
      // MISSING/null 取成员 → MISSING 传播（读侧不塌缩，设计 §8.1）。
      if (target === MISSING || target === null) return MISSING;
      if (isFileValue(target)) return getFileField(target, expr.name, expr.offset);
      if (isBrandedTypedValue(target)) {
        // date/duration/link（P2a）不支持 member：内部字段（epochMs/ms/path）不外露。
        throw new BaseRowEvalError(
          BASE_RULES.propertyTypeMismatch,
          expr.offset,
          `类型 ${typeNameOf(target)} 不支持成员访问 ".${expr.name}"`,
          expr.name,
        );
      }
      if (typeof target === "object" && !Array.isArray(target)) {
        return getObjectMember(target, expr.name, expr.offset);
      }
      // string 不允许 member；list/number/boolean 同样无成员（方法走 call 节点）。
      throw new BaseRowEvalError(
        BASE_RULES.propertyTypeMismatch,
        expr.offset,
        `类型 ${typeNameOf(target)} 不支持成员访问 ".${expr.name}"`,
        expr.name,
      );
    }

    case "index": {
      const target = evalNode(expr.target, row, state);
      const index = evalNode(expr.index, row, state);
      if (target === MISSING || target === null) return MISSING;
      if (Array.isArray(target)) {
        // P1 index 只支持 list/object：list 下标须为非负整数，越界 → MISSING。
        if (typeof index !== "number" || !Number.isInteger(index)) {
          throw new BaseRowEvalError(
            BASE_RULES.propertyTypeMismatch,
            expr.offset,
            `list 索引须为整数，实为 ${typeNameOf(index)}`,
          );
        }
        return index >= 0 && index < target.length ? (target[index] as BaseValue) : MISSING;
      }
      if (isFileValue(target)) {
        if (typeof index !== "string") {
          throw new BaseRowEvalError(
            BASE_RULES.propertyTypeMismatch,
            expr.offset,
            `file 索引须为 string 属性名，实为 ${typeNameOf(index)}`,
          );
        }
        return getFileField(target, index, expr.offset);
      }
      if (isBrandedTypedValue(target)) {
        // date/duration/link（P2a）不支持 index：内部字段（epochMs/ms/path）不外露。
        throw new BaseRowEvalError(
          BASE_RULES.propertyTypeMismatch,
          expr.offset,
          `类型 ${typeNameOf(target)} 不支持索引访问`,
        );
      }
      if (typeof target === "object") {
        if (typeof index !== "string") {
          throw new BaseRowEvalError(
            BASE_RULES.propertyTypeMismatch,
            expr.offset,
            `object 索引须为 string 键，实为 ${typeNameOf(index)}`,
          );
        }
        return getObjectMember(target, index, expr.offset);
      }
      // string 不支持 index（P1）；number/boolean 同理。
      throw new BaseRowEvalError(
        BASE_RULES.propertyTypeMismatch,
        expr.offset,
        `类型 ${typeNameOf(target)} 不支持索引访问`,
      );
    }

    case "call":
      return evalCall(expr, row, state);

    case "not":
      return !truthy(evalNode(expr.arg, row, state));

    case "neg": {
      // P2a 接线：一元取负 → arithNeg（number/duration 允许，其余行级类型错误）。
      const v = evalNode(expr.arg, row, state);
      try {
        return arithNeg(v);
      } catch (e) {
        if (e instanceof BaseTypeError) {
          throw new BaseRowEvalError(BASE_RULES.propertyTypeMismatch, expr.offset, e.message);
        }
        throw e;
      }
    }

    case "duration":
      // P2a 接线：duration 字面量 → BaseDurationValue（amount/unit 在 AST 已归一）。
      return createDurationValue(expr.amount, expr.unit);

    case "binary":
      return evalBinary(expr, row, state);
  }
}

/**
 * note 属性读取升级（P2a 计划「关键取舍」#3/#4，**暂定机制，待 oracle BASE-TYPE-005/006**）：
 * 从 frontmatter 读到的字符串标量在此**单点**尝试升级为 DateValue / LinkValue——
 * 选读取点而非各运算符处，是为保证比较/算术/投影/函数所有消费方看到同一形态（一致性优先）；
 * 不做缓存：升级为两次整体正则 + 一次对象构造，成本远低于一次 AST 求值，缓存徒增状态面。
 * 非严格匹配（非 ISO 日期 / 非整串 wikilink）原样返回字符串，不猜格式。
 * 升级链位置：本函数是推断段（语法 §5.1 第 3 条）；types.json 显式声明优先于它（见 applyDeclaredType）。
 */
function upgradeNoteString(v: BaseValue): BaseValue {
  if (typeof v !== "string") return v;
  return parseDateLike(v) ?? parseWikilinkValue(v) ?? v;
}

/**
 * note 属性读取升级链首：types.json 显式类型（P2b 片二，BASE-TYPE-001，语法 §5.1 第 1 条）。
 *
 * 返回 undefined 表示「无有效声明」（未声明 / 未知类型名），调用方回退既有推断链（不回归）；
 * 返回 BaseValue 表示声明已生效（含冲突时的原样值）。
 *
 * 各声明类型口径（设计 §8.2：显式类型不强制转换）：
 * - text：原样返回——显式声明优先，抑制 parseDateLike/parseWikilinkValue 推断升级；
 * - date/datetime：字符串经 parseDateLike 升级，成功按声明精度——声明 datetime 而解析为
 *   date 精度时提升为 datetime（同 epoch = 当日 UTC 00:00）；声明 date 而解析为 datetime
 *   精度时保留解析精度（暂定：截断会静默丢时刻信息）；非字符串 / 解析失败 → 冲突；
 * - number：已是 number 原样；其余（含整体可解析为有限 number 的字符串）→ 冲突（不转换）；
 * - checkbox：boolean 原样，其余 → 冲突；
 * - multitext/tags/aliases：list 原样，其余 → 冲突。
 *
 * 冲突口径（TYPE-004 暂定，待 oracle）：经 state.onRowError 产行级 base/property-type-mismatch
 * （warning，message 含声明类型与实际类型），值**按运行时类型**原样返回继续参与求值——
 * 后续比较/排序照走 compareValues 类型错误，绝不因声明类型静默按字符串比较。
 */
function applyDeclaredType(
  key: string,
  raw: BaseValue,
  offset: number,
  state: EvalState,
): BaseValue | undefined {
  const declared = state.propertyTypes?.[key];
  if (declared === undefined) return undefined;

  // 冲突统一出口：行级 warning + 原样值（不 throw——值须继续参与求值，见函数头 TYPE-004 口径）。
  const mismatch = (actual: string): BaseValue => {
    state.onRowError?.({
      rule: BASE_RULES.propertyTypeMismatch,
      message:
        `属性 "${key}" 声明类型 ${declared}（.obsidian/types.json）与实际值类型 ${actual} 冲突：` +
        "不强制转换，值按运行时类型继续求值（TYPE-004 暂定，待 oracle）",
      offset,
      target: key,
    });
    return raw;
  };

  switch (declared) {
    case "text":
      return raw;
    case "date":
    case "datetime": {
      if (typeof raw !== "string") return mismatch(typeNameOf(raw));
      const parsed = parseDateLike(raw);
      if (parsed === undefined) return mismatch(`${typeNameOf(raw)}（非严格日期格式）`);
      if (declared === "datetime" && parsed.precision === "date") {
        return createDateValue("datetime", parsed.epochMs);
      }
      return parsed;
    }
    case "number":
      return typeof raw === "number" ? raw : mismatch(typeNameOf(raw));
    case "checkbox":
      return typeof raw === "boolean" ? raw : mismatch(typeNameOf(raw));
    case "multitext":
    case "tags":
    case "aliases":
      return Array.isArray(raw) ? raw : mismatch(typeNameOf(raw));
    default:
      // 未知类型名已在 typeschema.ts 读取期忽略 + warning，正常不可达；防御兜底走推断链。
      return undefined;
  }
}

/** property 根引用求值：note/file/formula/this 四源分派（path 只含首段，更深落 member/index）。 */
function evalProperty(
  expr: Extract<BaseExpr, { kind: "property" }>,
  row: BaseRow,
  state: EvalState,
): BaseValue {
  // === Obsidian 规范来源: Bases list 高阶方法的隐式作用域（value/index/acc，官方 Bases 函数文档）===
  // HOF 作用域栈优先于 note 属性：作用域变量遮蔽同名 note 属性（含显式 `note.value` 形态——
  // AST 层裸 `value` 与 `note.value` 同为 base "note" 首段，无法区分，自建拍板统一遮蔽，注释存证）。
  // HOF 外（栈空）不出现任何特殊化：裸 `value`/`index`/`acc` 保持既有 note 属性语义。
  if (expr.base === "note" && expr.path.length > 0) {
    const key = expr.path[0] as string;
    if (key === "value" || key === "index" || key === "acc") {
      for (let i = state.scopes.length - 1; i >= 0; i -= 1) {
        const frame = state.scopes[i] as HofScopeFrame;
        if (key in frame) return frame[key] as BaseValue;
      }
    }
  }
  // 自定义汇总作用域（P2b 片三，SUM-002 暂定）：无行上下文——裸 `values` 取目标列值列表，
  // 其余 note/file 属性（含裸根）一律 MISSING（禁止访问行外状态）。
  // 位置在 HOF 作用域检查之后：汇总表达式内嵌套 HOF（如 values.filter(...)）的 value/index/acc 照常解析。
  if (state.summaryValues !== undefined && (expr.base === "note" || expr.base === "file")) {
    if (expr.base === "note" && expr.path.length > 0 && expr.path[0] === "values") {
      return state.summaryValues;
    }
    return MISSING;
  }
  // path 为空 = 裸根引用（如 `file.hasTag(...)` 的 receiver、裸 `note`）：
  // file → file 值本身（供 file 方法分派）；note → 整个 frontmatter 包装对象。
  if (expr.path.length === 0) {
    if (expr.base === "file") return row.file;
    if (expr.base === "note") return wrapValue(row.note);
    // 裸 formula/this 根无可求值形态：按未支持处理（formula.* 须带属性名；this 见下方分支）。
    throw new BaseRowEvalError(
      expr.base === "formula" ? BASE_RULES.unsupportedFeature : BASE_RULES.dynamicContextRequired,
      expr.offset,
      expr.base === "formula"
        ? "裸 formula 根引用不可求值（须 formula.<公式名>）"
        : `this.* 需要显式动态上下文（无头执行无当前活动文件，P3 支持）`,
    );
  }
  if (expr.base === "note" || expr.base === "file") {
    const key = expr.path[0] as string;
    if (expr.base === "note") {
      const r = safeGetOwn(row.note, key);
      if (r.status === "ok") {
        const raw = wrapValue(r.value);
        // 升级链（语法 §5.1 优先级）：types.json 显式类型（P2b）→ parseDateLike/parseWikilinkValue
        // 推断（P2a，upgradeNoteString）→ 原样。显式声明命中时不再走推断（含冲突场景，值按运行时类型）。
        return applyDeclaredType(key, raw, expr.offset, state) ?? upgradeNoteString(raw);
      }
      if (r.status === "missing") return MISSING;
      throw new BaseRowEvalError(
        BASE_RULES.unknownProperty,
        expr.offset,
        `属性 "${key}" 被安全白名单拒绝（禁原型链/getter 访问）`,
        key,
      );
    }
    return getFileField(row.file, key, expr.offset);
  }
  const key = expr.path[0] as string;
  switch (expr.base) {
    case "formula": {
      // P2a 接线：公式经 ctx.formulas 求值（engine 按依赖序 + 每行缓存实现）；
      // 未挂接公式上下文时保持 P1 显式拒绝口径，不静默 MISSING。
      if (state.formulas === undefined) {
        throw new BaseRowEvalError(
          BASE_RULES.unsupportedFeature,
          expr.offset,
          `formula.* 需要公式上下文（.base 无 formulas 段或未挂接求值器）`,
          key,
        );
      }
      return state.formulas.get(key);
    }
    default:
      // this：无头执行无「当前活动文件」，无显式 context 时 this.* 不可求值（P3 才支持）。
      throw new BaseRowEvalError(
        BASE_RULES.dynamicContextRequired,
        expr.offset,
        `this.* 需要显式动态上下文（无头执行无当前活动文件，P3 支持）`,
        key,
      );
  }
}

function evalCall(
  expr: Extract<BaseExpr, { kind: "call" }>,
  row: BaseRow,
  state: EvalState,
): BaseValue {
  spend(state, expr.offset); // 函数调用本身再计一（设计 §12）

  // 分派：全局调用查 "global"；方法调用按 receiver 运行时类型查、回退 "any"。
  let receiverValue: BaseValue | null = null;
  let entry;
  if (expr.receiver === null) {
    entry = lookupBaseFunction(expr.name, "global");
    if (entry === undefined) {
      // 防御性复查：名字在 parse 阶段已核对过白名单，到这里必是 global 组缺失（编程错误面）。
      throw new BaseRowEvalError(
        BASE_RULES.unknownFunction,
        expr.offset,
        `未知函数 "${expr.name}"（不在 Bases 白名单 global 组内）`,
        expr.name,
      );
    }
  } else {
    receiverValue = evalNode(expr.receiver, row, state);
    if (receiverValue === MISSING || receiverValue === null) {
      // any 组（isTruthy/isType/toString）语义就是「判定任意值」，MISSING/null 照常分派；
      // 其余组在 MISSING/null 上 → MISSING 传播（与 member/index 传播口径一致，暂定）。
      entry = lookupBaseFunction(expr.name, "any");
      if (entry === undefined) return MISSING;
    } else {
      const group = receiverGroupOf(receiverValue);
      entry = lookupBaseFunction(expr.name, group ?? "any");
      if (entry === undefined) {
        // 类型不匹配（如 `number.contains`、`"a".keys()`）→ 行级类型错误。
        throw new BaseRowEvalError(
          BASE_RULES.propertyTypeMismatch,
          expr.offset,
          `类型 ${typeNameOf(receiverValue)} 不支持方法 "${expr.name}"`,
          expr.name,
        );
      }
    }
  }

  // arity 校验（P1 由 evaluator 核对；parser 只核对名字）。
  const argc = expr.args.length;
  if (argc < entry.arity.min || argc > entry.arity.max) {
    const expected =
      entry.arity.max === Number.POSITIVE_INFINITY
        ? `至少 ${entry.arity.min}`
        : entry.arity.min === entry.arity.max
          ? `${entry.arity.min}`
          : `${entry.arity.min}..${entry.arity.max}`;
    throw new BaseRowEvalError(
      BASE_RULES.propertyTypeMismatch,
      expr.offset,
      `函数 "${expr.name}" 参数个数不符：期望 ${expected}，实传 ${argc}`,
      expr.name,
    );
  }

  // 调用嵌套深度预算：防深递归求值栈溢出（设计 §12 maxCallDepth）。
  // lazy 分支同样递归 evalNode，深度检查必须在其之前（嵌套 if 一样会爆栈）。
  state.callDepth += 1;
  if (state.callDepth > state.limits.maxCallDepth) {
    throw new BaseBudgetError(
      `函数调用嵌套深度超过预算上限 ${state.limits.maxCallDepth}（offset ${expr.offset}）`,
    );
  }
  try {
    // lazy 分派（arg 表达式不预求值）：
    // - `if`：只计算被选择分支——暂定 lazy（待 oracle），未选分支的错误/预算消耗不污染结果；
    // - `filter`/`map`/`reduce`（P2b，BASE-LIST-001）：list 高阶方法，逐元素在隐式作用域
    //   { value, index, acc } 下求值 arg AST（见 evalListHof）。
    if (entry.lazy === true) {
      if (entry.name === "if") {
        const cond = evalNode(expr.args[0] as BaseExpr, row, state);
        return evalNode(expr.args[truthy(cond) ? 1 : 2] as BaseExpr, row, state);
      }
      // 其余 lazy 条目必为 list HOF（注册表当前仅这两类 lazy；receiver 已由上方分派保证 list）。
      if (!Array.isArray(receiverValue)) {
        // 防御：正常分派不可达（list 组条目只在 list receiver 命中）；挡注册表未来的误标。
        throw new BaseRowEvalError(
          BASE_RULES.propertyTypeMismatch,
          expr.offset,
          `类型 ${typeNameOf(receiverValue as BaseValue)} 不支持方法 "${expr.name}"`,
          expr.name,
        );
      }
      return evalListHof(entry.name, expr, receiverValue, row, state);
    }
    const args = expr.args.map((a) => evalNode(a, row, state));
    const fnCtx: BaseFunctionContext = {
      checkCollectionSize: (count) => {
        if (count > state.limits.maxCollectionItems) {
          throw new BaseBudgetError(
            `函数 "${expr.name}" 集合产物元素数 ${count} 超过预算上限 ${state.limits.maxCollectionItems}`,
          );
        }
      },
      spendElementCompare: () => spend(state, expr.offset),
      clock: state.clock, // P2a：time 组（today/now）读注入时钟
    };
    return entry.impl(receiverValue, args, fnCtx, entry);
  } catch (e) {
    // 值域类型错误（无位置）叠加本调用节点 offset 转行级错误。
    if (e instanceof BaseTypeError) {
      throw new BaseRowEvalError(
        BASE_RULES.propertyTypeMismatch,
        expr.offset,
        e.message,
        expr.name,
      );
    }
    throw e;
  } finally {
    state.callDepth -= 1;
  }
}

/**
 * list 高阶方法 lazy 求值（P2b 片一，BASE-LIST-001 / BASE-SEC-005）：
 * `filter(expr)` 按 truthy 保留元素；`map(expr)` 收集每次求值结果；
 * `reduce(expr, init)` 的 acc 初值为第二参数（在元素作用域外先求值一次），逐元素更新。
 *
 * 预算（SEC-005）：每次元素迭代扣一（spend），元素表达式求值走 evalNode 既有扣减点；
 * map/filter 结果列表元素数受 maxCollectionItems；嵌套 HOF 深度由 evalCall 的 maxCallDepth
 * 检查覆盖（内层 HOF 调用同样经 evalCall 递增 callDepth）。耗尽抛 BaseBudgetError 上抛，
 * 不返回部分结果。
 */
function evalListHof(
  name: string,
  expr: Extract<BaseExpr, { kind: "call" }>,
  list: BaseValue[],
  row: BaseRow,
  state: EvalState,
): BaseValue {
  // reduce 的 init 在元素作用域外先求值一次（其内不感知 value/index/acc）。
  // 非 reduce 时 acc 占位 MISSING，永不被读取（只在 reduce 分支写后读）。
  let acc: BaseValue = MISSING;
  if (name === "reduce") acc = evalNode(expr.args[1] as BaseExpr, row, state);

  const argExpr = expr.args[0] as BaseExpr;
  const out: BaseValue[] = [];
  for (let i = 0; i < list.length; i += 1) {
    spend(state, expr.offset); // 每次元素迭代扣一（SEC-005）
    // === Obsidian 规范来源: 隐式作用域 { value, index, acc }（filter/map 无 acc）===
    const frame: HofScopeFrame = { value: list[i] as BaseValue, index: i };
    if (name === "reduce") frame.acc = acc;
    state.scopes.push(frame);
    let result: BaseValue;
    try {
      result = evalNode(argExpr, row, state);
    } finally {
      state.scopes.pop(); // 帧必弹出：元素表达式抛错（含预算耗尽）也不污染外层作用域栈
    }
    if (name === "filter") {
      if (truthy(result)) out.push(list[i] as BaseValue);
    } else if (name === "map") {
      out.push(result);
    } else {
      acc = result; // reduce：逐元素更新累计值
    }
  }

  if (name === "reduce") return acc;
  // map/filter 结果列表元素数受 maxCollectionItems 硬上限（SEC-005）。
  if (out.length > state.limits.maxCollectionItems) {
    throw new BaseBudgetError(
      `函数 "${name}" 结果列表元素数 ${out.length} 超过预算上限 ${state.limits.maxCollectionItems}`,
    );
  }
  return out;
}

/**
 * 二元运算操作数的字符串升级（P2a，对称性拍板）：字面量字符串与 note 属性走同一升级
 * （`due == "2026-07-27"` 右侧字面量同样过 parseDateLike/parseWikilinkValue），保证
 * `a == b` 与 `b == a` 结果一致；非严格匹配原样返回字符串。
 *
 * **暂定口径，待 oracle（已登记于 implementation-status.md §3）**：升级对全部非短路二元
 * 运算生效，`+` 也不例外——于是 `"2026-01-01" + " 备注"` 左侧升为 Date，落进
 * arithAdd(date, string) 报行级类型错误，而不是走 string+string 拼接分支。
 * 取「一致性优先」而非「按运算符区别对待」：后者会让 `==` 与 `+` 看到不同形态的同一个值。
 * 官方是否对拼接语境抑制日期推断未知，故不自行收窄，留 oracle 校正。
 */
function upgradeStringOperand(v: BaseValue): BaseValue {
  return upgradeNoteString(v);
}

/**
 * 算术操作数的 epoch 包装（P2a 计划「关键取舍」#3）：file.ctime/mtime 在值域内是
 * epoch 毫秒 number；与 Date 值混合算术时包装为 datetime，使 `now() - file.ctime` 可用。
 * 仅当两侧恰一侧为 DateValue 且另一侧为 number 时包装；number↔number 与其余组合原样进矩阵。
 */
function wrapEpochForArith(a: BaseValue, b: BaseValue): [BaseValue, BaseValue] {
  if (isDateValue(a) && typeof b === "number") return [a, createDateValue("datetime", b)];
  if (typeof a === "number" && isDateValue(b)) return [createDateValue("datetime", a), b];
  return [a, b];
}

function evalBinary(
  expr: Extract<BaseExpr, { kind: "binary" }>,
  row: BaseRow,
  state: EvalState,
): BaseValue {
  const { op } = expr;
  // && / || 短路：truthy 判定后不求值另一侧（语法 §4.3）。
  if (op === "&&") {
    const left = evalNode(expr.left, row, state);
    if (!truthy(left)) return false;
    return truthy(evalNode(expr.right, row, state));
  }
  if (op === "||") {
    const left = evalNode(expr.left, row, state);
    if (truthy(left)) return true;
    return truthy(evalNode(expr.right, row, state));
  }
  const left = upgradeStringOperand(evalNode(expr.left, row, state));
  const right = upgradeStringOperand(evalNode(expr.right, row, state));
  if (op === "==" || op === "!=") {
    // typedEqual 元素比较经回调扣 operations 预算（list/object 递归比较防耗尽）。
    const eq = typedEqual(left, right, () => spend(state, expr.offset));
    return op === "==" ? eq : !eq;
  }
  if (op === "+" || op === "-" || op === "*" || op === "/") {
    // P2a 接线：算术 → arithAdd/Sub/Mul/Div（允许矩阵见 values.ts）。
    // 暂定口径（待 oracle）：MISSING 短路传播（读侧不塌缩，设计 §8.1）；null 不传播、进矩阵报错。
    if (left === MISSING || right === MISSING) return MISSING;
    // ctime/mtime 等 epoch 毫秒 number 与 Date 混合运算时包装为 datetime（计划「关键取舍」#3）。
    const [a, b] = wrapEpochForArith(left, right);
    try {
      switch (op) {
        case "+":
          return arithAdd(a, b);
        case "-":
          return arithSub(a, b);
        case "*":
          return arithMul(a, b);
        default:
          return arithDiv(a, b);
      }
    } catch (e) {
      if (e instanceof BaseTypeError) {
        throw new BaseRowEvalError(BASE_RULES.propertyTypeMismatch, expr.offset, e.message);
      }
      throw e;
    }
  }
  // < > <= >=：compareValues 类型错误叠加本节点 offset 转行级错误（BASE-EXPR-001 可观察）。
  let c: number;
  try {
    c = compareValues(left, right);
  } catch (e) {
    if (e instanceof BaseTypeError) {
      throw new BaseRowEvalError(BASE_RULES.propertyTypeMismatch, expr.offset, e.message);
    }
    throw e;
  }
  switch (op) {
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case ">=":
      return c >= 0;
  }
  // 穷尽守卫：op 联合类型已全覆盖，理论不可达；防御未来新增运算符漏分支。
  throw new Error(`未处理的二元运算符：${op as string}`);
}

/**
 * 求值一个表达式于一行数据。不 throw 行级错误（类型/未知属性/安全拒绝）：
 * 上报 `ctx.onRowError` 一次后返回 MISSING（filter 语境按 false，projection 由调用方决定）。
 * 仅 {@link BaseBudgetError} 上抛（engine 转 `base/execution-budget` + 空结果）。
 *
 * @param expr - parser 产出的 AST（errors 非空时不应传入）
 * @param row - 一行运行时数据（note 原始 frontmatter + file 品牌值）
 * @param ctx - 预算与行级错误回调
 */
export function evaluateExpression(expr: BaseExpr, row: BaseRow, ctx: EvalContext): BaseValue {
  const state: EvalState = {
    ops: 0,
    callDepth: 0,
    limits: ctx.limits,
    clock: ctx.clock ?? (() => new Date()),
    scopes: [],
    ...(ctx.formulas !== undefined ? { formulas: ctx.formulas } : {}),
    ...(ctx.propertyTypes !== undefined ? { propertyTypes: ctx.propertyTypes } : {}),
    ...(ctx.summaryValues !== undefined ? { summaryValues: ctx.summaryValues } : {}),
    ...(ctx.sharedBudget !== undefined ? { sharedBudget: ctx.sharedBudget } : {}),
    ...(ctx.onRowError !== undefined ? { onRowError: ctx.onRowError } : {}),
  };
  try {
    return evalNode(expr, row, state);
  } catch (e) {
    if (e instanceof BaseRowEvalError) {
      ctx.onRowError?.({
        rule: e.rule,
        message: e.message,
        offset: e.offset,
        target: e.target,
      });
      return MISSING;
    }
    throw e; // BaseBudgetError 与意外异常继续上抛
  }
}

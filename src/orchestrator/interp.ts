// === 自建实现: {{row.x}} 模板插值引擎（设计：docs/design/pipeline-op-model.md §5）===
//
// 设计决策（D4 / §8）：只读不求值——不支持任何运算、函数调用、条件。
// 在同一个仓库里保持「只读不求值」的纪律，与 DQL/base 的表达式能力不重复。
// DQL WHERE 子集是查索引的语言（在 SQLite 上编译执行）；这里过滤的是已在内存中的 Row，
// 两者作用域不同。引入求值器会身份漂移且违反 §8「不做表达式求值器」。
//
// 取值优先级：
// 1. 一等字段：path → Row.path、event → Row.event
// 2. fields.xxx → Row.fields["xxx"]（显式前缀）
// 3. xxx → Row.fields["xxx"]（隐式，同 fields.xxx）
// 4. 点号键名如 formula.urgency → 优先整键匹配 Row.fields["formula.urgency"]，
//    再尝试路径下钻 Row.fields["formula"]?.["urgency"]
//
// 缺失字段：渲染为空字符串，同时将缺失记录记入 failed（不静默吞掉——本仓反对静默行为）。
// 模板不含 {{row. 时原样返回（零开销逃逸路径）。

import type { OpFailure, Row } from "./types.js";

/** {{row.<fieldPath>}} 正则：捕获 fieldPath（不含空白、不含嵌套 {{）。 */
const INTERP_RE = /\{\{row\.([A-Za-z0-9_.]+)\}\}/g;

/** 字段不存在的 sentinel 值，与「键存在但值为 undefined」区分。 */
const MISSING = Symbol("field-not-found");

/** 判断 token 是否含 {{row.x}} 插值。不含时走零开销逃逸路径。 */
export function hasInterpolation(token: string): boolean {
  // 重置 lastIndex 避免 g flag 的跨调用状态问题
  INTERP_RE.lastIndex = 0;
  return INTERP_RE.test(token);
}

/**
 * 从 Row 按路径取值。undefined = 字段不存在。
 *
 * 取值顺序：
 * 1. path / event → 一等字段
 * 2. fields.xxx → 显式 fields 前缀
 * 3. xxx → 隐式从 fields 取
 * 4. 点号路径（如 formula.urgency）→ 先整键匹配 fields["formula.urgency"]，
 *    再遍历 fields["formula"]["urgency"]
 */
export function getFieldValue(row: Row, fieldPath: string): unknown {
  // 一等字段
  if (fieldPath === "path") return row.path;
  if (fieldPath === "event") return row.event;

  // 显式 fields. 前缀
  const key = fieldPath.startsWith("fields.") ? fieldPath.slice(7) : fieldPath;

  // 从 fields 取值
  return resolveInFields(row.fields, key);
}

/** 在 fields 对象中按路径取值：先整键匹配，再点号遍历。键不存在返回 MISSING sentinel。 */
function resolveInFields(fields: Record<string, unknown>, key: string): unknown {
  // 整键匹配优先
  if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];

  // 点号路径下钻
  const parts = key.split(".");
  if (parts.length <= 1) return MISSING;

  let current: unknown = fields;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return MISSING;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * 渲染模板字符串，替换所有 {{row.<path>}} 为字段值。
 *
 * @param template - 含 {{row.xxx}} 的模板字符串
 * @param row      - 当前行的数据
 * @param opName   - 调用此插值的算子名（用于 failed 记录）
 * @returns [rendered, failures]
 *   - rendered: 渲染结果（缺失字段→空字符串）
 *   - failures: 缺失字段的失败记录（空数组=全部存在）
 */
export function renderTemplate(template: string, row: Row, opName: string): [string, OpFailure[]] {
  const failures: OpFailure[] = [];
  const rendered = template.replace(INTERP_RE, (_match, fieldPath: string) => {
    const value = getFieldValue(row, fieldPath);
    // MISSING sentinel 区分「键存在但值为 undefined」和「键不存在」
    if (value === MISSING) {
      failures.push({
        path: row.path,
        op: opName,
        error: `模板引用了不存在的字段 "${fieldPath}"`,
      });
      return "";
    }
    return String(value);
  });
  return [rendered, failures];
}

/**
 * 插值动作 token：把 token 中的 {{row.x}} 替换为当前行的字段值。
 * 不含插值时原样返回（无 failures）。
 *
 * 用于写算子（set/unset/rename/apply）的 buildOp 插值路径：
 * buildOp 先识别 token 含 {{row.，然后对每行调用此函数渲染 token，
 * 再对渲染结果调用 parseAction 得到按行绑定的 Action。
 *
 * @param token   - 动作 token，如 "set urgency={{row.formula.urgency}}"
 * @param row     - 当前行的数据
 * @returns [rendered, failures]
 */
export function interpolateToken(token: string, row: Row, opName: string): [string, OpFailure[]] {
  if (!hasInterpolation(token)) return [token, []];
  return renderTemplate(token, row, opName);
}

// === §12 未决问题决定：filter 表达式选型（片三前必须定）===
//
// 决策：filter 只做字段比较，不引入表达式求值器（守 D4 与 §8）。
// 语法定为 filter <field> <op> [<value>]。
//
// 理由：DQL WHERE 子集是查索引的语言（在 SQLite 上编译执行），
// 这里过滤的是已在内存中的 Row，两者作用域不同。
// 引入求值器会与 DQL/base 的表达式能力重复且违反 §8「不做表达式求值器」。
//
// 支持运算符：
//   二元：==, !=, >, >=, <, <=（6 个）
//   一元：exists, missing（2 个）
// 值类型按字面量推断：纯数字→number、true/false→boolean、其余→string。
// 两边类型不同则该行不通过（不做隐式类型转换，避免静默的类型胡猜）。

/** 支持的一元运算符。 */
const UNARY_OPS = new Set(["exists", "missing"]);

/** 支持的二元运算符。 */
const BINARY_OPS = new Set(["==", "!=", ">", ">=", "<", "<="]);

/** filter 表达式解析结果。 */
export interface FilterExpr {
  field: string;
  op: string;
  value: unknown; // undefined for unary ops (exists/missing)
}

/**
 * 解析 filter 表达式字符串。
 * 格式：<field> <op> [<value>]
 *   二元：formula.urgency > 4
 *   一元：status exists
 *
 * 值按字面量推断类型：
 *   纯数字（含小数、负数）→ number
 *   true / false → boolean
 *   其余 → string
 */
export function parseFilterExpr(paramStr: string): FilterExpr {
  const parts = paramStr.trim().split(/\s+/);

  if (parts.length < 2) {
    throw new Error(`filter 表达式格式错误：需要 <field> <op> [<value>]，得到 "${paramStr}"`);
  }

  const field = parts[0]!;
  const op = parts[1]!;

  if (UNARY_OPS.has(op)) {
    if (parts.length !== 2) {
      throw new Error(`filter ${op} 是一元运算符，不需要值参数，得到 "${paramStr}"`);
    }
    return { field, op, value: undefined };
  }

  if (BINARY_OPS.has(op)) {
    if (parts.length < 3) {
      throw new Error(
        `filter 二元运算符 ${op} 需要值参数：${field} ${op} <value>，得到 "${paramStr}"`,
      );
    }
    const raw = parts.slice(2).join(" "); // 值可能有空格
    return { field, op, value: inferLiteral(raw) };
  }

  throw new Error(`filter 未知运算符 "${op}"，支持：==, !=, >, >=, <, <=, exists, missing`);
}

/** 按字面量推断类型。纯数字→number、true/false→boolean、其余→string。 */
export function inferLiteral(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/**
 * 比较字段值与字面量。类型不同则该行不通过（返回 false）。
 * 用于 filter 算子的逐行判断。
 *
 * 注意：exists/missing 用 MISSING sentinel 区分「键存在但值为 undefined」和「键不存在」。
 * 二元比较时，MISSING 视为类型不匹配（该行不通过）。
 */
export function matchFilter(row: Row, expr: FilterExpr): boolean {
  const fieldValue = getFieldValue(row, expr.field);

  // 一元运算符（用 MISSING sentinel 区分）
  if (expr.op === "exists") return fieldValue !== MISSING;
  if (expr.op === "missing") return fieldValue === MISSING;

  // 二元运算符：类型必须相同
  if (typeof fieldValue !== typeof expr.value) return false;

  switch (expr.op) {
    case "==":
      return (fieldValue as never) === (expr.value as never);
    case "!=":
      return (fieldValue as never) !== (expr.value as never);
    case ">":
      return (fieldValue as number) > (expr.value as number);
    case ">=":
      return (fieldValue as number) >= (expr.value as number);
    case "<":
      return (fieldValue as number) < (expr.value as number);
    case "<=":
      return (fieldValue as number) <= (expr.value as number);
    default:
      return false;
  }
}

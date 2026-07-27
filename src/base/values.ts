/**
 * base 模块运行时值语义（P1 + P2a 增量）：BaseValue 类型、MISSING sentinel、品牌运行时值
 * （BaseFileValue / BaseDateValue / BaseDurationValue / BaseLinkValue）、typed equality /
 * truthiness / compare / 排序键、算术允许矩阵、属性访问白名单 safeGetOwn、输出序列化。
 *
 * 读侧不塌缩：属性缺失、对象缺 key、list 越界一律产生/传播 MISSING，
 * 只有「直接投影输出」时才由 engine 塌成 null（设计 §8.1）。
 *
 * P2a 增量（P2a 计划「关键取舍」#2/#3/#4）：
 * - 品牌值：BaseDateValue（date/datetime 两态 + epoch 毫秒）、BaseDurationValue（毫秒长度）、
 *   BaseLinkValue（path 归一键 + 原始 target + display?/subpath?）；
 * - 日期推断 parseDateLike（语法 §5.1 第 3 条，严格 ISO）；
 * - frontmatter wikilink 字符串 → BaseLinkValue（parseWikilinkValue，暂定机制，待 oracle BASE-TYPE-006）；
 * - 算术纯函数 arithAdd/Sub/Mul/Div/Neg（允许矩阵见函数注释），供 evaluator 接线调用。
 *
 * 上游：P1 evaluator / functions 消费；row 构造（P1 source.ts）经 {@link wrapValue}
 * 把 frontmatter 原始 JSON 值包装进值域。
 * 下游：P1 evaluator.ts / functions.ts / engine.ts。
 * 设计真相源：docs/design/bases-engine.md §8；
 * 语法真相源：docs/design/bases-syntax.md §5。
 */

// === 自建实现 ===

import { pathKey } from "../utils/path.js";
import type { BaseDurationUnit } from "./types.js";

/**
 * 属性缺失 sentinel：读时不塌成 null（设计 §8.1）。
 *
 * 暂定口径（待 oracle BASE-PROP-004 冻结）：MISSING 只等于 MISSING，
 * `missing == null` 为 false，可与显式 null 区分（`file.hasProperty` 只看 key 存在性）。
 */
export const MISSING: unique symbol = Symbol("base.missing");

/** 普通对象值（frontmatter 嵌套对象经 {@link wrapValue} 包装后的形状）。 */
export interface BaseValueObject {
  [key: string]: BaseValue;
}

/**
 * file 品牌键（symbol，且经 defineProperty 置为不可枚举）：
 * 供 evaluator/functions 做 file 方法分派，又不会泄漏进 keys()/JSON 输出（BASE-SEC-001 延伸）。
 */
const FILE_BRAND: unique symbol = Symbol("base.file");

/**
 * file 运行时值（设计 §10 映射；字段清单 = 语法 §4.2）。
 *
 * `ctime`/`mtime` 为 epoch 毫秒 number——P1 无 Date runtime value（计划「关键取舍」#6）。
 * `links` 为行内链接的**原始 target 文本**（未归一化），hasLink 的路径感知匹配在
 * functions.ts 内复用 `utils/path` 的 linkKey/pathKey 现算（设计 §3 明确允许的共享）。
 */
export interface BaseFileValue {
  readonly [FILE_BRAND]: true;
  /** 带扩展名文件名（basename + ext）。 */
  readonly name: string;
  readonly basename: string;
  /** vault 相对 POSIX 路径。 */
  readonly path: string;
  /** 所在目录（POSIX，根目录为 ""）。 */
  readonly folder: string;
  /** 扩展名（含点，如 ".md"）。 */
  readonly ext: string;
  readonly size: number;
  readonly ctime: number;
  readonly mtime: number;
  /** frontmatter 包装后的对象（= note 属性源）。 */
  readonly properties: BaseValueObject;
  readonly tags: readonly string[];
  readonly links: readonly string[];
}

/** P1 + P2a 运行时值域（设计 §8.2 子集；P2a 补 Date/Duration/Link 三类品牌值）。 */
export type BaseValue =
  | null
  | boolean
  | number
  | string
  | BaseValue[]
  | BaseValueObject
  | BaseFileValue
  | BaseDateValue
  | BaseDurationValue
  | BaseLinkValue
  | typeof MISSING;

/**
 * 构造 file 运行时值：品牌键经 defineProperty 写入且**不可枚举**，
 * 防止泄漏进 keys()/结构化输出。
 */
export function createFileValue(init: {
  name: string;
  basename: string;
  path: string;
  folder: string;
  ext: string;
  size: number;
  ctime: number;
  mtime: number;
  properties: BaseValueObject;
  tags: readonly string[];
  links: readonly string[];
}): BaseFileValue {
  const file = { ...init } as Record<PropertyKey, unknown>;
  Object.defineProperty(file, FILE_BRAND, { value: true, enumerable: false });
  return file as unknown as BaseFileValue;
}

/** 是否 file 运行时值（品牌检查，供 file 方法分派）。 */
export function isFileValue(v: BaseValue): v is BaseFileValue {
  return (
    typeof v === "object" && v !== null && (v as Record<PropertyKey, unknown>)[FILE_BRAND] === true
  );
}

// ---------------------------------------------------------------------------
// P2a 增量：Date / Duration / Link 三类品牌运行时值
// 品牌模式与 BaseFileValue 同款：symbol 键 + defineProperty 不可枚举，
// 不泄漏进 keys()/JSON 输出（BASE-SEC-001 延伸）。
// ---------------------------------------------------------------------------

/** date 品牌键（不可枚举 symbol）。 */
const DATE_BRAND: unique symbol = Symbol("base.date");
/** duration 品牌键（不可枚举 symbol）。 */
const DURATION_BRAND: unique symbol = Symbol("base.duration");
/** link 品牌键（不可枚举 symbol）。 */
const LINK_BRAND: unique symbol = Symbol("base.link");

/**
 * Date 运行时值（P2a，设计 §8.2）：epoch 毫秒 + 原始精度标记。
 * precision="date" 时 epochMs 恒为当日 UTC 00:00（拍板：无头执行无时区上下文，
 * date 语义锚定 UTC 日历日，避免宿主时区导致的结果漂移）。
 */
export interface BaseDateValue {
  readonly [DATE_BRAND]: true;
  readonly precision: "date" | "datetime";
  /** epoch 毫秒（date 精度时为当日 UTC 00:00）。 */
  readonly epochMs: number;
}

/**
 * Duration 运行时值（P2a）：毫秒长度。
 * month/year 按固定换算（拍板约定，官方未定义精确历法语义）：
 * month = 30 day、year = 365 day；其余单位按 SI（minute=60s、hour=60min、day=24h、week=7day）。
 */
export interface BaseDurationValue {
  readonly [DURATION_BRAND]: true;
  /** 长度（毫秒；可取负，一元 `-` 作用于 duration 时产生）。 */
  readonly ms: number;
}

/**
 * Link 运行时值（P2a，frontmatter wikilink 值场景；暂定机制，待 oracle BASE-TYPE-006）。
 * `path` 为 vault 相对 POSIX 无扩展名小写归一键（复用 utils/path 的 pathKey，
 * 与 indexer 链接匹配键同源）；`target` 保留原始文本供输出/诊断。
 */
export interface BaseLinkValue {
  readonly [LINK_BRAND]: true;
  /** 归一路径键（pathKey(target)：POSIX + 去扩展名 + 小写）。 */
  readonly path: string;
  /** 原始 target 文本（未归一化）。 */
  readonly target: string;
  /** `[[target|display]]` 的显示文本。 */
  readonly display?: string;
  /** `[[target#subpath]]` 的锚点（heading 或 `^block`，不含 `#`）。 */
  readonly subpath?: string;
}

/** 构造 Date 运行时值（品牌不可枚举）。 */
export function createDateValue(precision: "date" | "datetime", epochMs: number): BaseDateValue {
  const v = { precision, epochMs } as Record<PropertyKey, unknown>;
  Object.defineProperty(v, DATE_BRAND, { value: true, enumerable: false });
  return v as unknown as BaseDateValue;
}

/** 是否 Date 运行时值（品牌检查）。 */
export function isDateValue(v: BaseValue): v is BaseDateValue {
  return (
    typeof v === "object" && v !== null && (v as Record<PropertyKey, unknown>)[DATE_BRAND] === true
  );
}

// === Obsidian 规范来源: Bases duration 单位表（语法真相源 §4.3，对齐官方 duration 单位）===
/** duration 单位 → 毫秒换算表（month/year 为固定约定，见 BaseDurationValue 注释）。 */
const DURATION_UNIT_MS: Record<BaseDurationUnit, number> = {
  millisecond: 1,
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000, // 7 day
  month: 2_592_000_000, // 30 day（固定约定）
  year: 31_536_000_000, // 365 day（固定约定）
};

/** 由 amount + 单位构造 Duration 运行时值（换算为毫秒长度；品牌不可枚举）。 */
export function createDurationValue(amount: number, unit: BaseDurationUnit): BaseDurationValue {
  const v = { ms: amount * DURATION_UNIT_MS[unit] } as Record<PropertyKey, unknown>;
  Object.defineProperty(v, DURATION_BRAND, { value: true, enumerable: false });
  return v as unknown as BaseDurationValue;
}

/** 是否 Duration 运行时值（品牌检查）。 */
export function isDurationValue(v: BaseValue): v is BaseDurationValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<PropertyKey, unknown>)[DURATION_BRAND] === true
  );
}

/** 构造 Link 运行时值（path 经 pathKey 归一；品牌不可枚举）。 */
export function createLinkValue(init: {
  target: string;
  display?: string;
  subpath?: string;
}): BaseLinkValue {
  const v = {
    path: pathKey(init.target),
    target: init.target,
    ...(init.display !== undefined ? { display: init.display } : {}),
    ...(init.subpath !== undefined ? { subpath: init.subpath } : {}),
  } as Record<PropertyKey, unknown>;
  Object.defineProperty(v, LINK_BRAND, { value: true, enumerable: false });
  return v as unknown as BaseLinkValue;
}

/** 是否 Link 运行时值（品牌检查）。 */
export function isLinkValue(v: BaseValue): v is BaseLinkValue {
  return (
    typeof v === "object" && v !== null && (v as Record<PropertyKey, unknown>)[LINK_BRAND] === true
  );
}

/**
 * 求值期类型错误（值域内部信号，无位置信息）。
 *
 * 由 compareValues / 函数 impl 抛出；evaluator 在抛出节点处捕获，
 * 叠加表达式内 offset 转行级诊断（设计 §11「runtime 行级问题主位置指表达式」）。
 */
export class BaseTypeError extends Error {}

/**
 * 执行预算耗尽内部信号（设计 §12：耗尽即中止，不返回部分结果冒充成功）。
 *
 * 定义在值域层（values.ts）的原因：functions.ts 的集合预算与 evaluator 的 operations
 * 预算都要抛它，放 evaluator 会形成 functions → evaluator 反向依赖。evaluator 再导出。
 */
export class BaseBudgetError extends Error {}

/** safeGetOwn 结果：ok=取到值；missing=own key 不存在；forbidden=安全白名单拒绝。 */
export type SafeGetOwnResult =
  | { status: "ok"; value: unknown }
  | { status: "missing" }
  | { status: "forbidden" };

// === Obsidian 规范来源: Bases 属性访问白名单（设计 §12，BASE-SEC-001）===
/** 一律拒绝的属性名：原型链相关键永不可经表达式读取。 */
const FORBIDDEN_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

/**
 * 属性访问白名单（设计 §12，BASE-SEC-001）：
 * 仅 own property；`__proto__`/`prototype`/`constructor` 一律拒绝；拒绝 getter
 * （descriptor 带 get/set 不触发求值，直接拒绝）；不沿原型链、不认 symbol 键
 * （入参 key 为 string，symbol 键天然够不到）。
 *
 * @returns 判别联合——调用方据此区分「缺失 → MISSING 传播」与「拒绝 → 行级错误」
 */
export function safeGetOwn(obj: object, key: string): SafeGetOwnResult {
  if (FORBIDDEN_PROPERTY_NAMES.has(key)) return { status: "forbidden" };
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return { status: "missing" };
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  // 防御 getter：frontmatter 经 JSON 解析本无 getter，但 row.note 契约允许任意宿主对象，
  // 触发 getter 会执行宿主代码（副作用 + 原型污染面），一律拒绝。
  if (desc === undefined || desc.get !== undefined || desc.set !== undefined) {
    return { status: "forbidden" };
  }
  return { status: "ok", value: desc.value };
}

/**
 * 把 frontmatter 原始 JSON 值递归包装进 BaseValue 值域。
 *
 * - `undefined`/function/symbol/bigint 等宿主值 → MISSING（不进入值域）；
 * - 非有限 number（NaN/Infinity，JSON 不会有，防御宿主对象传入）→ null；
 * - 数组/普通对象递归包装；对象只取 own enumerable string key，
 *   且经 {@link safeGetOwn} 过滤（`__proto__` 字面量键、getter 直接剔除，不泄漏进值域）。
 */
export function wrapValue(raw: unknown): BaseValue {
  if (raw === undefined) return MISSING;
  if (raw === null || typeof raw === "boolean" || typeof raw === "string") return raw;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (Array.isArray(raw)) return raw.map(wrapValue);
  if (typeof raw === "object") {
    const out: BaseValueObject = {};
    for (const key of Object.keys(raw)) {
      const r = safeGetOwn(raw, key);
      if (r.status === "ok") out[key] = wrapValue(r.value);
    }
    return out;
  }
  return MISSING;
}

// ---------------------------------------------------------------------------
// P2a 增量：frontmatter 字符串 → Date / Link 推断
// ---------------------------------------------------------------------------

// === Obsidian 规范来源: frontmatter 日期格式推断（语法真相源 §5.1 第 3 条，严格 ISO）===
/** date 形态：`YYYY-MM-DD`（必须补零，`2026-1-1` 拒绝）。 */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** datetime 形态：`YYYY-MM-DDTHH:mm[:ss]`，可带 `Z` 或 `±hh:mm` 时区偏移。 */
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * 组装 UTC epoch 并做日历合法性回验（拒绝 `2026-13-40`、`2026-02-30` 这类滚动溢出）。
 * Date.UTC 对越界分量会滚动进位（13 月 → 次年 1 月），回读分量比对是唯一可靠校验。
 */
function utcEpochChecked(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
): number | undefined {
  if (h > 23 || mi > 59 || s > 59) return undefined;
  const epoch = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(epoch);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return epoch;
}

/**
 * 严格 ISO 日期字符串推断（语法 §5.1 第 3 条；P2a 计划「关键取舍」#3）：
 * - `YYYY-MM-DD` → precision "date"（epoch = 当日 UTC 00:00）；
 * - `YYYY-MM-DDTHH:mm[:ss]`（可带 `Z` / `±hh:mm`）→ precision "datetime"；
 *   **拍板：无时区后缀的 datetime 按 UTC 解释**（无头执行无宿主时区上下文，
 *   避免同一 vault 在不同时区机器上结果漂移）；
 * - 其余一律返回 undefined（非补零、非法分量、带毫秒/其他形态均不猜）。
 */
export function parseDateLike(v: unknown): BaseDateValue | undefined {
  if (typeof v !== "string") return undefined;
  const dm = DATE_ONLY_RE.exec(v);
  if (dm !== null) {
    const epoch = utcEpochChecked(Number(dm[1]), Number(dm[2]), Number(dm[3]));
    return epoch === undefined ? undefined : createDateValue("date", epoch);
  }
  const tm = DATE_TIME_RE.exec(v);
  if (tm === null) return undefined;
  const base = utcEpochChecked(
    Number(tm[1]),
    Number(tm[2]),
    Number(tm[3]),
    Number(tm[4]),
    Number(tm[5]),
    tm[6] === undefined ? 0 : Number(tm[6]),
  );
  if (base === undefined) return undefined;
  const tz = tm[7];
  if (tz === undefined || tz === "Z") return createDateValue("datetime", base);
  // ±hh:mm 偏移：本地钟面 = UTC + 偏移，故 epoch = base - 偏移。
  const sign = tz.startsWith("-") ? -1 : 1;
  const oh = Number(tz.slice(1, 3));
  const om = Number(tz.slice(4, 6));
  if (oh > 23 || om > 59) return undefined;
  return createDateValue("datetime", base - sign * (oh * 60 + om) * 60_000);
}

// === Obsidian 规范来源: wikilink 形态 `[[target]]` / `[[target|display]]` / `[[target#subpath]]` ===
// （可组合；解析顺序与 src/parser/wikilink.ts parseInner 一致：先 `|` 切 display，再 `#` 切锚点。）
/** 整体匹配的 frontmatter wikilink 字符串（内部不含 `[`/`]`，wikilink 不嵌套）。 */
const WIKILINK_VALUE_RE = /^\[\[([^\][]+)\]\]$/;

/**
 * frontmatter 字符串值 → BaseLinkValue（P2a 计划「关键取舍」#4）。
 *
 * **暂定机制，行为待 oracle BASE-TYPE-006 冻结**：仅当整串恰为一个 wikilink
 * （`[[target]]` / `[[target|display]]` / `[[target#subpath]]` 及组合）时解析为 Link；
 * 其余字符串（含首尾多余文本、`[[ ]]` 空目标、`[[#heading]]` 同文锚点）返回 undefined。
 */
export function parseWikilinkValue(s: string): BaseLinkValue | undefined {
  const m = WIKILINK_VALUE_RE.exec(s);
  if (m === null) return undefined;
  const inner = (m[1] as string).trim();
  const pipe = inner.indexOf("|");
  const linkPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const display = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  const hash = linkPart.indexOf("#");
  const target = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
  const subpath = hash === -1 ? undefined : linkPart.slice(hash + 1);
  // 空 target（`[[#heading]]` 同文锚点、`[[|x]]`）暂不接受：无 vault 相对路径可归一。
  if (target === "") return undefined;
  return createLinkValue({
    target,
    ...(display !== undefined && display !== "" ? { display } : {}),
    ...(subpath !== undefined && subpath !== "" ? { subpath } : {}),
  });
}

// ---------------------------------------------------------------------------
// P2a 增量：算术允许矩阵（纯函数，供 evaluator 接线调用；本片不在 evaluator 接线）
// ---------------------------------------------------------------------------

/**
 * 算术允许矩阵（P2a 计划「关键取舍」#2；矩阵外组合一律抛 {@link BaseTypeError} 行级类型错误）：
 *
 * | 运算 | 允许组合 | 结果 |
 * | ---- | -------- | ---- |
 * | `+`  | number + number | number |
 * |      | string + string | string（拼接，P2b 片三增量） |
 * |      | date\|datetime + duration | 同精度 Date |
 * |      | duration + date\|datetime | 同精度 Date |
 * |      | duration + duration | Duration |
 * | `-`  | number - number | number |
 * |      | date\|datetime - duration | 同精度 Date |
 * |      | duration - duration | Duration |
 * |      | date\|datetime - date\|datetime（可跨精度） | Duration（epoch 差） |
 * | `*`  | number * number | number |
 * |      | duration * number / number * duration | Duration |
 * | `/`  | number / number（除零 → BaseTypeError，不产 Infinity） | number |
 * |      | duration / number（除零 → BaseTypeError） | Duration |
 * |      | duration / duration（除零 → BaseTypeError） | number（无量纲比值；P2a 片二补，
 * |      |   官方示例 `(now() - file.ctime) / 1day` 必需） |  |
 * | 一元 `-` | number → number；duration → Duration（拍板：允许负 duration） | |
 *
 * MISSING/null 传播与 ctime/mtime（epoch number）包装为 datetime 的语境处理在 evaluator
 * 接线层（下一片），本矩阵只处理已落在值域内的具体类型组合。
 */

/** 类型名对（算术类型错误消息用）。 */
function arithTypeError(op: string, a: BaseValue, b?: BaseValue): BaseTypeError {
  const kinds = b === undefined ? typeNameOf(a) : `${typeNameOf(a)} 与 ${typeNameOf(b)}`;
  return new BaseTypeError(`算术运算 "${op}" 不支持的操作数类型：${kinds}（允许矩阵见 values.ts）`);
}

/** `+`：number 加；string 拼接；date|datetime ± duration；duration + duration。 */
export function arithAdd(a: BaseValue, b: BaseValue): BaseValue {
  if (typeof a === "number" && typeof b === "number") return a + b;
  // === Obsidian 规范来源: 官方示例 formatted_price 用字符串拼接 ===
  // string + string → 拼接（P2b 片三增量）；string 与非 string 仍走矩阵外类型错误，不静默强转。
  if (typeof a === "string" && typeof b === "string") return a + b;
  if (isDateValue(a) && isDurationValue(b)) return createDateValue(a.precision, a.epochMs + b.ms);
  if (isDurationValue(a) && isDateValue(b)) return createDateValue(b.precision, b.epochMs + a.ms);
  if (isDurationValue(a) && isDurationValue(b))
    return createDurationValue(a.ms + b.ms, "millisecond");
  throw arithTypeError("+", a, b);
}

/** `-`：number 减；date|datetime - duration；duration - duration；date|datetime 互减 → duration。 */
export function arithSub(a: BaseValue, b: BaseValue): BaseValue {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (isDateValue(a) && isDurationValue(b)) return createDateValue(a.precision, a.epochMs - b.ms);
  if (isDurationValue(a) && isDurationValue(b))
    return createDurationValue(a.ms - b.ms, "millisecond");
  // date/datetime 互减（含跨精度）→ epoch 差时长；跨精度语义暂定按 epoch，待 oracle BASE-TYPE-005。
  if (isDateValue(a) && isDateValue(b))
    return createDurationValue(a.epochMs - b.epochMs, "millisecond");
  throw arithTypeError("-", a, b);
}

/** `*`：number 乘；duration * number / number * duration。 */
export function arithMul(a: BaseValue, b: BaseValue): BaseValue {
  if (typeof a === "number" && typeof b === "number") return a * b;
  if (isDurationValue(a) && typeof b === "number")
    return createDurationValue(a.ms * b, "millisecond");
  if (typeof a === "number" && isDurationValue(b))
    return createDurationValue(b.ms * a, "millisecond");
  throw arithTypeError("*", a, b);
}

/** `/`：number 除（除零 → 行级类型错误，不产 Infinity）；duration / number 与
 * duration / duration（→ 无量纲 number 比值；官方示例 `(now() - file.ctime) / 1day` 必需）。 */
export function arithDiv(a: BaseValue, b: BaseValue): BaseValue {
  if (typeof a === "number" && typeof b === "number") {
    if (b === 0) throw new BaseTypeError('算术运算 "/" 除零（不产 Infinity，行级类型错误）');
    return a / b;
  }
  if (isDurationValue(a) && typeof b === "number") {
    if (b === 0) throw new BaseTypeError('算术运算 "/" 除零（duration / 0，行级类型错误）');
    return createDurationValue(a.ms / b, "millisecond");
  }
  if (isDurationValue(a) && isDurationValue(b)) {
    if (b.ms === 0) throw new BaseTypeError('算术运算 "/" 除零（duration / 0ms，行级类型错误）');
    return a.ms / b.ms;
  }
  throw arithTypeError("/", a, b);
}

/** 一元 `-`：number 取负；duration 取负（拍板允许，`-1day` 形态可用）。 */
export function arithNeg(v: BaseValue): BaseValue {
  if (typeof v === "number") return -v;
  if (isDurationValue(v)) return createDurationValue(-v.ms, "millisecond");
  throw arithTypeError("-（一元取负）", v);
}

/**
 * typed equality（设计 §8.3）：
 * - 同类型 primitive 按值；**数字不与数字字符串隐式相等**（`1 == "1"` 为 false）；
 * - list 按元素递归（长度相等且逐元素 typedEqual）；
 * - object 结构递归（own key 集合相同且逐值 typedEqual，P1 允许，设计 §8.3）；
 * - file 值按 `path` 相等；
 * - date/datetime 按 epoch（跨精度暂定同按 epoch，待 oracle BASE-TYPE-005）、
 *   duration 按毫秒、link 按归一 path + subpath（P2a）；
 * - MISSING 只等于 MISSING（`missing == null` 为 false——暂定口径，待 oracle BASE-PROP-004）。
 *
 * 不用 JSON.stringify 对比（key 顺序不稳定）；对象递归比较 own keys。
 *
 * @param onElementCompare - list/object 每比较一对元素回调一次（evaluator 借此扣
 *   maxOperations 预算，回调内可抛 BaseBudgetError）
 */
export function typedEqual(a: BaseValue, b: BaseValue, onElementCompare?: () => void): boolean {
  if (a === MISSING || b === MISSING) return a === b;
  if (a === null || b === null) return a === b;
  const ta = typeof a;
  const tb = typeof b;
  // primitive：类型不同直接 false（数字 ≠ 数字字符串）；同类型按值。
  if (ta !== "object" || tb !== "object") {
    return ta === tb && a === b;
  }
  // 此后两侧均为 object 形态（list / 普通对象 / file / date / duration / link）。
  const aFile = isFileValue(a);
  const bFile = isFileValue(b);
  if (aFile || bFile) {
    // file 按 path 相等（设计 §8.3：Link/File equality 完整语义属 P2，P1 先锁 path）。
    return aFile && bFile && a.path === b.path;
  }
  // P2a 品牌值相等（设计 §8.3 Date/Duration/Link equality）：
  const aDate = isDateValue(a);
  const bDate = isDateValue(b);
  if (aDate || bDate) {
    // 同精度按 epoch；跨精度（date vs datetime）暂定也按 epoch——待 oracle BASE-TYPE-005 冻结。
    return aDate && bDate && a.epochMs === b.epochMs;
  }
  const aDuration = isDurationValue(a);
  const bDuration = isDurationValue(b);
  if (aDuration || bDuration) {
    // duration 按毫秒长度相等（`1day` == `24hours` 为 true）。
    return aDuration && bDuration && a.ms === b.ms;
  }
  const aLink = isLinkValue(a);
  const bLink = isLinkValue(b);
  if (aLink || bLink) {
    // link 按归一 path + subpath 相等（路径感知复用 pathKey；display 不影响相等）。
    // subpath 比较小写化，与 indexer 链接锚点键（wikilinkIndexKey）口径一致。
    return (
      aLink &&
      bLink &&
      a.path === b.path &&
      (a.subpath ?? "").toLowerCase() === (b.subpath ?? "").toLowerCase()
    );
  }
  const aList = Array.isArray(a);
  const bList = Array.isArray(b);
  if (aList || bList) {
    if (!aList || !bList || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      onElementCompare?.();
      if (!typedEqual(a[i] as BaseValue, b[i] as BaseValue, onElementCompare)) return false;
    }
    return true;
  }
  // 普通对象结构递归：own key 集合相同（长度 + 逐个 hasOwnProperty），逐值 typedEqual。
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    onElementCompare?.();
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (
      !typedEqual(
        (a as BaseValueObject)[key] as BaseValue,
        (b as BaseValueObject)[key] as BaseValue,
        onElementCompare,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * truthiness 暂定口径（待 oracle BASE-PROP-004 冻结）：
 * falsy = MISSING / null / false / 0 / "" / 空列表；其余（含空对象、非空列表、file）truthy。
 */
export function truthy(v: BaseValue): boolean {
  if (v === MISSING || v === null || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 有序比较（`< > <= >=` 与排序键共用，设计 §8.3）：
 * - number ↔ number：数值比较；
 * - string ↔ string：按 UTF-16 code unit 字典序（JS `<` 原生语义）——
 *   ISO 日期字符串因此可比较（P1 无 Date 类型，日期以字符串形态参与比较）；
 * - date/datetime ↔ date/datetime（P2a）：按 epoch 比较；**跨精度暂定同样按 epoch**——
 *   待 oracle BASE-TYPE-005 冻结；number 与 DateValue 不可直接比较；
 * - duration ↔ duration（P2a）：按毫秒长度比较；
 * - 其余组合（boolean/list/object/file/link/MISSING/null 或混合类型）抛 {@link BaseTypeError}，
 *   由调用方（evaluator）叠加节点 offset 转行级诊断。
 */
export function compareValues(a: BaseValue, b: BaseValue): number {
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (isDateValue(a) && isDateValue(b)) {
    return a.epochMs < b.epochMs ? -1 : a.epochMs > b.epochMs ? 1 : 0;
  }
  if (isDurationValue(a) && isDurationValue(b)) {
    return a.ms < b.ms ? -1 : a.ms > b.ms ? 1 : 0;
  }
  throw new BaseTypeError(
    `类型不参与有序比较：${typeNameOf(a)} 与 ${typeNameOf(b)}（仅 number↔number / string↔string / date↔date / duration↔duration）`,
  );
}

/** 值的可读类型名（诊断消息用）。 */
export function typeNameOf(v: BaseValue): string {
  if (v === MISSING) return "missing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") {
    if (isFileValue(v)) return "file";
    if (isDateValue(v)) return v.precision; // "date" | "datetime"
    if (isDurationValue(v)) return "duration";
    if (isLinkValue(v)) return "link";
    return "object";
  }
  return typeof v; // boolean / number / string
}

/** 排序分组：0=number，1=string，2=date/datetime，3=duration，4=不可比较/空值组（恒排最后）。 */
function sortRank(v: BaseValue): number {
  if (typeof v === "number") return 0;
  if (typeof v === "string") return 1;
  if (isDateValue(v)) return 2;
  if (isDurationValue(v)) return 3;
  return 4;
}

/**
 * 排序键比较（engine sort 用；方向由调用方乘系数，本函数恒按 ASC 语义返回）。
 *
 * 暂定口径（待 oracle BASE-RESULT-002 冻结）：null / MISSING / 不可比较类型
 * （boolean/list/object/file）恒排最后，**与 ASC/DESC 无关**；
 * number 与 string 混排时 number 在前（仅为确定性，非官方语义）。
 * P2a：date/datetime（epoch）与 duration（毫秒）可比，分入独立排序组；
 * **link 不可比——排序遇到 link 抛 {@link BaseTypeError}**（P2a 计划「关键取舍」#9：
 * 排序报行级错误；engine 侧捕获接线属下一片，本片无产生 link 值的执行路径）。
 */
export function sortKeyCompare(a: BaseValue, b: BaseValue): number {
  if (isLinkValue(a) || isLinkValue(b)) {
    throw new BaseTypeError(
      `类型不参与排序：link（${typeNameOf(a)} 与 ${typeNameOf(b)}，link 无排序语义）`,
    );
  }
  const ra = sortRank(a);
  const rb = sortRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 4) return 0; // 同组保持原序（稳定排序兜底）
  // 同组内 number/string/date/duration 的 compareValues 必成功。
  return compareValues(a, b);
}

// ---------------------------------------------------------------------------
// P2a 增量：输出序列化（typed values → 稳定 JSON 形状）
// ---------------------------------------------------------------------------

/**
 * 输出 JSON 形状（设计 §4「不能泄漏类实例」）：无品牌、无 symbol 键、无 undefined。
 * 与 engine.ts 的 BaseOutputValue 同构；本函数是 typed values 的序列化真相源，
 * engine 接线（下一片）后由其调用，替换 P1 的 toBaseOutputValue。
 */
export type BaseTypedOutputValue =
  | null
  | string
  | number
  | boolean
  | BaseTypedOutputValue[]
  | { [key: string]: BaseTypedOutputValue };

/**
 * 运行时值 → 输出 JSON 形状（P2a 计划「关键取舍」#2/#9）：
 * - MISSING → null（读侧不塌缩、仅投影输出时塌，设计 §8.1）；
 * - DateValue → `{ type: "date", value: "YYYY-MM-DD" }` / `{ type: "datetime", value: <ISO 串> }`；
 * - DurationValue → number（毫秒；**P2a 无 duration 输出形状约定**，拍板直出毫秒数，注释存证）；
 * - LinkValue → `{ type: "link", path, display?, subpath? }`（path 为归一键）；
 * - BaseFileValue → 其 path 字符串（沿用 P1 边缘口径）；
 * - object/array 递归（品牌为不可枚举 symbol，天然不进输出；safeGetOwn 再过滤一层）；
 * - primitive 直出。
 */
export function toOutputValue(v: BaseValue): BaseTypedOutputValue {
  if (v === MISSING) return null;
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") {
    return v;
  }
  if (isFileValue(v)) return v.path;
  if (isDateValue(v)) {
    return v.precision === "date"
      ? { type: "date", value: new Date(v.epochMs).toISOString().slice(0, 10) }
      : { type: "datetime", value: new Date(v.epochMs).toISOString() };
  }
  if (isDurationValue(v)) return v.ms;
  if (isLinkValue(v)) {
    return {
      type: "link",
      path: v.path,
      ...(v.display !== undefined ? { display: v.display } : {}),
      ...(v.subpath !== undefined ? { subpath: v.subpath } : {}),
    };
  }
  if (Array.isArray(v)) return v.map(toOutputValue);
  const out: Record<string, BaseTypedOutputValue> = {};
  for (const key of Object.keys(v)) {
    const r = safeGetOwn(v, key);
    if (r.status === "ok") out[key] = toOutputValue(r.value as BaseValue);
  }
  return out;
}

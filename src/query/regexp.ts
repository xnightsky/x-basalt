// === 自建实现: regexmatch 的安全正则匹配（ReDoS 缓解）===
//
// SQLite 无内置 REGEXP；DataviewEngine 注册此函数支撑 regexmatch()。
// JS 正则无超时机制，恶意正则（如 (a+)+$）+ 长输入会指数回溯阻塞；这里以长度上限缓解攻击面
// （指数回溯需足够长输入触发，限长是务实有效的缓解，非根治——根治需 re2 等线性引擎）。

/** pattern 长度上限：超复杂正则一律视为不匹配。 */
const MAX_PATTERN = 200;
/** value 长度上限：超长输入是 ReDoS 触发条件，直接拒绝匹配。 */
const MAX_VALUE = 10000;

/**
 * SQLite REGEXP 自定义函数体：命中返回 1，否则 0。
 * 非法正则 / 超限输入视为不匹配且不抛错，避免单条查询因一个值崩溃或被 ReDoS 阻塞。
 *
 * @param pattern - 正则源（用户输入）
 * @param value - 被匹配列值
 *
 * @behavior
 * Given 合法正则与正常长度的列值
 * When 匹配
 * Then 命中返回 1、未命中返回 0
 *
 * @behavior
 * Given 非法正则、空值、或长度越过 ReDoS 阈值的 pattern/value
 * When 匹配
 * Then 一律降级为 0（不匹配）且不抛错，不中断整条查询
 */
export function safeRegexpMatch(pattern: unknown, value: unknown): 0 | 1 {
  if (value === null || value === undefined) return 0;
  const pat = String(pattern);
  const val = String(value);
  if (pat.length > MAX_PATTERN || val.length > MAX_VALUE) return 0;
  try {
    return new RegExp(pat).test(val) ? 1 : 0;
  } catch {
    // 非法正则不中断整条查询。
    return 0;
  }
}

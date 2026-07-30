/**
 * base 模块正则安全层（BASE-SEC-004）：`string.matches(pattern)` 的编译 + ReDoS 防护 + 缓存。
 *
 * 与 DQL 侧 `src/query/regexp.ts` 的**策略差异（有意）**：DQL 的 `regexmatch` 把非法正则/超限
 * 输入一律降级为「不匹配」且不报错（SQLite 自定义函数内不便产诊断）；Bases 的硬约束是
 * **不支持/不合法的写法必须报诊断、不静默忽略**（语法 §8），所以这里一律抛
 * {@link BaseInvalidRegexError} → 行级 `base/invalid-regex`。两处长度阈值刻意取同一档，
 * 便于统一调参。
 *
 * 防护三层（JS 正则无超时机制，无法根治，只能收窄攻击面——根治需 re2 类线性引擎）：
 *   1. **静态拒绝**灾难性回溯构造（无界量词套无界量词/顶层交替、反向引用）；
 *   2. **限长** pattern 与被匹配字符串（指数回溯需足够长输入才触发）；
 *   3. **有界编译缓存**（逐行匹配不重复编译；上限内淘汰全表，不做无界增长）。
 *
 * 上游：functions.ts 的 `matches` impl。
 * 下游：evaluator 把 {@link BaseInvalidRegexError} 转行级诊断。
 * 场景真相源：docs/design/bases-scenarios.md BASE-SEC-004。
 */

// === 自建实现 ===

/** pattern 长度上限（与 DQL 侧 `MAX_PATTERN` 同档）。 */
export const MAX_REGEX_PATTERN_LENGTH = 200;

/** 被匹配字符串长度上限（与 DQL 侧 `MAX_VALUE` 同档）：超长输入是 ReDoS 触发条件。 */
export const MAX_REGEX_SUBJECT_LENGTH = 10_000;

/** 编译缓存条目上限（防无界增长；超限整表清空，不做 LRU——命中率不值得引入淘汰结构）。 */
const MAX_CACHE_ENTRIES = 64;

/**
 * 正则不合法/不安全信号（值域内部，无位置信息）。
 * evaluator 捕获后转行级 `base/invalid-regex`——与「用错类型」「本引擎不做」都不是一回事。
 */
export class BaseInvalidRegexError extends Error {}

/** 无界量词：`*`、`+`、`{n,}`（`{n,m}` 有上界，不算）。 */
const UNBOUNDED_QUANTIFIER = /[*+]|\{\d+,\}/;

/**
 * 反向引用（`\1`..`\9`、`\k<name>`）：强制回溯，且与量词组合极易指数化，一律拒绝。
 * 注意排除 `\\1` 这种「转义反斜杠后跟数字」的情况——故先剥掉成对转义再检测。
 */
const BACKREFERENCE = /\\(?:[1-9]|k<)/;

/**
 * 静态检出灾难性回溯构造（保守但不过度）。
 *
 * 判据：**无界量词作用于一个分组，且该分组体内含无界量词或顶层交替**。
 * 命中：`(a+)+`、`(a*)*`、`(a|a)*`、`(a|ab)+` —— 经典指数回溯形态。
 * 放行：`(\d+)?`（外层量词有界）、`(foo)+`、`[a-z]+@[a-z]+`（量词不作用于分组）。
 *
 * 这条判据是**充分不必要**的：它挡住已知的经典形态，挡不住所有可能的指数式回溯
 * （完全判定不现实）。因此限长与缓存是必须同时在场的第二、三层，注释存证。
 */
function findCatastrophicGroup(pattern: string): string | undefined {
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "\\") {
      i += 1; // 跳过转义对，`\(` 不是分组开头
      continue;
    }
    if (pattern[i] !== "(") continue;
    // 定位配对的 `)`（跳过转义与字符类内的括号）
    let depth = 0;
    let j = i;
    let inClass = false;
    for (; j < pattern.length; j += 1) {
      const c = pattern[j];
      if (c === "\\") {
        j += 1;
        continue;
      }
      if (inClass) {
        if (c === "]") inClass = false;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j >= pattern.length) continue; // 括号不配平 → 交给 RegExp 编译去报
    const body = pattern.slice(i + 1, j);
    const after = pattern.slice(j + 1);
    // 外层量词必须无界才可能指数化（`{n,m}` / `?` 有上界，回溯规模受限）
    if (!/^(?:[*+]|\{\d+,\})/.test(after)) {
      i = j;
      continue;
    }
    if (UNBOUNDED_QUANTIFIER.test(body) || body.includes("|")) {
      return pattern.slice(i, j + 1 + (after.startsWith("{") ? after.indexOf("}") + 1 : 1));
    }
    i = j;
  }
  return undefined;
}

/** pattern → 已编译 RegExp 的有界缓存（逐行匹配不重复编译）。 */
const CACHE = new Map<string, RegExp>();

/**
 * 编译一个用户提供的正则源，带 ReDoS 静态防护与有界缓存。
 *
 * 不加任何 flag：`u` 会让 `\-` 这类宽松转义变成语法错误（收窄可用集合），
 * `g` 有 `lastIndex` 状态（跨行复用同一实例会漏匹配）——两者都不要。
 *
 * @throws {BaseInvalidRegexError} pattern 超长 / 含反向引用 / 含灾难性回溯构造 / 语法非法
 */
export function compileBaseRegex(pattern: string): RegExp {
  const hit = CACHE.get(pattern);
  if (hit !== undefined) return hit;

  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new BaseInvalidRegexError(
      `正则源长度 ${pattern.length} 超过上限 ${MAX_REGEX_PATTERN_LENGTH}（ReDoS 防护，BASE-SEC-004）`,
    );
  }
  // 先剥掉成对转义再查反向引用，避免把 `\\1`（转义反斜杠 + 字面 1）误判成 `\1`。
  if (BACKREFERENCE.test(pattern.replace(/\\\\/g, ""))) {
    throw new BaseInvalidRegexError(
      "正则含反向引用（\\1 / \\k<name>）：强制回溯且极易指数化，本引擎一律拒绝（ReDoS 防护）",
    );
  }
  const bad = findCatastrophicGroup(pattern);
  if (bad !== undefined) {
    throw new BaseInvalidRegexError(
      `正则含灾难性回溯构造 "${bad}"（无界量词套无界量词/交替，如 (a+)+）：本引擎一律拒绝（ReDoS 防护）`,
    );
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    // 非法正则**报诊断**而非静默不匹配——与 DQL 侧降级 0 的策略有意不同（见文件头）。
    throw new BaseInvalidRegexError(`正则语法非法：${(e as Error).message}`);
  }

  if (CACHE.size >= MAX_CACHE_ENTRIES) CACHE.clear(); // 有界：超限整表清空
  CACHE.set(pattern, re);
  return re;
}

/**
 * 安全匹配（子串命中即真，非整串锚定——要整串请自己写 `^…$`）。
 *
 * @throws {BaseInvalidRegexError} pattern 不合法/不安全，或被匹配字符串超长
 */
export function baseRegexTest(pattern: string, subject: string): boolean {
  if (subject.length > MAX_REGEX_SUBJECT_LENGTH) {
    throw new BaseInvalidRegexError(
      `被匹配字符串长度 ${subject.length} 超过上限 ${MAX_REGEX_SUBJECT_LENGTH}（ReDoS 防护，BASE-SEC-004）`,
    );
  }
  return compileBaseRegex(pattern).test(subject);
}

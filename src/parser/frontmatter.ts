/**
 * Frontmatter 解析子模块：提取文件顶部 YAML 并返回 { frontmatter, body }。
 *
 * 上游：src/parser/index.ts 的 VaultParser.parse() 是唯一调用方。
 * 下游：frontmatter 键值对由 indexer 写入 files 表与 tags 表（tags 字段 in_frontmatter=1）；
 *       body 传给后续正文提取器（wikilink/tag/callout/task/highlight/blockRef）。
 */
import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

// === Obsidian 规范来源: frontmatter 是文件顶部 --- 与 --- 之间的 YAML ===
// === 自建实现: 用 gray-matter 做分隔符/正文切分，YAML 本体交给 `yaml` 包 ===

/**
 * 自定义 YAML 引擎：只借 gray-matter 的 `---` 分隔符识别与正文切分，
 * YAML 解析改用 `yaml` 包（**与写侧 src/meta 同一个引擎**，读写口径统一）。
 *
 * 换引擎的原因是一个真实缺陷：gray-matter 内置 js-yaml 走 YAML 1.1，带
 * `!!timestamp` 隐式类型——不加引号的 `due: 2026-08-10` 被解析成 JS `Date`，
 * 经 indexer 的 `JSON.stringify` 落库即变成 `"2026-08-10T00:00:00.000Z"`（含毫秒），
 * 用户写的词法形态就此丢失。下游 Bases 的严格 ISO 推断（values.ts parseDateLike）
 * 不接受小数秒，于是该值退化为普通字符串，`due < now()` 一类比较静默失效
 * （只给行级 warning + cell null，查询仍以退出码 0 "成功"）。而 Obsidian 自己
 * 写日期属性正是不加引号的，真实 vault 普遍命中。
 *
 * `yaml` 包默认 YAML 1.2 core schema 无 timestamp 隐式类型，`2026-08-10` 保持
 * 字符串——恰好就是 parseDateLike 期望的形态，日期语义（date / datetime 精度）
 * 由值层按词法判定，不再依赖 YAML 层猜测。
 */
const YAML_ENGINE = {
  // 空 frontmatter（`---\n---`）时 parse 返回 null，gray-matter 的 engine 契约要求 object：
  // 归一为 {}，与原 js-yaml 引擎下的下游行为一致（非对象 frontmatter 由消费侧各自兜底）。
  parse: (str: string): object => (parseYaml(str) ?? {}) as object,
  stringify: (obj: object): string => stringifyYaml(obj),
};

/**
 * 解析文件顶部 YAML frontmatter，返回键值对与去掉 frontmatter 后的正文。
 * 仅当文件首行为 `---` 时生效（gray-matter 仅识别起始分隔符在开头的情形）。
 * 解析失败时降级为空 frontmatter + 原文（设计 §5：parser 不抛错，尽量降级）。
 *
 * @param content - 文件完整内容
 * @returns `{ frontmatter, body }`：frontmatter 为 YAML 键值对（失败时为 {}），
 *          body 为去掉 frontmatter 分隔符后的正文（失败时为原始 content）。
 *
 * @behavior
 * Given 文件首行为 `---` 且 YAML 语法合法
 * When 解析文件内容
 * Then 返回解析后的键值对与剥离 frontmatter 分隔符后的正文
 *
 * @behavior
 * Given YAML 语法非法或 gray-matter 抛出异常
 * When 解析文件内容
 * Then 降级返回空 frontmatter {} 与原始 content 作为正文，不向上抛出异常
 *
 * @behavior
 * Given 不加引号的 YAML 日期（`due: 2026-08-10` / `at: 2026-08-10T10:30:00`）
 * When 解析文件内容
 * Then 保持字符串原样，不转成 JS Date（YAML 1.2 core 无 timestamp 隐式类型）——
 *      日期语义交由下游值层按词法判定，见 {@link YAML_ENGINE} 注释
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  try {
    const parsed = matter(content, { engines: { yaml: YAML_ENGINE } });
    return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch {
    // 非法 YAML 不中断：退回无 frontmatter 解释，整文件作为正文。
    return { frontmatter: {}, body: content };
  }
}

/**
 * Frontmatter 解析子模块：提取文件顶部 YAML 并返回 { frontmatter, body }。
 *
 * 上游：src/parser/index.ts 的 VaultParser.parse() 是唯一调用方。
 * 下游：frontmatter 键值对由 indexer 写入 files 表与 tags 表（tags 字段 in_frontmatter=1）；
 *       body 传给后续正文提取器（wikilink/tag/callout/task/highlight/blockRef）。
 */
import matter from "gray-matter";

// === Obsidian 规范来源: frontmatter 是文件顶部 --- 与 --- 之间的 YAML ===
// === 自建实现: 阶段 1 用 gray-matter 解析，不依赖 Obsidian ===

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
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  try {
    const parsed = matter(content);
    return { frontmatter: parsed.data as Record<string, unknown>, body: parsed.content };
  } catch {
    // 非法 YAML 不中断：退回无 frontmatter 解释，整文件作为正文。
    return { frontmatter: {}, body: content };
  }
}

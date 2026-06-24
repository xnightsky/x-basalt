// === Obsidian 规范来源: frontmatter 是文件顶部 --- 与 --- 之间的 YAML ===
// === 自建实现: 阶段 1 用 gray-matter 解析，不依赖 Obsidian ===

/**
 * 解析文件顶部 YAML frontmatter，返回键值对与去掉 frontmatter 后的正文。
 * 仅当文件首行为 `---` 时生效。
 *
 * @param content - 文件完整内容
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  void content;
  throw new Error("not implemented: parseFrontmatter（阶段 1）");
}

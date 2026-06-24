import matter from "gray-matter";

// === Obsidian 规范来源: frontmatter 是文件顶部 --- 与 --- 之间的 YAML ===
// === 自建实现: 阶段 1 用 gray-matter 解析，不依赖 Obsidian ===

/**
 * 解析文件顶部 YAML frontmatter，返回键值对与去掉 frontmatter 后的正文。
 * 仅当文件首行为 `---` 时生效（gray-matter 仅识别起始分隔符在开头的情形）。
 * 解析失败时降级为空 frontmatter + 原文（设计 §5：parser 不抛错，尽量降级）。
 *
 * @param content - 文件完整内容
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

import type { ObsidianNode } from "./types.js";

// === Obsidian 规范来源 ===
// [[Note]] / [[Note|Alias]] / [[Folder/Note]] / [[Note#Heading]] / [[Note#^block-id]]
// embed：![[...]]（笔记嵌入 vs 资源嵌入由 utils/path.isAssetEmbed 区分）
// === 自建实现: 阶段 1 用正则 + remark AST 定位，不依赖 @flowershow/remark-wiki-link 的渲染逻辑 ===

/**
 * 从文本中提取全部 wikilink / embed 节点。
 * 解析每个链接的 target、alias、heading 锚点、block 引用、是否 embed。
 * 同一文件内重复 wikilink（规范化 target+anchor 后相同）只保留一次。
 *
 * @param text - 去掉 frontmatter 的正文
 */
export function extractWikilinks(text: string): ObsidianNode[] {
  void text;
  throw new Error("not implemented: extractWikilinks（阶段 1）");
}

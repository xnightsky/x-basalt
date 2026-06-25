// === Obsidian 规范来源: AST 节点类型，对应 Obsidian 笔记中的专有语法元素 ===
// 这些节点是 parser 的标准化输出，indexer / query 只依赖本类型，不感知原始 Markdown。

/** 标准化后的 Obsidian 语法节点。 */
export type ObsidianNode =
  | {
      type: "wikilink";
      target: string;
      alias?: string;
      heading?: string;
      blockId?: string;
      embed: boolean;
    }
  | { type: "tag"; value: string }
  | { type: "callout"; calloutType: string; title: string; foldable: boolean; content: string }
  // task / blockRef 携带 1-based 行号（相对**已剥离 frontmatter 的正文**）：
  // 位置信息是 parser 的职责，indexer 据此回填 tasks.line_number / blocks.line_number 与块内容，
  // 避免在 indexer 内重复 parser 的行匹配正则（消除跨模块逻辑漂移）。
  | { type: "task"; status: string; text: string; line: number }
  | { type: "blockRef"; id: string; line: number }
  | { type: "highlight"; content: string };

/** 单文件解析结果：frontmatter 键值对 + 节点数组。 */
export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  nodes: ObsidianNode[];
}

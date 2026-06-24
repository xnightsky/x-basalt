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
  | { type: "task"; status: string; text: string }
  | { type: "blockRef"; id: string }
  | { type: "highlight"; content: string };

/** 单文件解析结果：frontmatter 键值对 + 节点数组。 */
export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  nodes: ObsidianNode[];
}

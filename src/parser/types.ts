/**
 * Parser 模块公共类型契约：ObsidianNode（AST 节点联合）与 ParsedFile（单文件解析结果）。
 *
 * 上游：src/parser/index.ts（VaultParser）产出节点；src/parser/wikilink.ts 局部引用本类型。
 * 下游：src/indexer 是唯一消费方，按 type 分派写入 links/tags/tasks/blocks/inline_fields 五表（外加 files 行本身）；
 *       callout/highlight 节点不进索引（无对应查询字段，仅 parse 子命令展示）。
 *       src/query 读取 indexer 落地的 DB 数据，不再接触 ObsidianNode。
 *
 * 不变量：parser 产出的 ObsidianNode 是 indexer/query 的唯一 Markdown 解析输入；
 *         二者不感知原始 Markdown；parser 为纯函数，不碰 fs/DB。
 *         frontmatter.tags 由 indexer 单独消费（in_frontmatter=1），parser 不在 nodes 中重复产出。
 */
// === Obsidian 规范来源: AST 节点类型，对应 Obsidian 笔记中的专有语法元素 ===
// 这些节点是 parser 的标准化输出，indexer / query 只依赖本类型，不感知原始 Markdown。

/**
 * 标准化后的 Obsidian 语法节点。
 *
 * 每种变体对应 Obsidian 一类专有语法；indexer 按 `type` 分派写入不同 DB 表，
 * 不必重新解析 Markdown。同一文件内结构相同的节点 parser 已去重（wikilink/tag）。
 */
export type ObsidianNode =
  | {
      type: "wikilink";
      target: string; // 链接目标路径（已去除锚点；相对路径，不含 .md 后缀）
      alias?: string; // 显示别名（| 后文本）；缺省时由渲染层回退到 target
      heading?: string; // 标题锚点（# 后文本；与 blockId 互斥）
      blockId?: string; // 块引用 ID（#^ 后文本，不含 ^ 前缀；与 heading 互斥）
      embed: boolean; // true = ![[...]] 嵌入，false = [[...]] 普通链接；两者均计入 outlinks
      line: number; // 1-based 完整文件行号（包含 frontmatter），供 links/lint 诊断回指编辑器位置
      column: number; // 1-based UTF-16 code unit 列；与 JavaScript 字符串索引换算简单
      raw: string; // 原始匹配文本，embed 时包含 ! 前缀
    }
  // markdownLink：标准 Markdown inline link / image link 的 P0 子集。
  // 外部 URL、mailto、anchor-only link 也产出节点；是否跳过由后续 links check 判断。
  | {
      type: "markdownLink";
      text: string;
      target: string;
      title?: string;
      image: boolean;
      line: number; // 1-based 完整文件行号（包含 frontmatter）
      column: number; // 1-based UTF-16 code unit 列
      raw: string;
    }
  // tag.value：不含 # 前缀，保留原始大小写（DB 存储时由 indexer 归一化为小写）。
  | { type: "tag"; value: string }
  // callout.calloutType：已归一化为小写（如 "note"/"warning"）。
  // callout.foldable：有 +/- 折叠标记时为 true，无标记为 false。
  | { type: "callout"; calloutType: string; title: string; foldable: boolean; content: string }
  // task / blockRef 携带 1-based 行号（相对**已剥离 frontmatter 的正文**）：
  // 位置信息是 parser 的职责，indexer 据此回填 tasks.line_number / blocks.line_number 与块内容，
  // 避免在 indexer 内重复 parser 的行匹配正则（消除跨模块逻辑漂移）。
  // task.status：方括号内单字符（" " = 未完成，"x" = 完成，支持 "-"/"?" 等自定义状态）。
  | { type: "task"; status: string; text: string; line: number }
  // blockRef.id：^ 后的块标识符（不含 ^ 前缀；格式 [A-Za-z0-9-]+）。
  | { type: "blockRef"; id: string; line: number }
  | { type: "highlight"; content: string }
  // inlineField：Dataview 扩展的行内元数据 `key:: value`（整行 / [方括号] / (圆括号) 三形态）。
  // key 保留原始大小写（v1 仅 [A-Za-z0-9_]+，D4）；value 为原始文本 trim 后（v1 不类型化，D2）；
  // line 沿用 task/blockRef 的 1-based 正文行号——同名 key last-wins 去重后为最后一次出现行（D3）。
  // 设计真相源：docs/specs/2026-07-02-inline-fields-design.md §4/§6.1。
  | { type: "inlineField"; key: string; value: string; line: number };

/**
 * 单文件解析结果：frontmatter 键值对 + 节点数组。
 *
 * `frontmatter.tags`（若存在）由 indexer 单独消费并写入 tags 表（in_frontmatter=1），
 * parser 不在 nodes 中重复产出 frontmatter 标签，职责单一；
 * `nodes` 仅含正文行内提取的节点（wikilink/markdownLink/tag/callout/task/highlight/blockRef）。
 */
export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  nodes: ObsidianNode[];
}

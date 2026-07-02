---
name: biz-obsidian-spec
description: Use when implementing or reviewing the parser of x-basalt (wikilink/embed/frontmatter/tag/callout/task/highlight/blockRef extraction) - encodes the exact Obsidian Markdown grammar and edge cases the parser must reproduce
---

# Obsidian Markdown 解析规范（parser 真相源）

## 简介

x-basalt 的 parser 必须**精确复现** Obsidian 专有语法，且**零依赖 Obsidian 运行时**。本 skill 给出每类语法的文法与边界 case；完整论证见 `docs/research/2026-06-25-obsidian-spec-and-deps.md` §2。代码中以 `// === Obsidian 规范来源 ===` / `// === 自建实现 ===` 标注分界。

> **规范对标原则（2026-06-26）**：严格对标 Obsidian 官方语法行为实现。本 skill 的自定义口径若与官方**无冲突**，一律以**官方规范为准**；仅在官方未定义、或本项目刻意收窄（如纯 headless 不渲染）处才用自定义口径，并须显式注明理由。

## 触发场景

- 实现 / 修改 `src/parser/**`（wikilink、frontmatter、tag、callout、task、highlight、blockRef 提取）
- 审查解析结果与 `tests/fixtures/sample-vault/` 的断言
- 新增样例文件或扩展节点类型 `ObsidianNode`

## 文法与边界

### Wikilink / Embed

- 形态：`[[Note]]`、`[[Note|Alias]]`、`[[Folder/Note]]`、`[[Note#Heading]]`、`[[Note#^block-id]]`，可组合 `[[Folder/Note#Heading|Alias]]`。
- 解析顺序：`target` →（`#heading` **或** `#^blockId`）→ `|alias`。`#^` 优先识别为 blockId，单 `#` 为 heading。
- Embed：前缀 `!`。资源 vs 笔记由 `utils/path.isAssetEmbed` 判定（媒体扩展名=资源）。
- **去重**：同一文件内规范化（target + anchor）相同的 wikilink 只记录一次。
- embed 也计入 outlinks（`is_embed=1`）。

### Frontmatter

- 仅当**首行**为 `---`，到下一个 `---` 之间的 YAML 生效。用 gray-matter 解析。
- `tags` 可为数组或单值，并入 tag 索引（`in_frontmatter=1`）。

### Tag

- 行内 `#tag`、嵌套 `#a/b/c`；`#` 前**不能是字母/数字/下划线**（word 字符）。比「行首或空白」更贴近 Obsidian：允许 CJK 标点后成标签（如 `标签：#moc`），同时排除 `word#x` / `123#x` / `Concepts#heading`（wikilink 锚点不会被误当标签）。
- 排除：纯数字 `#123`（标签须含至少一个字母/下划线）；理想情况下排除代码块/行内代码内的 `#`（MVP 先近似，标注已知偏差）。
- 归一化：存**不带 `#`**；`#a/b` 同时归属 `a` 前缀。同一文件内同名标签去重。

### Callout

- `> [!type] Title`；`type` 大小写不敏感。
- 折叠：`[!type]+`（展开）/`[!type]-`（折叠）→ `foldable=true`，无符号 `foldable=false`。
- `content` = 后续连续 `>` 行聚合。

### Task

- `- [x] text`，状态取方括号内**单字符**（空格记 `" "`）。支持 `x`/` `/`-`/`?` 等自定义。
- `due_date`：文本中正则 `\d{4}-\d{2}-\d{2}` 首个匹配，无则 null。

### Highlight

- `==text==` → `{ type: "highlight", content }`。

### Block Reference

- 行尾 `^block-id`（`[A-Za-z0-9-]+`）为**定义**，入 blocks 表。
- `[[Note#^block-id]]` 为**引用**，由 wikilink 携带 `blockId`。

### Inline fields（Dataview 扩展，#28 · 2026-07-02）

- 三形态：整行 `key:: value`（可带列表前缀 `- ` / `* `，值取到行尾）、方括号 `[key:: value]`（键可见）、圆括号 `(key:: value)`（键隐藏）。
- 在 **maskCode 后**的正文提取（代码区不误吃，行号仍对齐原文）；整行形态独占该行，不再叠加行内形态扫描。
- key v1 仅 `[A-Za-z0-9_]+`（与 DQL 字段白名单对齐，D4；带空格/连字符 key 列 backlog）；空 key / 空 value 不产出；`https://x` 天然不命中（`//` 非 `::`）。
- 同名 key（按小写归一）**last-wins**：只保留最后一次出现（D3）；节点 `key` 保留原大小写，`line` 为最后出现行（1-based 正文行号）。
- 节点形态 `{ type: "inlineField"; key; value; line }`；设计真相源 `docs/specs/2026-07-02-inline-fields-design.md` §6.1。

## 硬约束提醒

parser 是**纯函数**：只吃字符串、吐 `ObsidianNode[]`，不碰 fs/DB/SQL。其余禁止项见 `AGENTS.md`「项目硬约束」。

# 调研：Obsidian 规范与依赖核实

> 日期：2026-06-25
> 目的：为 x-basalt 的设计提供事实依据——核实依赖可用性、整理 Obsidian 必解析语法、界定 Dataview DQL 子集与隐式字段，并把不确定项显式列为假设。

## 1. 依赖核实（npm，2026-06-25 实测）

| 包 | 最新版本 | 结论 |
|---|---|---|
| better-sqlite3 | 12.11.1 | Node 24 有预编译二进制，无需本地编译（Windows 友好）。**注意：pnpm v10 默认拦截依赖构建脚本**，须在 `package.json` 加 `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` 放行，否则拉不到 prebuilt。 |
| @flowershow/remark-wiki-link | 4.0.0 | 存在，但定位是「渲染期把 wikilink 转 HTML」，**不直接吐出 heading/block/embed 结构**。仅作语法参考，不作为解析真相源。 |
| chokidar | 5.0.0 | 可用，ESM。 |
| commander | 15.0.0 | 可用，ESM。 |
| unified / remark-parse | 11.0.5 / 11.0.0 | 纯 ESM——**强制本项目用 ESM**（`"type": "module"`）。 |
| gray-matter | 4.0.3 | 可用（CJS，default import）。 |
| zod | 4.4.3 | 可用。 |
| json5 | 2.2.3 | 可用（skill 文件格式）。 |
| node:sqlite（内置） | Node 24 可用 | 作为零安装兜底参考；当前**仍按 spec 用 better-sqlite3**。 |

**构建/运行决策**：ESM + `moduleResolution: NodeNext` → tsc 编译到 `dist/`，相对 import 必须带 `.js` 扩展名；开发态用 `tsx` 跑 `.ts`（自动解析 `.js`→`.ts`）；测试用 `node --import tsx --test`。

## 2. Obsidian 必解析语法（parser 真相源）

> 这是 parser 必须精确编码的文法。每条均标注是否有边界 case。详细规则同步进 `skills-def/biz-obsidian-spec`。

### 2.1 Wikilink / Embed
- `[[Note]]`：基础链接。
- `[[Note|Alias]]`：带显示别名。
- `[[Folder/Note]]`：带路径。
- `[[Note#Heading]]`：heading 锚点。
- `[[Note#^block-id]]`：block 引用锚点。
- `![[...]]`：embed。需区分**笔记嵌入**（target 无图片/媒体扩展名）与**资源嵌入**（`.png/.jpg/.gif/.svg/.mp4/.webm/.pdf` 等）。
- 组合：`[[Folder/Note#Heading|Alias]]` 各段可同时出现，解析顺序为 `target` →（`#heading` 或 `#^blockId`）→ `|alias`。
- **去重**：同一文件内重复 wikilink 只记录一次（按规范化后的 target+anchor 去重）。

### 2.2 Frontmatter
- 文件**顶部** `---` 与 `---` 之间的 YAML。仅当文件第一行为 `---` 时生效。
- `tags:` 可为数组或单值；`tags: [a, b]` / `tags:\n  - a`。
- 由 gray-matter 解析，提取为键值对，整体以 JSON 存 `files.frontmatter`。

### 2.3 Tags
- 行内 `#tag`、嵌套 `#parent/child`。
- 边界：`#` 前**不能是 word 字符（字母/数字/下划线）**——比初稿「行首或空白」更贴近 Obsidian，允许 `标签：#moc` 这类 CJK 标点后的标签生效，同时排除 `word#x` / `123#x` / wikilink 锚点 `Concepts#heading`（2026-06-25 阶段 1 据样例修订）；纯数字 `#123` 不算标签（须含至少一个字母/下划线）；代码块 / 行内代码内的 `#` 不算（MVP 先不剔除代码块，列为已知近似）。
- frontmatter `tags` 也并入标签索引（`in_frontmatter = 1`）。
- 归一化：DB 存**不带 `#`** 的标签文本；`FROM #a` 命中嵌套子标签 `#a/b`（前缀匹配，Obsidian 行为）。

### 2.4 Callouts
- `> [!type] Title` 起始，type 含 `note/tip/warning/danger/info/success/question/quote/...`。
- 折叠：`> [!type]+ Title`（默认展开）/ `> [!type]- Title`（默认折叠）→ `foldable = true`。
- content 为后续 `>` 引用行聚合。

### 2.5 Highlight
- `==highlighted==` → `{ type: 'highlight', content }`。

### 2.6 Task
- `- [ ]` 未完成 / `- [x]` 完成 / `- [-]` 取消 / `- [?]` 等自定义单字符状态。
- status 取方括号内字符（空格记为 `' '`）。
- `due_date`：从 task 文本正则提取 `\d{4}-\d{2}-\d{2}`（YYYY-MM-DD），无则 null。

### 2.7 Block Reference
- 行尾 `^block-id`（定义）→ `{ type: 'blockRef', id }`，并入 `blocks` 表。
- `[[Note#^block-id]]`（引用）由 wikilink 解析携带 `blockId`。

## 3. Dataview DQL 子集与隐式字段

### 3.1 语法子集（严格边界）
```
LIST | TABLE <field, ...>
FROM <"folder"> | <#tag> | <[[link]]>     # 单一来源；多来源 and/or 组合不在 MVP
WHERE <condition>
SORT <field> ASC | DESC                    # 单字段
LIMIT <number>
```
- 操作符：`= != < > <= >=`、`contains/icontains/startswith/endswith`、`AND/OR/NOT`、`regexmatch(field, "pattern")`。

### 3.2 隐式字段完整性分析（含假设）
Dataview 官方隐式字段很多，本项目只保证下列子集，其余**显式列为非目标**：

| 字段 | 来源 | MVP 支持度 |
|---|---|---|
| `file.name/path/folder/extension` | `files` 表直接列 | ✅ 完整 |
| `file.size/mtime/ctime` | `files` 表直接列 | ✅ 完整（数值/时间比较） |
| `file.tags` | `tags` 表聚合数组 | ✅ `contains(file.tags, "#x")` |
| `file.inlinks` | `links` 表反向 JOIN | ⚠️ 数组用于显示 + `contains`；数值比较为 stretch |
| `file.outlinks` | `links` 表正向 JOIN（含 embed） | ⚠️ 同上 |
| `file.tasks` | `tasks` 表关联 | ⚠️ 显示 + `length`；按 task 字段过滤为非目标 |
| frontmatter 标量字段（如 `status`） | `json_extract(files.frontmatter, …)` | ✅ 标量比较 + 数组 `contains` |
| `file.day/cday/mday/link/etags/aliases/...` | — | ❌ 非目标（MVP 不实现） |

### 3.3 关键假设（不确定项，显式列明而非含糊）
1. **链接解析**：wikilink target 按 basename（去 `.md`、大小写不敏感）解析到真实路径，歧义取第一个匹配——Obsidian「最短唯一路径」的 MVP 近似。
2. **embed 计入 outlinks**（`is_embed = 1`），与 Obsidian 一致。
3. **日期比较**：task `due_date` 与 frontmatter 日期按 ISO 字符串字典序比较（与日期序一致），不做时区处理。
4. **代码块内的 `#tag` / `==..==`**：MVP 不从代码块剔除，可能误识，列为已知近似，后续在 parser 用 remark AST 位置信息修正。
5. **`FROM [[link]]`**：解释为「链接指向该 note 的所有文件」（即 target 的反向链接集合）。
6. **大小写**：链接/标签匹配默认大小写不敏感（Obsidian 行为）。

## 4. 模块边界自检（防越界）
- parser 纯函数：只吃字符串、吐结构；不碰 fs / DB / SQL。
- indexer：唯一写 SQLite 的地方；不内联 DQL。
- query：只读 DB；不直接读 `.md` 文件。
- 隐式字段一律查询期 JOIN 计算，无物化缓存——对应硬约束第 6 条。

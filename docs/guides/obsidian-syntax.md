---
timestamp: 2026-07-02T05:43:48Z
sha256: 9512f57ac5f1f98ef9a7f8dae6f0e5d8a720bb1423b9746b9c922904ca0e92cc
type: guide
title: 解析层覆盖的 Obsidian 语法
description: parser 层支持的 wikilink/tag/callout/task 等 Obsidian 专有语法边界
tags:
  - guide
  - parser
  - obsidian
  - x-basalt
---
# 解析层覆盖的 Obsidian 语法

> 章节归属：[使用指南索引 →](usage.md) · 同级章节：[installation.md](installation.md) · [commands.md](commands.md) · [querying-dql.md](querying-dql.md) · [indexing-and-sync.md](indexing-and-sync.md) · [configuration.md](configuration.md) · [ai-and-skills.md](ai-and-skills.md) · [troubleshooting.md](troubleshooting.md)

---

## 概览

`parse` 是一个**纯函数** `string → { frontmatter, nodes }`：吃进文件的完整文本，吐出 frontmatter 键值对与标准化节点数组（`ObsidianNode[]`），**不碰文件系统或数据库**，**零依赖 Obsidian 运行时**。全部实现基于正则提取，不引入 `obsidian` npm 包。

一次解析的编排顺序：

```
parseFrontmatter  →  extractWikilinks  →  maskCode（代码区掩码）
→  extractTags（掩码后正文）  →  extractCallouts  →  extractTasks
→  extractHighlights（掩码后正文）  →  extractBlockRefs
→  extractInlineFields（掩码后正文）
```

`parse` 命令用法见 [commands.md](commands.md)。

---

## 代码区掩码

**亮点机制**：在提取行内语法前，先对正文中的代码区域执行**等长掩码**——把围栏代码块（` ``` ` / `~~~`）与行内代码（成对反引号）内的非换行字符替换为等量空格。

- 等长掩码**保留行结构和字符偏移**，后续按行计算 `task`/`blockRef` 行号完全不受影响。
- `#tag` 和 `==高亮==` 在掩码后的正文上提取，代码注释里的 `# comment`、字符串里的 `==x==` 不会被误识。
- 行内代码：开合反引号串**数量相等**才成对（CommonMark 语义），无闭合则视作普通文本。
- 未闭合的围栏块掩码至文末（贴近渲染行为）。

**已知近似**：`[[wikilink]]` 和 `- [ ] task` 暂时**不受掩码保护**，代码块内的此类语法仍会被提取（已知偏差，见[已知近似](#已知近似简表)）。

---

## ObsidianNode 节点类型

### 完整列表

| 节点        | 触发语法                                                                                                     | 字段                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `wikilink`  | `[[Note]]` / `[[Note\|Alias]]` / `[[F/Note]]` / `[[Note#Heading]]` / `[[Note#^block-id]]`，前缀 `!` 为 embed | `target, alias?, heading?, blockId?, embed` |
| `tag`       | 行内 `#tag` / 嵌套 `#a/b/c`                                                                                  | `value`（不带 `#`）                         |
| `callout`   | `> [!type] Title` + 后续 `>` 行，`+`/`-` 折叠标记                                                            | `calloutType, title, foldable, content`     |
| `task`      | `- [x] text` / `- [ ] text` / `- [-] text` / `- [?] text`（任意单字符状态）                                  | `status, text, line`                        |
| `highlight` | `==text==`                                                                                                   | `content`                                   |
| `blockRef`  | 行尾 `^block-id` 定义                                                                                        | `id, line`                                  |
| `inlineField` | `key:: value`（整行 / `[k:: v]` / `(k:: v)` 三形态，Dataview 扩展）                                        | `key, value, line`                          |

`task`/`blockRef`/`inlineField` 的 `line` 是**1-based 正文行号**（已剥离 frontmatter 后的正文），indexer 据此回填数据库的 `line_number` 列。

---

### wikilink / embed

**支持形态**：

| 写法                             | 说明                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `[[Note]]`                       | 普通笔记链接                                                 |
| `[[Note\|Alias]]`                | 带别名                                                       |
| `[[Folder/Note]]`                | 带路径前缀                                                   |
| `[[Note#Heading]]`               | 锚点 heading                                                 |
| `[[Note#^block-id]]`             | 锚点 block 引用                                              |
| `[[Folder/Note#Heading\|Alias]]` | 组合形式                                                     |
| `![[...]]`                       | embed（嵌入，资源 vs 笔记由 `utils/path.isAssetEmbed` 区分） |

**解析顺序**：`target` → （`#heading` 或 `#^blockId`）→ `|alias`。`#^` **优先识别为 blockId**，单 `#` 为 heading。

**去重规则**：同一文件内，`target basename`（小写）+ 锚点 + embed 标记 构成去重键。`[[X]]` 与 `![[X]]` embed 标记不同，**各自保留**。

```bash
# 示例：parse 输出中 wikilink 节点的形态
x-basalt parse note.md --format json
# nodes 中的 wikilink：
# { "type": "wikilink", "target": "Folder/Note", "heading": "Intro", "alias": "见简介", "embed": false }
# { "type": "wikilink", "target": "Image", "embed": true }
```

---

### tag（行内标签）

**形态**：`#tag`、嵌套 `#a/b/c`。存储**不带 `#`**，同一文件内同名 tag 去重。

**识别规则**（对标 Obsidian 官方行为）：

| 情形                                    | 是否识别为 tag                |
| --------------------------------------- | ----------------------------- |
| `#moc` · `#project/alpha`               | ✓                             |
| 标签：`#moc`（CJK 标点后）              | ✓                             |
| `word#x` · `123#x` · `Concepts#heading` | ✗（`#` 前为 word 字符）       |
| `#123`（纯数字）                        | ✗（须含至少一个字母或下划线） |
| 行内代码 / 围栏代码块内的 `#`           | ✗（代码区掩码已剔除）         |

精确规则：`#` 前**不能是**字母、数字、下划线（Unicode `\p{L}\p{N}_`），由此排除 wikilink 锚点（`[[Note#heading]]`）被误当标签，同时允许 CJK 标点后紧接的标签。

---

### callout

**触发语法**：

```markdown
> [!info] 标题
> 正文第一行
> 正文第二行

> [!warning]+ 可展开的折叠块
> 内容

> [!danger]- 默认折叠
> 内容
```

| 字段          | 说明                                                 |
| ------------- | ---------------------------------------------------- |
| `calloutType` | `[!type]` 内容，**归一化为小写**（`INFO` → `info`）  |
| `title`       | `[!type]` 后的标题文本（可为空）                     |
| `foldable`    | `+` 或 `-` 折叠标记存在时为 `true`，无标记为 `false` |
| `content`     | 后续连续 `>` 行聚合，去掉前缀 `> `                   |

---

### task

**触发语法**：行首允许缩进，列表符 `-` 或 `*`，方括号内**单字符**状态。

```markdown
- [ ] 未完成
- [x] 已完成
- [-] 取消
- [?] 存疑
```

`status` 字段取方括号内单字符（空格记作 `" "`）。`text` 为其后的正文（已 trim）。`line` 为 1-based 正文行号。

> task 在**原始行**上逐行匹配，不受代码区掩码影响（已知近似：代码块内的 task 行也会被提取，见下文）。

---

### highlight

```markdown
==高亮文本==
```

非贪婪匹配 `==(.+?)==`，`content` 为两端 `==` 之间的内容。在**掩码后正文**上提取，行内代码 / 围栏块内的 `==x==` 不误识。

---

### blockRef（块定义）

```markdown
这是一段正文内容 ^my-block-id
```

行尾 `^id`（`[A-Za-z0-9-]+`），`^` 前须为行首或空白（排除 `[[#^id]]` 这类引用）。`id` 字段为 `^` 后的标识符，`line` 为 1-based 正文行号。块**引用**（`[[Note#^id]]`）由 wikilink 节点的 `blockId` 字段携带，不产出额外 blockRef 节点。

---

### inlineField（Dataview 行内字段）

**触发语法**（Dataview 扩展，2026-07-02 #28）：

```markdown
rating:: 5
- 列表项里 key:: value 也算整行形态
这本书 [author:: 张三] 值得重读
这本书 (published:: 2026-01) 阅读视图里键隐藏
```

| 规则        | 说明                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| key 字符集  | v1 仅 `[A-Za-z0-9_]+`（与 DQL 字段白名单对齐）；带空格/连字符 key 不解析（backlog）                          |
| 同名 key    | **last-wins**：同文件多次出现（含大小写差异，按小写归一）只保留最后一次；`key` 保留原大小写                  |
| 空值        | `key::`（空 value）不产出节点                                                                               |
| 代码区      | 在掩码后正文提取，围栏 / 行内代码内的 `k:: v` 不误识                                                          |
| 整行 vs 行内 | 整行形态独占该行（值取到行尾，可含 `[ ] ( )` 字面）；非整行时同一行可提取多个 `[k:: v]` / `(k:: v)`           |

`value` 为原始文本（trim 后，不类型化）。查询侧与 frontmatter 的合并语义（同命名空间、frontmatter 胜）见 [querying-dql.md](querying-dql.md) §7.4；设计真相源 `docs/specs/2026-07-02-inline-fields-design.md`。

---

## frontmatter

仅当**首行为 `---`** 时触发 YAML 解析（用 `gray-matter`），到下一个 `---` 之间的内容视为 YAML。

- 解析失败（非法 YAML）**不抛错**，降级为空 `frontmatter` + 整文件作为正文。
- `tags` 字段支持数组或单值，由 indexer 并入 `tags` 表（`in_frontmatter=1`），**不会出现在 `nodes` 数组中**，parser 不在 nodes 里重复产出 frontmatter 标签。

```markdown
---
title: 我的笔记
tags: [project, active]
status: in-progress
---

正文从这里开始
```

---

## 已知近似（简表）

| 近似项                    | 当前行为                        | 影响                                                                                        |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| 代码块内的 `[[wikilink]]` | 仍按正文提取，不剔除            | 代码示例中的链接会进 links 表                                                               |
| 代码块内的 `- [ ] task`   | 仍按正文提取，不剔除            | 代码块内任务会进 tasks 表                                                                   |
| 同名 basename 链接歧义    | 取索引中首个匹配（近似）        | 多文件同名时可能指向错误文件；路径感知解析详见 [indexing-and-sync.md](indexing-and-sync.md) |
| 大小写                    | 链接 / 标签匹配默认大小写不敏感 | 与 Obsidian 官方行为一致                                                                    |

---

> 维护：扩展节点类型或修改解析规则时，同步更新 `src/parser/types.ts`、`biz-obsidian-spec` skill、本文档与 `tests/fixtures/sample-vault/` 中的断言。

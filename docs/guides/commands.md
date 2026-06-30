---
timestamp: 2026-06-30T03:21:42Z
sha256: 0e93b3c7e65d516cccaddcae3d42e262a6b0ff8382e210427be9ab59ab44ba1b
type: guide
title: 命令参考 · x-basalt
description: x-basalt CLI 全部子命令的参数、输出形态与示例
tags:
  - guide
  - cli
  - x-basalt
---
# 命令参考 · x-basalt

← [使用指南索引](usage.md)

> 所有命令的 `[vault...]`（可多个，回退配置 `vault`，支持多目录列表）、`--db` 均可回退到配置文件（`.x-basalt/config.yaml`）与环境变量 `X_BASALT_DIR`，无需每次手动指定——详见 [configuration.md](configuration.md)。出错时统一打印 `✗ <消息>` 并以退出码 1 退出。

---

## 目录

1. [`parse`](#parse--解析单文件)
2. [`index`](#index--全量建索引)
3. [`scan`](#scan--增量重索引)
4. [`query`](#query--执行-dql-查询)
5. [`skills` — 规范召回](#skills--规范召回)
6. [`meta`](#meta--读改-frontmatter)
7. [`watch`](#watch--常驻监听)
8. [`run`](#run--变更编排管道)

---

## `parse` — 解析单文件

```
x-basalt parse <file> [--format json|yaml]
```

解析单个 Markdown 文件，输出标准化 AST。纯函数，不操作数据库。

| 参数/选项        | 默认                      | 说明                                                  |
| ---------------- | ------------------------- | ----------------------------------------------------- |
| `<file>`         | 必填                      | Markdown 文件路径                                     |
| `--format <fmt>` | `json`（或配置 `format`） | 输出格式：`json`（缩进 2）或 `yaml`（极简展示序列化） |

**输出形态**

```json
{
  "frontmatter": { "status": "active", "tags": ["project"] },
  "nodes": [ ... ]
}
```

`nodes` 为 `ObsidianNode[]`——wikilink / tag / callout / task / highlight / blockRef 节点的类型与字段详见 [obsidian-syntax.md](obsidian-syntax.md)。

**示例**

```bash
x-basalt parse note.md
x-basalt parse note.md --format yaml
```

---

## `index` — 全量建索引

```
x-basalt index [vault...] [--db <path>] [--watch]
```

全量构建 / 重建 Vault 索引，写入 SQLite。

| 参数/选项     | 默认                             | 说明                                                                                                                       |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `[vault...]`  | 配置 `vault`                     | Vault 根目录，**可多个**（`index ./docs ./notes`）；省略时取配置 `vault`（可为列表），二者皆无则 `✗` 报错。多根索引其并集，主键以各根目录名作命名空间（目录名须互不相同）；详见 [configuration.md §6.5](configuration.md) |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | SQLite 路径；父目录自动创建                                                                                                |
| `--watch`     | `false`                          | 建完索引后继续监听文件变更，逐条打印 `· <event> <file>`（无 `on-change` 回调，需联动命令请用 [`watch`](#watch--常驻监听)） |

**行为细节**

- 扫描 Vault 下全部 `.md`，跳过 `.obsidian/` 及任何以 `.` 开头的隐藏文件/目录。
- 在单事务内「先清空再写入」；写入失败自动整体回滚，不留半成品索引。
- 流式分批处理，大 Vault 不阻塞。

**输出**

```
✓ 已索引 <vault> → <db>
监听中… 按 Ctrl+C 退出。      ← 仅 --watch 模式追加
· add Projects/New.md          ← 文件变更时逐行打印
```

**示例**

```bash
x-basalt index ./my-vault
x-basalt index ./my-vault --db ./my-vault.db --watch
```

> 只需增量更新而非全量重建？用 [`scan`](#scan--增量重索引)（更快）；需要变更联动命令？用 [`watch`](#watch--常驻监听)。

---

## `scan` — 增量重索引

```
x-basalt scan [vault...] [--db <path>] [--rehash] [--dry-run] [--json] [--pipe k=v]... [--apply]
```

**按需增量重索引**：diff 文件系统 vs 索引库，只重扫新增/改动/删除的文件；无需常驻进程，适合定时任务（cron）或 CI 钩子触发。

| 参数/选项                | 默认                             | 说明                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[vault]`                | 配置 `vault`                     | Vault 根目录                                                                                                                                                                                                                         |
| `--db <path>`            | `.x-basalt/index.db` / 配置 `db` | SQLite 路径                                                                                                                                                                                                                          |
| `--rehash`               | `false`                          | 按文件内容 hash 判断变化（慢但稳）；默认用 mtime + size 快速判断                                                                                                                                                                     |
| `--dry-run`              | `false`                          | 仅报告差异，**不写库**（触发前预览用）                                                                                                                                                                                               |
| `--json`                 | `false`                          | 输出结构化 JSON 报告；默认打印人读摘要                                                                                                                                                                                               |
| `--pipe k=v` / `--apply` | —                                | 用**管道**处理 scan 出的变更（替代默认仅 index 落库）：一次性 **scan 源编排**，管道语义同 [`run`](#run--变更编排管道)（`--pipe actions=…` 内联 或 `--pipe use=<name>` 引用配置；`--apply` 才落盘）；输出为管道报告，有失败退出码 `1` |

**输出形态**

人读摘要（默认）：

```
✓ scan <vault>：+N 新增 ~N 改动 -N 删除（N 未变跳过）
```

加 `--dry-run` 时摘要追加 `（dry-run 未写入）`。

`--json` 报告：

```json
{
  "added": ["Projects/New.md"],
  "modified": ["Daily/2026-06-28.md"],
  "deleted": ["Archive/Old.md"],
  "unchanged": 142
}
```

**示例**

```bash
x-basalt scan ./my-vault
x-basalt scan ./my-vault --dry-run           # 预览差异，不写库
x-basalt scan ./my-vault --rehash --json     # 精确内容对比，机器可读输出
x-basalt scan ./my-vault --pipe use=maintain # scan 出的变更跑管道（一次性编排）
x-basalt scan ./my-vault --pipe actions=index,normalize --apply # 内联，免配置
```

> 三种「源」对称（共享同一套 `--pipe` 管道）：`scan`（一次性 diff 源）/ [`watch`](#watch--常驻监听)（常驻事件源）/ [`run`](#run--变更编排管道)（默认 scan 源，`--pipe where=`/`paths=` 切手动源）。
> mtime 模式 vs `--rehash` 的权衡、断点续扫、数据模型细节——见 [indexing-and-sync.md](indexing-and-sync.md)。

---

## `query` — 执行 DQL 查询

```
x-basalt query "<dql>" [--db <path>] [--vault <path>]
```

执行自建 Dataview（DQL）子集查询，只读打开索引库，不回读 `.md` 文件。

| 参数/选项        | 默认                             | 说明                                                    |
| ---------------- | -------------------------------- | ------------------------------------------------------- |
| `<dql>`          | 必填                             | DQL 查询语句                                            |
| `--db <path>`    | `.x-basalt/index.db` / 配置 `db` | 要查询的 SQLite 路径（只读打开）；库不存在则 `✗` 报错   |
| `--vault <path>` | —                                | 被接受但**当前不使用**：查询只读索引库，无需 Vault 目录 |

**输出形态**

```json
{
  "type": "LIST",
  "columns": ["file.name", "file.path"],
  "rows": [{ "file.name": "Alpha", "file.path": "Projects/Alpha.md" }]
}
```

`rows` 中的聚合字段（`file.tags`、`file.inlinks`、`file.outlinks`、`file.tasks`）已解析为数组。

**示例**

```bash
x-basalt query 'LIST FROM #project WHERE status = "active" SORT file.mtime DESC LIMIT 10' --db ./index.db
x-basalt query 'TABLE status, due FROM "Projects" SORT file.name ASC' --db ./index.db
```

> **PowerShell 引号提示**：DQL 中的 `"folder"` 需原样传入程序。用**单引号**包整条语句，内部保留普通双引号（`'... FROM "Projects" ...'`）；不要写 `\"`，PowerShell 下会导致意外转义。

DQL 完整语法（`FROM` / `WHERE` / `SORT` / `LIMIT` / 操作符 / 隐式字段映射）见 [querying-dql.md](querying-dql.md)。

---

## `skills` — 规范召回

```
x-basalt skills [list]            # 列出全部 skill（name — description）
x-basalt skills get <name>        # 按名输出该 skill 完整内容
x-basalt skills get --all         # 输出全部 skill
x-basalt skills recall <keyword>  # 按关键字模糊召回
x-basalt skills path [name]       # 打印数据目录（带 name 打印该文件路径）
```

加载 JSON5 规范文件（内置 `obsidian-base-spec` + 自我说明书 `x-basalt`），按名精确取或按关键字模糊召回。

| 子命令             | 说明                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| （无）/ `list`     | 列出全部 skill 的 `name — description`                               |
| `get <name>`       | 按名输出该 skill 完整内容；`--all` 输出全部                          |
| `recall <keyword>` | Fuse.js 模糊召回（容拼写错、按相关性排序）；命中 `name` / `triggers` |
| `path [name]`      | 打印解析出的数据目录；带 `name` 打印 `<dir>/<name>.json5`            |

所有读子命令默认输出人类 / AI 可读 Markdown，加 `--json` 切换结构化 JSON。

**`get <name>` 未命中**打印 `✗ 未找到名为 "<name>" 的 skill` 退出码 1；**`recall` 命中 0 条**打印 `✗ 未召回到与 "<keyword>" 相关的 skill` 退出码 1。

skill 目录通过配置 `skillPath` 或环境变量 `OBSIDIAN_SKILL_PATH` 指定（命令行无单独 flag）；优先级、兜底内置 skill（`obsidian-base-spec` / `x-basalt`）详见 [ai-and-skills.md](ai-and-skills.md)，或用 `x-basalt skills path` 查看当前目录。

**示例**

```bash
x-basalt skills get obsidian-base-spec   # 取整篇 Obsidian/DQL 规范
x-basalt skills recall wikilink          # 模糊召回 wikilink 规范
x-basalt skills list --json              # 结构化列出全部 skill
x-basalt skills path                     # 打印数据目录
```

---

## `meta` — 读 / 改 frontmatter

```
x-basalt meta get   <file> [key] [--format json|yaml]
x-basalt meta set   <file> <key> <value> [--type <t>] [--dry-run]
x-basalt meta unset <file> <key> [--dry-run]
x-basalt meta rename <file> <oldKey> <newKey> [--dry-run]
x-basalt meta normalize <file> [--sort-keys] [--dry-run]
x-basalt meta profile list
x-basalt meta profile show <name> [--format json|yaml]
x-basalt meta apply <profile> <file> [--set key=value]... [--refresh-derived] [--dry-run]
```

读取与改造单个 `.md` 的 **frontmatter（元数据头 / Obsidian Properties）**。这是 x-basalt 唯一的**写侧**命令：写操作只动 frontmatter，**正文逐字节不动**；用 [`yaml`](https://eemeli.org/yaml/) Document 往返，保留键顺序、注释（尽力）、并对需要引号的值（如 `[[链接]]`）自动加引号产出合法 YAML。写入为**原子写**（临时文件 + rename），失败不留半成品。

| 子命令                                 | 说明                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `get <file> [key]`                     | 读 frontmatter：省略 `key` 输出整个对象，给 `key` 输出该值（缺失输出 `null`）。`--format` 同 `parse`             |
| `set <file> <key> <value>`             | 设置 / 更新一个属性；键存在则**原位更新**（保留位置），不存在则追加到末尾                                        |
| `unset <file> <key>`                   | 删除一个属性；键不存在为 no-op                                                                                   |
| `rename <file> <oldKey> <newKey>`      | 重命名键，**保留位置与值**；源键不存在或目标键已存在则 `✗` 报错（不静默覆盖）                                    |
| `normalize <file>`                     | **归一**（见下）：tags/aliases/cssclasses 列表化 + tags 去 `#` + 去重 + 单数键迁移；`--sort-keys` 额外排序顶层键 |
| `profile list` / `profile show <name>` | **元数据策略**（见下）：列出 / 查看某套约定的规范+模板（“告知”，供 AI/人读后决定补什么）                         |
| `apply <profile> <file>`               | 套用策略：机械预填 + `--set` 补/覆盖 + 报告仍缺（见下）                                                          |

**`set --type` 取值类型**（默认 `auto`）：

| `--type`       | 行为                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`（默认） | **保守推断**：仅 `true`/`false`→布尔、`null`→空、严格数字→number，其余按字符串。刻意不识别 `yes/no/on/off`（避免 YAML 1.1 的 Norway 陷阱静默改语义） |
| `string`       | 强制字符串（如把数字样值 `3` 存成 `"3"`）                                                                                                            |
| `number`       | 数值，非法则 `✗` 报错                                                                                                                                |
| `boolean`      | 仅接受 `true`/`false`                                                                                                                                |
| `null`         | 写入空值                                                                                                                                             |
| `list`         | 按逗号分隔为数组（如 `a, b, c` → 块序列）                                                                                                            |

**`--dry-run`**：只把**将写入的完整文件内容**打印到 stdout，不落盘（写前预览）。

**`normalize` 的归一规则**（默认 ON，都是"让 frontmatter 对 Obsidian 合法有效"的安全操作）：

| 规则         | 行为                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表属性归一 | `tags` / `aliases` / `cssclasses` 统一为列表。`tags`/`cssclasses` 的标量串按空白或逗号拆分；**`aliases` 标量当作单个别名不拆**（别名可含空格） |
| 去 `#` 前缀  | 仅 `tags` 项：`#x` → `x`（YAML 里 `#` 起注释，带 `#` 的 frontmatter 标签无效）                                                                 |
| 去重         | 列表项保留首次出现顺序去重                                                                                                                     |
| 单数键迁移   | `tag`→`tags`、`alias`→`aliases`、`cssclass`→`cssclasses`（Obsidian 1.9 已弃单数键）。两者都在 → **合并并集**；只有单数 → **原位改名**保位置    |

`--sort-keys`（opt-in，默认 OFF）：额外按字母序排序顶层键——可能动空行，故不默认。
**不做**（风险/不确定）：类型强制、日期格式统一、删空键。归一同样**幂等**、只动 frontmatter、非法 YAML 拒写。

**`profile` / `apply` 元数据策略**

> **`normalize` vs `apply` 分工**：`normalize` = **无约定的纯标准化**（只把已有字段改合规：tags 列表化 / 去 `#` / 去重 / 单数键迁移，**不挑 profile、不加新字段**）；`apply <profile>` = **按某约定补全/覆盖该有的字段，并自动标准化**（apply 内部以 normalize 收尾，产出既合规又齐全）。想"只把笔记变干净/批量清洗"用 `normalize`；想"让笔记符合某套约定"用 `apply`。

「策略（profile）」= 一套现成的元数据约定（模板 + 规范），帮你免去逐字段手敲。x-basalt 只负责**告知**这套约定长什么样——`meta profile show <name>` 输出它的规范+字段模板（哪些字段、必填/推荐/可选、各是什么意思、可额外补什么），供 **AI 或人读后自行决定补什么**。x-basalt **不替你判断、不调用 LLM**。

内置 profile（`meta profile list` 查看）：

| profile                    | 来源                           | 机械预填的字段                              | 需消费者补的（语义）                                  |
| -------------------------- | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| **`pkm-note`**（第一推荐） | Obsidian Properties + 社区惯例 | `created`(birthtime) / `modified`(mtime)    | tags / aliases / cssclasses / status                  |
| `llm-wiki`                 | Google OKF v0.1                | `timestamp`(mtime) / `sha256`(正文hash)     | type(必填) / title / description / resource / tags    |
| `ssg-blog`                 | Astro / Hugo / Jekyll 等 SSG   | `pubDate`(birthtime) / `updatedDate`(mtime) | title(必填) / description(必填) / draft / tags / slug |

`meta apply <profile> <file>` 做两件事：

1. **机械预填**（确定性）：把该 profile 里"无需理解文档"的字段按文件信息补上——`created`/`modified`（文件时间，ISO 字符串）、`sha256`（正文哈希）。**只补缺、不覆盖已有**（top-up）。
2. **`--set key=value`（可重复）**：你（AI 读规范+文档后 / 人）把语义字段和额外字段**一并传入**，免去逐条 `meta set`。值**按 profile 声明的类型自动转**（如 `tags` 是 list → 按逗号拆；profile 没有的额外 key 按 `auto` 转）。**`--set` 是显式权威值，会覆盖**已有值与机械预填（例：`--set title=abc` 把 title 覆盖为 abc）。
3. **标准化收尾**：填完自动跑 `normalize`（tags 列表化 / 去 `#` / 去重 / 单数键迁移），把文件里旧的不规范字段连同填入的值一起归一——产出**既合规又齐全**。

**`--refresh-derived`（改完正文后重算机械字段）**：默认机械预填是 top-up，改了正文后 `sha256`/`modified` 等不会刷新。加 `--refresh-derived` 后，**内容派生**字段（来源 `mtime`：modified/timestamp/updatedDate；来源正文 hash：sha256）即使已存在也**重算覆盖**；**创建时间**字段（来源 `birthtime`：created/pubDate）仍恒定不动（避免在 birthtime 不可靠的文件系统上把 created 刷成当前时间而漂移）；`--set` 给过的字段始终优先、不被重算覆盖。

apply 报告：**补入** / **覆盖(--set)** / **重算(--refresh-derived)** / **仍缺**（按 必填/推荐/可选 分组），并指向 `meta profile show` 让你读完整规范再补其余。没补的字段不出现（保持干净）。幂等、只动 frontmatter、非法 YAML 拒写、未知 profile `✗` 退出 1。

**输出**

```
✓ set status → <file>          # 成功
· 无变化：<file>                # 值未变，未写盘
· dry-run（未写入）：set x → <file>   # dry-run（内容已先打到 stdout）
```

**行为细节与边界**

- 只认**文件顶部** `---` 到 `---` 之间的 YAML；正文里的 `---`（分隔线 / 代码块）不会被误判。
- frontmatter 为**非法 YAML** 时，写操作**拒绝执行并 `✗` 报错**、文件保持原样（绝不在无法解析的结构上写、防毁文件）。
- 无 frontmatter 的文件执行 `set` 会在**顶部新建** `---…---`，原文整体作为正文保留。
- **幂等**：同一改动连跑两次，第二次报「无变化」、字节稳定。
- 本期仅支持**顶层扁平键**；嵌套键路径、inline Dataview 字段（`key:: v`）、批量 / 跨 vault、归一化（normalize）等为后续阶段。

**示例**

```bash
x-basalt meta get note.md                       # 看整个元数据头
x-basalt meta get note.md status                # 看单个属性
x-basalt meta set note.md status active         # 设字符串
x-basalt meta set note.md rank 3 --type number  # 设数值
x-basalt meta set note.md tags "a, b, c" --type list
x-basalt meta set note.md status done --dry-run # 预览不写
x-basalt meta rename note.md tag tags           # 改键名（如修历史单数键）
x-basalt meta unset note.md draft
x-basalt meta normalize note.md                 # 归一：tags 列表化/去#/去重 + 单数键迁移
x-basalt meta normalize note.md --sort-keys --dry-run  # 含排序、先预览
x-basalt meta profile list                      # 看有哪些策略
x-basalt meta profile show pkm-note             # 读 Obsidian 笔记策略的规范+模板
x-basalt meta apply pkm-note note.md            # 机械补 created/modified + 报告仍缺
x-basalt meta apply pkm-note note.md --set tags=area/work,moc --set status=active   # 顺手补语义字段
x-basalt meta apply llm-wiki note.md --refresh-derived   # 改完正文后重算 sha256/timestamp（created 不动）
```

---

## `watch` — 常驻监听

```
x-basalt watch [vault...] [--db <path>] [--on-change <cmd>] [--pipe k=v]... [--apply]
```

常驻监听模式：启动时全量建索引，随后对每次文件变更实时增量更新，可联动外部命令。

| 参数/选项                | 默认                             | 说明                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[vault]`                | 配置 `vault`                     | Vault 根目录；省略时取配置 `vault`，二者皆无则 `✗` 报错                                                                                                                                                                     |
| `--db <path>`            | `.x-basalt/index.db` / 配置 `db` | SQLite 路径（可由配置 `db` 覆盖）                                                                                                                                                                                           |
| `--on-change <cmd>`      | 配置 `onChange`                  | 变更时执行的 shell 命令模板；`{file}` 占位替换为变更文件路径                                                                                                                                                                |
| `--pipe k=v` / `--apply` | —                                | 用**管道**维护（替代 `--on-change` 裸 shell）：启动先全量 scan 建基线，再按变更跑管道（`--pipe actions=…` 或 `--pipe use=<name>`）；常驻自动改文件需 `--apply`，`Ctrl+C` 优雅退出。管道语义详见 [`run`](#run--变更编排管道) |

**行为细节**

1. 启动时先执行全量 `rebuild`（清空 + 重建），完成后打印：
   `✓ 已索引 <vault> → <db>，开始监听… 按 Ctrl+C 退出。`
2. `add` / `change`：先增量更新索引，**再**触发 `--on-change` 回调——回调运行时索引已是最新状态。
3. `unlink`（文件删除）：从索引中移除对应记录。
4. 前台常驻运行，`Ctrl+C` 退出。

> **建议**：无需实时响应的场景（如日常同步）推荐用 [`scan`](#scan--增量重索引) 配合定时任务周期触发——开销更低、无需守护进程。

**示例**

```bash
x-basalt watch ./my-vault --db ./index.db
x-basalt watch ./my-vault --db ./index.db --on-change "node reindex-hook.js {file}"
x-basalt watch ./my-vault --pipe use=maintain     # 声明式管道维护（替代裸 shell）
```

---

## `run` — 变更编排管道

```
x-basalt run [--pipe k=v]... [--apply] [--vault <path>]... [--db <path>] [--json]
```

按**管道**处理一批变更：源 → 去重（同文件折叠）→ 路由（事件类型 / glob / DQL）→ 执行内建动作链（`index` / `normalize` / `parse`…）。管道用 `--pipe k=v`（可重复）**内联定义**，或 `--pipe use=<name>` **引用配置段**——命令行是规范落地，配置段是命名快照。写动作默认 **dry-run**，`--apply` 才落盘。

**管道参数 `--pipe k=v`**（可重复；与配置段 `pipelines.<name>` 一一对应）：

| key           | 值                     | 含义                                                                                                                                 |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `use`         | name                   | 从配置 `pipelines.<name>` 加载作基底（其余 `--pipe` 覆盖它）                                                                         |
| `actions`     | a,b,c                  | 内建动作链（必填）：`index` / `normalize` / `parse` / `apply <profile>` / `set <key>=<value>` / `unset <key>` / `rename <old> <new>` |
| `where`       | DQL                    | 按 DQL 选文件（手动源 / 语义筛）                                                                                                     |
| `paths`       | glob                   | 路径过滤                                                                                                                             |
| `on`          | add,change             | 事件类型过滤                                                                                                                         |
| `concurrency` | N                      | 文件间并发上限（默认 4）                                                                                                             |
| `if-exists`   | skip\|overwrite\|merge | `rename` 键冲突策略（默认 `skip`）                                                                                                   |

**内建动作**

| 动作                 | 是否写 `.md` | 说明                                                                                                                        |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `index`              | 否（写库）   | 把文件增量写入 SQLite 索引                                                                                                  |
| `normalize`          | 是           | 归一 frontmatter：tags 列表化 / 去 `#` / 去重 / 单数键迁移                                                                  |
| `parse`              | 否           | 只读解析校验                                                                                                                |
| `apply <profile>`    | 是           | 套用 profile：机械补时间/哈希 + 自动标准化（**纯 top-up**，不带 `--set`/`--refresh-derived`；要补语义/刷新用 `meta apply`） |
| `set <key>=<value>`  | 是           | 设置属性（**仅标量值**，不含空格/逗号；列表值暂不支持）                                                                     |
| `unset <key>`        | 是           | 删除属性                                                                                                                    |
| `rename <old> <new>` | 是           | 改键名；目标键已存在时按 `if-exists` 策略处理                                                                               |

所有**写动作**（`normalize` / `apply` / `set` / `unset` / `rename`）默认 **dry-run 只预览**，必须加 `--apply` 才落盘。

**运行环境**（顶层 flag，与管道无关）：

| 选项             | 默认                             | 说明                                                        |
| ---------------- | -------------------------------- | ----------------------------------------------------------- |
| `--apply`        | 关                               | 写动作落盘（默认 dry-run 只预览）；覆盖管道 `dryRun`        |
| `--vault <path>` | 配置 `vault`                     | Vault 根目录                                                |
| `--db <path>`    | `.x-basalt/index.db` / 配置 `db` | SQLite 路径                                                 |
| `--json`         | 关                               | 结构化报告（`total`/`changed`/`skipped`/`failed`/`dryRun`） |

**源**：`run` 默认 **scan 源**（全库 diff）；给 `--pipe where=` / `--pipe paths=` 切**手动源**。**退出码**：有动作失败时 `1`（明细打到 stderr）。

**限制**

- 管道 `set` **仅支持标量值**：token 按空格切，值不能含空格/逗号；列表值暂不支持（P2）。
- 管道 `apply` 是**纯 top-up**（只补缺字段 + 自动 normalize），不带 `meta apply` 的 `--set`/`--refresh-derived`；要补语义字段或重算 `sha256`/`modified` 等请用独立 `meta apply` 命令。

**示例**

```bash
# 纯内联（自包含，不碰配置）
x-basalt run --pipe actions=index,normalize --pipe where="LIST FROM #pkm" --apply --vault ./v
# 引用配置段管道
x-basalt run --pipe use=maintain --apply --vault ./v
# 引用 + 覆盖一项
x-basalt run --pipe use=maintain --pipe concurrency=8 --vault ./v
# 批量套用 profile 后归一
x-basalt run --pipe actions="apply pkm-note, normalize" --pipe where="LIST FROM #pkm" --apply --vault ./v
# 批量改名：tag -> tags，冲突跳过
x-basalt run --pipe actions="rename tag tags" --pipe if-exists=skip --apply --vault ./v
```

**配置段**（`.x-basalt/config.yaml`，命名快照；每个 key ⟷ 一个 `--pipe key=val`）：

```yaml
pipelines:
  maintain:
    actions: [index, normalize] # 必填
    where: "contains(file.tags, 'pkm')"
    on: [add, change]
    concurrency: 4
    dryRun: true # 默认预览；命令行 --apply 覆盖
```

> 三命令共享 `--pipe`，命令只决定「源」：[`scan`](#scan--增量重索引)（diff）/ [`watch`](#watch--常驻监听)（事件）/ `run`（默认 scan）。原生管道（stdin）是与 `--pipe` 正交的独立设计，后续可组装。

---

← [使用指南索引](usage.md) · 安装：[installation.md](installation.md) · 配置：[configuration.md](configuration.md) · 故障排查：[troubleshooting.md](troubleshooting.md)

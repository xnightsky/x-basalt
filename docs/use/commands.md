---
timestamp: 2026-08-03T16:07:02Z
sha256: eb80117e484a34b658d8e8a3fcae072b0353700bee3478b05187d57966d997e3
type: guide
title: 命令参考 · x-basalt
description: x-basalt CLI 全部子命令的参数、输出形态与示例
tags:
  - guide
  - cli
  - x-basalt
---

# 命令参考 · x-basalt

← [使用指南索引](README.md)

> 所有命令的 `[vault...]`（可多个，回退配置 `vault`，支持多目录列表）、`--db` 均可回退到配置文件（`.x-basalt/config.yaml`）与环境变量 `X_BASALT_DIR`，无需每次手动指定——详见 [configuration.md](config.md)。出错时统一打印 `✗ <消息>` 并以退出码 1 退出。

---

## 目录

1. [`parse`](#parse--解析单文件)
2. [`index`](#index--全量建索引)
3. [`scan`](#scan--增量重索引)
4. [`query`](#query--执行-dql-查询)
5. [`search`](#search--全文检索正文)
6. [`base`](#base--base-view-查询)
7. [`skills` — 规范召回](#skills--规范召回)
8. [`meta`](#meta--读改-frontmatter)
9. [`watch`](#watch--常驻监听)
10. [`run`](#run--变更编排管道)
11. [`chat`](#chat--自然语言驱动可选-ai)
12. [`links`](#links--本地链接诊断)
13. [`lint`](#lint--规则诊断metadata--links)

---

## `parse` — 解析单文件

```
x-basalt parse <file> [--format json|yaml]
```

解析单个 Markdown 文件，输出 `{ frontmatter, body, nodes }`：`body` 是去除 frontmatter 后的完整 Markdown 正文（包括普通标题和段落），`nodes` 是 Obsidian 专有语法的标准化 AST。纯函数，不操作数据库。

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

`nodes` 为 `ObsidianNode[]`——wikilink / Markdown link / tag / callout / task / highlight / blockRef / inlineField 节点的类型与字段详见 [obsidian-syntax.md](obsidian-syntax.md)。链接类节点携带完整文件 `line` / `column` / `raw`，便于后续 links/lint 定位。

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

| 参数/选项     | 默认                             | 说明                                                                                                                                                                                                                      |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[vault...]`  | 配置 `vault`                     | Vault 根目录，**可多个**（`index ./docs ./notes`）；省略时取配置 `vault`（可为列表），二者皆无则 `✗` 报错。多根索引其并集，主键以各根目录名作命名空间（目录名须互不相同）；详见 [configuration.md §6.5](config.md) |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | SQLite 路径；父目录自动创建                                                                                                                                                                                               |
| `--watch`     | `false`                          | 建完索引后继续监听文件变更，逐条打印 `· <event> <file>`（无 `on-change` 回调，需联动命令请用 [`watch`](#watch--常驻监听)）                                                                                                |

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
x-basalt scan [vault...] [--db <path>] [--rehash] [--dry-run] [--json] [--by-dir] [--pipe k=v]... [--apply]
```

**按需增量重索引**：diff 文件系统 vs 索引库，只重扫新增/改动/删除的文件；无需常驻进程，适合定时任务（cron）或 CI 钩子触发。

| 参数/选项                | 默认                             | 说明                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `[vault]`                | 配置 `vault`                     | Vault 根目录                                                                                                                                                                                                                         |
| `--db <path>`            | `.x-basalt/index.db` / 配置 `db` | SQLite 路径                                                                                                                                                                                                                          |
| `--rehash`               | `false`                          | 按文件内容 hash 判断变化（慢但稳）；默认用 mtime + size 快速判断                                                                                                                                                                     |
| `--dry-run`              | `false`                          | 仅报告差异，**不写库**（触发前预览用）                                                                                                                                                                                               |
| `--json`                 | `false`                          | 输出结构化 JSON 报告（**始终含 `byDir`**，与 `--by-dir` 无关）；默认打印人读摘要                                                                                                                                                     |
| `--by-dir`               | `false`                          | 人读模式下追加**按目录标量计数**明细（只报每个目录 added/modified/deleted 的数量，不列文件名——目录再多也不撞 maxChars/撞顶，问「每个子目录各多少」用这个）                                                                           |
| `--pipe k=v` / `--apply` | —                                | 用**管道**处理 scan 出的变更（替代默认仅 index 落库）：一次性 **scan 源编排**，管道语义同 [`run`](#run--变更编排管道)（`--pipe actions=…` 内联 或 `--pipe use=<name>` 引用配置；`--apply` 才落盘）；输出为管道报告，有失败退出码 `1` |

**输出形态**

人读摘要（默认）：

```
✓ scan <vault>：+N 新增 ~N 改动 -N 删除（N 未变跳过）
```

加 `--dry-run` 时摘要追加 `（dry-run 未写入）`。加 `--by-dir` 时追加按目录明细行（如 `  guides/advanced  +3 ~1 -0`）。

`--json` 报告：

```json
{
  "added": ["Projects/New.md"],
  "modified": ["Daily/2026-06-28.md"],
  "deleted": ["Archive/Old.md"],
  "unchanged": 142,
  "byDir": {
    "Projects": { "added": 1, "modified": 0, "deleted": 0 },
    "Daily": { "added": 0, "modified": 1, "deleted": 0 },
    "Archive": { "added": 0, "modified": 0, "deleted": 1 }
  }
}
```

> `byDir`：key 为相对 Vault 的 POSIX 目录路径（根目录下文件归 `"."`），value 为该目录的标量计数——只给数量不给文件名，规模再大也不会撞 maxChars/撞顶（对治「问每个子目录各多少未索引」被误路由到逐文件列举的坑）。多根 vault 按 `<根名>/<相对路径>` 天然分桶，根间不混淆。

**示例**

```bash
x-basalt scan ./my-vault
x-basalt scan ./my-vault --dry-run           # 预览差异，不写库
x-basalt scan ./my-vault --rehash --json     # 精确内容对比，机器可读输出
x-basalt scan ./my-vault --by-dir            # 人读模式下按目录看明细（不逐文件列举）
x-basalt scan ./my-vault --pipe use=maintain # scan 出的变更跑管道（一次性编排）
x-basalt scan ./my-vault --pipe actions=index,normalize --apply # 内联，免配置
```

> 三种「源」对称（共享同一套 `--pipe` 管道）：`scan`（一次性 diff 源）/ [`watch`](#watch--常驻监听)（常驻事件源）/ [`run`](#run--变更编排管道)（默认 scan 源，`--pipe where=` 或 `--stdin` 切手动源）。
> mtime 模式 vs `--rehash` 的权衡、断点续扫、数据模型细节——见 [indexing-and-sync.md](indexing.md)。

---

## `query` — 执行 DQL 查询

```
x-basalt query "<dql>" [--db <path>] [--offset <n>] [--size <n>] [--json] [--vault <path>]
```

执行自建 Dataview（DQL）子集查询，只读打开索引库，不回读 `.md` 文件。

| 参数/选项        | 默认                             | 说明                                                                                                                        |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<dql>`          | 必填                             | DQL 查询语句                                                                                                                |
| `--db <path>`    | `.x-basalt/index.db` / 配置 `db` | 要查询的 SQLite 路径（只读打开）；库不存在则 `✗` 报错                                                                       |
| `--offset <n>`   | `0`                              | 结果起始偏移（分页）                                                                                                        |
| `--size <n>`     | —（不传=不分页，返回全部）       | 本页最大行数；给定即分页（引擎层外层包 `LIMIT/OFFSET`，不改 DQL 文法）。`size=0` 只回 `total` 不取行；翻页 `offset += size` |
| `--vault <path>` | —                                | 被接受但**当前不使用**：查询只读索引库，无需 Vault 目录                                                                     |

**输出形态**

```json
{
  "type": "LIST",
  "columns": ["file.name", "file.path"],
  "total": 142,
  "offset": 0,
  "size": 50,
  "returned": 50,
  "hasMore": true,
  "rows": [{ "file.name": "Alpha", "file.path": "Projects/Alpha.md" }]
}
```

- `total`：整个查询的**命中总数**（独立 `COUNT`，不随分页变化）——**数总量直接读 `total`，不要 `LIST` 全量再数**。
- `returned`/`hasMore`：本页行数 / 是否还有更多（`offset + returned < total`）。
- 不传 `--size`：返回全部行、`total` = 行数、`hasMore=false`、`size` 字段省略（向后兼容）。
- `rows` 中的聚合字段（`file.tags`、`file.inlinks`、`file.outlinks`、`file.tasks`）已解析为数组。

**示例**

```bash
x-basalt query 'LIST FROM #project WHERE status = "active" SORT file.mtime DESC LIMIT 10' --db ./index.db
x-basalt query 'TABLE status, due FROM "Projects" SORT file.name ASC' --db ./index.db
x-basalt query 'TABLE count() FROM "" GROUP BY file.extension' --db ./index.db   # 计数：各扩展名文件数
x-basalt query 'LIST FROM ""' --size 50 --offset 0 --db ./index.db               # 分页：每页 50；读 total 知总量
```

> **PowerShell 引号提示**：DQL 中的 `"folder"` 需原样传入程序。用**单引号**包整条语句，内部保留普通双引号（`'... FROM "Projects" ...'`）；不要写 `\"`，PowerShell 下会导致意外转义。

DQL 完整语法（`FROM` / `WHERE` / `SORT` / `LIMIT` / 操作符 / 隐式字段映射）见 [querying-dql.md](dql.md)。

---

> 输出**恒为 JSON**；`--json` 只是与 `scan`/`run`/`base`/`lint` 对齐的显式开关，写不写结果一样。此前不接受该 flag，显式写会撞 `unknown option`。

## `search` — 全文检索正文

```
x-basalt search "<query>" [--vault <path>] [--db <path>] [--offset <n>] [--size <n>]
```

按**正文内容**找笔记（FTS5 + trigram 子串匹配，覆盖中英文）。回答「哪篇笔记提到 X」这类不知道是哪篇、只能按内容找的问题——`query` 查的是结构化字段（frontmatter/tag/link/task），查不了正文。

| 参数/选项       | 默认                             | 说明                                                                 |
| --------------- | -------------------------------- | -------------------------------------------------------------------- |
| `<query>`       | 必填                             | 查询文本，**至少 2 个字符**；不支持 FTS5 查询语法（`AND`/`*`/`-` 等不是操作符） |
| `--vault <path>` | 配置 `vault`                    | Vault 根目录（检索只读索引，可省略）                                 |
| `--db <path>`   | `.x-basalt/index.db` / 配置 `db` | SQLite 路径                                                          |
| `--offset <n>`  | `0`                              | 结果起始偏移                                                         |
| `--size <n>`    | 不分页（全部）                   | 本页最大行数；给定则结果含 `total`/`hasMore`                         |

### 匹配口径分两档（别把 `total` 当成「含该短语的篇数」）

| 查询形态 | 匹配方式 | 后果 |
| -------- | -------- | ---- |
| 纯 ASCII | 字面短语；多词按 **AND** | `zzzz retention` → 0（两词须同现） |
| 含 CJK 汉字 | 切成重叠 trigram 取并集后 **OR 宽松召回** | **只命中部分片段的笔记也计入 `total`** |

CJK 走 OR 是有意的召回设计（中文无空白分词，严格短语会大量漏召），代价是 `total` 是**召回数**而非「确实含这一串的篇数」：

```bash
x-basalt search "回归网"          # → total 85
x-basalt search "回归网-不存在"    # → total 85（「不存在」单独搜是 0，但并不缩小结果）
```

**完整连续子串命中的笔记由 bm25 排在最前**，所以判断「到底有没有这一串」要看靠前的结果，别只读 `total`；需要精确判定用 `query` 的 `contains(...)`。

**其他边界**：基于**索引快照**——新写入的改动要先 `scan` / `index` 才搜得到（写动作走 [`run`](#run--变更编排管道) 管道时会自动刷索引）。是**子串匹配、非语义检索**：不理解同义词与概念相关性。

**输出形态**

```json
{
  "total": 3,
  "offset": 0,
  "size": 2,
  "returned": 2,
  "hasMore": true,
  "rows": [{ "path": "areas/ops/runbook/线上预案.md", "name": "线上预案", "snippet": "… 判断是否需要[熔断降级] … " }]
}
```

**示例**

```bash
x-basalt search "熔断降级"
x-basalt search "retention-policy" --size 10
x-basalt search "缓存失效" --offset 20 --size 20
```

---

## `base` — .base view 查询

```
x-basalt base [<file.base>] [--view <name>] [--stdin] [--vault <path...>] [--db <path>] [--format json|yaml] [--conformance <id>] [--context-file <path>]
```

执行 Obsidian `.base` view 的无头查询（Bases Markdown conformance 2026-07）：只读索引库，输出稳定 JSON，不渲染表格。

| 参数/选项        | 默认                             | 说明                                                                       |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `[<file.base>]`  | 必填（或 `--stdin`）             | vault 内 `.base` 路径（vault 相对或绝对；越出 vault 读取前拒绝）；传 `-` 或 `--stdin` 则从标准输入读 `.base` 定义（动态 base：不读文件、无越界检查、文档层诊断 file 为 `<stdin>`） |
| `--stdin`        | —                                | 从标准输入读 `.base` 定义（等效 file 传 `-`，与 file 同给时以 `--stdin` 为准）；stdin 是交互终端时立即报错不挂起 |
| `--view <name>`  | `views[0]`                       | 指定 view；不存在报 `base/view-not-found`（error，suggestions 列可用名）   |
| `--vault <path>` | 配置 `vault`                     | 可重复传多个（多根 vault）                                                 |
| `--db <path>`    | `.x-basalt/index.db` / 配置 `db` | 要查询的 SQLite 路径（只读打开）                                           |
| `--format <fmt>` | `json`（或配置 `format`）        | 输出格式：`json`（缩进 2）或 `yaml`                                        |
| `--conformance <id>` | `bases-markdown-2026-07`    | 数据集口径：缺省仅 Markdown；`bases-all-files-2026-07` 附件并入为行；未知值报 `base/invalid-schema` |
| `--context-file <path>` | 无 | `this.*` 的显式上下文文件（vault 内路径）；不传则 `.base` 里的 `this.*` 报 `base/dynamic-context-required`；传了却找不到该文件 → error + 空结果。完整语义见 [bases.md §3.5](bases.md#35-属性引用) |

**输出形态**

```json
{
  "conformance": "bases-markdown-2026-07",
  "base": "views/projects.base",
  "view": "Active",
  "columns": ["file.name", "status"],
  "total": 4,
  "rows": [{ "file.name": "Alpha.md", "status": "active" }],
  "diagnostics": [{ "rule": "base/markdown-only-dataset", "severity": "warning", "message": "…" }]
}
```

- `conformance` 回传**实际生效**口径：缺省 `bases-markdown-2026-07`（md-only，恒发 `base/markdown-only-dataset` warning）；`--conformance bases-all-files-2026-07` 时附件并入为行（附件行 note 属性投影 `null`、不发该 warning），旧库无 `vault_entries` 表自动降级回 md-only（compat warning）。
- `total` = filter 后、limit 前行数；缺失属性投影为 `null` 且列保留。
- 未显式 `sort` 按 `file.path` 升序稳定输出（附 `base/default-sort-tiebreak` info）；同库重复运行字节稳定。
- **stdin 模式**（`-` / `--stdin`）：`base` 字段恒为 `"<stdin>"`，全部文档层诊断的 `file` 字段为 `"<stdin>"`（types.json 读取诊断除外——它指向其自身路径）；与文件模式对同一内容输出等价（行/列/total）。
- **退出码**：`diagnostics` 含任一 `error` 级 → 输出完整 JSON（rows 为空）并退出码 1；仅 warning/info（如 md-only 恒发 warning）→ 0。

**示例**

```bash
x-basalt base views/projects.base --vault ./my-vault
x-basalt base views/projects.base --view Active --vault ./my-vault --db ./index.db
x-basalt base views/projects.base --conformance bases-all-files-2026-07 --vault ./my-vault   # all-files：附件也作为行
# 动态 base：从管道读 .base 定义（不落盘），AI 可现场组装查询
printf 'views:\n  - type: table\n    name: All\n    order: [file.name]\n' | x-basalt base - --vault ./my-vault
```

`.base` 怎么写与支持的完整语法（顶层 key / view / filter / 表达式 / 函数全表 / 值语义）、输出契约细节、限制与报错速查，见 [bases.md](bases.md)。

---

## `skills` — 规范召回

```
x-basalt skills [list]              # 列出全部 skill（name — description）
x-basalt skills list <name>         # 列出该 skill 的条目 id（供按条取）
x-basalt skills get <name>          # 按名输出该 skill 完整内容
x-basalt skills get <name> <id>...  # 只取这几条（条级召回）
x-basalt skills get --all           # 输出全部 skill
x-basalt skills recall <keyword>    # 按关键字模糊召回（多词=并集）
x-basalt skills path [name]         # 打印数据目录（带 name 打印该文件路径）
```

加载 JSON5 规范文件，按名精确取或按关键字模糊召回。内置六篇，**分工不互抄**：

| 内置 skill                     | 回答什么                     | 体量    | 什么时候取                              |
| ------------------------------ | ---------------------------- | ------- | --------------------------------------- |
| `summary`                      | **能干什么、该看哪篇**       | ~1.8 KB | 第一步。三组各一屏，英文                |
| `core`                         | 查与改**怎么用**             | ~17 KB  | 命令全集、DQL 子集、meta 写侧、项目配置 |
| `pipe`                         | 批量**怎么用**               | ~5 KB   | 改动对象超过一个文件时                  |
| `chat`                         | 自然语言路径怎么走           | ~4 KB   | 走 `chat` 时；CLI 直调用不上            |
| `obsidian-base-spec`           | Obsidian/DQL 语法            | ~9 KB   | 要精确文法与边界时                      |
| `bases`                        | Bases（`.base` 视图）语法     | ~6.5 KB | 要生成/改写 `.base`、走动态 base        |

**先 `skills get summary` 再按需深入**：摘要回答「能干什么、这件事去哪篇看」，约 1.8 KB；正文回答「怎么用」。一上来取 `core` 等于为选一个方向付十倍代价。摘要**只指路不重抄参数**——它超过 2 KB 就说明抄多了。

| 子命令             | 说明                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| （无）/ `list`     | 列出全部 skill 的 `name — description`                               |
| `get <name>`       | 按名输出该 skill 完整内容；`--all` 输出全部                          |
| `recall <keyword>` | Fuse.js 模糊召回（容拼写错、按相关性排序）；命中 `name` / `triggers` |
| `path [name]`      | 打印解析出的数据目录；带 `name` 打印 `<dir>/<name>.json5`            |

### 条级召回：只取需要的那几条

`get` 的返回单位默认是「整篇」。追加条目 id 就只取那几条——大篇不必被整篇吞下：

```bash
x-basalt skills list core            # 先看有哪些条目 id
x-basalt skills get core meta        # 只要 meta 那条：~2.6 KB（整篇 ~17 KB）
x-basalt skills get core meta profile
x-basalt skills get summary pipe     # 摘要里只要 pipe 那组
```

条目按**传入顺序**输出。给了未知 id 会报错并列出该 skill 的全部可用 id，**不会静默少给**——静默少给会让调用方以为已经取全。

**想看省多少就自己量**（体量随版本变，别信写死的数字）：

```bash
for a in "" "core" "core pipe"; do
  printf "%-10s %6s B\n" "${a:-整篇}" "$(x-basalt skills get summary $a | wc -c)"
done
```

体量阶梯（整篇 > 多条 > 单条，且单条 < 整篇 60%）由 `tests/cli.test.ts` 的用例守着，
`pnpm test` 即回归——比例失守说明「按条取更省」这个前提已经不成立。

多篇组合则用 `recall` 的多词并集：`x-basalt skills recall "批量 自然语言"` 一次拿到 `pipe` + `chat`。注意并集只累加不设上限，多词里混进说明书词会把 `core` 全文一起拽出来。

**召回按 triggers 分层，一个关键字只召回对应那一篇**——总览词（`摘要` / `总览` / `能干什么`）→ `summary`；管道词（`批量` / `管道` / `算子`）→ `pipe`；AI 词（`配 key` / `ollama` / `自然语言`）→ `chat`；说明书词（`用法` / `manual`）→ `core`；语法词（`wikilink` / `callout`）→ `obsidian-base-spec`；Bases 词（`bases` / `.base` / `动态 base`）→ `bases`。六篇的 triggers 刻意不重叠，故 `recall` 拿到的就是该看的那篇，不会一次吐出多篇全文。

所有读子命令默认输出人类 / AI 可读 Markdown，加 `--json` 切换结构化 JSON。

**`get <name>` 未命中**打印 `✗ 未找到名为 "<name>" 的 skill` 退出码 1；**`recall` 命中 0 条**打印 `✗ 未召回到与 "<keyword>" 相关的 skill` 退出码 1。

skill 目录通过配置 `skillPath` 或环境变量 `OBSIDIAN_SKILL_PATH` 指定（命令行无单独 flag）；优先级、兜底内置 skill（`obsidian-base-spec` / `core`）详见 [ai-and-skills.md](ai-and-skills.md)，或用 `x-basalt skills path` 查看当前目录。

**示例**

```bash
x-basalt skills get summary              # 第一步：能干什么、去哪篇看
x-basalt skills get pipe                 # 要批量改一批文件
x-basalt skills recall 批量              # 只召回 pipe，不带出 core 全文
x-basalt skills get obsidian-base-spec   # 取整篇 Obsidian/DQL 规范
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
x-basalt run [--pipe k=v]... [--apply] [--stdin] [--vault <path>]... [--db <path>] [--json]
```

按**管道**处理一批变更：源 → 去重（同文件折叠）→ 路由（事件类型 / glob / DQL）→ 执行内建动作链（`index` / `normalize` / `parse`…）。管道用 `--pipe k=v`（可重复）**内联定义**，或 `--pipe use=<name>` **引用配置段**——命令行是规范落地，配置段是命名快照。写动作默认 **dry-run**，`--apply` 才落盘。

> 本节是签名与默认值速查。**算子链怎么串、`step` 与 `actions` 怎么选、算子间怎么传数据（`{{row.x}}`）、报告怎么读** → [管道教程](pipelines.md)。

**管道参数 `--pipe k=v`**（可重复；与配置段 `pipelines.<name>` 一一对应）：

| key           | 值                     | 含义                                                                                                                                 |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `use`         | name                   | 从配置 `pipelines.<name>` 加载作基底（其余 `--pipe` 覆盖它）                                                                         |
| `actions`     | a,b,c                  | 内建动作链（逗号分隔；与 `step` 至少其一）：`index` / `normalize` / `parse` / `apply <profile>` / `set <key>=<value>` / `unset <key>` / `rename <old> <new>` |
| `step`        | spec                   | 声明式步骤（可重复，一 flag 一算子 spec、**不切分**；算子参数含顶层逗号时用它，如 `step=filter status == "a,b"`；存在时优先于 `actions`） |
| `where`       | DQL                    | 按 DQL 选文件（手动源 / 语义筛）                                                                                                     |
| `paths`       | glob                   | 路径过滤（**只过滤、不作源**；显式文件列表源用 `--stdin`）                                                                           |
| `on`          | add,change             | 事件类型过滤（仅 `add`/`change`/`unlink`）                                                                                            |
| `concurrency` | N                      | 文件间并发上限（正整数，默认 4）                                                                                                     |
| `debounce`    | wait,maxWait           | 堆积窗毫秒数（`watch` 用；`wait` 不得大于 `maxWait`）                                                                                |
| `if-exists`   | skip\|overwrite\|merge | `rename` 键冲突策略（默认 `skip`）                                                                                                   |
| `on-error`    | continue\|stop         | 失败策略（默认 `continue`：跳过继续）                                                                                                |
| `on-busy`     | queue                  | 重启语义（默认 `queue`；`restart`/`ignore` 尚未实现，给了即报错）                                                                    |
| `refresh-index` | true\|false          | 写动作落盘后是否自动把改动文件刷进索引（默认 `true`，见下「写后索引新鲜度」）                                                        |

> **值切分是括号感知的**：`[]`/`{}`/`()` 内的逗号视为字面量，故 `actions="set tags=[a, b],index"`、`paths="**/*.{md,txt}"` 都能正确切分。括号外引号内的逗号仍是分隔符——算子参数含顶层逗号时改用 `--pipe step=<spec>`（一 flag 一算子，不切分）。
> **拼错与非法值一律报错**（退出码 1）并指明来源是命令行还是配置段——不静默忽略，避免过滤条件悄悄失效。

**内建动作**

| 动作                 | 是否写 `.md` | 说明                                                                                                                        |
| -------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `index`              | 否（写库）   | 把文件增量写入 SQLite 索引                                                                                                  |
| `normalize`          | 是           | 归一 frontmatter：tags 列表化 / 去 `#` / 去重 / 单数键迁移                                                                  |
| `parse`              | 否           | 只读解析校验                                                                                                                |
| `apply <profile>`    | 是           | 套用 profile：机械补时间/哈希 + 自动标准化（**纯 top-up**，不带 `--set`/`--refresh-derived`；要补语义/刷新用 `meta apply`） |
| `set <key>=<value>`  | 是           | 设置属性；标量值不含空格，**列表值写 `[a, b]`**（`[]` = 空列表）                                                             |
| `unset <key>`        | 是           | 删除属性                                                                                                                    |
| `rename <old> <new>` | 是           | 改键名；目标键已存在时按 `if-exists` 策略处理                                                                               |

所有**写动作**（`normalize` / `apply` / `set` / `unset` / `rename`）默认 **dry-run 只预览**，必须加 `--apply` 才落盘。

> 除这七个动作外，`step=` 还可接查询/诊断/纯函数算子：`query <DQL>` / `search <text>` / `base <file>#<view>`（链首作源、中段作过滤+列合并）、`lint` / `links.check` / `links.suggest <file>`（诊断挂 `fields.diagnostics`）、`filter` / `limit` / `dedup` / `map`。逐个算子的语义与坑 → [管道教程 §5](pipelines.md#5-算子手册)。

**写后索引新鲜度**：写动作改的是 `.md` 文件，而 `query` 读的是 SQLite 索引——两者之间需要一次
刷新，否则「刚写完却查到旧值」。`run` 现在**默认在写动作落盘后自动把改动过的文件刷进索引**，
报告的 `reindexed` 就是刷新篇数：

```bash
x-basalt run --apply --pipe actions="set type=note" --pipe where='LIST FROM "inbox" WHERE type = null' --vault ./v
# ✓ run run：28 文件 / 28 改动 / 0 跳过 / 0 失败 / 28 已刷索引
x-basalt query 'LIST FROM "inbox" WHERE type = null'   # → 0，不必再手动 index
```

动作链里已经带了 `index` 时不重复刷（`reindexed` 为 `0`，索引同样是新鲜的）。
只有在「稍后必定统一 index」的批处理里才建议用 `--pipe refresh-index=false` 关掉——
关掉之后落盘与索引会静默不一致，`query` 查到的仍是旧值。

**运行环境**（顶层 flag，与管道无关）：

| 选项             | 默认                             | 说明                                                        |
| ---------------- | -------------------------------- | ----------------------------------------------------------- |
| `--apply`        | 关                               | 写动作落盘（默认 dry-run 只预览）；覆盖管道 `dryRun`        |
| `--stdin`        | 关                               | 从 stdin 逐行读文件列表作**源**（见下「源」）               |
| `--vault <path>` | 配置 `vault`                     | Vault 根目录                                                |
| `--db <path>`    | `.x-basalt/index.db` / 配置 `db` | SQLite 路径                                                 |
| `--json`         | 关                               | 结构化报告（`total`/`changed`/`skipped`/`failed`/`dryRun`/`changedPaths`/`byAction`/`reindexed`） |

**源**（三选一，命令只决定「源」）：

1. 默认 **scan 源**：全库 FS↔DB diff；
2. `--pipe where=<DQL>` → **DQL 手动源**（按语义选一批）；
3. `--stdin` → **原生管道源**：逐行读文件列表（vault 相对路径）。

`--stdin` 是与 `--pipe` **正交**的独立设计——源用 Unix 管道喂，动作链仍用 `--pipe` 定义。契约：读到 EOF；整行即一个路径（不按空格切，文件名可含空格）；跳空行与 `#` 注释行；**不猜 JSON**（结构化输入先用 `jq` 抽路径，单一职责）；空输入 = 空批（`total=0`）；stdin 是交互终端（没接管道）时**报错不挂起**；**路径须在 vault 内**（相对路径不越界、禁根外绝对路径），越界声明期报错并列出非法行。与 `--pipe where=` 同给时：stdin 供源、`where` 退化为语义过滤（取交集）。

**退出码**：有动作失败时 `1`（明细打到 stderr）。

**限制**

- 管道 `set` 的**标量**值不含空格（token 按空格切参数）；多值请用列表写法 `set tags=[a, b]`。
- 管道 `apply` 是**纯 top-up**（只补缺字段 + 自动 normalize），不带 `meta apply` 的 `--set`/`--refresh-derived`；要补语义字段或重算 `sha256`/`modified` 等请用独立 `meta apply` 命令。
- `--pipe on-busy` 只支持 `queue`：`restart`（弃旧重跑）/ `ignore`（忙时丢弃）尚未实现，给了会报错而**不会**静默按 `queue` 跑。
- `where` 必须是**完整 DQL**（以 `LIST` / `TABLE` / `TASK` 开头），不能只写 `FROM …` / `WHERE …` 裸子句；写错会直接报错并提示补法。
- 报告的 `total` / `changed` / `skipped` **均以文件为单位**；同一文件被多个动作改动只计一次，分动作明细看 `byAction`。

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
# 批量设列表属性（括号内逗号不是动作分隔符）
x-basalt run --pipe actions="set tags=[pkm, note],index" --apply --vault ./v
# 原生管道：query 选文件 → jq 抽路径 → run 只处理这批
x-basalt query "LIST FROM #pkm" --json --vault ./v \
  | jq -r '.rows[]["file.path"]' \
  | x-basalt run --stdin --pipe actions=normalize --apply --vault ./v
# 也可直接喂手写清单（跳空行与 # 注释）
printf 'pkm/A.md\n# 先不动 B\npkm/C.md\n' | x-basalt run --stdin --pipe actions=parse --vault ./v
```

**配置段**（`.x-basalt/config.yaml`，命名快照；每个 key ⟷ 一个 `--pipe key=val`）：

```yaml
pipelines:
  maintain:
    actions: [index, normalize] # 必填
    where: "contains(file.tags, 'pkm')"
    on: [add, change]
    paths: ["pkm/**"]
    debounce: { wait: 300, maxWait: 3000 } # watch 堆积窗
    concurrency: 4
    onError: continue # continue | stop
    onBusy: queue # 目前只支持 queue
    ifExists: skip # rename 键冲突策略
    dryRun: true # 默认预览；命令行 --apply 覆盖
```

> 配置段与命令行**一一对应**（命令行多词 key 用 kebab-case，如 `--pipe if-exists` ⟷ `ifExists`）；例外只有 `use`（引用入口）与 `dryRun`（由 `--apply` 承载）。配置段里的非法值同样在**加载期报错**，并定位到 `pipelines.<name>.<key>`。

> 三命令共享 `--pipe`，命令只决定「源」：[`scan`](#scan--增量重索引)（diff）/ [`watch`](#watch--常驻监听)（事件）/ `run`（默认 scan，可用 `--pipe where=` 或 `--stdin` 切手动源）。

---

## `chat` — 自然语言驱动（可选 AI）

```
x-basalt chat [input] [--model <name>] [--max-steps <n>] [--vault <path>]... [--db <path>] [-q|--quiet] [--json] [--trace [file]]
```

用自然语言驱动 vault：给 `[input]` 走**单发**（翻译→执行→输出→退出），省略则进 **REPL**（多轮、累积上下文）。底层工具面已收编为**单一 `cli` 工具**（切 C，2026-07-30 拍板）——模型只拿一个执行口，`args` 数组直传 CLI 子命令（query / parse / scan / meta / run / base …），外加 `skills_recall` / `skills_get` 两个规范召回元工具；**写动作直接落盘**（无确认闸，靠 `Ctrl+C` 中断 + 原子写兜底）。watch / chat 子命令被 allowlist 排除（常驻/递归，双保险拒绝）。

> **可选 AI**：需 `AI_GATEWAY_API_KEY`（兼容 `AI_GATEWAY_*`）；**无 key 时本命令友好退出、不影响其他命令**。内核零 AI，仅本命令懒加载 `ai` SDK。

| 参数/选项          | 默认                      | 说明                                                                    |
| ------------------ | ------------------------- | ----------------------------------------------------------------------- |
| `[input]`          | —                         | 自然语言指令；省略且 TTY → 进 REPL；省略且有管道输入 → 读 stdin 走单发  |
| `--model <name>`   | 配置 / `AI_GATEWAY_MODEL` | 覆盖模型名                                                              |
| `--max-steps <n>`  | `20`                      | agentic 最大步数；**撞顶不再静默停**——单发提示、REPL 可输入「继续」续跑 |
| `--vault` / `--db` | 同其他命令（回退配置）    | 库目录 / 索引路径                                                       |
| `-q, --quiet`      | 关                          | 单发只输出答案与 no-recall/exhausted 结果限定，完全隐藏工具过程（供 AI/脚本程序化调用，避免过程轨迹白占上下文） |
| `--json`           | 关                          | 单发结束后输出一个结构化 JSON 对象（优先于 `--quiet`）                  |
| `--trace [file]`   | 关                          | 落盘 chat 事件到 JSONL；省略 `file` 按时间戳自动命名到 `.x-basalt/chat-traces/` |

REPL 内命令：`help` 用法 · `examples` 可玩示例 · `继续` 撞顶续跑 · `quit`/`exit`/`q` 退出；`Ctrl+C` 中断当前轮。

**怎么玩 / 上手**：见 [chat.md](chat.md)（前置、建索引、试这些、玩时看什么、限制）。

**示例**

```bash
export AI_GATEWAY_API_KEY=...           # 先配 key
x-basalt index                          # 先建索引（vault 取配置，库默认 .x-basalt/index.db）
x-basalt chat                           # 进 REPL，输入 examples 看示例
x-basalt chat "这个库有多少篇笔记？"      # 单发
```

> 上例假设已配 `.x-basalt/config.yaml`（`vault` 等）；没配就给各命令补 `--vault <path>`（库不在默认位置再加 `--db <path>`）。

---

## `links` — 本地链接诊断

检查 vault 内**本地链接是否断掉**（KB compiler P1）。**内存 per-run，不依赖已建索引**——遍历 vault 现解析，退出即弃（不写 SQLite）。

```bash
x-basalt links check [vault...] [--format human|json|yaml]   # 扫全库报断链
x-basalt links suggest <file> [vault...]                     # 单文件断链 + 修复建议
```

**检查范围**：wikilink `[[..]]`、embed `![[..]]`、Markdown `[](..)`、图片 `![](..)` 的**本地目标存在性**。外部 URL / `mailto:` / 纯锚点跳过；`#heading` / `#^block` 锚点校验后置（P1 只查文件目标）。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `[vault...]` | 配置 `vault` | Vault 根目录，可多个；省略时取配置 `vault`（对齐 `index`/`scan`） |
| `--format <fmt>` | `human` | `human`（`file:line:col 消息 + → 建议`）/ `json` / `yaml` |
| `<file>`（suggest） | 必填 | 目标 Markdown（vault 相对主键 / cwd 相对 / 绝对） |

**断链原因（`reason`）**：`not_found`（目标不存在）/ `outside_vault`（逃出根）/ `backslash_path`（含反斜杠，应改 `/`）/ `ambiguous_target`（同名多处，需限定路径）/ `external_skipped`（外部/锚点，不产出 issue）。

**退出码**：有断链 `1`，全通过 `0`（便于 CI / 脚本闸门）。

**ignore**：在 `.x-basalt/config.*` 配 `lint.ignore` 屏蔽历史附件 / 生成目录 / 外链：

```yaml
lint:
  ignore:
    paths: [".tmp/**", "dist/**"]        # 忽略被检查文件
    targets: ["http://*", "https://*"]   # 忽略目标字符串
    rules:
      links/no-broken-link: ["legacy/**"] # 仅对该规则额外忽略
```

`suggest` 与 `check` 内嵌的 `suggestions[]` 一致：按 basename 在 vault 内找同名文件，给相对当前文件的路径建议（多命中即 `ambiguous_target`）。

---

## `lint` — 规则诊断（metadata / links）

按**规则集**诊断 vault，产出与 `links` 同一套 `BasaltDiagnostic`（KB compiler P2/P3）。同样**内存 per-run、不碰 SQLite、不写 `.md`**（metadata 规则只读 frontmatter）。

```bash
x-basalt lint [vault...] [--rules <list>] [--profile <name>] [--format human|json|yaml]
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `[vault...]` | 配置 `vault` | Vault 根目录，可多个；省略取配置 `vault` |
| `--rules <list>` | 见下 | 逗号分隔规则集：`links` / `metadata`。省略时：**给了 `--profile` 默认 `metadata`，否则 `links`** |
| `--profile <name>` | — | `metadata` 规则用的 profile：**config `profiles.<name>` 优先（同名覆盖内置），否则内置** `pkm-note`/`llm-wiki`/`ssg-blog` |
| `--format <fmt>` | `human` | `human` / `json` / `yaml`（与 `links` 同构，按 `file:line:col` 稳定排序） |

**规则与 `reason`**：

| rule | severity | reason | 触发 |
| --- | --- | --- | --- |
| `links/no-broken-link` | error | `not_found` 等 | 同 [`links check`](#links--本地链接诊断)（`--rules links`） |
| `metadata/required-missing` | error | `required_missing` | 文档缺 profile 的 required 字段 |
| `metadata/enum-invalid` | error | `enum_invalid` | 字段值不在 profile 的 `enums` 允许集 |

**退出码**：任一 `error` 级诊断 → `1`，否则 `0`（CI / 脚本闸门）。

### 内置 profile（零 config，P3a）

直接用内置 profile 校验 required 是否齐全——与写侧 [`meta apply <profile>`](#meta--读改-frontmatter) **同一套 profile 定义**（写侧补、读侧查）：

```bash
x-basalt lint docs --profile llm-wiki --format json   # 缺 type 的文档 → required-missing
```

### 自定义 config profile（`profiles` + `extends` + `enums`，P3b）

在 `.x-basalt/config.*` 声明 `profiles.<name>`，即可**继承内置魔改**或**全新定义**，加上 `enums` 值域校验：

```yaml
# .x-basalt/config.yaml
profiles:
  my-wiki:
    extends: llm-wiki                 # 继承内置 required 基线（type）
    required: [author]                # 追加必填 → 与父并集 = type + author
    enums:                            # 字段 → 允许值集（值越集即报 enum-invalid）
      type: [note, person, project]
      status: [draft, active, done]
    include: "docs/**"               # 只查匹配这些 glob 的文件（可选；缺省 = 全 vault）
  team-note:                          # 不 extends = 全新一套
    required: [owner, area]
    enums: { area: [infra, product, research] }
```

```bash
x-basalt lint --profile my-wiki --format json
# docs/x.md 若 type=gadget、缺 author → 报 enum-invalid(type) + required-missing(author)，退出 1
```

**`extends` 合并语义**（单父继承；父可是内置或另一个 config profile）：

- **子覆盖父**；`required` 取**并集**、`enums` 按字段**取并集去重**——**只加不减**。
- `include` 子有则用子、否则继承父。
- **同名 config 覆盖内置**（如上再定义一个 `llm-wiki` 就以你的为准）。
- **环**（`A→B→A`）、**未知父**（`extends` 指向不存在的名）→ **定向报错退出 `1`**，不静默。
- 数组字段（如 `tags`）逐元素校验；字段**缺失或为空**跳过 `enums`（缺失交给 `required`，不双报）。

> **glob 提醒**：`include` / `lint.ignore` 用同一套极简 glob。`docs/**/*.md` 的 `**/` 段要求至少一层子目录、**不匹配顶层 `docs/a.md`**；要含顶层用 `docs/*.md` 或 `docs/**`。

**ignore 叠加**：`lint.ignore`（见 [`links`](#links--本地链接诊断) 段）对 metadata 诊断同样生效——`paths` 按文件、`targets`/`rules.<rule>` 按字段名（`target`）过滤。

**后置（暂不做）**：`excludes`/减字段、多父数组 `extends`、`tagRules`、`--fix`、CI annotation / baseline、完整 JSON Schema。config `profiles` 配置见 [configuration.md](config.md#4-可配置项)。

---

← [使用指南索引](README.md) · 安装：[installation.md](install.md) · 配置：[configuration.md](config.md) · 故障排查：[troubleshooting.md](troubleshooting.md)

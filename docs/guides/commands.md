# 命令参考 · x-basalt

← [使用指南索引](usage.md)

> 所有命令的 `[vault]`、`--db` 均可回退到配置文件（`.x-basalt/config.yaml`）与环境变量 `X_BASALT_DIR`，无需每次手动指定——详见 [configuration.md](configuration.md)。出错时统一打印 `✗ <消息>` 并以退出码 1 退出。

---

## 目录

1. [`parse`](#parse--解析单文件)
2. [`index`](#index--全量建索引)
3. [`scan`](#scan--增量重索引)
4. [`query`](#query--执行-dql-查询)
5. [`skill recall / skill list`](#skill--规范召回)
6. [`watch`](#watch--常驻监听)

---

## `parse` — 解析单文件

```
x-basalt parse <file> [--format json|yaml]
```

解析单个 Markdown 文件，输出标准化 AST。纯函数，不操作数据库。

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `<file>` | 必填 | Markdown 文件路径 |
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
x-basalt index [vault] [--db <path>] [--watch]
```

全量构建 / 重建 Vault 索引，写入 SQLite。

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `[vault]` | 配置 `vault` | Vault 根目录；省略时取配置 `vault`，二者皆无则 `✗` 报错 |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | SQLite 路径；父目录自动创建 |
| `--watch` | `false` | 建完索引后继续监听文件变更，逐条打印 `· <event> <file>`（无 `on-change` 回调，需联动命令请用 [`watch`](#watch--常驻监听)） |

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
x-basalt scan [vault] [--db <path>] [--rehash] [--dry-run] [--json]
```

**按需增量重索引**：diff 文件系统 vs 索引库，只重扫新增/改动/删除的文件；无需常驻进程，适合定时任务（cron）或 CI 钩子触发。

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `[vault]` | 配置 `vault` | Vault 根目录 |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | SQLite 路径 |
| `--rehash` | `false` | 按文件内容 hash 判断变化（慢但稳）；默认用 mtime + size 快速判断 |
| `--dry-run` | `false` | 仅报告差异，**不写库**（触发前预览用） |
| `--json` | `false` | 输出结构化 JSON 报告；默认打印人读摘要 |

**输出形态**

人读摘要（默认）：

```
✓ scan <vault>：+N 新增 ~N 改动 -N 删除（N 未变跳过）
```

加 `--dry-run` 时摘要追加 `（dry-run 未写入）`。

`--json` 报告：

```json
{
  "added":     ["Projects/New.md"],
  "modified":  ["Daily/2026-06-28.md"],
  "deleted":   ["Archive/Old.md"],
  "unchanged": 142
}
```

**示例**

```bash
x-basalt scan ./my-vault
x-basalt scan ./my-vault --dry-run           # 预览差异，不写库
x-basalt scan ./my-vault --rehash --json     # 精确内容对比，机器可读输出
```

> mtime 模式 vs `--rehash` 的权衡、断点续扫、数据模型细节——见 [indexing-and-sync.md](indexing-and-sync.md)。

---

## `query` — 执行 DQL 查询

```
x-basalt query "<dql>" [--db <path>] [--vault <path>]
```

执行自建 Dataview（DQL）子集查询，只读打开索引库，不回读 `.md` 文件。

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `<dql>` | 必填 | DQL 查询语句 |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | 要查询的 SQLite 路径（只读打开）；库不存在则 `✗` 报错 |
| `--vault <path>` | — | 被接受但**当前不使用**：查询只读索引库，无需 Vault 目录 |

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

## `skill` — 规范召回

```
x-basalt skill recall <keyword>
x-basalt skill list
```

加载 JSON5 规范文件，按关键字模糊召回规范内容。

| 子命令 | 说明 |
|---|---|
| `recall <keyword>` | 按关键字模糊召回完整规范；大小写不敏感，命中 `name` 子串或与任一 `trigger` 互为子串（宽松） |
| `list` | 列出全部可用 skill 的 `name` 与 `triggers` |

**`recall` 命中 0 条时**打印 `✗ 未召回到与 "<keyword>" 相关的 skill` 并以退出码 1 退出。

skill 目录通过配置 `skillPath` 或环境变量 `OBSIDIAN_SKILL_PATH` 指定（命令行无单独 flag）；优先级、兜底内置 skill（`obsidian-base-spec` / `x-basalt-usage`）详见 [ai-and-skills.md](ai-and-skills.md)。

**示例**

```bash
x-basalt skill recall wikilink      # 召回 wikilink 规范
x-basalt skill recall dataview      # 召回 DQL/Dataview 规范
x-basalt skill list                 # 查看全部可用 skill
```

---

## `watch` — 常驻监听

```
x-basalt watch [vault] [--db <path>] [--on-change <cmd>]
```

常驻监听模式：启动时全量建索引，随后对每次文件变更实时增量更新，可联动外部命令。

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `[vault]` | 配置 `vault` | Vault 根目录；省略时取配置 `vault`，二者皆无则 `✗` 报错 |
| `--db <path>` | `.x-basalt/index.db` / 配置 `db` | SQLite 路径（可由配置 `db` 覆盖） |
| `--on-change <cmd>` | 配置 `onChange` | 变更时执行的 shell 命令模板；`{file}` 占位替换为变更文件路径 |

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
```

---

← [使用指南索引](usage.md) · 安装：[installation.md](installation.md) · 配置：[configuration.md](configuration.md) · 故障排查：[troubleshooting.md](troubleshooting.md)

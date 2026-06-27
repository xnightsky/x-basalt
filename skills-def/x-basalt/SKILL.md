---
name: x-basalt
description: 用 x-basalt CLI 在终端无头操作 Obsidian vault（不依赖 Obsidian App）——解析笔记为 AST、构建/增量刷新 SQLite 索引、用 Dataview(DQL) 子集查询笔记、按需重扫文件夹变更、召回 Obsidian/DQL 语法规范。当任务涉及从命令行读取/查询 Obsidian markdown vault 时使用。
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

`x-basalt` 是纯 Node CLI，零依赖 Obsidian 运行时，直接读文件系统：解析 Obsidian 专有语法、把 vault 索引进 SQLite、用 Dataview 子集 (DQL) 查询。**全局已装：直接 `x-basalt <command>`。**

## 何时用

- 要从终端 / 脚本 / AI 流程里**查询或提取** Obsidian vault 的结构化信息（链接、标签、任务、frontmatter），而不打开 Obsidian。
- 要像 Dataview 那样 `LIST/TABLE/TASK ... FROM ... WHERE ...` 查笔记。
- 索引建好后，**周期性触发**让它自己找出哪些文件变了并只重扫（无需常驻监听）。

## 典型流程

```bash
x-basalt index <vault>                 # 首次：全量建索引（默认库 <vault基目录>/.x-basalt/index.db）
x-basalt query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10"
x-basalt scan <vault>                  # 之后：增量重扫，只处理新增/改动/删除（diff mtime+size）
```

## 命令速查

| 命令 | 作用 | 关键选项 |
|---|---|---|
| `parse <file>` | 单文件 → AST（wikilink/tag/task/callout/highlight/blockRef + frontmatter） | `--format json\|yaml` |
| `index [vault]` | 全量建/重建索引 | `--db <path>` · `--watch`(常驻监听) |
| `scan [vault]` | **按需增量重索引**：diff 文件系统 vs 库，只重扫变化的 | `--rehash`(按内容比，稳但慢) · `--dry-run`(只报告不写) · `--json` |
| `query "<dql>"` | 执行 DQL 查询，输出 `{type,columns,rows}` | `--db <path>` |
| `skill recall <kw>` | 召回 Obsidian / DQL 语法规范详情 | — |
| `skill list` | 列出可召回规范 | — |
| `watch [vault]` | 常驻监听增量更新（有守护进程时用；否则首选 `scan`） | `--db` · `--on-change <cmd>`(`{file}` 占位) |

## 配置与基目录

- 配置文件：项目就近 `.x-basalt/config.{yaml,yml,json5,json}`（或扁平 `.x-basalt.*`），向上查找；全局 `~/.x-basalt/config.*` 兜底。键：`db` `vault` `skillPath` `format` `onChange`（仅字符串）。
- **`X_BASALT_DIR` 环境变量**：指定 `.x-basalt` 基目录（config 与 `index.db` 都落其下），把状态搬到任意位置。优先级：命令行 flag > `X_BASALT_DIR` > 就近 `.x-basalt/` > 默认。
- 取值统一 `flag ?? config ?? 默认`；出错统一打印 `✗` 并退出码 1。

## DQL 子集要点

`LIST | TABLE <字段,...> | TASK` · `FROM <#tag | "folder" | [[link]]>`（单一来源）· `WHERE`（`= != < > <= >=`、`AND/OR/NOT`、括号、`field = null`、日期 ISO 比较）· 字符串谓词 `contains/icontains/startswith/endswith/regexmatch` · `GROUP BY` · `FLATTEN` · `WITHOUT ID` · 多键 `SORT` · `LIMIT`。内置函数：`lower/upper/length/round`、`date(today)/date(now)`。隐式字段：`file.name/path/folder/extension/size/mtime/ctime/tags/inlinks/outlinks/tasks` 与 frontmatter 标量。范围外（CALENDAR、DataviewJS、多源 FROM、未知字段）会带位置报 `DqlSyntaxError`，不静默。

> **要精确语法 / 边界**：装好 x-basalt 后直接 `x-basalt skill recall <关键字>`（如 `wikilink`/`dataview`/`callout`），它返回带模式与示例的规范——本技能只给概览，细节以 `skill recall` 为准，避免漂移。

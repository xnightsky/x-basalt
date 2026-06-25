# 使用指南 · x-basalt

> 面向使用者的完整「怎么用」文档：安装 → 上手 → 五条命令参考 → DQL 子集 → 索引数据模型 → Skill 召回 → 限制与排查 → 配方。
> 实现真相源：[`../specs/2026-06-25-x-basalt-design.md`](../specs/2026-06-25-x-basalt-design.md)、[`../research/2026-06-25-obsidian-spec-and-deps.md`](../research/2026-06-25-obsidian-spec-and-deps.md)。本指南随实现演进维护。

## 目录

1. [它是什么](#1-它是什么)
2. [安装与构建](#2-安装与构建)
3. [5 分钟上手](#3-5-分钟上手)
4. [命令参考](#4-命令参考)
   - [parse](#41-parse--解析单文件)
   - [index](#42-index--构建索引)
   - [query](#43-query--执行-dql-查询)
   - [skill](#44-skill--召回规范)
   - [watch](#45-watch--监听增量--联动命令)
5. [DQL 子集参考](#5-dql-子集参考)
6. [索引数据模型](#6-索引数据模型)
7. [解析层覆盖的 Obsidian 语法](#7-解析层覆盖的-obsidian-语法)
8. [Skill 召回机制](#8-skill-召回机制)
9. [已知限制与近似](#9-已知限制与近似)
10. [故障排查](#10-故障排查)
11. [配方（常用组合）](#11-配方常用组合)
12. [配置文件（免去重复传参）](#12-配置文件免去重复传参)

---

## 1. 它是什么

x-basalt 是一个**纯 Node.js CLI**，零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault 目录，实现四件事：

| 能力 | 命令 | 说明 |
|---|---|---|
| 解析 | `parse` | 单个 `.md` → 标准化 AST（wikilink/tag/callout/task/highlight/blockRef + frontmatter） |
| 索引 | `index` / `watch` | 全量/增量扫描 Vault，写入单文件 SQLite |
| 查询 | `query` | 自建 Dataview（DQL）子集 → 参数化 SQL → JSON 结果 |
| 召回 | `skill` | 加载 JSON5 规范文件，按关键字模糊召回 |

**硬约束（设计红线）**：不引入 `obsidian` npm 包、不调 `obsidian://`、不使用 dataview 的执行层、不依赖浏览器自动化；所有文件操作仅经 `fs`/`chokidar`；反向链接等隐式字段**一律在查询期由 SQLite JOIN 实时计算**，不假设任何外部缓存。

---

## 2. 安装与构建

要求 Node.js ≥ 18（开发用 24.x）、包管理器 `pnpm`。

```bash
pnpm install          # 安装依赖（含构建 better-sqlite3 原生模块）
pnpm run build        # tsc → dist/，产出可执行的 dist/cli.js
```

两种运行方式：

```bash
# A. 构建后用 Node 直接跑产物
node dist/cli.js <command> [args]

# B. 开发态用 tsx 跑 TS 源码（免构建）
pnpm run cli -- <command> [args]
```

> 下文示例统一写作 `x-basalt <command>`，等价于上面任一种；`--` 是 pnpm 透传参数的分隔符，开发态务必带上。

---

## 3. 5 分钟上手

以仓库自带样例 Vault `tests/fixtures/sample-vault` 为例，跑通全链路：

```bash
# (1) 解析单文件，看 AST
pnpm run cli -- parse tests/fixtures/sample-vault/Index.md

# (2) 全量建索引到 SQLite
pnpm run cli -- index ./tests/fixtures/sample-vault --db ./index.db

# (3) 查询：列出 #project 标签下 status=active 的笔记
pnpm run cli -- query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10" --db ./index.db

# (4) 召回 wikilink 规范
pnpm run cli -- skill recall wikilink

# (5) 监听 + 变更联动
pnpm run cli -- watch ./tests/fixtures/sample-vault --db ./index.db --on-change "echo changed {file}"
```

(3) 的输出：

```json
{
  "type": "LIST",
  "columns": ["file.name", "file.path"],
  "rows": [{ "file.name": "Alpha", "file.path": "Projects/Alpha.md" }]
}
```

> 💡 不想每次都敲 `--db`/`<vault>`？在项目根的隐藏目录放 `.x-basalt/config.yaml`（不入 git），把默认值写进去即可；索引默认也落在 `.x-basalt/index.db`。详见 [§12 配置文件](#12-配置文件免去重复传参)。

---

## 4. 命令参考

所有命令出错时统一打印 `✗ <消息>` 并以退出码 1 结束（不抛裸栈）。

### 4.1 `parse` — 解析单文件

```
x-basalt parse <file> [--format json|yaml]
```

| 参数/选项 | 说明 |
|---|---|
| `<file>` | Markdown 文件路径 |
| `--format <fmt>` | 输出格式，`json`（默认，缩进 2）或 `yaml` |

**输出形态**：`{ frontmatter, nodes }`。`frontmatter` 为键值对；`nodes` 为标准化 `ObsidianNode[]`（见 [§7](#7-解析层覆盖的-obsidian-语法)）。纯函数，不碰 DB。

```bash
x-basalt parse note.md --format yaml
```

> `--format yaml` 是为展示设计的极简块序列化；frontmatter 里的日期会被解析为 Date 并以 ISO 字符串输出。

### 4.2 `index` — 构建索引

```
x-basalt index [vault] [--db <path>] [--watch]
```

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `[vault]` | 配置 `vault` | Vault 根目录；省略时取配置文件的 `vault`，二者皆无则报错 |
| `--db <path>` | `.x-basalt/index.db` | SQLite 索引文件路径（父目录自动创建）；可由配置 `db` 覆盖 |
| `--watch` | 关 | 建索引后继续监听增量（等价于在 index 上附加 watch 行为，无 on-change） |

全量扫描 Vault 下所有 `.md`，跳过 `.obsidian/` 与任意以 `.` 开头的隐藏文件/目录。重建在单事务内「先清空再写入」，失败整体回滚。

```bash
x-basalt index ./my-vault            # 配好 vault 后甚至可省略，直接 x-basalt index
```

### 4.3 `query` — 执行 DQL 查询

```
x-basalt query <dql> [--db <path>] [--vault <path>]
```

| 参数/选项 | 说明 |
|---|---|
| `<dql>` | DQL 查询语句（见 [§5](#5-dql-子集参考)） |
| `--db <path>` | 要查询的 SQLite 索引（只读打开）。默认 `.x-basalt/index.db`，可由 `--db` 或 [配置文件](#12-配置文件免去重复传参) 的 `db` 覆盖；库不存在则报错 |
| `--vault <path>` | 当前被接受但**不使用**：查询只读索引库，不回读 `.md` |

**输出形态**：`{ type, columns, rows }`，`rows` 中聚合字段（`file.tags`/`inlinks`/`outlinks`/`tasks`）已解析为数组。

```bash
x-basalt query 'TABLE status, due FROM "Projects" SORT file.name ASC' --db ./index.db
```

> Shell 引号提示：DQL 里的 `"folder"` 需要把双引号传进程序。PowerShell 用单引号包整条、内部保留双引号（`'... FROM "Projects" ...'`），不要写成 `\"`。

### 4.4 `skill` — 召回规范

```
x-basalt skill recall <keyword>     # 按关键字模糊召回完整规范
x-basalt skill list                 # 列出全部可用 skill 的 name + triggers
```

`recall` 命中 0 条时打印 `✗` 并退出码 1。匹配规则与目录解析见 [§8](#8-skill-召回机制)。

```bash
x-basalt skill recall dataview
x-basalt skill list
```

### 4.5 `watch` — 监听增量 + 联动命令

```
x-basalt watch [vault] [--db <path>] [--on-change <cmd>]
```

| 参数/选项 | 默认 | 说明 |
|---|---|---|
| `[vault]` | 配置 `vault` | Vault 根目录；省略时取配置文件的 `vault` |
| `--db <path>` | `.x-basalt/index.db` | 索引文件（可由配置 `db` 覆盖） |
| `--on-change <cmd>` | 配置 `onChange` | 变更时执行的命令模板，`{file}` 占位替换为变更文件路径 |

启动时先全量 `rebuild`，随后监听：`add`/`change` 先增量更新索引**再**触发回调（保证 on-change 看到的索引已最新），`unlink` 删除记录。前台运行，`Ctrl+C` 退出。

```bash
x-basalt watch ./my-vault --db ./my-vault.db --on-change "node reindex-hook.js {file}"
```

---

## 5. DQL 子集参考

自建执行层：`tokenizer → 递归下降 parser → SQL 生成器 → better-sqlite3`。**所有用户输入走参数化占位符绑定**（防注入）；唯一内联的是 frontmatter 字段名，且经 `^[A-Za-z0-9_]+$` 白名单校验。

### 文法

```
(LIST | TABLE <field, ...>)
[FROM (#tag | [[link]] | "folder")]
[WHERE <condition>]
[SORT <field> (ASC | DESC)?]      # 单字段，默认 ASC
[LIMIT <number>]
```

- 关键字大小写不敏感（`list`/`LIST` 均可）。
- `LIST` 固定输出列 `file.name`、`file.path`。
- `TABLE f1, f2` 输出列为 `file.name, f1, f2`（自动以 `file.name` 起头作为文件标识）。

### 操作符

| 类别 | 形式 |
|---|---|
| 比较 | `= != < > <= >=` |
| 字符串函数 | `contains(field, "x")` / `icontains` / `startswith` / `endswith` |
| 正则 | `regexmatch(field, "pattern")`（JS 正则语义） |
| 逻辑 | `AND` / `OR` / `NOT`，可用 `( )` 分组 |

优先级：`OR < AND < NOT < 原子（比较/函数/括号）`。

### FROM 语义

| 写法 | 含义 |
|---|---|
| `FROM #a` | 含标签 `a` 的文件；**前缀匹配**，命中 `#a` 与嵌套 `#a/b` |
| `FROM "Folder"` | 该文件夹及其**子文件夹**下的文件 |
| `FROM [[Note]]` | **指向** Note 的所有文件（即 Note 的反向链接集合） |

### 隐式字段映射

| 字段 | 来源 |
|---|---|
| `file.name` / `path` / `folder` / `extension` / `size` / `mtime` / `ctime` | `files` 表直接列（`mtime`/`ctime` 为 epoch 毫秒整数） |
| `file.tags` | `tags` 表聚合数组；`contains(file.tags, "x")` 走前缀语义（`x` 命中 `x` 与 `x/...`） |
| `file.inlinks` | `links` 反向 JOIN（`target_key = 本文件 name_key`），去重 |
| `file.outlinks` | `links` 正向 JOIN（`source = 本文件 path`，含 embed），去重 |
| `file.tasks` | `tasks` 表聚合，元素为 `{status, text, due}`（仅用于显示） |
| 任意 frontmatter 标量（如 `status`、`due`） | `json_extract(files.frontmatter, '$.<字段>')` |

### 非目标（明确报错或不支持，而非静默）

- `file.day/cday/mday/link/etags/aliases/...` → 查询报 `✗ 不支持的查询字段`。
- 多字段 `SORT`、`FROM` 的 and/or 组合、`length()` 数值比较、`TASK`/`CALENDAR` 查询。
- 按 task 字段过滤（`file.tasks` 仅显示）。

---

## 6. 索引数据模型

单文件 SQLite，五张表。隐式字段**不建物化视图**，查询期 JOIN 实时算（硬约束）。

| 表 | 关键列 | 用途 |
|---|---|---|
| `files` | `path, name, name_key, extension, folder, size, mtime, ctime, content, frontmatter` | 每文件一行；`frontmatter` 存 JSON；`name_key`=小写无扩展名 basename（链接解析键）；`folder`=父目录 POSIX（根为空串） |
| `links` | `source, target, target_key, alias, heading, block_id, is_embed` | 每条 wikilink 一行；`target`=原文，`target_key`=`linkKey(target)`；`is_embed=1` 表示 `![[...]]` |
| `tags` | `file_path, tag, in_frontmatter` | 标签存**不带 `#`**；`in_frontmatter=1` 来自 frontmatter，`0` 为行内 |
| `tasks` | `file_path, line_number, status, text, due_date` | `status`=方括号内单字符；`due_date`=从文本提取的 `YYYY-MM-DD`（无则 NULL） |
| `blocks` | `file_path, block_id, content, line_number` | 行尾 `^id` 块定义；`content`=去掉 `^id` 后的该行文本 |

**链接解析**：wikilink target 按 **basename（去扩展名、大小写不敏感）** 解析（调研 §3.3#1）。`inlinks` = 其他文件的 `target_key` 命中本文件 `name_key`；`outlinks` = 本文件作为 `source` 的 target，二者查询时 `DISTINCT`。路径一律以 POSIX 正斜杠存储（跨平台可移植）。

---

## 7. 解析层覆盖的 Obsidian 语法

`parse` 产出的 `ObsidianNode`（节点类型 → 字段）：

| 节点 | 语法 | 字段 |
|---|---|---|
| `wikilink` | `[[Note]]` / `[[Note\|Alias]]` / `[[F/Note]]` / `[[Note#Heading]]` / `[[Note#^block-id]]`，`![[...]]`=embed | `target, alias?, heading?, blockId?, embed` |
| `tag` | 行内 `#tag` / 嵌套 `#a/b` | `value`（不带 `#`） |
| `callout` | `> [!type] Title` + 后续 `>` 行，`+/-` 折叠标记 | `calloutType(小写), title, foldable, content` |
| `task` | `- [ ] / [x] / [-] / [?] ...` | `status, text, line` |
| `highlight` | `==text==` | `content` |
| `blockRef` | 行尾 `^block-id` 定义 | `id, line` |

去重：同文件内 wikilink 按 `target(basename) + 锚点 + embed 标记` 去重（`[[X]]` 与 `![[X]]` 各保留）。frontmatter 的 tags 不进 `nodes`，由 indexer 单独并入 `tags` 表（`in_frontmatter=1`）。

---

## 8. Skill 召回机制

**目录解析优先级**（取第一个命中）：

1. `SkillRecall` 构造参数 `skillPath`（库级 API，CLI 未暴露）
2. 环境变量 `OBSIDIAN_SKILL_PATH`
3. `~/.obsidian-core/skills`（存在时）
4. 随包内置 `skills/`

**兜底（始终可召回）**：无论解析到哪个目录，内置的 `obsidian-base-spec`（基础规范）与 `x-basalt-usage`（**本 CLI 的自我说明书**）都会被兜底补齐——外部目录为空/无效也能召回；外部目录若自带同名 skill 则不覆盖。

**自我说明书**：本 CLI 把自己的用法做成了一个可召回 skill，AI / 使用者无需外部文档即可上手：

```bash
x-basalt skill recall usage     # 召回五命令用法 + DQL 速查 + 限制（即本指南的精简版）
```

它对 `usage`/`help`/`manual`/`说明书`/`用法` 以及各命令名（`parse`/`index`/`query`/`watch` 等）都会命中。完整版即本文件 `docs/guides/usage.md`。

**文件格式**（JSON5，`skills/*.json5`）：

```json5
{
  name: "obsidian-base-spec",
  triggers: ["wikilink", "tag", "dataview", /* ... */],
  patterns: ["[[...]]", "#tag"],
  rules: [{ pattern: "...", description: "...", examples: ["..."] }],
  metadata: { /* 任意 */ },
}
```

**匹配**：关键字大小写不敏感，命中 `name` 子串，或与任一 `trigger` **互为子串**（双向，宽松召回）。单个文件解析失败会跳过并 warn，不影响其余。

---

## 9. 已知限制与近似

| 项 | 说明 | 依据 |
|---|---|---|
| 日期存储 | frontmatter 的 `YYYY-MM-DD` 被 YAML 解析为 Date、以 ISO 字符串入库。**范围/前缀**比较正确；`= 'YYYY-MM-DD'` 精确等值**不命中**（用 `>=`/`<` 或前缀） | 调研 §3.3#3 |
| 代码块内语法 | 代码块/行内代码中的 `#tag`、`==..==` **不剔除**，可能误识 | 调研 §3.3#4 |
| 链接歧义 | 同名 basename 多文件时取首个匹配（最短唯一路径的近似） | 调研 §3.3#1 |
| 大小写 | 链接/标签匹配默认大小写不敏感 | 调研 §3.3#6 |
| `file.tasks` | 仅作显示数组，不支持按 task 字段过滤 | 设计非目标 |
| `--format yaml` | 仅供 parse 展示的极简序列化，非通用 YAML 库 | 实现说明 |

---

## 10. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `✗ unable to open database file` | `--db` 指向的索引不存在；先跑 `index` 建库（`query` 不会自动建空库） |
| `✗ 不支持的查询字段: file.day` | 用了非子集字段，见 [§5 非目标](#非目标明确报错或不支持而非静默) |
| `✗ DQL 语法错误 (位置 N): ...` | 语句不符合子集文法，按位置 N 检查 |
| `pnpm install` 卡在 better-sqlite3 | pnpm v10 默认拦截原生构建脚本；本仓库已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 放行，确保用 pnpm 安装 |
| PowerShell 下 `FROM "folder"` 报意外字符 `\` | 别写 `\"`；用单引号包整条 DQL，内部保留普通双引号 |
| `watch` 不触发 | 确认改的是 `.md` 且不在 `.obsidian/`、非隐藏文件；保存后约 100ms 稳定窗口才触发 |

---

## 11. 配方（常用组合）

```bash
# 某文件夹下按修改时间倒序的最近 10 篇
query 'TABLE status, file.mtime FROM "Projects" SORT file.mtime DESC LIMIT 10' --db ./index.db

# 含某标签族（含子标签）且标题以 A 开头
query 'LIST FROM #area WHERE startswith(file.name, "A")' --db ./index.db

# 反向链接：谁链接了 Index
query 'TABLE file.inlinks FROM [[Index]]' --db ./index.db

# 正则匹配文件名
query 'LIST WHERE regexmatch(file.name, "^20[0-9]{2}-")' --db ./index.db

# 监听并在每次变更后重跑某个查询脚本
watch ./my-vault --db ./index.db --on-change "node run-saved-query.js {file}"
```

---

## 12. 配置文件（免去重复传参）

把项目里稳定不变的默认值（索引路径、Vault 根等）写进配置文件，命令行就能省略对应参数。配置文件**不入 git**（已在 `.gitignore`），相当于「本机/本项目该怎么跑」的记忆。

### 文件位置与格式

**默认放仓库内隐藏目录 `.x-basalt/`**（类比 `.obsidian/`），配置、示例、索引库都默认归在这里、整体不入 git。**默认 YAML**，也支持 JSON5 / JSON。

| 层级 | 文件（默认 → 回退） | 查找方式 |
|---|---|---|
| 项目 | `.x-basalt/config.yaml` → 扁平 `.x-basalt.yaml` | 从当前工作目录**逐级向上**查找，首个命中生效 |
| 全局 | `~/.x-basalt/config.yaml` | 固定路径 |

每一层级内的优先级：隐藏目录形式 > 扁平文件形式；扩展名 `.yaml > .yml > .json5 > .json`。索引库默认也落在 `.x-basalt/index.db`（父目录自动创建）。

### 可配置项（均可选，字符串）

| 键 | 对应 | 说明 |
|---|---|---|
| `db` | `--db` | 默认 SQLite 索引路径 |
| `vault` | `index`/`watch` 的 `<vault>` | 默认 Vault 根（可省略位置参数） |
| `skillPath` | 等价 `OBSIDIAN_SKILL_PATH` | 默认 skill 目录 |
| `format` | `parse --format` | 默认输出格式 `json`/`yaml` |
| `onChange` | `watch --on-change` | 默认变更命令模板（`{file}` 占位） |

### 优先级

```
命令行 flag  >  项目配置 .x-basalt.json5  >  全局配置 ~/.x-basalt/config.json5  >  内置默认
```

### 示例

仓库内自带模板 `.x-basalt/config.example.yaml`（已入仓），复制一份即可：

```bash
cp .x-basalt/config.example.yaml .x-basalt/config.yaml
```

`.x-basalt/config.yaml`（推荐）：

```yaml
vault: ./my-vault
# db 省略即用默认 .x-basalt/index.db
# skillPath: ./team-skills
# format: yaml
```

等价的扁平 `.x-basalt.json5`：

```json5
{ vault: "./my-vault" }
```

配好后，这些都能省参数运行：

```bash
x-basalt index                       # vault 取自配置；索引写入默认 .x-basalt/index.db
x-basalt query "LIST FROM #project"  # db 默认即 .x-basalt/index.db，无需 --db
```

> 解析失败的配置文件会被忽略并 warn，不中断命令（降级）；未知键与非字符串值会被丢弃。

---

> 维护：命令签名 / DQL 子集 / 数据模型 / 配置项变化时，同步本指南、`README.md`、自我说明书 skill（`skills/x-basalt-usage.json5`）与 `docs/specs`，确保互相验证（见 `docs/README.md` 三层口径）。

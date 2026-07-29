---
type: architecture
title: x-basalt 架构总览
description: x-basalt 的分层架构、读写数据流、DQL 编译管线、SQLite 数据模型与组件目录
tags:
  - architecture
  - overview
  - x-basalt
timestamp: 2026-07-29T04:31:35Z
sha256: 929605e17393c2f1efc9af68e50a3a1e15f50f82e4c3b27a37359c8f02e19e29
---

# x-basalt 架构总览

> 目标架构真相源（允许阶段性滞后于实现）。本文是「架构图 + 架构目录」的集中入口。
> 关联：硬约束与目录结构见 [`AGENTS.md`](../../AGENTS.md)；文档路由见 [`docs/README.md`](../README.md)；
> DQL 子集见 [`specs/2026-06-27-dql-subset-frozen.md`](dql-subset.md)；
> meta 写侧子集见 [`specs/2026-06-28-meta-subset-frozen.md`](meta-subset.md)。

## 1. 一句话定位

x-basalt 是**零依赖 Obsidian GUI / 运行时**的 Vault 命令行工具：直接通过文件系统把 Obsidian Markdown
解析为 AST、写入单文件 SQLite 索引、用 Dataview(DQL) 子集查询、按 profile 读改 frontmatter 元数据，并能召回规范 skill。
所有能力都不依赖 Obsidian App、不引入 `obsidian` 包、不启动浏览器。

## 2. 设计约束（决定架构形状的硬边界）

这些约束（见 `AGENTS.md`「项目硬约束」）不是实现细节，而是架构的地基：

| #   | 约束                                                        | 对架构的影响                                                    |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | 禁 `import ... from 'obsidian'` / 任何 obsidian 类型        | parser 全自建正则提取，不复用 Obsidian 内部 AST                 |
| 2   | 禁 `obsidian://` URI                                        | 一切操作走 `fs`，无 App 往返                                    |
| 3   | 禁用 `obsidian-dataview` 的 Evaluator/Executor              | query 层自建 DQL→SQL 编译执行（可参考其 AST 类型，执行不依赖）  |
| 4   | 禁 Electron/Puppeteer/Playwright                            | 无 GUI 自动化，纯 Node 进程                                     |
| 5   | 文件操作只经 `fs`/`fs.promises`/`chokidar`                  | I/O 边界收敛在 indexer（读+写 DB）与 meta（写 .md）             |
| 6   | 隐式字段（inlinks/outlinks/tasks…）必须查询期 JOIN 实时计算 | 索引**不物化**反向链接，禁止假设 `app.metadataCache` 等外部缓存 |

## 3. 分层与依赖

七个一级单元，单向依赖、职责互不重叠。CLI 在顶层装配，各库层只做自己的事：

```mermaid
flowchart TD
    user([终端用户 / AI Agent]) --> cli["cli.ts（commander 入口）"]

    cli --> parser["parser/ 解析层"]
    cli --> indexer["indexer/ 索引层（唯一写 SQLite）"]
    cli --> query["query/ 查询层（只读 SQLite）"]
    cli --> base["base/ Bases 无头引擎（只读 SQLite + 只读 .base）"]
    cli --> meta["meta/ 元数据写侧（唯一写 .md）"]
    cli --> skill["skill/ 规范召回"]
    cli --> config["config.ts"]
    cli --> format["format.ts"]

    indexer --> parser
    parser --> utils["utils/path.ts（连接键真相源）"]
    indexer --> utils
    query --> utils
    base --> utils

    indexer -- 写 --> db[("SQLite 单文件<br/>.x-basalt/index.db")]
    query -- 只读 --> db
    base -- 只读 --> db
    parser -. 只读内容 .-> md[(".md 文件")]
    indexer -. 只读内容 .-> md
    base -. 只读 .-> basef[(".base / .obsidian/types.json")]
    meta -- 原子读改写 --> md
    skill --> skfiles[("skills-data/*.json5")]

    classDef store fill:#eef,stroke:#88a;
    class db,md,basef,skfiles store;
```

要点：

- **parser 不碰 fs/DB**（纯函数）；**query 不读 .md、只读 DB**；**indexer 是唯一写 DB 的层**；**meta 是唯一写 .md 的层**；**base 只读不写**（不写 vault、不写 DB、无 `eval`/动态代码，SQL 全参数化）。
- `utils/path.ts` 是 parser/indexer/query/base 共用的「连接键真相源」——写入侧与查询侧必须调用同一套 `linkKey`/`pathKey`，否则链接漏命中。
- base 与 query **互不依赖**（Bases 表达式与 DQL 是两套独立 token/AST）；base 复用 indexer 既有表（files/tags/links），不改其语义（md-only 数据集）。
- meta 与 parser/indexer/query **解耦**：写元数据不经过索引，索引也不依赖 meta。

## 4. 读侧数据流：解析 → 索引 → 查询

```mermaid
flowchart LR
    md[".md 内容"] --> P["VaultParser.parse()"]
    P --> fm["frontmatter 键值对"]
    P --> nodes["ObsidianNode[]<br/>wikilink/markdownLink/tag/callout/task/highlight/blockRef/inlineField"]
    fm --> IDX["VaultIndexer<br/>（事务内先删后插）"]
    nodes --> IDX
    IDX --> T1[("files")]
    IDX --> T2[("links")]
    IDX --> T3[("tags")]
    IDX --> T4[("tasks")]
    IDX --> T5[("blocks")]
    IDX --> T6[("inline_fields")]
    T1 & T2 & T3 & T4 & T5 & T6 --> Q["DataviewEngine.query(dql)"]
    Q --> out["QueryResult<br/>{ type, columns, rows }"]
```

- parser 编排：`parseFrontmatter → extractWikilinks → 行内 tag/callout/task/highlight/blockRef`，提取 tag/highlight 前先把代码区域**等长掩码**，避免代码块里的 `#`、`==` 被误识。
- callout/highlight 节点**不进索引**（无对应查询字段，仅 `parse` 子命令展示）；frontmatter 的 tags 由 indexer 单独并入 tags 表（`in_frontmatter=1`），parser 不重复产出。

## 5. DQL 编译管线（query 层内部）

自建的 Dataview 子集编译器，把 DQL 字符串编译为**参数化 SQL** 再执行：

```mermaid
flowchart LR
    dql["DQL 字符串"] --> lex["DqlLexer（chevrotain tokens）"]
    lex --> ast["DqlChevParser → DqlQuery AST"]
    ast --> gen["generateSql → CompiledSql<br/>(参数化 SQL + params + 列规格)"]
    gen --> exec["better-sqlite3 prepare/all"]
    exec --> json["聚合列 JSON.parse<br/>(tags/inlinks/outlinks/tasks)"]
    json --> res["QueryResult"]
```

不变量：

- **只读**：生产模式以 `readonly` 打开 DB，绝不写表；`:memory:` 仅供测试实例化。
- **防注入**：所有用户输入值走 `?` 占位符绑定；唯一内联是经白名单正则 `^[A-Za-z0-9_]+$` 校验过的 frontmatter 字段名。
- **隐式字段实时 JOIN**：`file.inlinks/outlinks/tags/tasks` 无物化视图，每次查询从 links/tags/tasks 表 JOIN 计算（硬约束 #6）。
- **路径感知（S3.2）**：qualified 链接（含 `/`）按 `path_key` 精确匹配，bare 链接按 `name_key` basename 回退，消除同名异目录串味。
- **越界即报错**：子集外语法 / 不支持字段 → 抛带源串偏移位置的 `DqlSyntaxError`，绝不返回误导性空结果。
- **真值语义对标官方**：WHERE 原子含裸字段真值 `truthy`（`WHERE field`）与一元 `!`（`not(truthy)`）；`generateSql` 用 `json_type` CASE 复刻官方 `Values.isTruthy()`（null/0/空串/空数组/空对象/false 皆 falsy），与显式 `= null`/`!= null`（`IS [NOT] NULL`）语义分离。见 [`../specs/2026-07-01-dql-truthiness-existence-design.md`](dql-truthiness.md)。

## 6. 写侧数据流：meta 元数据往返

```mermaid
flowchart LR
    cmd["meta get/set/unset/rename<br/>normalize/apply"] --> split["splitDocument<br/>(BOM + frontmatter + body)"]
    split --> chk{"YAML 合法?"}
    chk -- 否 --> reject["拒写并抛错<br/>(防毁文件)"]
    chk -- 是 --> mut["mutate(yaml Document)<br/>set/unset/rename/normalizeDoc/applyProfile"]
    mut --> ser["serializeDocument"]
    ser --> diff{"有字节变化<br/>且非 dry-run?"}
    diff -- 否 --> noop["不落盘"]
    diff -- 是 --> atomic["atomicWrite<br/>(临时文件 + rename)"]
```

不变量：唯一写 `.md` 的层；非法 YAML 拒写；原子写避免半写损坏；无变化不落盘（不制造虚假 mtime）。
`apply` 中**归一在机械预填之后**执行；profile **只告知不补语义**——机械字段（created/modified/sha256）顺手 top-up，
语义字段（type/title/tags…）由消费者读 `meta profile show` 的规范后经 `--set`/`meta set` 自行补。

## 7. 增量维护：watch 与 scan

两条增量路径共用 indexer 的「先删后插」单文件事务：

- **watch（常驻）**：`chokidar` 监听 → `onAdd/onChange/onUnlink` → `indexer.update()/remove()`；`add/change` 在落库**完成后**才触发 `onEvent` 回调（保证回调看到的索引最新）；监听/单文件失败降级 warn，不崩进程；`awaitWriteFinish` 防编辑器半写。
- **scan（按需）**：`computeDiff`（mtime+size 快判，或 `--rehash` 内容对比）算出新增/改动/删除，分批 (re)build 落库；可中途 break，未写文件下次仍被检出 → 天然断点续扫（无游标）。

## 8. SQLite 数据模型（五表）

```mermaid
erDiagram
    files {
        TEXT path PK "POSIX 主键：单根=相对根，多根=根名/相对根"
        TEXT name_key "小写无扩展名，bare 链接解析键"
        TEXT path_key "全路径去扩展名小写，qualified 链接精确键"
        TEXT folder "父目录，支撑 FROM 文件夹前缀匹配"
        TEXT frontmatter "JSON 串，json_extract 取标量"
    }
    links {
        TEXT source "源文件 path"
        TEXT target_key "bare 链接回退连接键"
        TEXT target_path_key "qualified 链接精确连接键(可空)"
        INTEGER is_embed "1 = ![[...]]"
    }
    tags {
        TEXT file_path
        TEXT tag "不带 #，嵌套保留全名"
        INTEGER in_frontmatter "1=frontmatter 0=行内"
    }
    tasks {
        TEXT file_path
        INTEGER line_number "1-based 正文行号"
        TEXT status "方括号内单字符"
        TEXT due_date "YYYY-MM-DD 或 NULL"
    }
    blocks {
        TEXT file_path
        TEXT block_id
        TEXT content "去行尾 ^id"
    }
    files ||--o{ links : "outlinks(source=path) / inlinks(JOIN key)"
    files ||--o{ tags : file_path
    files ||--o{ tasks : file_path
    files ||--o{ blocks : file_path
```

隐式字段如何算（查询期 JOIN，不物化）：

- `outlinks` = `links WHERE source = files.path`
- `inlinks` = `links WHERE target_path_key = files.path_key`（qualified）**或** `target_key = files.name_key`（bare 回退）
- `tags` / `tasks` = 对应表按 `file_path` 聚合

## 9. 架构目录（组件清单）

每个一级单元的职责 / 公共出口 / 上游 / 下游 / 关键不变量：

| 单元        | 源                  | 职责                                                        | 公共出口                                                                                              | 上游                   | 下游                                | 关键不变量                                                                            |
| ----------- | ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| **cli**     | `src/cli.ts`        | commander 装配 7 命令组，只做参数装配与输出，不内联业务逻辑 | `x-basalt parse/index/scan/query/skills/meta/watch`                                                   | 终端用户 / AI          | 四层库 + config + format            | 逻辑在各层，CLI 不持有状态                                                            |
| **parser**  | `src/parser/`       | 内容 → `ObsidianNode[]`，纯函数零 I/O                       | `VaultParser`、`ObsidianNode`、`ParsedFile`                                                           | indexer                | gray-matter、utils/path             | 不碰 fs/DB；链接类节点含完整文件 line/column/raw；代码区域掩码；inlineField last-wins |
| **indexer** | `src/indexer/`      | 唯一写 SQLite 的边界，全量/增量维护六表                     | `VaultIndexer`(rebuild/scan/scanIter/update/remove/watch/close)、`createSchema`                       | cli、watcher 回调      | parser、better-sqlite3              | 不内联 DQL；隐式字段不物化；links 表写入前去重；先删后插事务；单文件失败跳过          |
| **query**   | `src/query/`        | 自建 DQL 子集 → 参数化 SQL，只读执行                        | `DataviewEngine`(query/close)、`DqlSyntaxError`、`DqlQuery`、`QueryResult`                            | cli                    | better-sqlite3（只读）              | 不读 .md；参数化防注入；隐式字段 JOIN；越界抛带位置错误                               |
| **base**    | `src/base/`       | Bases 无头引擎：.base 文档层 + 表达式文法 + 预算解释器 + 查询 engine（只读） | `BaseEngine`(query/close)、`loadBaseDocument`、`selectView`、`parseBaseExpression` | cli | better-sqlite3（只读）、yaml、utils/path | 不写 vault/DB；无 eval/new Function；SQL 参数化；md-only 数据集；预算硬上限；与 query 零共享 token/AST |
| **meta**    | `src/meta/`         | 唯一写 `.md` 的层，frontmatter 读改 + 归一 + profile 套用   | `readMeta`/`editMeta`/`applyProfile`、`set/unset/rename`、`normalizeDoc`、`getProfile`/`listProfiles` | cli                    | yaml、node:fs、node:crypto          | 不碰 SQLite；非法 YAML 拒写；原子写；无变化不落盘；profile 只告知不补语义             |
| **skill**   | `src/skill/`        | json5 加载 + Fuse.js 模糊召回 + 按名取 / 渲染，内置兜底     | `SkillRecall`(list/get/all/recall/resolvedDir)、`loadSkills`、`renderSkill`、`SkillDefinition`        | cli                    | fuse.js、json5、skills-data/\*.json5 | 空目录兜底在 loader；外部目录可 shadow 内置；单文件失败跳过                           |
| **config**  | `src/config.ts`     | cosmiconfig 向上搜 + 全局/项目合并                          | `loadConfig`、`BasaltConfig`                                                                          | cli                    | cosmiconfig、yaml                   | 项目键覆盖全局；解析失败降级 `{}`                                                     |
| **format**  | `src/format.ts`     | 输出序列化 json/yaml                                        | `emit`、`toYaml`                                                                                      | cli                    | yaml                                | 未知 format 静默降级 JSON                                                             |
| **utils**   | `src/utils/path.ts` | 路径归一 + wikilink 连接键真相源                            | `toPosix`、`linkKey`、`pathKey`、`isAssetEmbed`                                                       | parser、indexer、query | node:path                           | 写入侧与查询侧必须共用同一套键函数                                                    |

## 10. 目录映射

```
src/parser/   解析层：内容 → ObsidianNode[]（纯函数）
src/indexer/  索引层：parser → SQLite 五表，chokidar 增量
src/query/    查询层：DQL tokenizer→ast→sql-generator，参数化 SQL
src/base/     Bases 无头引擎：.base 文档层 + 查询/formulas/类型/分组汇总（P0..P2b，只读）
src/meta/     元数据写侧：frontmatter 往返 + CRUD + normalize + profile + 原子写
src/skill/    Skill 召回：json5 加载 + Fuse 模糊匹配 + 按名取 / 渲染 + 兜底
src/utils/    路径与连接键工具
src/cli.ts    commander 入口
skills-data/   运行时 Skill 数据（SkillRecall 加载）
tests/        Node 原生测试 + fixtures/sample-vault
```

## 11. skill 加载 / 召回数据链

`skills` 命令组（`src/cli.ts`）→ `SkillRecall`（`src/skill/index.ts`）→ `loadSkills` / `resolveSkillDir`（`src/skill/loader.ts`）→ 渲染（`src/skill/render.ts`）→ stdout。每次 CLI 调用构造一次 `SkillRecall`、加载一次、查后即用：

1. **目录解析** `resolveSkillDir`：显式 `skillPath`（config）> env `OBSIDIAN_SKILL_PATH` > `~/.obsidian-core/skills`（存在时）> 内置 `skills-data/`（随包发布，`../../skills-data` 上溯两级，src 与 dist 一致）。
2. **加载校验** `loadDir`：读目录下全部 `*.json5` → `JSON5.parse` → 最小校验（须有 `name` + `rules` 数组，否则 warn 跳过，单文件失败不中断）→ `SkillDefinition[]`。
3. **兜底补齐**：`ALWAYS_AVAILABLE`（`obsidian-base-spec` / `x-basalt`）缺失时从内置 `skills-data/` 补回，使基础规范与自我说明书永远可召回；外部目录自带同名则不覆盖（可 shadow）。
4. **召回 / 取数**：构造期建一次 Fuse 索引（`name` 权重 2、`triggers` 权重 1，阈值 0.4）。`recall(kw)` 模糊命中并按相关性排序；`get(name)` 精确取；`all()` 全量；`list()` 取 `name` + `description`；`resolvedDir()` 暴露解析目录。
5. **输出**：读子命令默认经 `renderSkill` / `renderSkills` / `renderSkillList` 渲染为可读 Markdown；`--json` 改走 `emit` 输出结构化 JSON。`get` 未命中 / `recall` 空 → 打印 `✗` + 退出码 1。

## 12. 现状与边界（截至 2026-06-28）

- 读侧（parser/indexer/query/skill/cli）+ 写侧（meta：CRUD/normalize/profile-apply，三套 profile）均已落地，272 测试绿，处于 dogfood 观察期。
- 待 dogfood 暴露真实需求再开的方向（migrate 批量改造、lint schema 校验、watch pipeline 常驻管线）见 [`TODO.md`](../../TODO.md)。
- **2026-07 更新**：新增一级单元 `src/base/`（Bases 无头引擎，P0 文档层 → P1 查询 → P2 formulas/类型/分组汇总，只读边界；all-files/context 属 P3，schema 决策见 [`bases-vault-entries.md`](bases-vault-entries.md)）。

## 13. Bases 模块内部架构（zoom-in）

`src/base/` 是七一级单元之一，因其是**最核心的新增模块**（也是当前正在给你讲的部分），特此放大画出内部架构图。

### 13.1 架构线框图

```text
┌──────────────────────────────────────────────────────────────────┐
│                    CLI 薄出口（未来）                              │
│                BaseEngine.query({...})                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  🎮 执行引擎                    engine.ts                        │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐       │
│  │ planner.ts  │  │ evaluator.ts │  │   source.ts       │       │
│  │  (编译计划)  │─▶│  (逐行求值)   │  │  (SQLite 数据源)   │       │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘       │
│         │                │                    │                  │
│         │     ┌──────────▼────────┐          │                  │
│         │     │  values.ts        │          │                  │
│         │     │  (值语义/比较/     │          │                  │
│         │     │   序列化)          │          │                  │
│         │     └───────────────────┘          │                  │
│         │                                    │                  │
│         │     ┌──────────┐   ┌────────────┐  │                  │
│         │     │ parser.ts│   │ tokens.ts  │  │                  │
│         │     │ (AST 编译)│   │ (词法分析)  │  │                  │
│         │     └──────────┘   └────────────┘  │                  │
│         │                                    │                  │
│         ▼                                    ▼                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  summaries.ts  │  typeschema.ts  │  functions.ts             ││
│  │  (15内置汇总+   │  (类型表只读)   │  (函数注册表)             ││
│  │   自定义汇总)    │               │                            ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▲
                             │ 调用
┌──────────────────────────────────────────────────────────────────┐
│  📋 P0 文档层                       document.ts                 │
│                                                                  │
│  职责链（5 道防线，顺序执行）：                                    │
│  ① 路径越界检查 ── resolveInsideVault()                          │
│  ② 文档大小预算 ── stat → maxDocumentBytes                      │
│  ③ YAML 解析    ── parseDocument + alias 预算（防 alias bomb）    │
│  ④ Schema 校验   ── views/type/name/limit/sort/groupBy/summaries │
│  ⑤ 浅扫描       ── scanExpression（白名单核对 + token 预算）      │
│                                                                  │
│  产出：BaseDocument { path, views[], filters, diagnostics[] }    │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  🏗️ 类型定义 + 诊断契约           types.ts + errors.ts            │
│                                                                  │
│  types.ts: BaseDocument / BaseView / BaseFilter / BaseExpr(AST)  │
│            BaseDocumentLimits / BaseExecutionLimits(10 道预算)    │
│                                                                  │
│  errors.ts: BASE_RULES(20+ 条 rule id) + baseDiagnostic 构造器   │
│             诊断形状: { file, line, col, rule, severity, message }│
└──────────────────────────────────────────────────────────────────┘
```

### 13.2 组件依赖方向

```text
源文件                  依赖                          被依赖
───────                ──────                        ────────
index.ts               ──                            types.ts, errors.ts, document.ts
                       (聚合出口，cli / engine 消费)   parser, evaluator, source 等

types.ts               ──                            全部 15 个文件
                       无依赖（纯 type/interface 定义）

errors.ts              types.ts                      全部诊断产出方
                       ../diagnostic.ts               （document/planner/evaluator/engine）

document.ts            types.ts, errors.ts,           engine.ts(planBaseQuery)
                       expressions.ts                 （唯一 .base 读取边界）
                       yaml, node:fs

expressions.ts         errors.ts                     document.ts（浅扫描），
                                                      functions.ts（白名单共享）

parser.ts              tokens.ts                     planner.ts（编译 filter/sort/order）
(tokens.ts → 词法)      types.ts, chevrotain?

planner.ts             document.ts, parser.ts         engine.ts（接收编译计划）
                       errors.ts, types.ts

evaluator.ts           values.ts, functions.ts        engine.ts
                       errors.ts, types.ts

values.ts              types.ts                       evaluator.ts, source.ts
                       （值语义/比较/序列化）

source.ts              values.ts, types.ts            engine.ts（SQLite → BaseRow）
                       better-sqlite3

engine.ts              上述全部                      CLI 薄出口
                       better-sqlite3

summaries.ts           types.ts, values.ts            engine.ts（内置 15 汇总函数）

functions.ts           types.ts                       evaluator.ts（函数分派）

typeschema.ts          node:fs                        engine.ts（.obsidian/types.json）
```

### 13.3 执行流水线（engine.query 内 8 步）

```text
SQLite
  │
  ▼
readBaseRows ──→ filter 逐行（truthy 判定，行级错误跳过）
  │                   │
  │                   ▼
  │             sort 多键稳定排序（恒附 file.path ASC tie-break）
  │                   │
  │                   ▼
  │             limit 截断（total = filter 后 limit 前真实行数）
  │                   │
  │                   ▼
  │             投影序列化（行级错误 cell → null，不崩）
  │                   │
  │                   ▼
  │             groupBy 分桶（P2b：list 键扇出）
  │                   │
  │                   ▼
  │             summaries 汇总（内置 15 名 / 自定义）
  │                   │
  ▼                   ▼
BaseQueryResult { conformance, base, view, columns, total, rows, groups?, summaries?, diagnostics }
```

### 13.4 10 道安全预算防线

| 防线 | 字段 | 默认值 | 约束目标 | 触发后果 |
|------|------|--------|----------|----------|
| 1 | maxDocumentBytes | 1 MiB | 超大文件不读 | 读取前拒绝（stat 预判） |
| 2 | maxYamlAliases | 100 | YAML alias bomb | toJS 时拒绝，返空结果 |
| 3 | maxFilterDepth | 32 | filter 嵌套深度（迭代栈实现） | 不展开分支，防栈溢出 |
| 4 | maxExpressionNodes | 1000 | P0 token / P1 AST 节点 | 解析终止 |
| 5 | maxCallDepth | 64 | 函数调用嵌套 | 求值终止 |
| 6 | maxFormulaNodes | 256 | 公式数量 | 不建依赖图 |
| 7 | maxFormulaDepth | 64 | 公式依赖链长度 | 不执行公式 |
| 8 | maxRows | 100,000 | 单次查询候选行 | source 层截断 |
| 9 | maxOperations | 1,000,000 | 单表达式求值操作数 | 转 execution-budget error |
| 10 | maxTotalOperations | 50,000,000 | 整次查询操作数总额 | 兜底：防 maxRows×列数淹过 |

### 13.5 关键不变量

1. **不写 vault/DB** — engine 以 `readonly` 打开 SQLite，不写 .md、不写 .base、不写索引
2. **无 `eval` / `new Function`** — AST 解释器手写，不动态生成代码
3. **预算耗尽不返回部分结果** — 任何一道防线碰壁即 `execution-budget` error + 空结果
4. **行级错误不崩查询** — filter 行当作 unselected，投影 cell 置 null
5. **错误经 diagnostics 返回，不 throw** — 唯一例外：索引库打不开（fileMustExist）
6. **诊断字节稳定** — 产出顺序固定（文档层→planner→引擎→行级），不随行数无界增长

### 13.6 BaseDocument 类型对象关系

```text
BaseDocument
  ├── path: string  （vault 相对 POSIX 路径）
  ├── filters?: BaseFilter
  │     ├── kind="expr"  ──→ { expr: string, span: SourceSpan }
  │     └── kind="and"|"or"|"not"
  │           └── children: BaseFilter[]  ← 递归引用自身（树形结构）
  ├── formulas?: Record<string, BaseFormulaDef>
  │     └── BaseFormulaDef = { expr: string, span: SourceSpan }
  ├── summaries?: Record<string, BaseFormulaDef>  （结构同 formulas）
  ├── properties?: Record<string, { displayName?: string }>
  ├── views: BaseView[]      （必填，≥1 个；error 诊断使其空时不执行）
  │     └── BaseView
  │           ├── type: string         （"table" | 未知 | 插件，不猜测）
  │           ├── name: string         （唯一，重名 → error）
  │           ├── filters?: BaseFilter （view 级 filter，P1 与顶层 AND 合并）
  │           ├── order?: string[]     （投影列 property-ref 列表）
  │           ├── sort?: BaseViewSort[]
  │           │     └── { property: string, direction: "ASC"|"DESC" }
  │           ├── limit?: number
  │           ├── groupBy?: BaseViewGroupBy  （P2b）
  │           ├── summaries?: Record<string, string>  （P2b：prop→汇总名）
  │           └── span: SourceSpan     （view 在 YAML 中的位置）
  ├── unknownKeys: Record<string, unknown>  （未知顶层 key 保留原值，warning）
  ├── viewsSpan: SourceSpan   （views 键的位置）
  └── diagnostics: BasaltDiagnostic[]

聚合关系（→ = 引用，⇒ = 包含数组）：
  BaseDocument ⇒ views: BaseView[]
  BaseFilter → BaseFilter[].children（递归）
  BaseView → BaseViewSort | BaseViewGroupBy
  BaseFormulaDef → SourceSpan
```

### 13.7 BaseExpr AST 节点（10 种）

```text
所有节点共有字段：
  offset: number  — 表达式内 UTF-16 code unit 位置（0-based），P1 诊断换算用

kind           字段                                  含义/举例
────           ─────                                  ────────
literal        value: null | boolean | number | str   字面量："Done", 42, true

list           items: BaseExpr[]                      列表 [a, b, c]

property       base: "note" | "file" |                属性引用：
               "formula" | "this"                      status → note.status
               path: string[]                           file.name → file
                                                         formula.x → 跨行公式

member         target: BaseExpr                       成员访问：
               name: string                             file.properties.author

index          target: BaseExpr                       下标访问：
               index: BaseExpr                          note["Review Status"]

call           name: string                           函数/方法调用：
               receiver: BaseExpr | null                contains(status, "x")  [receiver=null]
               args: BaseExpr[]                         status.contains("x")  [receiver=status]

not            arg: BaseExpr                           !isTruthy(status)

neg            arg: BaseExpr                           -amount

duration       amount: number                         duration 字面量：
               unit: BaseDurationUnit                   3days, 1hour, 6month

binary         op: "&&"|"||"|"=="|"!="|             二元运算：
                  "<"|">"|"<="|">="|               status == "Done"
                  "+"|"-"|"*"|"/"                    amount * 2
               left: BaseExpr
               right: BaseExpr


节点树形关系（缩进=子节点引用）：
  binary  ← left/right  → binary | not | call | property | literal | ...
  call    ← args[]      → 任意 BaseExpr
  call    ← receiver    → 方法调用的主体表达式
  list    ← items[]     → 任意 BaseExpr
  member  ← target      → 任意 BaseExpr
  index   ← target + index → 各为任意 BaseExpr
```

### 13.8 场景索引

查询流程见 §13.3；filter 合并策略见 §13.5；P0 文档层防线见 §13.1；
公式编译与依赖图算法见 `src/base/planner.ts`（Kahn 拓扑排序 + 循环检测）；
行级错误处理、contextFile 接线、groupBy 扇出、summaries 计算集等见 `src/base/engine.ts`。


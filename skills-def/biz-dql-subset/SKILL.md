---
name: biz-dql-subset
description: Use when implementing or reviewing the query engine or indexer schema of x-basalt (DQL tokenizer/ast/sql-generator, implicit fields, SQLite JOIN) - defines the supported DQL subset, the AST→SQL mapping, and implicit-field semantics
---

# Dataview DQL 子集 → SQL 规范（query/indexer 真相源）

## 简介

x-basalt 自建 DQL 执行层，**禁止依赖 obsidian-dataview 的 Evaluator/Executor**。本 skill 定义支持的 DQL 子集、AST→参数化 SQL 的映射、隐式字段语义。完整分析见 `docs/research/2026-06-25-obsidian-spec-and-deps.md` §3。

> **规范对标原则（2026-06-26）**：查询语义严格对标官方 Dataview 行为（以官方 `src/query/parse.ts` 与官方文档为参考）。本 skill 的子集口径若与官方**无冲突**，一律以**官方 Dataview 为准**；子集只做"少而正确"的取舍（暂不实现 = 报错，而非语义偏离），不得在已实现的子句上偏离官方语义。

## 触发场景

- 实现 / 修改 `src/query/**`（tokenizer、ast、sql-generator、执行）
- 实现 / 修改 `src/indexer/schema.ts`（隐式字段依赖的表结构）
- 审查查询结果与 `tests/query.test.ts` 的断言

## 支持的子集（2026-06-27 冻结 · 扩展后）

> 早期 MVP 的「严格边界」是无调研临时口径，已按官方 Dataview + 用户拍板扩展。完整裁决表 + 每项 AST→SQL 策略见 `docs/specs/2026-06-27-dql-subset-frozen.md`，本段为真相源摘要。

```
LIST | TABLE <field, ...> | TASK
FROM <"folder"> | <#tag> | <[[link]]>           # 单一来源；多来源 and/or 不做
WHERE <condition>
GROUP BY <expr>
FLATTEN <arrayField>
SORT <field> [ASC|DESC] (, <field> [ASC|DESC])* # 多键
WITHOUT ID
LIMIT <number>
```

- 操作符：`= != < > <= >=`、`AND/OR/NOT`、括号。
- 字符串谓词函数：`contains/icontains/startswith/endswith`、`regexmatch(field,"pat")`（含 ReDoS 防护）。
- WHERE 扩展：`field = null` / `!= null`（→ `IS NULL`/`IS NOT NULL`）、日期比较（ISO 字典序）。
- 内置标量函数：日期 `date(today)`/`date(now)`；字符串 `lower`/`upper`；`length(x)`（字符串长度 / 数组计数）；数值 `round(x[,n])`。
- TASK：返回任务行（text/status/line/file），FROM/WHERE 做**文件级**过滤；task 内部字段级过滤为后续（非本轮）。
- **仍非目标（遇到报带位置 `DqlSyntaxError`，不静默）**：FROM and/or 多源、CALENDAR、DataviewJS（`dataviewjs` 块）、未知字段 / 未知函数、对聚合 JSON 列排序、`LIMIT` 负数、`length()` 之外的任意数值表达式运算（如 `a + b`）。

## 隐式字段映射

| 字段 | SQL 来源 |
|---|---|
| `file.name/path/folder/extension/size/mtime/ctime` | `files` 表列（folder 由 path 推导） |
| `file.tags` | `tags` 表聚合；`contains(file.tags, "#x")` → JOIN tags WHERE tag = 'x' |
| `file.inlinks` | `links` 表反向：`JOIN links ON links.target = files.path` |
| `file.outlinks` | `links` 表正向：`JOIN links ON links.source = files.path`（含 embed） |
| `file.tasks` | `tasks` 表关联；`TASK` 查询返回任务行、`length(file.tasks)` 计数；task 字段级过滤为后续（非本轮） |
| frontmatter 标量（如 `status`） | `json_extract(files.frontmatter, '$.status')` |

**硬约束**：inlinks/outlinks 等**无物化视图**，一律查询期 JOIN 实时计算（对应 `AGENTS.md` 硬约束第 6 条）。

## 实现要点

- 流水线：`tokenize(dql) → parse 成 DqlQuery(ast.ts) → generateSql(query) → better-sqlite3 执行 → QueryResult`。
- **全部走参数化占位符绑定**，禁止字符串拼接用户输入（防注入）。
- 标签前缀匹配：`FROM #a` 命中 `#a` 与 `#a/b`（`tag = 'a' OR tag LIKE 'a/%'`）。
- 大小写：链接/标签匹配默认不敏感。
- 结果形态：`{ type, columns, rows }`；LIST 的 columns 至少含 `file.name`/`file.path`。

## 测试强度（硬要求）

DQL 内核复杂，测试必须「重」：**每个子句 / 函数 / 隐式字段 / 文法分支逐项独立用例**，覆盖**边界值、异常输入、错误定位（带 pos）、安全对抗（SQL 注入、`regexmatch` ReDoS）**。每个声称「支持」的能力须有可追溯测试编号，对齐覆盖矩阵。缺这些维度视为该步未完成。详见 `AGENTS.md` 测试规范。

## 关键假设

链接解析按 basename 近似、embed 计入 outlinks、日期按 ISO 字典序比较——细节与理由见 `docs/research` §3.3，改动这些口径需同步研究文档与测试。

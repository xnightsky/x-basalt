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

## 支持的子集（严格边界）

```
LIST | TABLE <field, ...>
FROM <"folder"> | <#tag> | <[[link]]>     # 单一来源；多来源 and/or 不在 MVP
WHERE <condition>
SORT <field> ASC | DESC                    # 单字段
LIMIT <number>
```

- 操作符：`= != < > <= >=`、`contains/icontains/startswith/endswith`、`AND/OR/NOT`、`regexmatch(field, "pattern")`。
- 超出子集（TASK/CALENDAR、多字段 SORT、FROM and/or、length() 数值比较）= 非目标，遇到应明确报错而非静默。

## 隐式字段映射

| 字段 | SQL 来源 |
|---|---|
| `file.name/path/folder/extension/size/mtime/ctime` | `files` 表列（folder 由 path 推导） |
| `file.tags` | `tags` 表聚合；`contains(file.tags, "#x")` → JOIN tags WHERE tag = 'x' |
| `file.inlinks` | `links` 表反向：`JOIN links ON links.target = files.path` |
| `file.outlinks` | `links` 表正向：`JOIN links ON links.source = files.path`（含 embed） |
| `file.tasks` | `tasks` 表关联（显示 + length；按字段过滤为非目标） |
| frontmatter 标量（如 `status`） | `json_extract(files.frontmatter, '$.status')` |

**硬约束**：inlinks/outlinks 等**无物化视图**，一律查询期 JOIN 实时计算（对应 `AGENTS.md` 硬约束第 6 条）。

## 实现要点

- 流水线：`tokenize(dql) → parse 成 DqlQuery(ast.ts) → generateSql(query) → better-sqlite3 执行 → QueryResult`。
- **全部走参数化占位符绑定**，禁止字符串拼接用户输入（防注入）。
- 标签前缀匹配：`FROM #a` 命中 `#a` 与 `#a/b`（`tag = 'a' OR tag LIKE 'a/%'`）。
- 大小写：链接/标签匹配默认不敏感。
- 结果形态：`{ type, columns, rows }`；LIST 的 columns 至少含 `file.name`/`file.path`。

## 关键假设

链接解析按 basename 近似、embed 计入 outlinks、日期按 ISO 字典序比较——细节与理由见 `docs/research` §3.3，改动这些口径需同步研究文档与测试。

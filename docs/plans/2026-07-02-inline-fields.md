---
type: plan
title: inline fields 解析/索引/查询三层落地计划
description: "inline fields（key:: value）三层落地的实现计划：P0 冻结 spec → P1 parser 提取 → P2 indexer 建表 → P3 query 字段解析 → P4 文档/skills 收尾；设计与 D1–D5 决策以 specs/2026-07-02-inline-fields-design.md 为真相源"
tags:
  - plan
  - inline-fields
  - dql
  - query
  - parser
  - indexer
timestamp: 2026-07-02T05:43:42Z
sha256: c0c28f249c07d0b1e3a78fc1d5c7822e3085a868b3eac977381261192e73f941
---
# 计划：inline fields（`key:: value`）解析 / 索引 / 查询三层落地

> 2026-07-02 · 承接 feature-gap 研究篇「元数据采集层最关键缺口」。
> **设计真相源**：[`../specs/2026-07-02-inline-fields-design.md`](../specs/2026-07-02-inline-fields-design.md)——inline 是什么、现状缺口、关键洞察（文法零改动）、**D1–D5 决策**、子集边界与 backlog、三形态正则、`inline_fields` 表 DDL、字段解析 SQL、安全口径、已知限制，**一律以该 spec 为准，本计划不重复**。本计划只留「怎么做 + 验收」。
> 其它关联：[`../research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](../research/2026-06-30-feature-gap-vs-dataview-obsidian.md) §A、[`../specs/2026-06-27-dql-subset-frozen.md`](../specs/2026-06-27-dql-subset-frozen.md)、[`../specs/2026-06-26-coverage-matrix.md`](../specs/2026-06-26-coverage-matrix.md)。
> 状态：**已完成（2026-07-02）：P0–P4 全部落地。全量 lint/typecheck/build/test 绿（502 用例，含 #28 新增的 parser/indexer/scan/sql-generator/query 各层用例）；CLI 手验命中（只有 inline 字段的笔记 `TABLE rating WHERE rating` / `rating > "4"` 均正确）**。

## 背景（一句）

x-basalt 三元元数据模型缺 inline fields 一元（解析层无 `::`、索引层无表、查询层无通道）；补齐后无论字段来自 frontmatter 还是正文 inline，`WHERE rating > "3"` 均可命中。详见 spec §1–§3。

## 分阶段切口

### P0 · 冻结设计 spec（先于编码）

- **前置条件（gate，非本计划产出）**：spec §4 决策 D1–D5 已由用户拍板。
- 把 spec 状态行由「草案 — 待拍板」改为「已冻结（拍板日期）」。
- `docs/specs/2026-06-27-dql-subset-frozen.md` 挂占位条目 **#28 inline fields（🚧 实现中，指向 spec）**——翻 ✅ 与挂测试号在 P4（须测试绿后，P0 时测试尚不存在）。
- **验收**：spec 状态=已冻结；#28 占位在位；无代码改动。

### P1 · 解析层：提取 inline fields（`src/parser/`）

- `types.ts`：`ObsidianNode` 增变体 `{ type: "inlineField"; key: string; value: string; line: number }`（`line` 沿用 task/blockRef 的 1-based 正文行号风格，供未来定位）。
- `index.ts`：新增 `extractInlineFields(maskedBody, lines)`——正则、`maskCode` 前提、key 字符集、last-wins 去重、注释分界，全部按 **spec §6.1**（含 §4 D3 落点澄清：去重在提取期兑现）。
- `parse()` 编排里加 `extractInlineFields`，push 进 `nodes`。
- **测试** `tests/parser.test.ts`：三形态各正例；代码块/行内代码内 `a:: b` 不提取；`https://x`、`a::b` 无空格等边界；负例（无 `::`、空 key、空 value）；同 key 多次出现 → last-wins；ReDoS 对抗（超长行不卡死）。
- **验收**：`typecheck` + `parser.test` 绿；`pnpm cli -- parse <fixture>` 输出含 inlineField 节点。

### P2 · 索引层：`inline_fields` 表 + 写入（`src/indexer/`）

- `schema.ts`：建表按 **spec §6.2** DDL。
- `index.ts`：
  - Row 类型 `InlineFieldRow`；`FilePayload` 加 `inlineFields`。
  - prepared：`insertInlineField`（~L276 insertTag 区）；`delInlineFields`（~L293 delTags 区）。
  - rebuild 全量 DELETE（~L385）加 `DELETE FROM inline_fields;`。
  - payload 构建的 node 循环（~L662–708）加 `case "inlineField"`。
  - `insertPayload`（~L735–754）加写循环。
  - **关键**：凡 `delTags`/`delTasks` 被调处（rebuild 全量 + **增量 per-file 更新 / 删除路径**）同步加 `delInlineFields`（spec §6.2 生命周期；回归高危点）。
- **测试** `tests/indexer.test.ts` + `tests/scan.test.ts`：建索引后 `inline_fields` 行数正确；改文件 scan 后旧 inline 被清、新写入；删文件后清空。
- **验收**：`typecheck` + `indexer`/`scan` 测试绿；硬约束 6 自查通过（spec §6.2）。

### P3 · 查询层：字段解析纳入 inline（`src/query/sql-generator.ts`，文法不动）

- `fieldToSql` default 分支、`truthySql` default、`compileWhere` 的 `isnull` default 三处，按 **spec §6.3** 改（COALESCE 合并 + 白名单）；既有 `file.*` 字段不变。
- **测试** `tests/sql-generator.test.ts`（SQL 形态：出现 COALESCE + `inline_fields` 子查询、白名单、无注入）、`tests/query.test.ts`（端到端：① 只有 inline 字段的笔记被 `WHERE rating` / `WHERE rating > "4"` 命中；② frontmatter 与 inline 同名按 D1 优先级取值；③ `WHERE !status` / `= null` 存在性把 inline 算进；④ 非法/未知 key 仍报 `DqlSyntaxError`）、`tests/query-parser.test.ts`（文法未变的回归护栏）。
- **验收**：`typecheck` + `build` + 四测试文件绿。

### P4 · 文档 / skills / 收尾（执行 spec §9 rebase 地图）

- guides ×2、skills-def ×2（改完 `pnpm run skills:install`）、skill-data ×2、根 `TODO.md` 勾掉——逐项内容见 **spec §9**。
- `dql-subset-frozen` #28 占位翻 ✅；`coverage-matrix` 从 ❌ 翻 ✅ 并挂测试号。
- **docs 元数据自举**：对本计划与 spec 跑 `x-basalt meta apply llm-wiki <doc> --refresh-derived`（AGENTS「文档元数据自举」）。
- **验收**：docs 链接自洽；`skills:install` 后 `x-basalt skills get biz-dql-subset` 含 inline；spec §9 清单逐项勾达。

## 测试策略

对齐 AGENTS「复杂模块重测试」：parser / indexer / query 三层各自独立用例 + 覆盖**边界值 / 异常输入 / 错误定位 / 安全对抗**（维度清单见 spec §7）。每个声称「支持」的能力挂可追溯测试号，回写 `coverage-matrix.md`。

## 验证命令

1. `pnpm run typecheck && pnpm run build`
2. `pnpm test`（parser / indexer / scan / sql-generator / query / query-parser）
3. 手验：造一篇只有 inline 字段的笔记 → `x-basalt index` → `x-basalt query 'TABLE rating WHERE rating'` 命中。
4. 触及共享 schema + DQL 子集边界 → 升级跑**全量** lint/typecheck/build/test（AGENTS「完成定义」）。

## 风险

- **[数据模型·迁移]** 新增 `inline_fields` 表触及索引 schema：`createSchema` 为 `IF NOT EXISTS`，新表对旧库自动补建，但旧库无历史 inline 数据，**需重跑 `x-basalt index` 全量回填**——guide 注明。
- 语义 / 类型层面的已知限制（D1 与官方差异、字典序陷阱）见 **spec §8**，不在此重复。

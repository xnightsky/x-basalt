---
timestamp: 2026-06-30T00:01:23Z
sha256: 258eb0b681505af72fdb6a8a2fc9f8b8e07044c7acfa0be5357d185062ff77ba
type: plan
title: 阶段 2 下钻：DQL 内核做深 · 原子子步
description: DQL 内核扩展与做深的原子实现子步与验收
tags:
  - plan
  - dql
  - query
  - x-basalt
---
# 阶段 2 下钻：DQL 内核做深 · 原子子步（x-basalt 代表作核心）

> 日期：2026-06-26 · 父计划：[`2026-06-26-execution-roadmap.md`](2026-06-26-execution-roadmap.md) 阶段 2
> 真相源：`skills-def/biz-dql-subset/SKILL.md`（DQL 子集 + AST→SQL 映射 + 隐式字段语义）、调研 [`../research/2026-06-25-obsidian-spec-and-deps.md`](../research/2026-06-25-obsidian-spec-and-deps.md) §3
> 现状：覆盖 [`../specs/2026-06-26-coverage-matrix.md`](../specs/2026-06-26-coverage-matrix.md) §B（DQL ~70%）

## ⚠️ 前置冲突（开工前必须解决）

DQL 子集真相源把当前子集定义为**严格边界**，明确 `TASK/CALENDAR、多字段 SORT、FROM and/or、length()` = **非目标，应报错**；而本阶段要**扩展**子集（多键 SORT、GROUP BY、FLATTEN…）。
→ **S2.2a/S2.2b 是卡点：先在真相源 skill + research §3 里重新冻结"扩展后的目标子集"，再写任何代码。** 否则真相源与实现分叉，`tests/query.test.ts` 现有"非子集报错"断言也会冲突。

## 子步格式

每步：目标 / 动作 / 验收标准 / 证据命令 / 前置。功能步一律 **TDD：先写测试(red)→实现(green)**。新建解析器单测文件 `tests/query-parser.test.ts`，端到端仍用 `tests/query.test.ts`。

---

## Part A · 选型与契约（地基）

- [x] **S2.1 文法工具 spike：chevrotain vs peggy** ✅ 2026-06-27
  - 目标：选定 DQL 文法实现工具。
  - 动作：各写最小 spike 解析 `LIST FROM #x WHERE a = 1 AND contains(file.tags,"y") SORT b DESC LIMIT 5`；验证 ESM/NodeNext 接入、错误位置、TS 类型。
  - 验收：选定其一（推荐 **chevrotain**：纯 TS、无生成步骤、Node22 已满足、错误恢复+IDE 友好；备选 peggy）。决策写入 specs。
  - 证据：两 spike 均打印**一致**的正确 AST；决策 + 实证评估矩阵见 [`../specs/2026-06-27-dql-grammar-tool-decision.md`](../specs/2026-06-27-dql-grammar-tool-decision.md)。
  - **结论**：选 **chevrotain@12.0.0**（已落 `dependencies`，待 S2.3 接入）；peggy 已移除。关键依据：端到端类型安全（peggy `parse()` 返回 `any`）、LL 错误定位贴近真实错误点、内建多错误恢复。
  - 前置：阶段 0。

- [x] **S2.2a 决定"扩展后的目标子集"（卡点·决策）** ✅ 2026-06-27 → 冻结表 `../specs/2026-06-27-dql-subset-frozen.md`（TASK+GROUP BY+FLATTEN 全纳入；函数集=日期+字符串+数值；CALENDAR/DataviewJS/FROM and-or 仍不做）
  - 目标：明确扩展边界，消解前置冲突。
  - 动作：在现 MVP 子集上逐项裁决纳不纳入：多键 SORT、GROUP BY、FLATTEN、WITHOUT ID、WHERE null、日期比较、函数集（contains 家族完整 + 最小内置函数）、**TASK 查询类型（候选，需定）**；明确 **CALENDAR / DataviewJS / FROM and-or 仍不做**（或定为后续）。
  - 验收：specs 有一张"扩展后子集"裁决表，每项标 纳入/不纳入/后续。
  - 证据：裁决表评审（自检：每个"纳入"项都能对到 SQL 策略）。
  - 前置：S2.1。

- [x] **S2.2b 同步更新真相源（卡点·防分叉）** ✅ 2026-06-27 → SKILL.md + research §3.1/§3.2 已同步扩展子集 + skills:install 重装；现有 query 测试无"应报错"冲突断言（52 绿）；新能力测试随 S2.3+ TDD 新增
  - 目标：真相源先于代码更新。
  - 动作：按 S2.2a 改写 `skills-def/biz-dql-subset/SKILL.md` 的"支持的子集/非目标"段 + research §3；`pnpm run skills:install` 重装；调整 `tests/query.test.ts` 中"非子集报错"断言到新边界。
  - 验收：skill、research、测试三者对新子集一致；`pnpm test tests/query.test.ts` 仍绿（断言已对齐）。
  - 证据：`pnpm run skills:install`；`pnpm test tests/query.test.ts`。
  - 前置：S2.2a。

- [x] **S2.2c 定义扩展后的 AST 类型** ✅ 2026-06-27 → `src/query/ast.ts`：`QueryType`+TASK、`sort` 单键→多键数组、新增 `groupBy/flatten/withoutId`；`sql-generator` 适配多键 ORDER BY；typecheck=0、测试 52 绿不回归。WhereExpr 细粒度（null/日期/内置函数）随 S2.15/S2.16/S2.17 各实现步增量加类型，避免半成品占位。
  - 目标：`src/query/ast.ts` 反映新子集。
  - 动作：扩展 `DqlQuery` 类型：sort 改多键数组、加 groupBy/flatten/withoutId 字段、WHERE 表达式补 null/日期/函数节点。
  - 验收：`typecheck` 通过；类型覆盖 S2.2a 全部"纳入"项。
  - 证据：`pnpm run typecheck`。
  - 前置：S2.2b。

---

## Part B · 用选定工具重写 tokenizer→parser（red→green）

- [x] **S2.3 tokenizer 全 token 覆盖** ✅ 2026-06-27
  - 目标：词法层覆盖所有记号。
  - 动作：先写 `tests/query-parser.test.ts` 词法用例；实现关键字(LIST/TABLE/FROM/WHERE/SORT/LIMIT/AND/OR/NOT/ASC/DESC/GROUP BY/FLATTEN…)、标识符、字符串、数字、操作符、`[[..]]`、`#tag`、`(`/`)`/`,`、函数名。
  - 验收：词法用例全绿；非法字符报带位置错误。
  - 证据：`src/query/tokens.ts`（chevrotain lexer）+ `tests/query-parser.test.ts` 19 词法用例全绿（含大小写不敏感、longer_alt 回退、GROUP BY/WITHOUT ID 多词关键字、unicode 标签、字符串/数字边界、错误定位）；71 测试全绿、typecheck=0。
  - 关键点：chevrotain 对 `\p{}` unicode pattern 首字符优化失配 → Tag 改自定义 matcher 函数（sticky 正则）。
  - 前置：S2.2c。

- [x] **S2.4 parser：查询头 LIST / TABLE(+fields) / TASK** ✅ 2026-06-27（`src/query/parser.ts` chevrotain EmbeddedActionsParser；WITHOUT ID 对齐 Dataview 置于字段前；LIST/TASK 接字段报错）
  - 动作：测试先行；解析 `LIST` 与 `TABLE f1, f2`，产出 AST 头。
  - 验收：两类查询头解析正确；TABLE 字段列表正确。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.3。

- [x] **S2.5 parser：FROM（#tag / "folder" / [[link]]）** ✅ 2026-06-27（三来源解析对齐旧语义；and/or 多源不解析→报错）
  - 动作：测试先行；解析三种来源到 AST.from。
  - 验收：三种来源解析正确；FROM and/or 按裁决报错或解析（依 S2.2a）。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.4。

- [x] **S2.6 parser：WHERE 表达式（比较/AND/OR/NOT/括号/函数调用）** ✅ 2026-06-27（优先级 OR<AND<NOT<primary，括号、函数调用；未知函数带位置报错；null/日期/内置函数留 S2.15–S2.17）
  - 动作：测试先行；解析比较、逻辑组合、括号优先级、函数调用 `fn(field,"arg")`。
  - 验收：优先级/结合性正确（含嵌套括号）；语法错误抛带位置 `DqlSyntaxError`。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.5。

- [x] **S2.7 parser：SORT（多键）/ LIMIT** ✅ 2026-06-27（多键 `SORT a ASC, b DESC` 解析为数组；LIMIT 数字。负数校验留 S2.13）
  - 动作：测试先行；解析 `SORT a ASC, b DESC` 多键与 `LIMIT n`。
  - 验收：多键顺序/方向正确；LIMIT 解析为数字。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.6。

- [x] **S2.8 端到端迁移：旧 query 测试跑通新引擎** ✅ 2026-06-27（`DataviewEngine` 切 `parseDql`；旧手写 `tokenizer.ts`/`ast.parseQuery` 已删，`DqlSyntaxError` 移 `errors.ts`；sql-generator 对 TASK/GROUP BY/FLATTEN/WITHOUT ID 诚实报「暂未实现」；全量 86 测试/typecheck/lint/build 全绿）
  - 目标：新 parser 接上 sql-generator + 执行。
  - 动作：把现有 `tests/query.test.ts` 11 例接到新引擎（red→green）。
  - 验收：旧端到端测试全绿（行为不回归）。
  - 证据：`pnpm test tests/query.test.ts`。
  - 前置：S2.7。

---

## Part C · 修已确认 query bug（red→green，每步一测）

- [x] **S2.9 LIKE 通配符转义（Q1）** ✅ 2026-06-27：`escapeLike` 转义 `%`/`_`/`\` + `ESCAPE '\'`；新建 `tests/sql-generator.test.ts` 单元测 contains/icontains/startswith/endswith。**附带修复 S2.8 回归**：chevrotain StringLiteral image 未解码转义 → `parser.unquote` 补 `\X→X` 解码（加 parser 用例锁定）。92 测试全绿。
  - 证据：`tests/sql-generator.test.ts` + `tests/query-parser.test.ts`。前置：S2.8。
- [x] **S2.10 icontains 大小写（Q2）** ✅ 2026-06-27：file.tags 的 icontains 用 LOWER 两侧（大小写不敏感）、contains 保持精确前缀；links 经 linkKey 已小写化。
  - 证据：`tests/sql-generator.test.ts`。前置：S2.8。
- [x] **S2.11 TABLE 重复列（Q3）** ✅ 2026-06-27：addCol 用 seen Set 去重（默认起头 file.name 与显式/重复字段不重复）。
  - 证据：`tests/sql-generator.test.ts`。前置：S2.8。
- [x] **S2.12 未知字段抛 DqlSyntaxError（Q4）** ✅ 2026-06-27：fieldToSql 未知字段改抛 `DqlSyntaxError`（非裸 Error）。
  - 证据：`tests/sql-generator.test.ts`。前置：S2.8。
- [x] **S2.13 SORT JSON 列报错 + LIMIT 负数校验** ✅ 2026-06-27：sort 命中 json 列抛 DqlSyntaxError；parser LIMIT `<0` 带位置报错（0 合法）。
  - 证据：`tests/sql-generator.test.ts` + `tests/query-parser.test.ts`。前置：S2.8。

---

## Part D · 补全子集（red→green，每子句一步；仅做 S2.2a 裁定"纳入"项）

- [x] **S2.14 多键 SORT** ✅ 2026-06-27：parser 产多键数组 + sql-gen 多列 ORDER BY（结构 S2.2c/S2.7 就位，本步补单元测）。
- [x] **S2.15 WHERE null 判断** ✅ 2026-06-27：WhereExpr 加 `isnull` 节点；`= null`/`!= null` → `IS NULL`/`IS NOT NULL`（不参数化 null）；其他比较符 + null 报错。
- [x] **S2.15b 裸字段真值 / 一元 `!`（isTruthy）** ✅ 2026-07-01：补正官方对标遗漏——词法加 `Bang` token（`!=` 仍归 `Op`）、AST 加 `truthy` 节点、`!field`=`not(truthy)`；`generateSql` 用 `json_type` CASE 复刻官方 `Values.isTruthy()`（null/0/空串/空数组/空对象/false 皆 falsy），与 `= null`/`!= null`（显式 null 比较）语义分离。TDD：token/AST/优先级/SQL-shape/端到端分歧（`flag:0`→`!flag` 无、`!=null` 有）逐项测；全量 428 绿 + 新增 18。设计 + 真相源同步（§7）见 [`../specs/2026-07-01-dql-truthiness-existence-design.md`](../specs/2026-07-01-dql-truthiness-existence-design.md)。
- [x] **S2.16 WHERE 日期比较** ✅ 2026-06-27：frontmatter 日期按 ISO 字符串字典序比较（= 日期序，无需特殊类型）；数值列 mtime/ctime 直接比较；区间过滤测试。**注**：task `due_date` 提取仍依赖阶段1 S1.3，届时复用本比较路径。
- [x] **S2.17 函数集完整** ✅ 2026-06-27：contains 家族（已 S2.9/S2.10）+ 内置标量 `lower/upper/length/round` 作比较左操作数（length 数组→json_array_length）+ `date(today)/date(now)` 求值 ISO 串作右值；parser 区分谓词 vs scalar 函数；逐函数单元测 + parser 行为/错误测。
- [x] **S2.18 GROUP BY** ✅ 2026-06-27：分组键 + `json_group_array(DISTINCT f.path) AS rows` + `GROUP BY`；端到端验证分组聚合。
- [x] **S2.19 FLATTEN** ✅ 2026-06-27：`FROM …, json_each(<arrayexpr>) AS _flat` 交叉展开 + 展开值列；非数组字段报错；端到端验证标签展开多行。固定子句顺序 WHERE 先于 FLATTEN。
- [x] **S2.20 WITHOUT ID** ✅ 2026-06-27：隐藏默认 file.name 列（LIST/TABLE）；单元测列集。
- [x] **S2.21 TASK 查询类型** ✅ 2026-06-27：`TASK [FROM][WHERE][LIMIT]` → tasks JOIN files 返回任务行（task.text/status/due + file.path）；FROM/WHERE 复用文件级过滤；端到端验证。task 字段级过滤为后续。

---

## Part E · 隐式字段、安全与收口

- [x] **S2.22 隐式字段全集核对** ✅ 2026-06-27
  - 动作：按真相源映射表逐字段核对 file.name/path/folder/extension/size/mtime/ctime、file.tags、file.inlinks、file.outlinks、file.tasks、frontmatter 标量；每个有测试；inlinks/outlinks **查询期 JOIN 实时计算**（硬约束第 6 条）。
  - 验收：每个隐式字段有用例；无物化缓存。✅ query.test.ts 加全集 TABLE 查询用例 + outlinks 实时计算用例。
  - 证据：`pnpm test tests/query.test.ts`。前置：S2.8。

- [x] **S2.23 注入与 ReDoS 安全复核** ✅ 2026-06-27
  - 动作：复核所有用户输入走参数化占位符（含新子句）；REGEXP 抽到 `regexp.ts` 的 `safeRegexpMatch` 加 pattern/value 长度上限缓解 ReDoS。
  - 验收：构造注入用例不破库；恶意正则超长输入不阻塞。✅ `tests/regexp.test.ts`（ReDoS 缓解）+ query.test 端到端注入用例。
  - 证据：`pnpm test`（regexp.test + query.test）。前置：S2.17。

- [x] **S2.24 DQL 覆盖矩阵收口（黑盒消除）** ✅ 2026-06-27
  - 动作：更新覆盖矩阵 §B 到实际；每个 ✅ 标注对应测试名/子步；明确剩余 ❌（CALENDAR/DataviewJS/FROM-and-or 范围外）；DQL 子集覆盖率更新到 ~95%。
  - 验收：矩阵无"声称支持但无测试"的格；与 skill/research 一致。✅ `specs/2026-06-26-coverage-matrix.md` §B 全量重写。
  - 证据：矩阵每行标测试；全量 132 测试 / typecheck / lint / build 全绿。
  - 前置：S2.14–S2.23 全部完成。

---

## 与父计划的衔接

- 本清单替代父路线图阶段 2 的 S2.1–S2.7（更细）；父路线图阶段 2 顶部应链到本文件。
- S3.4（kysely 收编 SQL）依赖本清单 S2.24 完成后再换底。
- 真相源纪律：任何子集变化先改 `skills-def/biz-dql-subset/SKILL.md` + research §3，再动代码（见前置冲突）。

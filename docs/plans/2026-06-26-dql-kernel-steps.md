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

- [ ] **S2.2a 决定"扩展后的目标子集"（卡点·决策）**
  - 目标：明确扩展边界，消解前置冲突。
  - 动作：在现 MVP 子集上逐项裁决纳不纳入：多键 SORT、GROUP BY、FLATTEN、WITHOUT ID、WHERE null、日期比较、函数集（contains 家族完整 + 最小内置函数）、**TASK 查询类型（候选，需定）**；明确 **CALENDAR / DataviewJS / FROM and-or 仍不做**（或定为后续）。
  - 验收：specs 有一张"扩展后子集"裁决表，每项标 纳入/不纳入/后续。
  - 证据：裁决表评审（自检：每个"纳入"项都能对到 SQL 策略）。
  - 前置：S2.1。

- [ ] **S2.2b 同步更新真相源（卡点·防分叉）**
  - 目标：真相源先于代码更新。
  - 动作：按 S2.2a 改写 `skills-def/biz-dql-subset/SKILL.md` 的"支持的子集/非目标"段 + research §3；`pnpm run skills:install` 重装；调整 `tests/query.test.ts` 中"非子集报错"断言到新边界。
  - 验收：skill、research、测试三者对新子集一致；`pnpm test tests/query.test.ts` 仍绿（断言已对齐）。
  - 证据：`pnpm run skills:install`；`pnpm test tests/query.test.ts`。
  - 前置：S2.2a。

- [ ] **S2.2c 定义扩展后的 AST 类型**
  - 目标：`src/query/ast.ts` 反映新子集。
  - 动作：扩展 `DqlQuery` 类型：sort 改多键数组、加 groupBy/flatten/withoutId 字段、WHERE 表达式补 null/日期/函数节点。
  - 验收：`typecheck` 通过；类型覆盖 S2.2a 全部"纳入"项。
  - 证据：`pnpm run typecheck`。
  - 前置：S2.2b。

---

## Part B · 用选定工具重写 tokenizer→parser（red→green）

- [ ] **S2.3 tokenizer 全 token 覆盖**
  - 目标：词法层覆盖所有记号。
  - 动作：先写 `tests/query-parser.test.ts` 词法用例；实现关键字(LIST/TABLE/FROM/WHERE/SORT/LIMIT/AND/OR/NOT/ASC/DESC/GROUP BY/FLATTEN…)、标识符、字符串、数字、操作符、`[[..]]`、`#tag`、`(`/`)`/`,`、函数名。
  - 验收：词法用例全绿；非法字符报带位置错误。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.2c。

- [ ] **S2.4 parser：查询头 LIST / TABLE(+fields)**
  - 动作：测试先行；解析 `LIST` 与 `TABLE f1, f2`，产出 AST 头。
  - 验收：两类查询头解析正确；TABLE 字段列表正确。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.3。

- [ ] **S2.5 parser：FROM（#tag / "folder" / [[link]]）**
  - 动作：测试先行；解析三种来源到 AST.from。
  - 验收：三种来源解析正确；FROM and/or 按裁决报错或解析（依 S2.2a）。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.4。

- [ ] **S2.6 parser：WHERE 表达式（比较/AND/OR/NOT/括号/函数调用）**
  - 动作：测试先行；解析比较、逻辑组合、括号优先级、函数调用 `fn(field,"arg")`。
  - 验收：优先级/结合性正确（含嵌套括号）；语法错误抛带位置 `DqlSyntaxError`。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.5。

- [ ] **S2.7 parser：SORT（多键）/ LIMIT**
  - 动作：测试先行；解析 `SORT a ASC, b DESC` 多键与 `LIMIT n`。
  - 验收：多键顺序/方向正确；LIMIT 解析为数字。
  - 证据：`pnpm test tests/query-parser.test.ts`。
  - 前置：S2.6。

- [ ] **S2.8 端到端迁移：旧 query 测试跑通新引擎**
  - 目标：新 parser 接上 sql-generator + 执行。
  - 动作：把现有 `tests/query.test.ts` 11 例接到新引擎（red→green）。
  - 验收：旧端到端测试全绿（行为不回归）。
  - 证据：`pnpm test tests/query.test.ts`。
  - 前置：S2.7。

---

## Part C · 修已确认 query bug（red→green，每步一测）

- [ ] **S2.9 LIKE 通配符转义（Q1）**：`%`/`_` 转义 + `ESCAPE` 子句；测 `contains(title,"50%")` 字面匹配。
  - 证据：`pnpm test tests/query.test.ts`（新增用例）。前置：S2.8。
- [ ] **S2.10 icontains 大小写（Q2）**：tags/inlinks/outlinks 的 icontains 真正大小写不敏感；测大小写命中。
  - 证据：同上。前置：S2.8。
- [ ] **S2.11 TABLE 重复列（Q3）**：`TABLE file.name, status` 不产生重复 `file.name` 列。
  - 证据：同上。前置：S2.8。
- [ ] **S2.12 未知字段抛 DqlSyntaxError（Q4）**：非子集字段抛带位置的 `DqlSyntaxError`（非裸 Error）。
  - 证据：同上。前置：S2.8。
- [ ] **S2.13 SORT JSON 列报错 + LIMIT 负数校验**：对聚合 JSON 列排序报错而非静默；`LIMIT -5` 报错。
  - 证据：同上。前置：S2.8。

---

## Part D · 补全子集（red→green，每子句一步；仅做 S2.2a 裁定"纳入"项）

- [ ] **S2.14 多键 SORT**：AST→`ORDER BY a ASC, b DESC`；测多键+方向。前置：S2.8。
- [ ] **S2.15 WHERE null 判断**：`field = null`/`!= null` → `IS NULL`/`IS NOT NULL`；测有无值。前置：S2.8。
- [ ] **S2.16 WHERE 日期比较**：ISO 字典序比较（含 frontmatter 日期与 due_date）；测区间过滤。前置：S2.8、(parser due_date 需阶段1 S1.3)。
- [ ] **S2.17 函数集完整**：contains/icontains/startswith/endswith 全字段类型正确 + S2.2a 裁定的最小内置函数；逐函数测。前置：S2.9。
- [ ] **S2.18 GROUP BY**：AST→SQL 聚合（分组列 + 聚合结果形态）；端到端测。前置：S2.8。
- [ ] **S2.19 FLATTEN**：展开数组字段为多行；端到端测。前置：S2.8。
- [ ] **S2.20 WITHOUT ID**：列控制（隐藏默认 id/file.name 列）；测列集。前置：S2.4。
- [ ] **S2.21 TASK 查询类型（若 S2.2a 纳入）**：`TASK FROM ...` 返回任务行形态；端到端测。前置：S2.8。

---

## Part E · 隐式字段、安全与收口

- [ ] **S2.22 隐式字段全集核对**
  - 动作：按真相源映射表逐字段核对 file.name/path/folder/extension/size/mtime/ctime、file.tags、file.inlinks、file.outlinks、file.tasks、frontmatter 标量；每个有测试；inlinks/outlinks **查询期 JOIN 实时计算**（硬约束第 6 条）。
  - 验收：每个隐式字段有用例；无物化缓存。
  - 证据：`pnpm test tests/query.test.ts`。前置：S2.8。

- [ ] **S2.23 注入与 ReDoS 安全复核**
  - 动作：复核所有用户输入走参数化占位符（含新子句）；REGEXP 自定义函数加长度上限/超时防 ReDoS。
  - 验收：构造注入用例不破库；恶意正则不阻塞。
  - 证据：`pnpm test tests/query.test.ts`（含注入/ReDoS 用例）。前置：S2.17。

- [ ] **S2.24 DQL 覆盖矩阵收口（黑盒消除）**
  - 动作：更新覆盖矩阵 §B 到实际；每个 ✅ 标注对应测试名；明确剩余 ❌（CALENDAR/DataviewJS）；给量化覆盖率。
  - 验收：矩阵无"声称支持但无测试"的格；与 skill/research 一致。
  - 证据：矩阵每行链到测试；`pnpm test tests/query.test.ts` 全绿。
  - 前置：S2.14–S2.23 全部完成。

---

## 与父计划的衔接

- 本清单替代父路线图阶段 2 的 S2.1–S2.7（更细）；父路线图阶段 2 顶部应链到本文件。
- S3.4（kysely 收编 SQL）依赖本清单 S2.24 完成后再换底。
- 真相源纪律：任何子集变化先改 `skills-def/biz-dql-subset/SKILL.md` + research §3，再动代码（见前置冲突）。

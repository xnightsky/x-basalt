---
type: plan
title: Bases 无头引擎 P1 计划（Markdown query vertical slice）
description: 落地 src/base/ 查询层：Chevrotain 表达式文法、值语义、函数白名单、预算解释器、BaseEngine.query()，覆盖场景矩阵 §4 P1 与 SEC-001/002/003/009
tags:
  - plan
  - bases
  - obsidian
  - headless
  - x-basalt
timestamp: 2026-07-26T16:13:57Z
sha256: 40c417ad28d438441ecda42704208bc7851e959355ea9609c21e539822c93f2c
---
# 计划：Bases 无头引擎 P1 · Markdown query vertical slice

> 2026-07-26 · 来源：根 `TODO.md`「Obsidian Bases 无头执行引擎」P1 项；前置 P0 计划 [`2026-07-26-bases-p0-document-schema.md`](2026-07-26-bases-p0-document-schema.md)（已 ✅）。
> 设计真相源：[`../specs/2026-07-22-bases-headless-engine-design.md`](../../design/bases-engine.md) §3/§4/§7/§8/§9/§10/§12；语法真相源：[`../specs/2026-07-26-bases-syntax.md`](../../design/bases-syntax.md)；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../../design/bases-scenarios.md) §4/§7。

## 目标与范围

在 P0 文档层之上交付可执行的 `BaseEngine.query()`：对当前 SQLite 索引中的 Markdown 笔记，指定 `.base` view 返回行/列（conformance id `bases-markdown-2026-07`）。覆盖场景矩阵 §4 P1 表（除「非目标」列出的 oracle 冻结项）与安全项 `BASE-SEC-001/002/003/009`。

交付物（均在 `src/base/` 内新增，复用 P0 文档层）：

- `tokens.ts` + `parser.ts`：Chevrotain 表达式文法（设计 §7 字面量/属性引用/运算符优先级），独立于 DQL token/AST，不共用。
- `values.ts`：typed equality / truthiness / compare + `MISSING` sentinel（读时不塌成 null）。
- `functions.ts`：白名单注册表（name/receiver/arity/return type/实现/场景编号），名字集合复用 `expressions.ts` 的 `BASE_FUNCTION_NAMES`。
- `source.ts`：SQLite → `BaseRow`（复用 files/tags/links 表，只读、参数化；不合入 Dataview inline fields）。
- `planner.ts`：view 选择 + global/view filter 外层 AND 合并。
- `evaluator.ts`：带 `BaseExecutionLimits` 预算的纯 AST 解释器，禁 `eval`/`new Function`。
- `engine.ts`：`BaseEngine.query()/close()`，契约按设计 §4。
- `tests/fixtures/bases/p1/` fixture vault + `tests/base-*.test.ts` 场景测试（注释标编号）。

## 非目标（防止范围蔓延）

- **不改** `src/query/` 与既有 DQL 语义（files 表 .md-only 数据集不变）；不加 CLI 命令；不写任何 vault 文件。
- **不做** SQL predicate 下推：一次读候选 Markdown 行、evaluator 内存过滤（设计 §10）。
- oracle 冻结项（不在本期，代码显式拒绝或标注暂定）：
  - `BASE-PROP-004`（missing/null/空串/0/false/空列表的精确 truthiness 合并）；
  - `BASE-RESULT-002` 的 null 排序位置；
  - 空 filter 数组语义（`and:[]`/`or:[]`/`not:[]`）——遇空数组直接报 `base/unsupported-feature` 并注明待 oracle；
  - `if()` lazy branch 验证——按设计暂定 lazy 实现，注释/状态文档标注待 oracle。
- P2/P3 全部（types.json、formulas、group/summary、today/now、list 高阶、all-files、`this`、附件数据集）。

## 关键取舍（实现前拍板）

1. **AST 落点**：`BaseExpr` AST 节点类型放 `types.ts`（延续 P0「文档类型集中一处」的既有模式，设计 §3 的 `ast.ts` 不再单建）；runtime value / `MISSING` sentinel 放 `values.ts`；`BaseExecutionLimits`（设计 §12 全量）放 `types.ts`，P0 的 `BaseDocumentLimits` 保持不动。
2. **表达式解析时机**：`BaseFilter.expr` 仍存原始字符串（P0 结构不动），planner 在 query 时逐条解析为 AST 并缓存；解析失败产 `base/expression-syntax`（error，位置 = YAML scalar 起点 + 表达式内 offset，沿用 P0 换算）。
3. **Chevrotain 用法**：只借鉴 `src/query/` 的 Chevrotain 写法惯用法，token/AST 两套完全独立；不复用 DQL 任何 token（DQL `=`/`AND`，Bases `==`/`&&`），错误提示指向 Bases 语法文档。
4. **文法子集**（设计 §7）：literal（null/boolean/number/单双引号字符串/list）、property-ref（裸属性/`note.x`/`note["…"]`/`file.x`/Unicode 名）、一元 `!`、二元 `&& || == != < > <= >=`、括号、白名单函数/方法调用、只读属性/索引访问。无算术、无负数字面量、无 regex、无 duration。`formula.*` → `base/unsupported-feature`；`this` → `base/dynamic-context-required`；未知 file 属性 → `base/unknown-property`（errors.ts 增补 rule 常量，纯增量）。
5. **值语义暂定项**（注释 + 状态文档标「待 oracle」）：truthiness 暂定 falsy = `MISSING`/`null`/`false`/`0`/`""`/空列表，其余 truthy（`BASE-PROP-004` 冻结前不定精确合并）；排序时 null/missing 暂定恒排最后（与方向无关，`BASE-RESULT-002` null 位置冻结前不定），测试只锁定多键优先级/方向/稳定 tie-break。
6. **file 属性映射**（`source.ts`，设计 §10）：`note`/`file.properties` ← `files.frontmatter` JSON（只读解析，不信任原型键）；`file.path/folder/ext/size/ctime/mtime` ← files 列；`file.basename` ← `files.name`（无扩展名），`file.name` ← basename+ext（带扩展名，与 `basename` 并存由此区分）；`file.tags` ← tags 表聚合（含 frontmatter + inline）；`file.links` ← links 表按 source 聚合（含 embed）。ctime/mtime 输出 epoch 毫秒 number（P1 无 Date runtime value）。
7. **file 方法语义**：`hasTag(t)` = 精确或嵌套前缀（`area` 命中 `area` 与 `area/x`），大小写不敏感（口径固定，注释标注）；`hasLink(t)` 复用 DQL 路径感知键（`utils/path` 的 `linkKey`/`pathKey`：含 `/` 按 `target_path_key` 精确，否则 `target_key` basename 回退），在内存中对行内 links 判定，不入 SQL；`inFolder(f)` 命中目录本身及子目录、不命中前缀同名目录；`hasProperty(k)` 只判 frontmatter own key 存在，不看值 falsy。
8. **安全**：SQL 全部参数化（行读取无用户输入拼接；`BASE-SEC-003/009`）；属性访问仅 own property，禁 `__proto__`/`prototype`/`constructor`（`BASE-SEC-001`）；任意标识符调用在文法层拒绝（`BASE-SEC-002`）；frontmatter JSON 解析产物经安全包装（不暴露 host 原型）。
9. **预算默认值**（`BaseExecutionLimits`，fixture 校准，均硬上限）：`maxRows = 100_000`、`maxOperations = 1_000_000`、`maxCallDepth = 64`、`maxCollectionItems = 10_000`；文档层四项沿用 P0（`maxExpressionNodes` 语义升级为 AST 节点数，parser 侧计数）。每次 AST 节点求值/函数调用/列表元素比较/行过滤扣 operations；耗尽抛内部 BudgetError，engine 转 `base/execution-budget`（error）+ 空结果，不返回部分结果。
10. **engine 错误口径**：`query()` 不 throw——加载/选择/解析/求值任一 error 级诊断即返回 `rows=[]/total=0/columns=[]` + 全量诊断（设计 §11「error 阻止结果」）；warning/info 随结果返回。`base/markdown-only-dataset`（warning）每次查询恒发，声明 md-only conformance 与附件差异（`BASE-DATA-001/002`）。
11. **结果契约**：columns = view.order 逐项原文（缺失时默认 `["file.name"]`）；row 以 column 原文为 key、missing 投影为 null；`total` = filter 后 limit 前行数；未显式 sort 按 `file.path ASC` tie-break 并给 info diagnostic；sort 多键稳定执行、最终 `file.path` 兜底 tie-break；输出值只含 JSON 可序列化形状（无类实例）。
12. **测试组织**：fixture vault `tests/fixtures/bases/p1/`（多 frontmatter 形态/嵌套 tag/链接/子目录/附件文件），用 `VaultIndexer.rebuild()` 建临时库后只读查询（沿用 `tests/query.test.ts` 模式）；每个 `BASE-*` 编号独立用例并注释标号；字节稳定 = 同 DB+Base+clock 两次 `JSON.stringify(query())` 全等专项用例。

## 停点（触发即停下报告，不猜测补齐）

- 需要改既有 DQL 数据集 / files 表语义；
- P1 场景超三分之一依赖附件数据集、动态 `this`、不可稳定观测的闭源语义（设计 §14 / 调研 §9 杀死条件）；
- 需要重建索引 / 改 tokenizer（指 DQL 侧）。

## 验证口径（完成定义）

- 场景矩阵 §4 P1 表除 oracle 排除项外每号独立测试通过（注释标编号）；`BASE-SEC-001/002/003/009` 通过；字节稳定专项用例通过。
- `pnpm run typecheck`、`pnpm test` 全绿；触碰文件 `oxfmt --check` + `oxlint` 0 告警。
- `docs/testing/2026-07-26-bases-implementation-status.md` 对应行翻 ✅ 标日期；本计划附验证结论；改动文档过 `x-basalt meta apply llm-wiki` dogfood + `x-basalt lint --profile llm-wiki docs`。
- 落盘前自查 AGENTS.md 硬约束：无 `obsidian` import、无 `obsidian://`、无 `eval`/`new Function`、SQL 参数化、只经 fs 读、不写 vault 文件。

## 验证结论（2026-07-26）

**交付**：`src/base/` 新增 `tokens.ts`/`parser.ts`（Chevrotain 文法，独立于 DQL）、`values.ts`（MISSING/typed equality/truthiness/compare/safeGetOwn）、`functions.ts`（24 注册项，模块加载即与 `BASE_FUNCTION_NAMES` 一致性自检）、`evaluator.ts`（三项预算 + 行级错误）、`source.ts`（SQLite→BaseRow，三条零拼接只读 SQL）、`planner.ts`（view 选择 + filter AND 合并 + 空数组拒绝）、`engine.ts`（`BaseEngine.query()/close()`，契约按设计 §4）；`errors.ts` 增量补 `unknownProperty`/`dynamicContextRequired`/`markdownOnlyDataset`/`propertyTypeMismatch`/`defaultSortTiebreak`；fixture `tests/fixtures/bases/p1/`（vault 7 篇 note + 附件 + 12 个 .base；vault-b 多根）；测试 `tests/base-expression.test.ts`（14）/`base-evaluator.test.ts`（29）/`base-engine.test.ts`（31），用例注释标场景编号。

**已验证项**（全部实际运行）：

- 场景矩阵 §4 P1 表除 oracle 排除项外每号独立测试通过：BASE-VIEW-001..004、DATA-001..004、PROP-001/002/003/005、FILE-001..005、EXPR-001..005、RESULT-001..004；安全项 BASE-SEC-001/002/003/009 通过（P0 已覆盖 SEC-007/008）。
- 字节稳定专项：同 DB+Base+clock 两次 `JSON.stringify(query())` 全等（2 个 base 各一条用例 + 基准脚本复核 stable=true）。
- 空 filter 数组 → `base/unsupported-feature`（注明待 oracle）；预算耗尽 → `base/execution-budget` + 空结果，不返回部分行。
- `pnpm run typecheck` 通过；`pnpm test` 700 pass / 0 fail（全量零回归）；触碰代码文件 `oxfmt --check` 全过、`oxlint` 0 告警。
- 基准（矩阵 §9「只记录不承诺」，脚本 `.tmp/bench-bases-p1.mts` 一次性运行）：n=1 index 27ms / query 11.1→1.1ms；n=100 index 85ms / query 3.9→1.4ms；n=10000 index 7131ms / query 68.4→40.2ms（total=3334，字节稳定）。10,000 篇内存过滤亚百毫秒，**无需 SQL predicate 下推**（设计 §10 门槛未触发）。

**实现期拍板记录**（已落入代码注释/本文档，未改设计）：

- parser 嵌套深度单列上限 `min(maxNodes, 128)`（实测括号不产 AST 节点、节点预算挡不住栈溢出；128 层留约 30% 栈余量）。
- 行级运行时类型错误 severity = warning（error 会触发「任何 error 即空结果」短路，与「该行不通过、查询继续」契约冲突），复用 rule `base/property-type-mismatch`。
- 新增 info rule `base/default-sort-tiebreak`（已同步设计 §11）。
- `file.ext` 无扩展名时为空串；投影到 `file` 根值时序列化为 path 字符串（边缘情形）；tags 聚合去重保序。
- 行级诊断上限 100 条，超出补汇总诊断（防洪）。

**未验证项**：

- oracle 冻结项全部维持暂定：BASE-PROP-004 truthiness 合并（暂定 falsy=MISSING/null/false/0/""/空列表）、BASE-RESULT-002 null 排序位置（暂定恒排最后）、空 filter 数组语义（P1 拒绝）、`if()` lazy（暂定 lazy）——待官方串行 oracle 校正。
- 引号包裹 scalar 内表达式的诊断列号为近似值（planner 模块头已声明）；order/sort 列表达式诊断锚定 view.span（P0 未记录逐项位置）。
- `contextFile`/`clock` 入参接受但 P1 不消费（`this` 报 dynamic-context-required；today/now 属 P2）。

**剩余风险**：函数注册表与 `BASE_FUNCTION_NAMES` 靠模块加载自检防漂移；oracle 校正时暂定口径的测试需按官方结果改写。

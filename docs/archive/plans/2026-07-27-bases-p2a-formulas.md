---
type: plan
title: Bases P2a 计划（typed formulas 核心）
description: Date/Duration/Link runtime values + 算术 + duration 字面量 + formulas 依赖图/cycle + today/now clock 注入，覆盖 BASE-FORM-001..006 与 SEC-006
tags:
  - plan
  - bases
  - formulas
  - x-basalt
timestamp: 2026-07-26T18:58:21Z
sha256: 6670b5c29ae290d7257b8487100f81ce8068bba6053b9513d172bef24272d9dd
---
# 计划：Bases P2a · typed formulas 核心

> 2026-07-27 · 来源：根 `TODO.md`「Obsidian Bases 无头执行引擎」P2 项的第一片；前置 P1 计划 [`2026-07-26-bases-p1-markdown-query.md`](2026-07-26-bases-p1-markdown-query.md)（✅）、CLI 薄出口 [`2026-07-27-bases-cli-export.md`](2026-07-27-bases-cli-export.md)（✅）。
> 设计真相源：[`../specs/2026-07-22-bases-headless-engine-design.md`](../../design/bases-engine.md) §13 P2 顺序 1-3/6；语法真相源：[`../specs/2026-07-26-bases-syntax.md`](../../design/bases-syntax.md) §5/§6；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../../design/bases-scenarios.md) §5/§7。

## 目标与范围

P2 第一片：**typed runtime values + 算术 + formulas 段执行 + clock 注入**，让官方示例级公式可跑：

```yaml
formulas:
  age: (now() - file.ctime) / 1day
```

覆盖场景：BASE-FORM-001（常量与简单算术公式）/ FORM-002（引用 note/file 属性）/ FORM-003（引用另一公式，拓扑排序不依赖 YAML 键序）/ FORM-004（公式循环 → `base/formula-cycle` 含完整循环链）/ FORM-005（公式运行时类型错误行级诊断）/ FORM-006（`today`/`now` 注入 clock，重复运行完全一致）；安全项 BASE-SEC-006（公式依赖图超大/超深 → 节点与深度上限，错误含依赖路径）。

## 非目标（P2b/P3，不在本片）

- `.obsidian/types.json` 读取（BASE-TYPE-001..003）→ P2b。
- list 高阶 `filter/map/reduce/flat/sort/unique/join`（BASE-LIST-001 / SEC-005）→ P2b。
- `groupBy` / `summaries`（BASE-GROUP-001/002、SUM-001/002）→ P2b；`cards` 等仍拒绝。
- Link/File **构造字面量**（语法 §4.3「P2 评估」→ 评估结论：本片不做，无真实需求；frontmatter wikilink 值 → Link 的机制见取舍 #4）。
- regex（BASE-SEC-004，P2 最后评估）、`backlinks`、附件、`this`。
- oracle 冻结项本片仍只做暂定机制（见取舍 #3/#4），断言待官方 oracle。

## 关键取舍（实现前拍板）

1. **文法扩展（tokens/parser，增量不改 P1 行为）**：二元算术 `+ - * /`（优先级：`* /` 高于 `+ -`，均高于比较 `< > <= >=`，一元 `-` 支持负数字面量与取负）；duration 字面量 `<number>(millisecond|second|minute|hour|day|week|month|year)`（含复数形态，词法层单 token，对齐官方 duration 单位表）；`today`/`now` 加入 `BASE_FUNCTION_NAMES`（expressions.ts 单一真相源追加，注册表同步扩）。P1 既有 token/AST 节点不变。
2. **runtime values（values.ts 扩）**：新增品牌化 `BaseDateValue`（date / datetime 两态，内部 epoch 毫秒 + 原始精度标记）、`BaseDurationValue`（epoch 毫秒长度）、`BaseLinkValue`（path/display?/subpath?）。输出序列化按设计 §4 `BaseOutputValue`：`{ type: "date"|"datetime", value: <ISO 串> }`、`{ type: "link", path, display?, subpath? }`。算术语义：number 四则；`date/datetime ± duration`；`datetime - datetime → duration`；`duration * / number`；其余组合 → 行级类型错误（注释写清允许矩阵）。
3. **日期解析与比较**：严格 ISO（`YYYY-MM-DD` → date；`YYYY-MM-DDTHH:mm[:ss]` → datetime）从 frontmatter 字符串推断（语法 §5.1 第 3 条）；比较按 epoch；**date vs datetime 跨精度比较的语义暂定**（统一到 UTC epoch 比较，注释标待 oracle BASE-TYPE-005）；ctime/mtime（epoch ms number）在算术语境包装为 datetime。
4. **frontmatter wikilink → Link value**：frontmatter 字符串值形如 `[[target]]` / `[[target|display]]`（含 `#subpath`）时解析为 BaseLinkValue（复用 `utils/path` 键做路径感知相等）；**暂定机制，行为待 oracle BASE-TYPE-006**。Link equality 按解析后 path（+subpath）。
5. **formulas 段（document 层）**：`formulas` 从 `UNSUPPORTED_FEATURE_KEYS` 移出，解析为 `Record<string, { expr: string; span: SourceSpan }>`（结构校验：值必须是表达式字符串；`summaries`/`groupBy` 仍 `base/unsupported-feature`）。formula 属性经 `formula.name` 引用；`formula.*` 从「文法层拒绝」改为可求值。
6. **依赖图与循环（planner 新增）**：收集公式间 `formula.x` 引用建图，拓扑排序（不依赖 YAML 键序，FORM-003）；循环 → `base/formula-cycle`（error，message 含完整循环链，FORM-004）；图节点数/深度上限并入预算（SEC-006，错误含依赖路径）。求值按拓扑序逐公式缓存结果（每行每公式至多求值一次）。
7. **`today()`/`now()`（evaluator + functions.ts）**：消费 `BaseQueryOptions.clock`（P1 已接受未消费；缺省 `() => new Date()`）；`today()` → 当日 00:00 的 date，`now()` → datetime；测试必须注入固定 clock（FORM-006：同 clock 重复运行字节一致——复用字节稳定测试口径）。
8. **行级错误（FORM-005）**：公式求值类型错误 → 该 cell 输出行级 warning 诊断（复用 P1 口径）+ cell null；filter 中公式类型错误 → 该行不通过。公式**不**因单行错误中止整个查询。
9. **输出与排序**：含 Date/Duration/Link 的列序列化为稳定 JSON（无类实例泄漏）；sortKeyCompare 扩 date/datetime（epoch 可比）与 duration（长度可比），link 不可比（排序报行级错误）；null/missing 暂定口径不变（仍待 oracle）。
10. **测试口径**：fixture 复用 `tests/fixtures/bases/p1/vault` 增量补（含 formulas 的 .base + 含日期/wikilink frontmatter 的 note）；FORM-001..006、SEC-006 每号独立用例标编号；`today/now` 用例注入固定 clock 断言完全一致；含负边界（循环链 message 内容、超深公式图、类型错误 cell null、非法 duration）。

## 停点

- 需要改 P1 已定契约（`BaseQueryResult` 形状、既有诊断语义）才能落地 → 停下回报；
- formulas 与 DQL 侧产生耦合需求（共享 AST/执行）→ 停下回报（设计 §14 禁 .base→DQL 翻译器）；
- 发现官方 duration/date 语义大面积不可稳定观测 → 退回只交付 FORM-001..004 并标注。

## 验证口径（完成定义）

- BASE-FORM-001..006、BASE-SEC-006 每号独立测试通过（注释标编号）；含 clock 注入一致性用例。
- `pnpm run typecheck`、`pnpm test` 全绿；触碰代码文件 `oxfmt --check` + `oxlint` 0 告警。
- 状态文档 §4 对应行翻 ✅（本片范围）；语法文档对应标记翻【P2a ✅】；本计划附验证结论；改动文档 dogfood + `x-basalt lint --profile llm-wiki docs`。

## 验证结论（2026-07-27）

**交付**：文法扩算术 `+ - * /` / 一元 `-` / duration 字面量（单复数单位表）；`BASE_FUNCTION_NAMES` 加 `today`/`now`；values.ts 新增 Date/Duration/Link 品牌值 + 严格 ISO 日期推断 + wikilink→Link + 算术允许矩阵（含 `duration/duration → number`）；document.ts `formulas` 段解析（结构校验 + 浅扫描，`summaries`/`groupBy` 仍拒绝）；planner Kahn 拓扑 + `base/formula-cycle` 完整循环链 + `maxFormulaNodes 256`/`maxFormulaDepth 64`（SEC-006）；evaluator 算术/duration/`formula.*` 接线（每行惰性求值 + 缓存，未被引用公式不求值）；engine clock 全链路 + 投影走 `toOutputValue`。fixture 新增 `tests/fixtures/bases/p1/vault-formula/`（3 .md + 3 .base）；测试 `tests/base-values-date.test.ts`（21）+ `tests/base-formula.test.ts`（10）。

**已验证项**（全部实际运行）：

- BASE-FORM-001..006、BASE-SEC-006 每号独立用例通过（注释标编号）；循环链 message、超深公式图、类型错误 cell null、非法 duration 等负边界在列。
- FORM-006：注入固定 clock 两次 query 字节一致；不同 clock 结果不同。
- `pnpm run typecheck` 通过；`pnpm test` 全量 **738 pass / 0 fail**（P0/P1 零回归）；触碰代码文件 `oxfmt --check` 全过、`oxlint` 0 告警。
- 官方示例 `(now() - file.ctime) / 1day` 形态公式 e2e 可跑。

**实现期拍板记录**：

- fixture 放兄弟目录 `vault-formula/` 而非 `p1/vault`（新 .md 会改变 P1 全量行数断言，与零回归约束冲突）。
- 算术矩阵补 `duration / duration → number`（官方示例必需；无量纲比值，除零仍类型错误）。
- frontmatter 日期一律加引号写 fixture（gray-matter 会把未加引号日期解析为 Date，落库 JSON 带 `.000Z` 后缀，超出严格 ISO 形态不升级——注释已写明）。
- 算术中 MISSING 短路传播、null 进矩阵报错（暂定，注释标待 oracle）；note 字符串升级在 evaluator 读取单点（比较两侧对称升级），`file.properties` 保持原始不升级（BASE-PROP-005 不回归）。
- 公式按需（惰性）求值而非一律按拓扑序全量：未被引用的公式不产生行级诊断。

**未验证项**：date vs datetime 跨精度比较（BASE-TYPE-005）与 frontmatter wikilink→Link（BASE-TYPE-006）的**官方语义**——暂定机制已落，待 oracle（并入既有 oracle runbook 的校正范围）。

**剩余风险**：duration month/year 固定换算（30/365 天）为约定值，若 oracle 显示官方按日历换算需调整；无其他新增风险。

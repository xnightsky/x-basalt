---
type: testing
title: Bases P1 争议语义官方 oracle 操作手册
description: 四项暂定口径（truthiness/null 排序/空 filter 数组/if lazy）的官方串行 oracle：fixture vault、13 个 view 逐步执行、观察记录表与校正工作流
tags:
  - testing
  - bases
  - oracle
  - conformance
timestamp: 2026-07-26T17:13:57Z
sha256: f0e8c4a123b8efb3f1d8f0842235addaf42a0da1755ebb228eaa50cb107727dd
---
# Bases P1 争议语义官方 oracle 操作手册（runbook）

> 2026-07-27 · 协议真相源：[`2026-07-22-bases-scenario-matrix.md`](2026-07-22-bases-scenario-matrix.md) §8（本手册是其逐步具体化，不替代协议）。
> 用途：把 P1 四项「暂定口径」一次跑完官方串行 oracle，校正 x-basalt 语义与锁定测试。
> **执行者：用户侧人工**（官方 `base:query` 依赖 Obsidian GUI；项目硬约束禁 GUI 自动化，本手册全部步骤只能人工串行执行）。

## 1. 待冻结语义与 x-basalt 暂定口径

| # | 争议语义 | 场景编号 | x-basalt P1 暂定口径 | oracle fixture |
| --- | --- | --- | --- | --- |
| ① | missing/null/空串/0/false/空列表 truthiness 与 == 合并 | BASE-PROP-004 | falsy = MISSING/null/false/0/""/空列表；`missing == null` 为 false | `views/truthiness.base`（8 个 view） |
| ② | 多键 sort 的 null/missing 位置 | BASE-RESULT-002 | null/missing 恒排最后（与方向无关） | `views/sort-null.base`（ASC/DESC 各一） |
| ③ | `if()` lazy branch | 设计 §9 | lazy：只计算被选择分支 | `views/if-lazy.base`（2 个 view） |
| ④ | 空 filter 数组 and/or/not | 设计 §6 | P1 拒绝（`base/unsupported-feature`） | `views/empty-filter.base`（3 个 view） |
| ⑤ | date vs datetime 跨精度比较 | BASE-TYPE-005 | 统一按 UTC epoch 比较（P2a 落地） | `views/types.base`（date-eq-literal / date-lt-datetime / datetime-lt-date） |
| ⑥ | frontmatter wikilink → Link 值与相等 | BASE-TYPE-006 | `[[t]]`/`[[t\|d]]`/`[[t#sub]]` → Link value，按 path+subpath 相等（P2a 落地） | `views/types.base`（link-eq-wikilink / link-projection） |
| ⑦ | list/tag 分组键一行多组 | BASE-GROUP-002 | 暂定拒绝（`base/unsupported-feature`，P2b 落地） | `views/group-summary.base`（group-by-tags / group-by-list-prop） |
| ⑧ | 自定义 summary 的 `values` 边界（空值剔除 / limit 前后） | BASE-SUM-002 | 暂定剔除 null/missing、按 limit 前全量（P2b 落地） | `views/group-summary.base`（summary-custom / summary-custom-limited） |

## 2. 前置（一次性）

1. 记录 Obsidian installer 与 App 版本：`__________`（填入观察表）。
2. 把 `tests/fixtures/bases/oracle/` **整个目录复制为独立 vault**（不用日常 vault；确认无社区插件、无其他 .base）。
3. 记录 fixture hash（在仓库根执行，填入观察表）：
   - `git hash-object tests/fixtures/bases/oracle/views/*.base tests/fixtures/bases/oracle/notes/*.md`
4. 预先启动 Obsidian 打开该 vault，**确认索引完成**（状态栏无 indexing 提示）。

## 3. 串行执行（逐 view，不并发）

对每个 `.base` 的**每个 view** 依次执行（串行、不让命令负责拉起 GUI）：

1. 运行 `base:query`（view 名见下表），保存：原始 JSON、stderr、退出码。
2. 每个 view **连跑两次**，确认结果一致；不一致即标 `implementation-defined`（协议 §8 第 7 条，不得靠单次观察冻结强结论）。

view 清单（22 个）：truthiness.base × 8（truthy-missing / truthy-explicit-null / truthy-empty-string / truthy-zero / truthy-false / truthy-empty-list / eq-missing-null / eq-explicit-null-null）、sort-null.base × 2（sort-asc / sort-desc）、if-lazy.base × 2（if-lazy / if-lazy-false-branch）、empty-filter.base × 3（empty-and / empty-or / empty-not）、types.base × 5（date-eq-literal / date-lt-datetime / datetime-lt-date / link-eq-wikilink / link-projection，P2a 新增，样本 CaseE）、group-summary.base × 4（group-by-tags / group-by-list-prop / summary-custom / summary-custom-limited，P2b 新增，样本 CaseF 与 CaseB/C）。

## 4. 观察记录表（跑完逐项填写）

### ① truthiness / equality（样本：CaseA 六形态显式值；CaseB/C 这些属性缺失；CaseD 全缺）

| view | 官方命中行（file.name 列表） | 两次一致？ | 结论（truthy? == 合并?） |
| --- | --- | --- | --- |
| truthy-missing | | | |
| truthy-explicit-null | | | |
| truthy-empty-string | | | |
| truthy-zero | | | |
| truthy-false | | | |
| truthy-empty-list | | | |
| eq-missing-null | | | |
| eq-explicit-null-null | | | |

### ② null 排序位置（CaseA sortable=null、CaseB=1、CaseC=2、CaseD 缺失）

| view | 官方行序（file.name 顺序） | 两次一致？ | 结论（null/missing 位置） |
| --- | --- | --- | --- |
| sort-asc | | | |
| sort-desc | | | |

### ③ if() lazy

| view | 官方结果/错误 | 两次一致？ | 结论（lazy? eager 污染形态） |
| --- | --- | --- | --- |
| if-lazy | | | |
| if-lazy-false-branch | | | |

### ④ 空 filter 数组

| view | 官方命中行数/错误 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| empty-and | | | |
| empty-or | | | |
| empty-not | | | |

### ⑤⑥ date/datetime 比较与 wikilink → Link（P2a 新增，样本 CaseE）

| view | 官方结果 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| date-eq-literal | | | |
| date-lt-datetime | | | |
| datetime-lt-date | | | |
| link-eq-wikilink | | | |
| link-projection | | | |

### ⑦⑧ list 分组键与自定义 summary values（P2b 新增，样本 CaseF / CaseB/C）

| view | 官方结果 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| group-by-tags | | | |
| group-by-list-prop | | | |
| summary-custom | | | |
| summary-custom-limited | | | |

## 5. 校正工作流（拿到结论后）

1. 定位需改写的锁定测试（全部带「待 oracle」标注）：
   - `rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`
   - 语义实现落点：`src/base/values.ts`（truthiness/equality/sortKeyCompare）、`src/base/evaluator.ts`（if lazy）、`src/base/planner.ts`（空数组拒绝）。
2. 按官方结论改写实现与测试，**删除对应「待 oracle」标注**，状态文档 [`2026-07-26-bases-implementation-status.md`](2026-07-26-bases-implementation-status.md) §3 对应行翻 ✅。
3. 若某 view 两次结果不一致 → 该语义标 `implementation-defined`：x-basalt 维持暂定口径并注释「官方不稳定」，测试只锁定 x-basalt 自一致性。
4. 原始 JSON/stderr/版本/hash 随校正提交一并留存（放 `docs/testing/oracle/` 新建日期目录）。

## 6. 红线

- 原始 App 输出**不是** x-basalt 公共 API；结论必须人工审查后才转期望快照。
- oracle 跑不通（官方 CLI 拉起失败/输出不稳定）时，不猜测补齐——维持暂定口径，状态文档保持 ⏸。

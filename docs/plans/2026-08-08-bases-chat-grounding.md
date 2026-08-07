---
type: plan
title: Bases chat 语法接地与 A/B 复跑计划
description: 补齐 chat 的 Bases 语法真相源、分页契约与错误观测，并以三轮 A/B 门槛决定动态 base 路线是否继续
tags:
  - plan
  - chat
  - bases
  - evaluation
timestamp: 2026-08-07T17:23:59Z
sha256: afa022fe631e6bcf01d2eaf1f4ef6cd8bb9197e80ad7174a8ed4d946351f27b6
status: active
---
# Bases chat 语法接地与 A/B 复跑计划

> 日期：2026-08-08 · 状态：active
> 上游计划：[`2026-08-03-chat-cli-tool.md`](./2026-08-03-chat-cli-tool.md)
> 触发：真实 chat A/B 已完成；动态 base 的生成可靠性、重试成本与步数预算显著落后于 DQL。

## Goal

先修复 chat 对 Bases 语法“无可机读真相源、只能靠 diagnostics 试错”的接地缺口，再用完全相同的配对场景复跑。只有复跑指标达到门槛，才保留“动态 base 可能比 DQL 更可靠”的路线假设。

## 为什么优先于 pipeline 间歇失败

- Bases 问题已稳定复现，失败位置和恢复轨迹可观测；pipeline 仅有一次未记录用例名的红，尚无可执行根因。
- 当前 A/B 中 DQL 12/12 通过，base 7/12；base 平均重试 7.17 次、撞顶 25%、error-storm 16.7%，平均 token 约为 DQL 的 9.5 倍。
- 4 对 DQL/base 确定性真值始终一致，说明问题集中在模型生成/接地层，不是 base 引擎答案错误。

## Non-goals

- 本切口不扩 Bases 引擎语法、公式、分组或数据集能力。
- 不把 `.base` 文法塞回 `obsidian-base-spec`；两篇分工必须保持独立。
- 不先改 `cli` 工具的 `{ args, source }` 输入 schema。先验证“补真相源”是否足够；结构化 tool input 是复跑失败后的备选路线。
- 不因单一模型基线宣称所有模型都会得到相同结果。

## Decision Log

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-08-08 | 新增独立 Bases 运行时 skill | 现有 `obsidian-base-spec` 明确只覆盖 Markdown/DQL；继续往里面塞会破坏召回分工 |
| 2026-08-08 | 先修提示中的 base 分页漂移，不实现新分页能力 | 当前 CLI 不接受 `--size/--offset`；chat 把 query/search/base 并列描述为可分页会诱导无效调用 |
| 2026-08-08 | trace 保留 tool-error 的 message/code/classification | 当前 Error 序列化接近空对象，根因只能从模型自述反推，削弱评估证据 |
| 2026-08-08 | 第一轮不改 tool schema | 用最小改动验证语法接地是否足以降低失败与重试，避免把两种变量混在一次实验里 |

## Evidence

- `skills-data/obsidian-base-spec.json5` 的职责是 Obsidian Markdown + DQL，不含 Bases 文法。
- `skills-data/core.json5` 只描述 base 命令、能力边界和 stdin 调用，没有可直接改写的 filters/order/sort/limit 模板。
- `src/chat/index.ts` 把 base 与 query/search 一并描述为支持 `--offset/--size`，而 `x-basalt base --help` 没有这两个选项。
- trace 中失败的 base 调用反复出现三类形态：把 `filters` 写成数组、臆造 `{field, operator, value}`、把排序写进 `order`。
- `src/chat/trace.ts` 直接 JSON 序列化 `Error`，tool-error 明细缺失可读 message。

## 范围与文件

| 边界 | 预计文件 | 责任 |
| --- | --- | --- |
| Bases 运行时真相源 | `skills-data/bases.json5`、`skills-data/summary.json5` | 独立触发词；提供最小语法模板、常见错误和动态 stdin 例子 |
| CLI/chat 指路 | `skills-data/core.json5`、`skills-data/chat.json5`、`src/chat/index.ts` | 指向 Bases skill；删除 base 支持 `--offset/--size` 的错误暗示 |
| 可观测性 | `src/chat/loop.ts`、`src/chat/trace.ts` | 把 tool-error 归一为可 JSON 化的 message/code/classification |
| 约束测试 | `tests/skill.test.ts`、`tests/chat/trace.test.ts`、必要的 chat 测试 | 锁定 skill 分工、提示契约和错误序列化 |
| 使用文档 | `docs/use/bases.md`、`docs/use/ai-and-skills.md`、必要时 `docs/use/commands.md` | 同步“去哪取语法”和真实分页边界 |

## 执行步骤

### BG-1：Bases 运行时 skill

- [ ] 新增 `skills-data/bases.json5`，每条 rule 有唯一 kebab-case `id`。
- [ ] 只覆盖模型生成动态 base 所需的最小闭环：顶层/view `filters`；字符串表达式；递归 `and/or/not`；`order` 是投影列；`sort` 才是排序；`limit` 与 `total` 口径。
- [ ] 提供 3 个可直接改写的完整 source：简单过滤、嵌套布尔、排序 + limit。
- [ ] 触发词与 `obsidian-base-spec`/`core` 刻意错开；summary/core 只留一行指路，不复制正文。

### BG-2：chat/core 契约校正

- [ ] chat 开始生成 `.base` 前能明确取到 Bases skill，而不是误取 `obsidian-base-spec`。
- [ ] 从系统提示与运行时说明中移除 base 支持 `--offset/--size` 的错误描述；query/search 分页契约保持不变。
- [ ] 不改变 `cli` 单工具、stdin source、防递归和 vault/db 注入架构。

### BG-3：tool-error 证据完整性

- [ ] trace 的 tool-error 至少保留 `{ message, code?, classification? }`，不再落成空对象。
- [ ] 超长错误仍受有界预览约束，不把 safety 包裹内的大段 vault 内容重复写入报告。
- [ ] 正常 tool-call/tool-result/finish trace 契约不变。

### BG-4：回归与文档

- [ ] `tests/skill.test.ts` 锁定 Bases skill 可独立召回、与 Markdown/DQL skill 不串篇、rule id 完整。
- [ ] chat/trace 测试覆盖可读 tool-error 与 base 分页提示回归。
- [ ] 同步消费侧文档与 `skills-data` 自我说明；更新已有 docs 后刷新派生元数据。
- [ ] 按跨运行时契约变更执行全量 `lint / typecheck / build / test`。

### BG-5：同条件 A/B 复跑

- [ ] 使用相同模型、vault、4 对问题、`maxSteps=12`，连续跑 3 轮；DQL/base 各 12 个正式样本。
- [ ] 单列任务失败率、tool-error、重试、exhausted、error-storm、平均轮数/调用/token；不同预算的 pilot 不并入。
- [ ] 与当前基线逐项对比，结论写回计划 Evidence/Verify，不只写“体感变好”。

## Verify / 验收门槛

- 确定性 DQL/base truth：100% 通过。
- base task 失败不超过 1/12（≤8.3%）。
- base `exhaustedRate=0`、`errorStormRate=0`。
- base `avgRetries≤1.0`。
- base `avgTotalTokens≤2× DQL`。
- Bases skill、提示和文档互相指路但不复制正文；不存在旧的 base 分页错误说明。
- tool-error trace 能直接读出错误 message，无需依赖模型自述。

## 杀死条件与后续分支

- **杀死条件**：补完语法接地后，三轮正式样本的 base task 失败率仍 ≥25%。命中即停止宣传或假设“动态 base 比 DQL 更可靠”，chat 默认结构化查询继续优先 DQL；base 保留为用户已有 `.base` 或显式指定时的执行能力。
- **灰区**：失败率在 8.3%～25% 之间，不算验收通过；只允许再做一次基于 trace 的最小修正后复跑，不无限调 prompt。
- **未命中杀死条件但 token/重试仍超标**：再评估把 filters/order/sort/limit 提升为结构化 tool input；另开决策计划，不混入本切口。

## Progress

- [x] 真实 chat A/B 基线完成，差距与生成侧根因已定位。
- [x] 本计划与量化验收/杀死条件落盘。
- [ ] BG-1～BG-5 待执行。

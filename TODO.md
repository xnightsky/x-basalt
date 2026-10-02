---
type: index
title: x-basalt 置顶关注与未完成事项
description: 持续保留用户关注、未修复问题与长期待办；会话启动先读，登记不等于实施授权
tags:
  - todo
  - attention
  - x-basalt
timestamp: 2026-10-02T08:13:30Z
sha256: 769037d59745bf6c0ac021b11b09dfa4783fdafa4fe9db05609addfeed361209
---
# TODO · x-basalt

本文件是未完成事项与用户关注项的置顶入口，会话启动时先读。关注可以只是持续观察，不必已经进入实施；不因某轮收口将它们迁走或隐藏。“待办/关注”不等于实施授权或正在执行。已完成的调查、R08/R09 修复与旧计划核对见[本轮执行记录](docs/plans/2026-10-01-todo-sequential-cleanup.md)，不等于模型问题和长期功能全部解决。

## 已发现问题与验证状态（已完成项保留）

- [x] **本切口已完成（2026-10-02）**：修正 chat 写后节流与用户显式复核/再次执行要求的冲突，并覆盖“真实执行第二次 run”而非用 query=0 冒充幂等证据。相关回归 124/124；同一模型旧／新各三题的执行义务均通过，不证明成功率提升或历史失败因果，模型漏执行／输出范围风险仍保留。（[本轮验收与边界](docs/plans/2026-10-02-chat-write-verification.md)）（[独立切口与验收](docs/plans/2026-10-01-todo-sequential-cleanup.md#3-下一轮切口--验收--非目标)、[系统提示](src/chat/index.ts)）
- [ ] 修复外部 AI 最终答案追加排除路径的范围违约；内层 chat 与外层转述分别验收，不以目标路径/总数正确代替输出义务。（[已观察结果](docs/plans/2026-10-01-todo-sequential-cleanup.md#2-外部-ai-能力发现与入口分流)、[入口策略](docs/design/chat-tool-surface.md)）
- [ ] 为 trace 补齐可关联工具调用/结果/错误的标识，验证并发同名调用与乱序结果的准确归属。（[可观测性风险](docs/plans/2026-10-01-todo-sequential-cleanup.md#decisions--progress)、[trace](src/chat/trace.ts)）
- [ ] 核对或补齐历史 Bases grounding 原始评测证据；原始 JSON 未定位期间，历史汇总只作已报告结果，不重新认证旧分数。（[归档核对与证据缺口](docs/archive/plans/2026-08-08-bases-chat-grounding.md#收口核对2026-10-01)）

## 长期待办与关注项（原条目保留，未实施）

- [ ] 扩展任务 emoji 字段、任务状态及到期日过滤。（[历史差距](docs/archive/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#a-dataview-元数据采集层最关键)、[当前 TASK 边界](docs/use/dql.md#33-task)）
- [ ] 补齐 DQL 的 `default`、数组高阶和聚合函数。（[历史差距](docs/archive/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#b-dataview-查询表达力层)、[当前函数集](docs/use/dql.md#6-内置函数)）
- [ ] 复核 FROM 多源 AND/OR 的实现取舍。（[冻结裁决](docs/design/dql-subset.md#冻结裁决表每个纳入项附-astsql-策略证明可实现)、[历史复核建议](docs/archive/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#c-dataview-查询入口)）
- [ ] 为 `runPipeline` 接入 `AbortSignal` 协作取消，补齐 `onBusy restart/ignore`、背压、缓存跳过、条件分支、检查点续跑和失败告警。（[编排设计与能力地图](docs/design/change-orchestration.md)）
- [ ] 完善跨平台 shell 管道的 stdin/stdout 契约。（[传输设计与验收矩阵](docs/design/shell-pipe-portability.md)）
- [ ] 按实际需求扩展元数据 profile。（[当前 profile 设计](docs/design/meta-subset.md)、[profile 调研](docs/research/2026-06-28-metadata-profiles-research.md)）
- [ ] 评估 embedding 语义检索的准入条件与集成方案。（[准入与候选方案](docs/design/semantic-retrieval.md#5-可选-embedding-的候选方案未实现)）
- [ ] 评估使用 Kysely 收编 DQL→SQL。（[选型调研](docs/research/2026-06-26-libraries-survey.md#2-索引层-indexer)、[当前 SQL 生成器](src/query/sql-generator.ts)）

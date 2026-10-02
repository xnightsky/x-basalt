---
type: index
title: 归档文档索引
description: 集中保留已结束或被接替的计划、调研与决策；归档不等于废弃，也不自动代表当前事实
tags:
  - archive
  - index
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 82371602bda976921d227c7d3d4fa24194955d4bbd5d906cffaf8584e1a48701
---
# 归档文档

**集中保留已结束或被接替的文档。归档不等于废弃，也不自动代表当前事实。**

当前有效的设计在 [`../design/`](../design/README.md)，使用方式在 [`../use/`](../use/README.md)，当前外部对照与能力边界在 [`../research/`](../research/README.md)。来这里查已结束的计划、调研与决策依据，了解**当初为什么这么决定、有哪些验证与边界**。所有正式文档的归档统一放在本目录，不在各业务目录内分散设置归档目录。

| 目录 | 内容 |
| --- | --- |
| `plans/` | 实现计划。每份含分阶段切口 + 验收 + Evidence，`YYYY-MM-DD-<topic>.md` |
| `research/` | 调研：外部规范核实、依赖比选、技术选型论证 |
| `decisions/` | 决策记录，含已被取代的旧设计（标 `superseded_by`） |

## 怎么读

- 计划文件的 frontmatter 有 `status`：`done` / `completed` / `archived` 表示原执行状态；归档保留原内容与证据，**不以旧状态证明当前事实**。
- 看到 `superseded_by` 就跳过去读新的那份；局部归档按来源章节与接替链接阅读，不把旧阶段快照当当前规则。
- 整篇迁移与局部摘出的准入、证据和引用验证见[内容级归档标准](plans/README.md)。
- 想知道某个能力现在做到哪了 → 不要翻这里，看 [`../research/`](../research/README.md) 或仓库根 `TODO.md`。

## 内容级归档入口

九篇混合设计的局部摘出与双向来源见[决策索引](decisions/README.md#本轮局部快照)；未完成义务仍在来源设计及根 TODO，不由快照关闭。

### 已结束计划

| 计划 | 活跃接替 |
| --- | --- |
| [片四 steps 配置面](plans/2026-07-30-pipeline-slice4-steps.md) | [统一算子契约](../design/pipeline-op-model.md)；10-02 补记实际核对，不追认旧日期验收 |
| [单 CLI 工具面](plans/2026-08-03-chat-cli-tool.md) | [工具面与宿主纪律](../design/chat-tool-surface.md) |
| [路径/DQL 诊断](plans/2026-08-13-cli-path-dql-diagnostics.md) | [工具路径还原](../design/chat-tool-surface.md#41-文件路径不是普通-argv索引主键必须在壳层还原) |
| [会话续跑](plans/2026-09-20-chat-session-continue.md) | [会话契约](../design/chat-session-continue.md) |
| [顺序清理](plans/2026-10-01-todo-sequential-cleanup.md) | [兼容账本](../design/query-compatibility-ledger.md)及根 TODO |
| [写后显式验收](plans/2026-10-02-chat-write-verification.md) | [当前提示纪律与风险](../design/chat-tool-surface.md) |

### 调研背景

| 调研 | 仍有效的入口或停点 |
| --- | --- |
| [早期逐模块库普查](research/2026-06-26-libraries-survey.md) | 当前 package.json / AGENTS、许可证政策；Kysely 仍在根 TODO |
| [早期 chat 对标](research/2026-06-30-chat-gap-vs-agent-browser.md) | 当前工具面/会话与待执行模型对照；旧场景格式不自动获授权 |
| [KB compiler 立项](research/2026-07-09-markdown-kb-compiler-lint-links-research.md) | 当前 KB compiler；heading/fix/CI 等后置边界仍保留 |
| [Bases 无头引擎立项](research/2026-07-22-obsidian-bases-headless-engine-research.md) | 当前 Bases 状态与未知 oracle，不声称完整兼容 |
| [R08/R09 最小切口复用](research/2026-10-01-minimal-slice-reuse-assessment.md) | 兼容账本；候选许可、适配与性能停点未解除 |
| [两轮 oracle 观察](research/2026-07-28-bases-oracle-observations.md) | 当前 runbook 方法与 vs-official 决定；新官方文档不等于新 App 实测 |

## 几份值得一读的

| | |
| --- | --- |
| [2026-06-26 现状体检](2026-06-26-audit.md) | 分模块找问题的一次全面审计 |
| [自建 vs 用库决策](decisions/2026-06-26-deps-build-vs-buy.md) | 「零依赖运行时」被执行成「全部手撸」的复盘结论 |
| [先 dogfood 还是先开源](decisions/2026-06-28-release-vs-dogfood.md) | 发布时机的判断 |

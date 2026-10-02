---
type: index
title: 当前调研入口
description: 当前能力边界、外部对照与证据快照的入口；不替代设计契约。
tags:
  - research
  - docs
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: b2e706359e237bf0316c8869b06d43843f538f69dbb1202dab41cf5d8d7280fa
---
# 当前调研

这里放仍用于判断当前能力边界的证据快照：外部能力对照、选型依据、规范核查和差距分析。它解释“现在知道什么”，但**不**定义实现契约、路线图或兼容承诺。

| 文档 | 作用 |
| --- | --- |
| [DQL / Bases 双路线局部深度调研](2026-10-01-dql-bases-compatibility-local-audit.md) | 官方正文入口/API 与模型限制、本项目 stdin/source、任务/inline/展开/公式/附件对照；保留 R08/R09 发现时证据（随后已修），并给出条件化兼容建议，不把旧探针结果当未修复现状。 |
| [Agent 知识工具业界调研：定位与架构取舍](2026-09-30-agent-knowledge-industry-landscape.md) | 固定源码与官方信源，比较无头竞品、词法/语义/图检索、Agent 宿主与知识维护；列出证据边界、文档校正及待执行 A/B 协议。 |
| [元数据策略 profile 调研](2026-06-28-metadata-profiles-research.md) | Obsidian、OKF 与 SSG 元数据字段的比较依据。 |
| [inline fields 采用度与前景](2026-07-02-inline-fields-adoption-outlook.md) | 存量兼容与未来投入边界的生态证据。 |
| [x-basalt、Obsidian 与 LLM Wiki：能力差距与边界 rebase](2026-08-07-x-basalt-obsidian-llm-wiki-rebase.md) | 以当前实现为基线，对照 Obsidian 与 LLM Wiki，并明确 SQLite index cache 替代 wiki 层后的能力边界。 |

早期库普查、chat/KB compiler/Bases 立项调研与已结束 R08/R09 选型已转入[归档调研](../archive/README.md#调研背景)。有效规则由对应设计接替，Kysely、模型对照、未知 oracle 与许可停点继续保留活跃入口；归档不关闭这些义务。

## 与其他目录的边界

| 要表达的内容 | 应放位置 |
| --- | --- |
| 外部资料、现状核查、能力差距与尚待判断的问题 | `research/` |
| 已确认的模块职责、行为契约和实现决定 | [`../design/`](../design/README.md) |
| 可供用户执行的命令、示例和故障处理 | [`../use/`](../use/README.md) |
| 已被新结论取代的调研、决策与执行计划 | [`../archive/`](../archive/README.md) |

调研结论若变成需要长期遵守的实现规则，应在 `design/` 落下对应设计，而不是用调研文档替代设计。

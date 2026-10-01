---
type: index
title: 当前调研入口
description: 当前能力边界、外部对照与证据快照的入口；不替代设计契约。
tags:
  - research
  - docs
  - x-basalt
timestamp: 2026-10-01T01:03:03Z
sha256: 0e37ad6940c366f141f54c8b5195aa0ef8ba491f56651e380949e7373a0718e1
---
# 当前调研

这里放仍用于判断当前能力边界的证据快照：外部能力对照、选型依据、规范核查和差距分析。它解释“现在知道什么”，但**不**定义实现契约、路线图或兼容承诺。

| 文档 | 作用 |
| --- | --- |
| [DQL / Bases 双路线局部深度调研](2026-10-01-dql-bases-compatibility-local-audit.md) | 官方正文入口/API 与模型限制、本项目 stdin/source、任务/inline/展开/公式/附件对照；记录公式解析器与 TASK 子句执行缺口，给出条件化兼容建议。 |
| [Agent 知识工具业界调研：定位与架构取舍](2026-09-30-agent-knowledge-industry-landscape.md) | 固定源码与官方信源，比较无头竞品、词法/语义/图检索、Agent 宿主与知识维护；列出证据边界、文档校正及待执行 A/B 协议。 |
| [业界现成库逐模块普查](2026-06-26-libraries-survey.md) | parser / indexer / query 的库选型比较与许可证核查线索。 |
| [元数据策略 profile 调研](2026-06-28-metadata-profiles-research.md) | Obsidian、OKF 与 SSG 元数据字段的比较依据。 |
| [chat 对标 agent-browser](2026-06-30-chat-gap-vs-agent-browser.md) | chat 效果、重试、撞顶与场景库量化的对照基线。 |
| [inline fields 采用度与前景](2026-07-02-inline-fields-adoption-outlook.md) | 存量兼容与未来投入边界的生态证据。 |
| [KB compiler 深度调研](2026-07-09-markdown-kb-compiler-lint-links-research.md) | lint、links、profile 与诊断能力的外部比较。 |
| [Obsidian Bases 无头引擎调研](2026-07-22-obsidian-bases-headless-engine-research.md) | 官方 Bases 与无 GUI 查询能力的持续对照。 |
| [x-basalt、Obsidian 与 LLM Wiki：能力差距与边界 rebase](2026-08-07-x-basalt-obsidian-llm-wiki-rebase.md) | 以当前实现为基线，对照 Obsidian 与 LLM Wiki，并明确 SQLite index cache 替代 wiki 层后的能力边界。 |

## 与其他目录的边界

| 要表达的内容 | 应放位置 |
| --- | --- |
| 外部资料、现状核查、能力差距与尚待判断的问题 | `research/` |
| 已确认的模块职责、行为契约和实现决定 | [`../design/`](../design/README.md) |
| 可供用户执行的命令、示例和故障处理 | [`../use/`](../use/README.md) |
| 已被新结论取代的调研、决策与执行计划 | [`../history/`](../history/README.md) |

调研结论若变成需要长期遵守的实现规则，应在 `design/` 落下对应设计，而不是用调研文档替代设计。

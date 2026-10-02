---
type: guide
title: 归档标准与历史设计快照索引
tags:
  - archive
  - index
  - x-basalt
description: 内容级整篇/局部归档的边界及历史快照索引；当前契约与未完成义务仍有活跃入口。
timestamp: 2026-10-02T12:17:48Z
sha256: b1bcca09700bfb55390128271ecf0fb66996aade774a6600f14f6069d584795e
---
# 归档标准（设计与决策）

集中保留结束的方案、有效决策的历史依据与被接替的过程。**不是删除，也不是因日期早就判失效。** 整篇/局部归档的共同标准见[内容级归档规则](../plans/README.md)，当前设计见[活跃索引](../../design/README.md)。

## 归档与保留边界

- 原型、被否决/接替方案、已结束实施记录可以整篇归档；唯一证据也可以留在这里。
- 混合文档只摘历史章节：当前契约、有效理由、安全边界、测试编号和未完成义务仍留活跃入口。
- 迁移后保留来源/接替链接、旧日期与版本；旧“当前”“未修复”“待实施”只按当时基线阅读。
- 历史读数不重新认证；许可、未知语义与模型可靠性停点不因归档解除。
- 全部归档集中于 `docs/archive/`，不按业务另建历史目录。

## 整篇旧设计

| 文档 | 原归档日期 | 去向或理由 |
| --- | --- | --- |
| [初始架构](2026-06-25-x-basalt-design.md) | 2026-07-22 | 已被实际演进接替 |
| [早期 CLI chat 评估](2026-06-28-cli-chat-design.md) | 2026-07-22 | 当前读写边界由 chat-readwrite 接替 |
| [检索分层评估](2026-06-28-semantic-retrieval-integration.md) | 2026-10-01 | 保留原接口/工作量与取舍，当前 FTS5/embedding 边界由 semantic-retrieval 接替 |
| [场景库初始设计](2026-06-30-chat-eval-scenario-library-design.md) | 2026-07-22 | 独立评估工作区的历史设计，不构成新建/集成授权 |

## 本轮局部快照

以下均于 2026-10-02 摘出；源文保留原标题指路和当前契约。快照中的旧工具、阶段优先级、方案表与实验数字不能直接作为当前能力。

| 快照 | 活跃入口 |
| --- | --- |
| [chat 初版范围/模块/工具/交接](2026-06-30-chat-readwrite-record.md) | [当前读写与安全](../../design/chat-readwrite.md) |
| [会话演变、CLI 对照与 spike 纠偏](2026-09-20-chat-session-record.md) | [UUID/JSONL/恢复契约](../../design/chat-session-continue.md) |
| [旧工具漂移、对标与迁移序列](2026-07-30-chat-tool-surface-record.md) | [单 CLI 工具面](../../design/chat-tool-surface.md) |
| [grounding 初期观察与改名](2026-06-30-chat-grounding-record.md) | [当前按需规范与可靠性边界](../../design/chat-skill-grounding.md) |
| [编排立项、能力地图与旧定义](2026-06-29-change-orchestration-record.md) | [五段流水线与剩余关注](../../design/change-orchestration.md) |
| [统一算子旧接口与实施增补](2026-07-30-pipeline-op-record.md) | [Row/Op/OpOutcome 与回归判据](../../design/pipeline-op-model.md) |
| [skills 旧目录、失败方案与体积读数](2026-07-15-skills-router-record.md) | [cli/dev 路由与条级规则](../../design/skills-router.md) |
| [Bases 首次函数补齐与阶段校正](2026-07-28-bases-implementation-record.md) | [当前状态/测试编号](../../design/bases-status.md)和[语法](../../design/bases-syntax.md) |

Bases 两轮版本化 oracle 观察另在[调研归档](../research/2026-07-28-bases-oracle-observations.md)，活跃[runbook](../../design/bases-oracle-runbook.md)只维护方法、重跑条件与红线。

---
type: index
title: 设计文档索引
description: 当前有效的设计与规范索引：全局架构、Bases、DQL、索引解析、写侧编排、chat、KB compiler
tags:
  - design
  - index
  - x-basalt
timestamp: 2026-07-27T18:17:29Z
sha256: 5049b1170502c605be4a3b23a7271e6d44d66dffdfd0495806c5b13c9c503b0d
---
# 设计文档

**当前有效的设计与规范。** 这里的每一份都描述"现在的代码是怎么回事"，和 `src/` 必须能互相验证——对不上就是文档坏了，改文档或改代码，不能沉默。

已被取代的旧设计在 [`../history/decisions/`](../history/decisions/README.md)，不在这里。

## 全局

| | |
| --- | --- |
| [架构总览](architecture.md) | 分层依赖、读写数据流、DQL 管线、SQLite 数据模型、组件目录。**先读这个建立全局观** |
| [依赖与许可证政策](dependency-license-policy.md) | 选第三方库前必读 |

## Bases（`.base` 无头查询）

| | |
| --- | --- |
| [官方怎么做 / 我们怎么做](bases-vs-official.md) | 官方 CLI 的架构与五个实测坑、我们为什么走另一条路、能换来什么 |
| [引擎设计](bases-engine.md) | 模块边界、诊断契约、预算模型、安全面 |
| [语法规范](bases-syntax.md) | 规范级语法口径（实现状态与诊断编号以此为准） |
| [实现状态追踪](bases-status.md) | living 文档：逐项做没做 + 测试编号 |
| [场景矩阵](bases-scenarios.md) | 验收编号体系（`BASE-XXX-NNN`） |
| [oracle 操作手册](bases-oracle-runbook.md) | 拿官方读数校正 9 项暂定语义的流程 |
| [附件数据集决策](bases-vault-entries.md) | `vault_entries` 表为什么独立于 `files` |

> 使用者视角的 Bases 文档在 [`../use/bases.md`](../use/bases.md)——是什么、教程、语法速查、命令、报错，一份读完就会用。

## DQL（Dataview 子集）

| | |
| --- | --- |
| [DQL 子集边界](dql-subset.md) | 冻结的支持范围 |
| [真值与存在性](dql-truthiness.md) | `WHERE x` 到底判什么 |

## 索引与解析

| | |
| --- | --- |
| [增量重扫](scan-incremental.md) | `scan` 的 mtime / hash / 断点续 |
| [inline fields](inline-fields.md) | 正文 `key:: value` 的解析口径 |
| [语义检索集成](semantic-retrieval.md) | FTS5 已落地，embedding 的触发条件 |

## 写侧与编排

| | |
| --- | --- |
| [meta 子集](meta-subset.md) | frontmatter 读写的冻结范围 |
| [变更编排](change-orchestration.md) | `run` 管道的设计 |

## chat（可选 AI）

| | |
| --- | --- |
| [读写机制](chat-readwrite.md) | 工具调用的读侧与受闸写侧 |
| [skill grounding](chat-skill-grounding.md) | 怎么让模型用对 CLI |
| [trace](chat-trace.md) | 可观测性 |

## KB compiler（lint / links）

| | |
| --- | --- |
| [lint 与 links 设计](kb-compiler.md) | 诊断契约、profile 分层 |
| [skills 瘦路由重组](skills-router.md) | `skills-def/` 的组织方式 |

---

**维护规则**：命令签名 / DQL 子集 / 数据模型 / 配置项变化时，同步对应设计文档、[`../use/`](../use/README.md) 对应章节、自我说明书（`skills-data/x-basalt.json5`）。大改动记入本目录；被取代的移入 `../history/decisions/` 并标 `superseded_by`。

---
type: index
title: 设计文档索引
description: 当前有效的设计与规范索引：全局架构、Bases、DQL、索引解析、写侧编排、chat、KB compiler
tags:
  - design
  - index
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 84aa9f90b83ba752029ed00d3ffbf82beb3b480595704e0a49d66602b5d40093
---
# 设计文档

**当前维护的设计与规范，也保留明确标注的未实现提案。** 已实现契约必须与 `src/` 互相验证；提案不作为现有能力。历史过程集中归档，活跃文档保留当前规则、有效决策理由及溯源。

已被取代的旧设计在 [`../archive/decisions/`](../archive/decisions/README.md)，不在这里。

## 全局

| | |
| --- | --- |
| [架构总览](architecture.md) | 分层依赖、读写数据流、DQL 管线、SQLite 数据模型、组件目录。**先读这个建立全局观** |
| [DQL/Bases 兼容投入账本](query-compatibility-ledger.md) | 当前快照、已验证/有据差异/未实现/未知分类，升级顺序与停点 |
| [依赖与许可证政策](dependency-license-policy.md) | 选第三方库前必读 |

## Bases（`.base` 无头查询）

| | |
| --- | --- |
| [官方怎么做 / 我们怎么做](bases-vs-official.md) | 官方 CLI 的架构与五个实测坑、我们为什么走另一条路、能换来什么 |
| [引擎设计](bases-engine.md) | 模块边界、诊断契约、预算模型、安全面 |
| [语法规范](bases-syntax.md) | 规范级语法口径（实现状态与诊断编号以此为准） |
| [实现状态追踪](bases-status.md) | living 文档：逐项做没做 + 测试编号 |
| [场景矩阵](bases-scenarios.md) | 验收编号体系（`BASE-XXX-NNN`） |
| [oracle 操作手册](bases-oracle-runbook.md) | 指定版本取证、重跑条件与红线；旧观察另留归档 |
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
| [内置 pipeline 改造](pipeline-op-model.md) | **已落地**：统一算子模型（Row 流动单位、单签名算子、调度可换）；含当前边界与回归口径 |
| [多平台 shell 管道](shell-pipe-portability.md) | **增强提案·未实现**：现有文本 `run --stdin` 之外的格式嗅探、ASCII JSON 与跨平台验收 |

## chat（可选 AI）

| | |
| --- | --- |
| [读写机制](chat-readwrite.md) | 可选 AI 隔离、无逐动作确认的写侧及安全边界 |
| [skill grounding](chat-skill-grounding.md) | 怎么让模型用对 CLI |
| [trace](chat-trace.md) | 可观测性 |
| [会话落盘与续跑](chat-session-continue.md) | **已落地**：默认不落盘；UUID 新建/严格续跑；JSONL 逐 step 追加、返回 id、显式恢复守卫 |
| [工具面单一真相源](chat-tool-surface.md) | **已落地**：cli 单执行口、argv 无 shell、主键路径还原、防递归及写后验收边界 |

## KB compiler（lint / links）

| | |
| --- | --- |
| [lint 与 links 设计](kb-compiler.md) | 诊断契约、profile 分层 |
| [skills 瘦路由重组](skills-router.md) | `skills-def/` 的组织方式 |

---

**维护规则**：命令签名 / DQL 子集 / 数据模型 / 配置项变化时，同步对应设计文档、[`../use/`](../use/README.md) 对应章节、运行时对应篇（`skills-data/core.json5`、`pipe.json5`、`chat.json5` 等）。大改动记入本目录；被取代的移入 `../archive/decisions/` 并标 `superseded_by`。

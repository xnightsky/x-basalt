---
type: index
title: x-basalt 文档入口
description: 按读者分流的文档总入口：use/ 怎么用、design/ 怎么改、history/ 查历史；含三层口径与维护规则
tags:
  - docs
  - index
  - x-basalt
timestamp: 2026-07-27T18:12:28Z
sha256: 5f1f398a0746ee190f4136c27b8370b5ebcbf4691cbe4930f402cf0a97607103
---
# x-basalt 文档

三个目录，按**你是谁**分：

| 我想…… | 去 |
| --- | --- |
| **用这个 CLI** —— 安装、查笔记、改元数据、报错了 | [`use/`](use/README.md) |
| **改这个 CLI** —— 架构、模块设计、为什么这么定 | [`design/`](design/README.md) |
| **查历史** —— 当初怎么调研的、旧计划、被推翻的决策 | [`history/`](history/README.md) |

## 三层口径（改文档前先分清）

| 层 | 在哪 | 要求 |
| --- | --- | --- |
| **当前实现** | `src/` + `design/` | 必须互相验证，对不上就是文档坏了 |
| **使用方式** | `use/` | 写在这里的必须能跑通，示例要真实跑过 |
| **历史** | `history/` | 只进不出，不代表当前事实 |

## 现在的主线

**Bases 无头引擎**——不启动 Obsidian 查询 `.base` 文件。

- 会用 → [`use/bases.md`](use/bases.md)
- 懂原理 → [`design/bases-vs-official.md`](design/bases-vs-official.md)
- 做到哪了 → [`design/bases-status.md`](design/bases-status.md)
- 待办 → 仓库根 [`TODO.md`](../TODO.md)

## 维护规则

- 改了行为，同步改 `design/` 对应文档和 `use/` 对应章节；小改动也要同步，不静默覆盖原规则。
- 设计被推翻时：移进 `history/decisions/`，标 `superseded_by`，**不删文件**。
- 入仓文档禁止出现仓库根目录之外的绝对本机路径（见 `AGENTS.md`「脱敏」）。
- 文件名：`use/` 和 `design/` 不带日期（名字即内容）；`history/` 保留 `YYYY-MM-DD-` 前缀。

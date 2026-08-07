---
type: index
title: x-basalt 文档入口
description: 按读者分流的文档总入口：use/ 怎么用、research/ 查当前调研、design/ 怎么改、history/ 查历史；含四层口径与维护规则
tags:
  - docs
  - index
  - x-basalt
timestamp: 2026-08-07T00:12:49Z
sha256: 7d98ea52c42407ef05191989e9eff3c9a8424b456ee75be8a8f3226194270a29
---
# x-basalt 文档

四个目录，按**你是谁**分：

| 我想…… | 去 |
| --- | --- |
| **用这个 CLI** —— 安装、查笔记、改元数据、报错了 | [`use/`](use/README.md) |
| **核对当前边界** —— 对照外部能力、查调研证据、判断是否真是差距 | [`research/`](research/README.md) |
| **改这个 CLI** —— 架构、模块设计、为什么这么定 | [`design/`](design/README.md) |
| **查历史** —— 当初怎么调研的、旧计划、被推翻的决策 | [`history/`](history/README.md) |

## 四层口径（改文档前先分清）

| 层 | 在哪 | 要求 |
| --- | --- | --- |
| **当前实现** | `src/` + `design/` | 必须互相验证，对不上就是文档坏了 |
| **使用方式** | `use/` | 写在这里的必须能跑通，示例要真实跑过 |
| **当前调研** | `research/` | 基于证据的现状快照；不是实现契约、路线图或兼容承诺 |
| **历史** | `history/` | 只进不出，不代表当前事实 |

## 现在的主线

**Bases 无头引擎**——不启动 Obsidian 查询 `.base` 文件。

- 会用 → [`use/bases.md`](use/bases.md)
- 懂原理 → [`design/bases-vs-official.md`](design/bases-vs-official.md)
- 当前执行与待办 → 仓库根 [`TODO.md`](../TODO.md)

## 维护规则

- 改了行为，同步改 `design/` 对应文档和 `use/` 对应章节；小改动也要同步，不静默覆盖原规则。
- 外部对照、能力边界和选型证据写入 `research/`；结论一旦成为当前实现契约或决策，再写入 `design/`。
- 设计被推翻时：移进 `history/decisions/`，标 `superseded_by`，**不删文件**。
- 入仓文档禁止出现仓库根目录之外的绝对本机路径（见 `AGENTS.md`「脱敏」）。
- 文件名：`use/` 和 `design/` 不带日期（名字即内容）；`research/` 与 `history/` 保留 `YYYY-MM-DD-` 前缀。

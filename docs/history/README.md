---
type: index
title: 历史归档索引
description: 只进不出的归档：plans/ 实现计划、research/ 调研、decisions/ 决策记录；含怎么读与几份值得一读的
tags:
  - history
  - index
  - x-basalt
timestamp: 2026-08-07T00:12:49Z
sha256: 3508b9ae46d5c85e2fd34ccd1c779cfa214dea03813e8f7eea5bb8000321d076
---
# 历史归档

**只进不出。这里的东西不代表当前事实。**

当前有效的设计在 [`../design/`](../design/README.md)，使用方式在 [`../use/`](../use/README.md)，当前外部对照与能力边界在 [`../research/`](../research/README.md)。来这里只有一个理由：想知道**当初为什么这么决定**。

| 目录 | 内容 |
| --- | --- |
| `plans/` | 实现计划。每份含分阶段切口 + 验收 + Evidence，`YYYY-MM-DD-<topic>.md` |
| `research/` | 调研：外部规范核实、依赖比选、技术选型论证 |
| `decisions/` | 决策记录，含已被取代的旧设计（标 `superseded_by`） |

## 怎么读

- 计划文件的 frontmatter 有 `status`：`done` / `archived` 只作历史参考，**不当作当前事实**。
- 看到 `superseded_by` 就跳过去读新的那份。
- 想知道某个能力现在做到哪了 → 不要翻这里，看 [`../research/`](../research/README.md) 或仓库根 `TODO.md`。

## 几份值得一读的

| | |
| --- | --- |
| [2026-06-26 现状体检](2026-06-26-audit.md) | 分模块找问题的一次全面审计 |
| [自建 vs 用库决策](decisions/2026-06-26-deps-build-vs-buy.md) | 「零依赖运行时」被执行成「全部手撸」的复盘结论 |
| [先 dogfood 还是先开源](decisions/2026-06-28-release-vs-dogfood.md) | 发布时机的判断 |

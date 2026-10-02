---
type: index
title: 归档文档索引
description: 集中保留已结束或被接替的计划、调研与决策；归档不等于废弃，也不自动代表当前事实
tags:
  - archive
  - index
  - x-basalt
timestamp: 2026-10-02T08:11:40Z
sha256: e4222edc4c4f1d5e71109f95412bee7c7710642ebe5210ecbdd42e5c5b15fbce
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
- 看到 `superseded_by` 就跳过去读新的那份。
- 想知道某个能力现在做到哪了 → 不要翻这里，看 [`../research/`](../research/README.md) 或仓库根 `TODO.md`。

## 几份值得一读的

| | |
| --- | --- |
| [2026-06-26 现状体检](2026-06-26-audit.md) | 分模块找问题的一次全面审计 |
| [自建 vs 用库决策](decisions/2026-06-26-deps-build-vs-buy.md) | 「零依赖运行时」被执行成「全部手撸」的复盘结论 |
| [先 dogfood 还是先开源](decisions/2026-06-28-release-vs-dogfood.md) | 发布时机的判断 |

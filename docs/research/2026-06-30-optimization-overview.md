---
type: research
title: x-basalt 优化方向总览（2026-06-30 会话）
description: 本会话对「x-basalt 如何优化」的诊断总览 + 四篇专题文档索引；项目健康度高，优化集中在功能覆盖/chat 可用性/场景库三条线
tags:
  - research
  - optimization
  - overview
  - index
timestamp: 2026-06-30T15:44:28Z
sha256: 59a88e2b3b1e6f0f531a86b169d9693bb72d9719a122135f7a02f95d138e351b
---

# x-basalt 优化方向总览（2026-06-30 会话）

> 本篇是 2026-06-30「如何优化」会话的**总入口 + 文档索引**。每个方向的细节落在各自专题文档，本篇只做诊断结论与导航。

## 1. 健康度基线：无低垂果实

| 维度 | 现状 |
|---|---|
| typecheck / lint | ✅ 全绿，零警告 |
| 测试 | ✅ 414 全绿（~31s） |
| 代码异味 | ≈0：无 `any` 堆积、无 `@ts-ignore`、仅 1 处 `@deprecated`（带迁移路径） |
| 性能基建 | 已到位：WAL、事务包裹批量写、批内并发读盘、mtime+size 快判 + rehash 兜底、流式分批、断点续扫 |
| 模块边界 | 清晰，符合 AGENTS.md 单一职责约束 |

**结论**：优化不在还技术债或修性能陷阱（这些没有），而在**功能覆盖、chat 可用性、评估基建**三条更高层的线。

## 2. 优化方向全景

| # | 方向 | 状态 | 文档 |
|---|---|---|---|
| A | **功能覆盖 gap**（对标官方 Dataview/Obsidian） | ✅ 已调研落地 | [`2026-06-30-feature-gap-vs-dataview-obsidian.md`](2026-06-30-feature-gap-vs-dataview-obsidian.md) |
| B | **chat 可用性**（对标 agent-browser，三痛点） | ✅ 已调研落地 | [`2026-06-30-chat-gap-vs-agent-browser.md`](2026-06-30-chat-gap-vs-agent-browser.md) |
| C | **chat 评估/场景库**（兄弟目录素材库） | 📝 设计草案（选址/格式待拍板） | [`../specs/2026-06-30-chat-eval-scenario-library-design.md`](../specs/2026-06-30-chat-eval-scenario-library-design.md) |
| D | 架构整洁（`cli.ts` 721 行拆分） | 💡 候选，未展开 | 本篇 §3 |
| E | 性能基准（benchmark） | 💡 候选，预防性（无已知瓶颈） | 本篇 §3 |
| F | 写侧 / 编排器 P1+、lint schema 校验、FTS5 | 💡 既有 backlog | [`../../TODO.md`](../../TODO.md) |

## 3. 候选方向（本会话未展开，备忘）

- **D 架构整洁**：`cli.ts` 721 行把命令注册 + 11 个 `report*/parse*` 格式化辅助 + 参数校验挤在一起，随命令增长会膨胀，可按命令域拆分。**注意**：与在建 chat P4（往 cli.ts 加 chat 命令）冲突，宜合并做或等其收尾。低风险纯收益，但不紧急。
- **E 性能基准**：当前无已知瓶颈，性能基建已好；可建大 vault benchmark 做预防性度量（query 编译缓存 / prepared stmt 复用），但属「锦上添花」，无证据驱动。

## 4. 会话聚焦与下一步

本会话用户聚焦 **A（功能残缺评估）+ B（chat 不好用）**，并提出 **C（场景库）**。三条线均已落地为可执行文档。

**建议下一步**（本会话止于文档落地，不实现）：
1. **chat 止血 P0**（见 B 篇 §4）：工具调用错误分类+有限重试、撞顶区分完成/耗尽+REPL 可续——改动小、收益直接。
2. **功能高频刚需**（见 A 篇 §2）：inline fields 提取、task emoji 多字段、函数补一批、FTS5 全文检索。
3. **场景库拍板**（见 C 篇 §6）：选址+格式定了再开 spec→plan，用它量化验证以上改进。

---
type: guide
title: 归档标准 —— 什么情况下 spec 应移入 archived/
description: 定义 docs/specs/archived/ 的准入标准和维护规范
tags:
  - spec
  - meta
  - x-basalt
---

# 归档标准（specs）

> 归档 = 从 `docs/specs/` 移入 `docs/specs/archived/`。**不是删除**。
> 目的是让 `docs/specs/` 保持可用的设计参考，archive 作为历史决策的"可查集"。

## 归档条件（满足任一即可）

1. **已被后续设计文档完全覆盖**（如 early chat design → readwrite design）
2. **设计的技术方案未被采纳**（如 embedding 集成，实际只做了 FTS5）
3. **所在功能域已迁移到其他仓库**（如场景库设计）
4. **是初始/原型设计，与实际实现的架构已显著偏离**

## 不归档的情况

- 真相源 / 冻结规范（`dql-subset-frozen`、`meta-subset-frozen` 等）
- 活跃功能的当前设计文档
- 一次性但仍有参考价值的决策记录（按需——可存 archived 也可留原位，标注 `status: decision`）

## 索引

| 文件名 | 归档日期 | 归档理由 |
|--------|---------|---------|
| `2026-06-25-x-basalt-design.md` | 2026-07-22 | 初始架构设计，已被实际演进取代 |
| `2026-06-28-cli-chat-design.md` | 2026-07-22 | 被 `cli-chat-readwrite-design.md` 取代 |
| `2026-06-30-chat-eval-scenario-library-design.md` | 2026-07-22 | 场景库已迁至兄弟仓 `x-basalt-evals` |

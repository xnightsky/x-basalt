---
type: index
title: 活跃计划
description: 正在做的计划放这里，完成后 git mv 进 history/plans；含命名与必备章节规矩
tags:
  - plan
  - index
  - x-basalt
timestamp: 2026-07-27T18:16:24Z
sha256: 56930246ddcee92d4d3a6bcc02404287f406c5931344fd8e45f3a3e1bda8ffec
---
# 活跃计划

**只放正在做的。做完就移走。**

```
docs/plans/          ← 在做（本目录）
      ↓ 完成后 git mv
docs/history/plans/  ← 做完了，只进不出
```

## 规矩

- 命名 `YYYY-MM-DD-<topic>.md`，kebab-case。
- 每份必须有：背景 / 分阶段切口 / Decision Log / Evidence / 验收口径。
- 仓库根 `TODO.md` 挂链接到这里；**TODO 只挂活跃项，历史不堆在那**。
- 计划完成 → `git mv docs/plans/x.md docs/history/plans/x.md`，并把 frontmatter 的 `status` 改成 `done`。
- 本目录空 = 当前没有进行中的大型任务，不是出错。

## 什么算「需要写计划」

大型任务：预计 >90 分钟，或跨 2 个及以上一级模块。小改动直接做，不写计划。

详见仓库根 [`AGENTS.md`](../../AGENTS.md)。

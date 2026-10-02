---
type: index
title: 活跃计划
description: 正在做的计划放这里，满足归档标准后移入 archive/plans；含命名与必备章节规矩
tags:
  - plan
  - index
  - x-basalt
timestamp: 2026-10-02T08:11:40Z
sha256: 80207682278d9a5cbbec1657215fef3d33e22396856c7995b205e02337d6d539
---
# 活跃计划

**活跃计划放这里。满足[归档标准](../archive/plans/README.md)后集中归档。**

```
docs/plans/          ← 活跃计划（本目录）
      ↓ 满足归档标准后迁移
docs/archive/plans/  ← 归档计划，保留内容与证据
```

## 规矩

- 命名 `YYYY-MM-DD-<topic>.md`，kebab-case。
- 每份必须有：背景 / 分阶段切口 / Decision Log / Evidence / 验收口径。
- 仓库根 `TODO.md` 挂执行计划链接；持续关注与未完成事项不因计划归档而隐藏。
- 计划满足归档标准 → `git mv docs/plans/x.md docs/archive/plans/x.md`，并按实际执行状态更新 frontmatter。
- 本目录空 = 当前没有进行中的大型任务，不是出错。

## 什么算「需要写计划」

大型任务：预计 >90 分钟，或跨 2 个及以上一级模块。小改动直接做，不写计划。

详见仓库根 [`AGENTS.md`](../../AGENTS.md)。

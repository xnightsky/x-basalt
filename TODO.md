---
timestamp: 2026-08-07T17:21:48Z
sha256: df63ee4e704e4d5e210c50e9a15e715c429d3449a1f9b41c311cd925724d56fc
---
# TODO · x-basalt

> 正在执行 / 待开展事项。已完成工作见 `git log`、`docs/history/` 与相关设计、计划文档。

## 当前执行项

- [ ] **先补 Bases 语法接地，再复跑动态 base A/B**：当前真实 chat 基线中 DQL 12/12、base 7/12；先新增独立 Bases 运行时 skill、修正 base 分页提示漂移并补全 tool-error trace，再按同模型/同场景/同预算跑 3 轮。验收目标为 base 失败≤1/12、零撞顶/零 error-storm、平均重试≤1、token≤2× DQL；若补接地后失败仍≥25%，停止“动态 base 比 DQL 更可靠”的路线假设。计划见 [`docs/plans/2026-08-08-bases-chat-grounding.md`](./docs/plans/2026-08-08-bases-chat-grounding.md)。
- [ ] **定位 pipeline 的间歇性测试失败**：曾观察到一次 `1028 pass / 1 fail`，未记录用例名；优先复现并记录失败测试，再判断是否为 watch/debounce 时序问题。未复现前不得视为已解决。设计见 [`docs/design/pipeline-op-model.md`](./docs/design/pipeline-op-model.md)。

## 长期 backlog（待 dogfood 暴露真实需求再开）

- task emoji 多字段 + 完成状态
- 内置函数补一批（`default` / 数组高阶 / 聚合，现覆盖约 15%）
- FROM 多源 AND/OR 取舍复核（背景见 [`docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](./docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md)）
- **变更编排器 P1 余项 / P2**：`onBusy` 的 `restart` / `ignore`、背压、缓存跳过、条件分支、检查点续跑、失败告警。实现前需先为 `runPipeline` 接入 `AbortSignal` 协作取消；设计见 [`docs/design/change-orchestration.md`](./docs/design/change-orchestration.md)。
- **多平台 shell 管道**：接外部工具的 stdin/stdout 跨平台契约；统一算子模型前置已满足，按需开片。设计见 [`docs/design/shell-pipe-portability.md`](./docs/design/shell-pipe-portability.md)。
- 更多 profile：按需扩。
- embedding 向量语义检索：FTS5 全文已落地；embedding 仍 backlog（触发条件见 [`docs/design/semantic-retrieval.md`](./docs/design/semantic-retrieval.md) §10）。
- S3.4 kysely 收编 DQL→SQL（可选增强，按需再定）。

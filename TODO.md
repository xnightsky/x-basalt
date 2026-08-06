---
timestamp: 2026-08-06T23:31:20Z
sha256: 13eac1e4627c72314f802ed94bec22cf31a18c8d3de235f1e63503ab1a6f1c50
---
# TODO · x-basalt

> 正在执行 / 待开展事项。已完成工作见 `git log`、`docs/history/` 与相关设计、计划文档。

## 当前执行项

- [ ] **动态 base 的 evals 场景库 A/B**：在真实 chat + `AI_GATEWAY_API_KEY` 环境中，对比 DQL `query` 与结构化 `base` 查询的失败率、重试次数和撞顶率。stdin 与 chat `cli` 工具基座已落地；验证设计见 [`docs/plans/2026-08-03-bases-dynamic-stdin.md`](./docs/plans/2026-08-03-bases-dynamic-stdin.md) 与 [`docs/plans/2026-08-03-chat-cli-tool.md`](./docs/plans/2026-08-03-chat-cli-tool.md)。
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

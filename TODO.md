---
timestamp: 2026-08-08T15:06:31Z
sha256: aed070aadc9ecf82d42706e56f209014fd1c15129fff018ee825d522af69a322
---
# TODO · x-basalt

> 正在执行 / 待开展事项。已完成工作见 `git log`、`docs/history/` 与相关设计、计划文档。

## 当前执行项

> 当前无在进行中的产品主线。最近一轮「Bases 语法接地 + 动态 base A/B 复跑」已**完成并收口**：
> base 从基线 7/12 逆转到 12/12（[计划 Evidence/Verify](./docs/plans/2026-08-08-bases-chat-grounding.md)），
> 后续能力评估四场景 39/39、skill-before-base/source 39/39，零 base error / 零撞顶 / 零 error-storm（x-basalt-evals）。
> 进入真实 vault dogfood 观察期；出现可复现阻断问题再立项。

## 长期 backlog（待 dogfood 暴露真实需求再开）

- task emoji 多字段 + 完成状态
- 内置函数补一批（`default` / 数组高阶 / 聚合，现覆盖约 15%）
- FROM 多源 AND/OR 取舍复核（背景见 [`docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](./docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md)）
- **变更编排器 P1 余项 / P2**：`onBusy` 的 `restart` / `ignore`、背压、缓存跳过、条件分支、检查点续跑、失败告警。实现前需先为 `runPipeline` 接入 `AbortSignal` 协作取消；设计见 [`docs/design/change-orchestration.md`](./docs/design/change-orchestration.md)。
- **多平台 shell 管道**：接外部工具的 stdin/stdout 跨平台契约；统一算子模型前置已满足，按需开片。设计见 [`docs/design/shell-pipe-portability.md`](./docs/design/shell-pipe-portability.md)。
- 更多 profile：按需扩。
- embedding 向量语义检索：FTS5 全文已落地；embedding 仍 backlog（触发条件见 [`docs/design/semantic-retrieval.md`](./docs/design/semantic-retrieval.md) §10）。
- S3.4 kysely 收编 DQL→SQL（可选增强，按需再定）。

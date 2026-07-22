# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。已完成的不堆这——见 git log、`docs/plans/`、`docs/specs/`。


## 📋 功能覆盖 gap → backlog（待 dogfood 暴露真实需求再开）

高频缺口（未做，各自待开计划/spec）：
- task emoji 多字段 + 完成状态
- 内置函数补一批（`default` / 数组高阶 / 聚合，现覆盖 ~15%）
- FROM 多源 AND/OR 取舍复核
- 详见 [`docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md)

## 💡 backlog（待 dogfood 暴露真实需求再开）

- **变更编排器 P1 余项 / P2**：背压、缓存跳过、条件分支、检查点续跑、失败告警、原生管道 stdin、管道 `set` 列表值。设计见 [`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md)。
- **更多 profile**：按需扩。
- **embedding 向量语义检索**：FTS5 全文已落地；embedding 仍 backlog（触发条件见 `docs/specs/2026-06-28-semantic-retrieval-integration.md` §10）。
- **S3.4 kysely 收编 DQL→SQL**（可选增强，按需再定）。

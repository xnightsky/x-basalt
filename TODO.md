---
timestamp: 2026-10-01T13:28:59Z
sha256: c4870135d85f2d795c8c96beed5ccfa899ee29b848152bd0a3da788b6ece783f
---
# TODO · x-basalt

## 待办

- [ ] 复现复杂任务失败，记录输入、预期结果与调用轨迹，定位失败环节。（[讨论记录](docs/research/2026-09-30-agent-knowledge-industry-landscape.md#94-后续讨论与待办背景2026-09-302026-10-01)）
- [ ] 复现外部 AI 委托 chat 的能力发现路径，明确入口分流策略。（[讨论记录](docs/research/2026-09-30-agent-knowledge-industry-landscape.md#94-后续讨论与待办背景2026-09-302026-10-01)、[消费侧入口](skills-def/cli/x-basalt/SKILL.md)、[双入口设计](docs/design/chat-tool-surface.md#6-宿主投入与接口纪律2026-09-30)）
- [ ] 根据复现确定下一轮实施切口、验收用例与非目标。（[实验与停点](docs/research/2026-09-30-agent-knowledge-industry-landscape.md#9-下一步实验可复现能推翻建议)）
- [ ] 按实施切口评估外部工具或成熟库的适配、成本、许可和失败边界。（[业界对照](docs/research/2026-09-30-agent-knowledge-industry-landscape.md#4-竞争与组合矩阵)、[库选型调研](docs/research/2026-06-26-libraries-survey.md)）
- [ ] 补齐 Bases 公式中的 `file()` / `link.asFile()` 解析能力及端到端测试。（[R08 定位](docs/research/2026-10-01-dql-bases-compatibility-local-audit.md#52-两个应独立修复的执行缺口)、[引擎实现](src/base/engine.ts)）
- [ ] 明确 DQL TASK 的 SORT/GROUP BY/FLATTEN 执行或拒绝行为，补齐端到端测试。（[R09 定位](docs/research/2026-10-01-dql-bases-compatibility-local-audit.md#52-两个应独立修复的执行缺口)、[SQL 生成器](src/query/sql-generator.ts)）
- [ ] 建立 DQL/Bases 兼容投入账本，确定特性边界、目标版本与实施顺序。（[投入建议](docs/research/2026-10-01-dql-bases-compatibility-local-audit.md#62-条件化投入建议尚待用户决定)、[现有校正账本](docs/design/bases-vs-official.md)、[实现状态](docs/design/bases-status.md)）
- [ ] 核对 Bases 语法接地计划与评测记录的收口状态，同步计划状态及归档。（[原计划与验收记录](docs/plans/2026-08-08-bases-chat-grounding.md)、[状态核对背景](docs/research/2026-09-30-agent-knowledge-industry-landscape.md#94-后续讨论与待办背景2026-09-302026-10-01)）

## 长期待办

- [ ] 扩展任务 emoji 字段、任务状态及到期日过滤。（[历史差距](docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#a-dataview-元数据采集层最关键)、[当前 TASK 边界](docs/use/dql.md#33-task)）
- [ ] 补齐 DQL 的 `default`、数组高阶和聚合函数。（[历史差距](docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#b-dataview-查询表达力层)、[当前函数集](docs/use/dql.md#6-内置函数)）
- [ ] 复核 FROM 多源 AND/OR 的实现取舍。（[冻结裁决](docs/design/dql-subset.md#冻结裁决表每个纳入项附-astsql-策略证明可实现)、[历史复核建议](docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md#c-dataview-查询入口)）
- [ ] 为 `runPipeline` 接入 `AbortSignal` 协作取消，补齐 `onBusy restart/ignore`、背压、缓存跳过、条件分支、检查点续跑和失败告警。（[编排设计与能力地图](docs/design/change-orchestration.md)）
- [ ] 完善跨平台 shell 管道的 stdin/stdout 契约。（[传输设计与验收矩阵](docs/design/shell-pipe-portability.md)）
- [ ] 按实际需求扩展元数据 profile。（[当前 profile 设计](docs/design/meta-subset.md)、[profile 调研](docs/research/2026-06-28-metadata-profiles-research.md)）
- [ ] 评估 embedding 语义检索的准入条件与集成方案。（[准入与候选方案](docs/design/semantic-retrieval.md#5-可选-embedding-的候选方案未实现)）
- [ ] 评估使用 Kysely 收编 DQL→SQL。（[选型调研](docs/research/2026-06-26-libraries-survey.md#2-索引层-indexer)、[当前 SQL 生成器](src/query/sql-generator.ts)）

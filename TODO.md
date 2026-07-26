# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。已完成的不堆这——见 git log、`docs/plans/`、`docs/specs/`。


## 🔥 2026-07-22 Obsidian Bases 无头执行引擎（下一核心优先级）

方向已完成调研、场景矩阵与实现前设计冻结：

- 调研：[`docs/research/2026-07-22-obsidian-bases-headless-engine-research.md`](docs/research/2026-07-22-obsidian-bases-headless-engine-research.md)
- 场景：[`docs/testing/2026-07-22-bases-scenario-matrix.md`](docs/testing/2026-07-22-bases-scenario-matrix.md)
- 规范：[`docs/specs/2026-07-22-bases-headless-engine-design.md`](docs/specs/2026-07-22-bases-headless-engine-design.md)

定位：实现真正无 GUI、无 Obsidian 运行时的 `.base` 查询库层；官方 `base:query` 只作串行语义 oracle，不进入运行时依赖。首期明确为 **Bases Markdown conformance 2026-07**，不冒充 all-files 完整兼容。

- [ ] **P0 · document/schema/diagnostic**：`.base` YAML + view 选择 + filter 结构校验 + expression source span；先完成 `BASE-DOC-001..009`。
- [ ] **P1 · Markdown query vertical slice**：独立 Bases AST/evaluator，支持 global+view filters、note/file properties、常用 file/string/list 方法、order/sort/limit 与稳定 JSON；不复用 DQL AST，不用 `eval`。
- [ ] **P1 oracle · 串行差分**：固定官方版本，先冻结 missing/null/truthiness、null 排序、类型错误等争议语义；禁止并发拉起 GUI。
- [ ] **P2 · typed formulas/group/summary**：Property 类型、Date/Link/File/List、公式依赖图与循环、高阶列表、groupBy/summaries；以真实需求逐项开计划。
- [ ] **P3 · all-files/context**：附件数据集、embedded `base` code block、显式 `contextFile`/`this`；先做独立 indexer schema 决策，证明不改变既有 DQL `.md` 数据集。

**暂缓**：内置 chat 打磨、DQL 函数全集、task emoji 全字段、lint CI/baseline、embedding、复杂编排器。它们不能优先于 Bases P0/P1，除非 dogfood 出现阻断性缺陷。

**实现前停点**：需先确认 Markdown-only 口径；若 P1 场景超过三分之一依赖附件、动态 UI `this` 或不可稳定观测的闭源语义，则退回 `.base` lint/inspect，不以猜测补齐兼容。


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

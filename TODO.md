# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。已完成的不堆这——见 git log、`docs/plans/`、`docs/specs/`。


## 🔥 2026-07-22 Obsidian Bases 无头执行引擎（下一核心优先级）

方向已完成调研、场景矩阵与实现前设计冻结：

- 调研：[`docs/research/2026-07-22-obsidian-bases-headless-engine-research.md`](docs/research/2026-07-22-obsidian-bases-headless-engine-research.md)
- 场景：[`docs/testing/2026-07-22-bases-scenario-matrix.md`](docs/testing/2026-07-22-bases-scenario-matrix.md)
- 规范：[`docs/specs/2026-07-22-bases-headless-engine-design.md`](docs/specs/2026-07-22-bases-headless-engine-design.md)
- 语法真相源：[`docs/specs/2026-07-26-bases-syntax.md`](docs/specs/2026-07-26-bases-syntax.md)
- 实现状态追踪（living，逐项标记）：[`docs/testing/2026-07-26-bases-implementation-status.md`](docs/testing/2026-07-26-bases-implementation-status.md)

定位：实现真正无 GUI、无 Obsidian 运行时的 `.base` 查询库层；官方 `base:query` 只作串行语义 oracle，不进入运行时依赖。首期明确为 **Bases Markdown conformance 2026-07**，不冒充 all-files 完整兼容。

- [x] **P0 · document/schema/diagnostic**：`.base` YAML + view 选择 + filter 结构校验 + expression source span；先完成 `BASE-DOC-001..009`。计划：[`docs/plans/2026-07-26-bases-p0-document-schema.md`](docs/plans/2026-07-26-bases-p0-document-schema.md)（2026-07-26 落地，含 SEC-007/008）
- [x] **P1 · Markdown query vertical slice**：独立 Bases AST/evaluator，支持 global+view filters、note/file properties、常用 file/string/list 方法、order/sort/limit 与稳定 JSON；不复用 DQL AST，不用 `eval`。计划：[`docs/plans/2026-07-26-bases-p1-markdown-query.md`](docs/plans/2026-07-26-bases-p1-markdown-query.md)（2026-07-26 落地，含 SEC-001/002/003/009 与字节稳定；oracle 冻结项为暂定口径）
- [x] **P1 收口 · CLI 薄出口 + guides**：`x-basalt base` 命令（JSON 契约、error 诊断 exit 1）+ `guides/querying-bases.md`。计划：[`docs/plans/2026-07-27-bases-cli-export.md`](docs/plans/2026-07-27-bases-cli-export.md)（2026-07-27 落地）
- [ ] **P1 oracle · 串行差分**：固定官方版本，先冻结 missing/null/truthiness、null 排序、类型错误等争议语义；禁止并发拉起 GUI。
- [ ] **P2 · typed formulas/group/summary**：Property 类型、Date/Link/File/List、公式依赖图与循环、高阶列表、groupBy/summaries；以真实需求逐项开计划。
  - [x] **P2a · formulas 核心**（typed values + 算术 + 依赖图/cycle + clock，BASE-FORM-001..006/SEC-006）：[`docs/plans/2026-07-27-bases-p2a-formulas.md`](docs/plans/2026-07-27-bases-p2a-formulas.md)（2026-07-27 落地）
  - [x] **P2b · types.json / list 高阶 / groupBy / summaries**（BASE-TYPE-001..003、LIST-001、GROUP-001、SUM-001/002；TYPE-004 与 GROUP-002 待 oracle）计划：[`docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md`](docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md)（2026-07-27 落地）
- [ ] **P3 · all-files/context**：附件数据集、embedded `base` code block、显式 `contextFile`/`this`；先做独立 indexer schema 决策，证明不改变既有 DQL `.md` 数据集。schema 决策已冻结：[`docs/specs/2026-07-27-bases-p3-vault-entries-decision.md`](docs/specs/2026-07-27-bases-p3-vault-entries-decision.md)（2026-07-27；实施另开计划）

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

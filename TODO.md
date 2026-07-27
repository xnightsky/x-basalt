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

> **下一步（2026-07-27 收口后）**：P0/P1/P2a/P2b 与 review 修复批次全部落地，四门（typecheck / lint / format / test 793）皆绿。**建议下一件事做 P1 oracle 而不是 P3**——理由见下方 oracle 条目；oracle 需用户侧 Obsidian App 环境，AI 侧无法自行推进。

- [x] **P0 · document/schema/diagnostic**：`.base` YAML + view 选择 + filter 结构校验 + expression source span；先完成 `BASE-DOC-001..009`。计划：[`docs/plans/2026-07-26-bases-p0-document-schema.md`](docs/plans/2026-07-26-bases-p0-document-schema.md)（2026-07-26 落地，含 SEC-007/008）
- [x] **P1 · Markdown query vertical slice**：独立 Bases AST/evaluator，支持 global+view filters、note/file properties、常用 file/string/list 方法、order/sort/limit 与稳定 JSON；不复用 DQL AST，不用 `eval`。计划：[`docs/plans/2026-07-26-bases-p1-markdown-query.md`](docs/plans/2026-07-26-bases-p1-markdown-query.md)（2026-07-26 落地，含 SEC-001/002/003/009 与字节稳定；oracle 冻结项为暂定口径）
- [x] **P1 收口 · CLI 薄出口 + guides**：`x-basalt base` 命令（JSON 契约、error 诊断 exit 1）+ `guides/querying-bases.md`。计划：[`docs/plans/2026-07-27-bases-cli-export.md`](docs/plans/2026-07-27-bases-cli-export.md)（2026-07-27 落地）
- [ ] **⭐ P1 oracle · 串行差分（当前唯一硬阻塞，建议先于 P3）**：固定官方版本，冻结 **9 项**争议语义；禁止并发拉起 GUI。
  - **为什么排在 P3 前面**：这 9 项目前都是**暂定口径**——实现能跑、测试也锁着，但没有与官方比对过，随时可能是错的。P3 是**加能力**，oracle 是**验证已有能力对不对**；暂定口径压着不解，P3 做得越多、将来校正要翻的面越大（P3 的附件行同样要走 truthiness / null 排序 / 类型比较这几条已存疑的路径）。
  - **准备度**：runbook 已就绪，26 个 view + 观察记录表 + 校正工作流全部写好 → [`docs/testing/2026-07-27-bases-oracle-runbook.md`](docs/testing/2026-07-27-bases-oracle-runbook.md)；fixture 在 `tests/fixtures/bases/oracle/`。
  - **卡点**：需要装了 Obsidian App 的机器人工串行跑一遍，**AI 侧做不了**，须用户触发。
  - 9 项清单与逐项暂定口径见[实现状态追踪](docs/testing/2026-07-26-bases-implementation-status.md) §3 / §4；跑完按 runbook §5 校正工作流回填。
- [ ] **P2 · typed formulas/group/summary**：Property 类型、Date/Link/File/List、公式依赖图与循环、高阶列表、groupBy/summaries；以真实需求逐项开计划。
  - [x] **P2a · formulas 核心**（typed values + 算术 + 依赖图/cycle + clock，BASE-FORM-001..006/SEC-006）：[`docs/plans/2026-07-27-bases-p2a-formulas.md`](docs/plans/2026-07-27-bases-p2a-formulas.md)（2026-07-27 落地）
  - [x] **P2b · types.json / list 高阶 / groupBy / summaries**（BASE-TYPE-001..003、LIST-001、GROUP-001、SUM-001/002；TYPE-004 与 GROUP-002 待 oracle）计划：[`docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md`](docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md)（2026-07-27 落地）
- [x] **P0..P2b 收口 · code review 修复批次**：view 必填字段静默通过、Windows 盘符大小写误判越界、多根 `.base` 主键缺命名空间、`order`/`sort` 静默丢项、`maxOperations` 非查询总额、解析缓存无界。计划：[`docs/plans/2026-07-27-bases-code-review-fixes.md`](docs/plans/2026-07-27-bases-code-review-fixes.md)（2026-07-27 落地）
- [x] **收口附带修复**（2026-07-27，同批次外的两笔）：①**不加引号的 frontmatter 日期静默失去日期语义**——读侧 YAML 引擎改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型），与写侧 `src/meta` 统一；②**`format:check` 门禁此前从未可通过**——`.prettierignore` 豁免 fixtures + 作用域收敛为 `src tests scripts` + 一次性格式化 13 个文件。全量 **793 测试绿**。
- [ ] **P3 · all-files/context（建议等 oracle 之后再开）**：附件数据集、embedded `base` code block、显式 `contextFile`/`this`；先做独立 indexer schema 决策，证明不改变既有 DQL `.md` 数据集。schema 决策已冻结：[`docs/specs/2026-07-27-bases-p3-vault-entries-decision.md`](docs/specs/2026-07-27-bases-p3-vault-entries-decision.md)（2026-07-27；实施另开计划）。**软序而非硬依赖**：真有 dogfood 需求可以先动，但要接受届时 oracle 结论可能同时推翻 P1/P2 与 P3 两层的暂定口径。
  - [x] **P3a · 附件数据集（vault_entries + all-files 模式，BASE-ALL-001/002）**：schema+indexer 六条写入路径 → base all-files 数据源 → DQL 不变证明 + CLI `--conformance`，三片全部落地。计划：[`docs/plans/2026-07-27-bases-p3-attachments.md`](docs/plans/2026-07-27-bases-p3-attachments.md)（2026-07-27 用户拍板「附件数据集优先」开片；片一 schema+indexer、片二 all-files 数据源 + conformance 开关、片三 DDL 防漂移锁 + DQL 不变回归 + CLI + 基准全部落地。embedded code block 与 contextFile/this 仍另开计划）

**暂缓**：内置 chat 打磨、DQL 函数全集、task emoji 全字段、lint CI/baseline、embedding、复杂编排器。它们不能优先于 **Bases oracle**（原文写「P0/P1」，两者均已完成，优先级基准顺延至 oracle），除非 dogfood 出现阻断性缺陷。

**实现前停点（已通过，留档）**：原定「若 P1 场景超过三分之一依赖附件 / 动态 UI `this` / 不可稳定观测的闭源语义，则退回 `.base` lint/inspect」。实际结论：P1 全部场景在 Markdown-only 口径下可实现且可测，未触发退回；附件与 `this` 划入 P3，争议语义走 oracle 校正而非猜测补齐。


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

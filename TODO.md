# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。**已完成的不堆这**——见 git log、`docs/plans/`、`docs/specs/`。

## ▶ 当前：变更编排器 P0 实现中（2026-06-29 起）

按 spec 开工：实现 `src/orchestrator/`（源→堆积→去重→路由→执行）。计划见 [`docs/plans/2026-06-29-change-orchestration.md`](docs/plans/2026-06-29-change-orchestration.md)，设计见 [`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md)。范围 = spec §12 的 P0；写动作默认 dry-run。

## dogfood 观察期（2026-06-28 起）

核心读侧（解析/索引/查询/召回/CLI）+ 写侧（meta：CRUD / normalize / profile-apply，3 套 profile）均已落地。**先不发布，全局安装实际用一段时间，据真实反馈再迭代。**

- 已 `npm link` 全局：`x-basalt` 全局可用（live → 仓库 `dist/`；**改源码需 `pnpm build` 重编才生效**）。
- 暂不发布（阶段 5 推迟到观察期后）。

## 💡 backlog（待 dogfood 暴露真实需求再开，各自写计划/spec）

- **变更编排器（change orchestration）**：把 `watch`（实时）/`scan`（diff）/手动批量统一为**同一条声明式管线的三个「源」**——源 → 堆积(debounce+maxWait) → 去重(L2/L3 事件折叠) → **路由(DQL 选择器)** → 执行(有界并发/重启语义/超时/失败continue/dry-run/优雅退出)，跑一串**强类型内建动作**(index/normalize/apply…)自动维护 vault。**吸收原 `migrate` 与 `watch pipeline` 两项**：批量改元数据 = 手动源+写动作（不再独立立项；调研结论：批量改属性「键」官方本体已做，「值」级才是空白）。**有评估背书**：[`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md)。设计完整、实现分阶段（P0 只读先行、写动作后置 dry-run）；**现在不做**，触发条件见 spec §13。
- **lint（schema 校验）**：按用户 schema 校验属性存在性/类型/取值，报告或修（"修"复用 normalize/set）。需先定 frontmatter schema 格式（JSON Schema 或自创轻量 DSL，对标 `remark-lint-frontmatter-schema`）——长期 API 承诺最重，**最后做**。- **更多 profile**：按需扩（加 profile = 加数据；现有 `pkm-note` / `llm-wiki` / `ssg-blog`）。
- **meta refresh（机械字段重算）**：dogfood 发现——`meta apply` 对已存在的机械字段（`timestamp`/`sha256`）是 top-up 不重算，文档改内容后须先 `unset` 再 `apply` 才能刷新。可加 `meta apply --refresh-derived` / `meta refresh` 一键重算 derive 字段。小改动，按需做。
- **不做**：type 强制 / 日期格式统一（调研判风险高、格式不确定）。
- **语义/全文检索（S3.5）**：FTS5 全文（core、无 AI、中文 trigram）补"查正文"空洞；embedding 向量做成最小可选 AI（接口后、默认关、FTS5 兜底）。**有评估背书**：[`docs/specs/2026-06-28-semantic-retrieval-integration.md`](docs/specs/2026-06-28-semantic-retrieval-integration.md)。FTS5 优先级高于 embedding；**现在不做**，触发条件见 spec。
- **CLI chat（可选 AI · 远期）**：自然语言驱动 vault，对标 `agent-browser chat`（单发 `chat "<指令>"` + REPL）。最小可选 AI——内核纯离线、默认关、用户自配 `AI_GATEWAY_*`（兼容 agent-browser）、无配置全功能。**有评估背书**：[`docs/specs/2026-06-28-cli-chat-design.md`](docs/specs/2026-06-28-cli-chat-design.md)。依赖 FTS5 先落地，**现在不做**。
- **可选增强**（按需再定）：S3.4 kysely 收编 DQL→SQL。

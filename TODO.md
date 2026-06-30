# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。**已完成的不堆这**——见 git log、`docs/plans/`、`docs/specs/`。

## dogfood 观察期（2026-06-28 起）

核心读侧（解析/索引/查询/召回/CLI）+ 写侧（meta：CRUD / normalize / profile-apply + `--refresh-derived`，3 套 profile）+ 变更编排器 **P0 + P1 写动作**（`--pipe` 五段管线 + `--apply` 落盘闸 + apply/set/unset/rename + if-exists）均已落地（详见 git log、`docs/plans/`、`docs/specs/`）。**先不发布，全局安装实际用一段时间，据真实反馈再迭代。**

- 已 `npm link` 全局：`x-basalt` 全局可用（live → 仓库 `dist/`；**改源码需 `pnpm build` 重编才生效**）。
- 暂不发布（阶段 5 推迟到观察期后）。

## 🚧 执行中：CLI chat（读+写，可选 AI）

dogfood 期决定提前做：自然语言驱动 vault 的 `chat` 子命令（单发 + REPL）。**范围读+写**（既有读原语 + meta 写 + 编排器一次性批量），仅排除常驻 watch；「按正文找」依赖 FTS5 仍推后。最小可选 AI（内核零 AI、`src/chat/` 懒加载 Vercel `ai` SDK、`AI_GATEWAY_*` 兼容、无 key 友好退出）；写动作直接落盘、Ctrl+C 中断（无确认闸，见设计变更）。

- 设计：[`docs/specs/2026-06-30-cli-chat-readwrite-design.md`](docs/specs/2026-06-30-cli-chat-readwrite-design.md)（父评估 [`docs/specs/2026-06-28-cli-chat-design.md`](docs/specs/2026-06-28-cli-chat-design.md)）。
- 计划：[`docs/plans/2026-06-30-cli-chat-readwrite.md`](docs/plans/2026-06-30-cli-chat-readwrite.md)（4 段：P1 provider ✅ → P2 safety ✅ → P3 tools+loop ✅ → P4 单发+REPL+cli）。
- 交付：pi 起进程逐段实现，编排方编排+独立复核（不轻信 pi 自报）。
- 设计变更（2026-06-30）：删除写动作逐动作确认；写工具直接落盘，终止靠 Ctrl+C/SIGINT → AbortController。

## 📋 2026-06-30 优化方向调研产出（发现问题 → 落地文档）

本轮「如何优化」会话的诊断与对标调研已全部落地为文档（总入口：[`docs/research/2026-06-30-optimization-overview.md`](docs/research/2026-06-30-optimization-overview.md)）：

- **功能覆盖 gap**（对标官方 Dataview/Obsidian，deep-research 22 确认）：[`docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md) — inline fields 完全缺失、内置函数覆盖 ~15%、task emoji 多字段缺失、Lambda/动态访问/Inline DQL/GROUP BY swizzling 缺失。
- **chat 可用性**（对标 agent-browser 三痛点）：[`docs/research/2026-06-30-chat-gap-vs-agent-browser.md`](docs/research/2026-06-30-chat-gap-vs-agent-browser.md) — 工具调用无重试（→失败率高）、撞顶静默停（→轮询到上限停）、缺读正文/全文搜/列笔记。
- **chat 评估/场景库**（兄弟目录素材库，设计草案，**选址/格式待拍板**）：[`docs/specs/2026-06-30-chat-eval-scenario-library-design.md`](docs/specs/2026-06-30-chat-eval-scenario-library-design.md)。

> 高频刚需缺口（据上述调研，待各自开计划/spec）：**inline fields 提取** · **task emoji 多字段+完成状态** · **内置函数补一批**（default/数组高阶/聚合）· **FTS5 全文检索** · **chat 工具重试+撞顶续作**。FROM 多源 AND/OR 取舍建议复核（官方高频）。

## 💡 backlog（待 dogfood 暴露真实需求再开，各自写计划/spec）

- **变更编排器 P1 余项 / P2（change orchestration）**：P0 + 统一 `--pipe` + `--apply` + 写动作（apply/set/unset/rename + if-exists）已落地。**P1 余项待续**：背压、缓存跳过、条件分支、检查点续跑、失败告警、内容 hash 去重、**原生管道 stdin（spec §8.3）**、管道 `set` 列表值（现仅标量）。**P2**：DAG/补偿回滚/定时·空闲触发/配置热重载。设计见 [`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md) §8/§12；**按 dogfood 真实需求再开**。
- **lint（schema 校验）**：按用户 schema 校验属性存在性/类型/取值，报告或修（"修"复用 normalize/set）。需先定 frontmatter schema 格式（JSON Schema 或自创轻量 DSL，对标 `remark-lint-frontmatter-schema`）——长期 API 承诺最重，**最后做**。
- **更多 profile**：按需扩（加 profile = 加数据；现有 `pkm-note` / `llm-wiki` / `ssg-blog`）。
- **不做**：type 强制 / 日期格式统一（调研判风险高、格式不确定）。
- **语义/全文检索（S3.5）**：FTS5 全文（core、无 AI、中文 trigram）补"查正文"空洞；embedding 向量做成最小可选 AI（接口后、默认关、FTS5 兜底）。**有评估背书**：[`docs/specs/2026-06-28-semantic-retrieval-integration.md`](docs/specs/2026-06-28-semantic-retrieval-integration.md)。FTS5 优先级高于 embedding；**现在不做**，触发条件见 spec。
- ~~**CLI chat（可选 AI · 远期）**~~：已提为执行中，见上「🚧 执行中：CLI chat（读+写）」。范围调整为读+写同做、不待 FTS5（结构化先行）。
- **可选增强**（按需再定）：S3.4 kysely 收编 DQL→SQL。

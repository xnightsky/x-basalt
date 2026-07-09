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
- **chat 可用性**（对标 agent-browser 三痛点）：[`docs/research/2026-06-30-chat-gap-vs-agent-browser.md`](docs/research/2026-06-30-chat-gap-vs-agent-browser.md) — ~~工具调用无重试（→失败率高）、撞顶静默停（→轮询到上限停）、缺读正文/全文搜/列笔记~~ 均已落地（结构化错误+换策略引导、撞顶续跑、`read_note`/`list`/`search` 三工具，见下 ✅）。
- **chat 评估/场景库**（兄弟目录素材库，设计草案，**选址/格式待拍板**）：[`docs/specs/2026-06-30-chat-eval-scenario-library-design.md`](docs/specs/2026-06-30-chat-eval-scenario-library-design.md)。

> 高频刚需缺口（据上述调研，待各自开计划/spec）：~~inline fields 提取~~（已落地 2026-07-02：三形态解析 → `inline_fields` 表 → COALESCE 查询合并，见 [`docs/plans/2026-07-02-inline-fields.md`](docs/plans/2026-07-02-inline-fields.md) ✅）· **task emoji 多字段+完成状态** · **内置函数补一批**（default/数组高阶/聚合）· ~~FTS5 全文检索~~（已落地，见下 ✅）· ~~chat 工具重试+撞顶续作~~（已落地为「结构化错误+换策略引导」+「撞顶续跑」，见下 ✅）。FROM 多源 AND/OR 取舍建议复核（官方高频）。

## 📋 2026-07-09 文档质量 / KB compiler 调研产出

本轮围绕「x-basalt 是否应内置 lint、links check、profile/schema、CI 友好模式」做外部生态调研，并落地为讲义式 research：[`docs/research/2026-07-09-markdown-kb-compiler-lint-links-research.md`](docs/research/2026-07-09-markdown-kb-compiler-lint-links-research.md)。

**结论**：方向成立，但切口应从“直接做完整 `lint`”调整为“先建带位置的结构化节点与统一 Issue 模型，再分层接 links / metadata / profile / CI / rewrite”。这避免 `lint --profile` 过早承诺长期 API，也避免 links 修复只能报数量、不能定位。

建议后续立项顺序：

1. **P0 parser 定位契约**：给 wikilink / Markdown link / image link 节点补 `line` / `column` / `raw` / `target`；明确 links 行号采用完整文件行号，便于编辑器与 CI 对齐。✅ 已落地：parser 保留链接诊断节点，indexer 维持 links 表去重。
2. **P1 `links check` / `links suggest`**：检查本地 Markdown 相对链接、图片、wikilink、embed；支持 ignore；按 basename 给路径建议。
3. **P2 统一 `BasaltIssue` + `lint` 壳**：冻结 `file` / `line` / `column` / `rule` / `severity` / `message` / `target` / `reason` / `suggestions` / `fixable` JSON 字段。
4. **P3 profile/schema v1**：在 `.x-basalt/config.*` 声明 `profiles.<name>.include|required|enums|tagRules|domain|ignore`，首版用轻量 DSL，不承诺完整 JSON Schema。
5. **P4 CI / baseline**：`--ci`、`--format github`、`--baseline` 在 Issue JSON 稳定后再做。
6. **P5 rewrite/fix**：`links rewrite --apply` 与有限 `lint --fix` 最后做；默认 dry-run，不自动猜业务语义。

## 🟡 进行中（2026-07-01）：chat 对话打磨（B 止血 P0 + 可玩化）

**验证方式改为「手玩」**：AI agent 行为质量在场景库（C 线）落地前没法靠自动化判定——本次**删除了为 chat 新增的 AI 行为单测**（tool-errors / repl / loop-exhausted / tools-dql 集成），保留会话前就有的确定性测试（safety / provider / isolation / loop 主路径 / tools 主路径）。production 代码保留，靠 `docs/guides/chat.md` 指引**亲手玩**来验证。

**已落地（production，typecheck/build 通过；逻辑确定但 agent 效果未验证）**：

- **工具错误结构化 + 换策略引导（非机械重试）**：`src/chat/tool-errors.ts` 分类底层错误（DQL→dql / 库未建 `SQLITE_CANTOPEN`→not-found / `ENOENT`→not-found / 瞬时→transient），包成「[工具失败·类] 原因 + 换策略建议」回灌；SYSTEM_PROMPT 加「失败换写法/角度（A≠B）、别硬试同一操作」。**方向修正**：原 §2.1「工具重试」改为「结构化 + 引导换策略」——chat 读多写少、工具皆一次性独立调用（无会话读写事务），机械精准重试无土壤（详见 memory `chat-retry-as-strategy-not-precision`）。
- **撞顶区分 + REPL 续跑**：`loop.ts` 返回 `stopReason`（done/exhausted，按末步是否仍 `toolCalls` 判）；exhausted 显式提示、REPL 输入「继续」用现有上下文续跑；默认步数 12→20。
- **REPL 可玩化（最小实现，无 TUI 框架）**：启动横幅、`help` 速查、`examples`/`例子` 列可玩示例指令（含一条故意写错 DQL 观察自纠）、撞顶提示符引导、退出语。
- **文档**：新增 [`docs/guides/chat.md`](docs/guides/chat.md)（怎么玩：前置/建索引/试这些/看什么/限制）；`commands.md` 补 `chat` 条目+目录。

### 🐞 未做 / 缺陷（待续，按优先级）

- **[阻断验证] 没有场景库 → chat 效果无法量化回归**：成功率/撞顶率/自纠是否真改善，全靠手玩主观判断。**这是当前最大缺口**，对应 C 线（[`docs/specs/2026-06-30-chat-eval-scenario-library-design.md`](docs/specs/2026-06-30-chat-eval-scenario-library-design.md)），需先拍板**选址 + 格式**（§3 待定项）。
- **[开放设计] chat 是否需要真正的「读写机制」未调研**：现工具皆一次性独立调用，无会话级事务 / 读写状态协调（如读后写一致性、批内回滚）。用户明确未调研——独立开放项，需先调研再决定要不要做。
- **[已部分验] 机制端到端已用 mock 自验**（2026-07-01）：① 工具失败→结构化错误在轮内送达模型、可据以自纠 ✓；② 撞顶 `exhausted` + 「继续」续跑（消息累积）✓；③ REPL 命令派发 + 横幅/help/examples 文本 ✓。**仍未验**：真 provider 下的流式输出与 `Ctrl+C` 中断手感、以及 **LLM 答案质量**（需真 key + 场景库，非自验可达——见上 [阻断验证]）。
- **[收尾·大半已结，2026-07-01]** ~~`usage.md` 加 chat 链接~~ ✅、~~`chat.md` 补 frontmatter（已用 x-basalt `meta apply llm-wiki` dogfood，含 `--refresh-derived` 刷 sha256）~~ ✅、~~plan 勾选~~ ✅（Phase 3/4 标完成，仅留「有 key dogfood」未勾）、~~chat.md/commands.md 示例去 `--vault`/`--db` 噪声~~ ✅（配 config 后裸跑，用户反馈）。**仍欠**：有 key 真实 dogfood（单发+REPL+写入+pipeline+Ctrl+C）未跑（需真 key）。
- **[缺陷] 撞顶判定真 provider 未验**：`stopReason` 靠 `step.toolCalls` 非空判，仅在 mock 验证过形状；真实 provider 下「最后一步既出文本又留 toolCall」等边界未实测。
- **[缺陷] 默认 maxSteps=20 是拍的**：未经场景库实测校准（grounding 1-2 步 + 任务步的真实分布未知）。
- **[缺陷] 错误分类启发式有限**：`tool-errors.ts` 对非 `DqlSyntaxError` 来源的错误靠中文/英文 message 关键字兜底，可能漏判（落到 unknown 给泛建议）；写侧 `SQLITE_BUSY` 兜底重试**未做**（按取舍故意不做，需要时再加极简单次重试）。
- ~~**[能力缺口] read_note / list / 全文搜**~~ 已全部落地（2026-07-02）：`read_note`/`list`（P1，`DataviewEngine.list`/`generateListSql`）+ `search`（P2，FTS5 + trigram，`files_fts` 虚表由 indexer 唯一写边界维护、版本号迁移守卫、MATCH 注入防护，`DataviewEngine.search` + CLI `search` 命令 + chat `search` 工具）。答得了「读整篇正文」「列出有哪些笔记」「哪篇正文提到 X」三类此前答不了的请求（chat-gap §2.3 P1+P2）。

## 💡 backlog（待 dogfood 暴露真实需求再开，各自写计划/spec）

- **inline fields 扩展项一律降级（2026-07-02 调研定案）**：值类型化 / 多值列表化 / 带空格 key / `file.inlineFields` / meta 写回 inline（spec §5 backlog 清单）默认**不做**——生态正转向 frontmatter/Properties（官方 Bases 明确不支持 inline、Datacore 被官方建议弃用之），inline 支持定位为**兼容存量 vault 的读侧能力**（v1 已落地即止）。依据：[`docs/research/2026-07-02-inline-fields-adoption-outlook.md`](docs/research/2026-07-02-inline-fields-adoption-outlook.md)。后续更值得调研：task emoji 字段、官方 Bases `.base` 格式。

- **变更编排器 P1 余项 / P2（change orchestration）**：P0 + 统一 `--pipe` + `--apply` + 写动作（apply/set/unset/rename + if-exists）已落地。**P1 余项待续**：背压、缓存跳过、条件分支、检查点续跑、失败告警、内容 hash 去重、**原生管道 stdin（spec §8.3）**、管道 `set` 列表值（现仅标量）。**P2**：DAG/补偿回滚/定时·空闲触发/配置热重载。设计见 [`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md) §8/§12；**按 dogfood 真实需求再开**。
- **KB compiler / lint / links 分层路线**：已调研定案（见上 2026-07-09 段），设计入口已建立：[`docs/specs/2026-07-09-kb-compiler-lint-links-design.md`](docs/specs/2026-07-09-kb-compiler-lint-links-design.md)。P0 parser link 定位契约已按 [`docs/plans/2026-07-09-kb-compiler-parser-position.md`](docs/plans/2026-07-09-kb-compiler-parser-position.md) 落地；下一步开 P1 `links check` / `links suggest` 计划，**禁止直接跳到大而全 `lint --profile --fix`**。
- **更多 profile**：按需扩（加 profile = 加数据；现有 `pkm-note` / `llm-wiki` / `ssg-blog`）。
- **不做**：type 强制 / 日期格式统一（调研判风险高、格式不确定）。
- ~~**语义/全文检索（S3.5）**~~：FTS5 全文部分（core、无 AI、中文 trigram）**已落地**（2026-07-02，见上「🐞」段）——`files_fts` 虚表 + 版本号迁移守卫 + `DataviewEngine.search`/CLI `search`/chat `search` 工具。**embedding 向量语义检索仍是 backlog**（接口后、默认关、FTS5 兜底，触发条件见 [`docs/specs/2026-06-28-semantic-retrieval-integration.md`](docs/specs/2026-06-28-semantic-retrieval-integration.md) §10：dogfood 中出现"想按正文内容找笔记但 FTS5 子串匹配不够、确有穷尽概念相关刚需"再立计划）。
- ~~**CLI chat（可选 AI · 远期）**~~：已提为执行中，见上「🚧 执行中：CLI chat（读+写）」。范围调整为读+写同做、不待 FTS5（结构化先行）。
- **可选增强**（按需再定）：S3.4 kysely 收编 DQL→SQL。

# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。**已完成的不堆这**——见 git log、`docs/plans/`、`docs/specs/`。

## dogfood 观察期（2026-06-28 起）

核心读侧（解析/索引/查询/召回/CLI）+ 写侧（meta：CRUD / normalize / profile-apply + `--refresh-derived`，3 套 profile）+ 变更编排器 **P0 + P1 写动作**（`--pipe` 五段管线 + `--apply` 落盘闸 + apply/set/unset/rename + if-exists）+ **CLI chat（读+写，可选 AI，单发 + REPL）** 均已落地（详见 git log、`docs/plans/`、`docs/specs/`）。**先不发布，全局安装实际用一段时间，据真实反馈再迭代。**

- 已 `npm link` 全局：`x-basalt` 全局可用（live → 仓库 `dist/`；**改源码需 `pnpm build` 重编才生效**）。
- 暂不发布（阶段 5 推迟到观察期后）。

## 📋 2026-07-09 文档质量 / KB compiler 调研产出

本轮围绕「x-basalt 是否应内置 lint、links check、profile/schema、CI 友好模式」做外部生态调研，并落地为讲义式 research：[`docs/research/2026-07-09-markdown-kb-compiler-lint-links-research.md`](docs/research/2026-07-09-markdown-kb-compiler-lint-links-research.md)。

**结论**：方向成立，但切口应从“直接做完整 `lint`”调整为“先建带位置的结构化节点与统一 Issue 模型，再分层接 links / metadata / profile / CI / rewrite”。这避免 `lint --profile` 过早承诺长期 API，也避免 links 修复只能报数量、不能定位。

建议后续立项顺序：

1. **P0 parser 定位契约**：给 wikilink / Markdown link / image link 节点补 `line` / `column` / `raw` / `target`；明确 links 行号采用完整文件行号，便于编辑器与 CI 对齐。✅ 已落地：parser 保留链接诊断节点，indexer 维持 links 表去重。
2. **P1 `links check` / `links suggest`**：检查本地 Markdown 相对链接、图片、wikilink、embed；支持 ignore；按 basename 给路径建议。**← 下一步（P0 地基已铺好，纯 core 无 AI，好写测试）**
3. **P2 统一 `BasaltIssue` + `lint` 壳**：冻结 `file` / `line` / `column` / `rule` / `severity` / `message` / `target` / `reason` / `suggestions` / `fixable` JSON 字段。
4. **P3 profile/schema v1**：在 `.x-basalt/config.*` 声明 `profiles.<name>.include|required|enums|tagRules|domain|ignore`，首版用轻量 DSL，不承诺完整 JSON Schema。
5. **P4 CI / baseline**：`--ci`、`--format github`、`--baseline` 在 Issue JSON 稳定后再做。
6. **P5 rewrite/fix**：`links rewrite --apply` 与有限 `lint --fix` 最后做；默认 dry-run，不自动猜业务语义。

设计入口：[`docs/specs/2026-07-09-kb-compiler-lint-links-design.md`](docs/specs/2026-07-09-kb-compiler-lint-links-design.md)。P0 已按 [`docs/plans/2026-07-09-kb-compiler-parser-position.md`](docs/plans/2026-07-09-kb-compiler-parser-position.md) 落地；**禁止直接跳到大而全 `lint --profile --fix`**。

## 📋 功能覆盖 gap（对标官方 Dataview/Obsidian，deep-research 22 确认）

调研全部落档，总入口 [`docs/research/2026-06-30-optimization-overview.md`](docs/research/2026-06-30-optimization-overview.md)。**已落地**：inline fields（三形态解析→查询期合并，2026-07-02）、FTS5 全文检索（trigram + `search`，2026-07-02）、chat 三痛点（结构化错误+撞顶续跑+`read_note`/`list`/`search`）。**仍未做的高频缺口**（各自待开计划/spec）：

- **task emoji 多字段 + 完成状态**（覆盖不全）。
- **内置函数补一批**（`default` / 数组高阶 / 聚合，现覆盖 ~15%）。
- **FROM 多源 AND/OR 取舍**复核（官方高频）。
- 详见 [`docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md)。

## 🟡 chat 对话打磨（已收尾，留验证 / 校准缺口）

止血 P0 + 可玩化 production 全部落地（结构化工具错误+换策略引导、撞顶 `done`/`exhausted` 区分 + REPL「继续」续跑、REPL 横幅/`help`/`examples`、[`docs/guides/chat.md`](docs/guides/chat.md)）。**验证靠手玩**：为 chat 新增的 AI 行为单测已删，保留会话前就有的确定性测试；机制端到端已用 mock 自验。开放 / 未验缺口：

- **[阻断验证] 没有场景库 → chat 效果无法量化回归**：成功率/撞顶率/自纠是否真改善全靠手玩主观判断。**当前最大缺口**，对应 C 线 [`docs/specs/2026-06-30-chat-eval-scenario-library-design.md`](docs/specs/2026-06-30-chat-eval-scenario-library-design.md)（选址 + 格式 §3 待拍板）。
- **[开放设计] chat 是否需要真正「读写机制」未调研**：现工具皆一次性独立调用，无会话级事务 / 读写状态协调（读后写一致性、批内回滚）。需先调研再决定要不要做。
- **[未验] 有 key 真实 dogfood 未跑**：单发 + REPL + 一次写入 + pipeline_run + Ctrl+C 中断手感、真 provider 流式输出、LLM 答案质量——需真 key + 场景库。
- **[校准缺口]**：撞顶 `stopReason` 判定真 provider 未验（仅 mock 验形状）；默认 `maxSteps=20` 是拍的、未经场景库校准；错误分类启发式有限（非 `DqlSyntaxError` 靠中英文 message 关键字兜底，可能漏判落 unknown）；写侧 `SQLITE_BUSY` 兜底重试按取舍故意未做。

## 💡 backlog（待 dogfood 暴露真实需求再开，各自写计划/spec）

- **inline fields 扩展项一律降级（2026-07-02 调研定案）**：值类型化 / 多值列表化 / 带空格 key / `file.inlineFields` / meta 写回 inline（spec §5 backlog 清单）默认**不做**——生态正转向 frontmatter/Properties（官方 Bases 明确不支持 inline，Datacore 被官方建议弃用之），inline 支持定位为**兼容存量 vault 的读侧能力**（v1 已落地即止）。依据：[`docs/research/2026-07-02-inline-fields-adoption-outlook.md`](docs/research/2026-07-02-inline-fields-adoption-outlook.md)。后续更值得调研：task emoji 字段、官方 Bases `.base` 格式。
- **变更编排器 P1 余项 / P2（change orchestration）**：P0 + 统一 `--pipe` + `--apply` + 写动作（apply/set/unset/rename + if-exists）已落地。**P1 余项待续**：背压、缓存跳过、条件分支、检查点续跑、失败告警、内容 hash 去重、**原生管道 stdin（spec §8.3）**、管道 `set` 列表值（现仅标量）。**P2**：DAG/补偿回滚/定时·空闲触发/配置热重载。设计见 [`docs/specs/2026-06-29-change-orchestration-design.md`](docs/specs/2026-06-29-change-orchestration-design.md) §8/§12；**按 dogfood 真实需求再开**。
- **更多 profile**：按需扩（加 profile = 加数据；现有 `pkm-note` / `llm-wiki` / `ssg-blog`）。
- **不做**：type 强制 / 日期格式统一（调研判风险高、格式不确定）。
- **embedding 向量语义检索**：FTS5 全文已落地；embedding 语义检索仍是 backlog（接口后、默认关、FTS5 兜底，触发条件见 [`docs/specs/2026-06-28-semantic-retrieval-integration.md`](docs/specs/2026-06-28-semantic-retrieval-integration.md) §10：dogfood 中出现“想按正文内容找笔记但 FTS5 子串匹配不够、确有穷尽概念相关刚需”再立计划）。
- **可选增强**（按需再定）：S3.4 kysely 收编 DQL→SQL。

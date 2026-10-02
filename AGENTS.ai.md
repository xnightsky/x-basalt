# AGENTS.ai

> AI / 工具 / 提交授权等规则的真相源。`AGENTS.md` 只保留人类速览与项目全局约束；改动优先落本文件。

## Superpowers 文档落点重定向

使用 Superpowers 的 brainstorming / writing-plans 等技能时，先评估任务大小与文档是否有持续维护价值，再决定是否落盘。本节覆盖技能默认的 `docs/superpowers/specs/`、`docs/superpowers/plans/` 路径；按文档用途分流，不另建工具专属文档树。

- **小任务**：在对话中说明目标、范围、方案与验收即可；不为走流程额外创建设计或计划文档。
- **中间态**：讨论、备选方案和临时分析不强制落盘。确有必要保留的过程稿放 `.tmp/` 下与正式目录同名的位置（如 `.tmp/design/`、`.tmp/plans/`）；`.tmp/` 已被 Git 忽略，不作为正式真相源。
- **正式成果**：用户确认需要持续维护后，设计进入 `docs/design/<topic>.md`，计划进入 `docs/plans/YYYY-MM-DD-<topic>.md`；提案标明未实现，不冒充当前实现。大型任务仍遵循 `AGENTS.md`：开始实现前更新根 `TODO.md` 并落正式计划。
- **集中归档**：满足归档条件的正式文档统一进入 `docs/archive/`，按 `decisions/`、`plans/`、`research/` 分类；不在各业务目录内另设归档目录。归档不等于内容失效，也不自动证明当前实现，保留原决策、证据与引用。

正式文档的维护与元数据规则见 [`docs/README.md`](docs/README.md) 与 `AGENTS.md`「Docs 维护」。技能中要求 commit / push 的步骤仍受下述 Git 授权约束。

## Git 提交约定

- **AI 默认不得自行 `git commit` / `git push`**；仅当用户在当前会话明确授权方可本地 commit。
- 提交信息**不带任何小尾巴**：不加 `Co-Authored-By: Claude Opus … <noreply@anthropic.com>`、不加 `🤖 Generated with …` 等 trailer 或署名行。
- 标题仍遵循 `AGENTS.md`「Commit 规范」：`type(scope): summary`（Conventional Commits + 中文 summary）。

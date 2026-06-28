# skills-def · 开发侧业务 skill 真相源

本目录是 x-basalt **开发期** AI 召回用 skill 的**唯一源码**。`.claude/skills/` 仅为安装产物（已 gitignore），由 `pnpm run skills:install` 从这里拷贝生成，**不要手改安装产物**。

> 区分：`skills-def/` 是开发侧（AI 写代码时召回规范）；仓库根的 `skill-data/` 是**产品运行时** SkillRecall 加载的数据，两者互不替代。

## 现有 skill

| skill | 用途 | 召回时机 |
|---|---|---|
| `biz-obsidian-spec` | Obsidian Markdown 精确文法与边界 | 实现/审查 `src/parser/**` |
| `biz-dql-subset` | DQL 子集文法 + AST→SQL 映射 + 隐式字段语义 | 实现/审查 `src/query/**`、`src/indexer/schema.ts` |
| `biz-code-comments` | 中文注释 / JSDoc / 模块头 / 跨模块不变量 / 规范来源分界 | 写或审查任意源码注释时 |

## 约定

- 每个 skill 一个目录：`skills-def/<name>/SKILL.md`，frontmatter 必含 `name` 与 `description`。
- 业务 skill 用 `biz-` 前缀。
- 新增/修改后跑 `pnpm run skills:install` 重新安装，再在 Claude Code 中生效（必要时重启会话）。

## 安装机制

`scripts/install-skills.mjs` 遍历本目录下含 `SKILL.md` 的子目录，拷贝到 `.claude/skills/<name>/`（覆盖旧产物）。跨平台、纯 Node、无第三方依赖。

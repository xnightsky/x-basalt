# skills-def · 开发期 AI 召回 skill 真相源

本目录是 x-basalt 开发期 AI 召回用 skill 的**唯一源码**。`.claude/skills/` 与 `.agents/skills/` 仅为安装产物（均已 gitignore），由 `pnpm run skills:install*` 从这里拷贝生成，**不要手改安装产物**。

> 区分：`skills-def/` 是开发期召回；仓库根的 `skills-data/` 是**产品运行时** SkillRecall 加载的数据（如自我说明书 `core`），两者互不替代。

## 两个组（按受众 / 安装去向分目录）

| 组 | 受众 | 安装去向 | 命令 |
| --- | --- | --- | --- |
| `cli/` | **消费侧**：如何用 x-basalt CLI 操作任意 vault | 宿主全局 `~/.claude/skills` + `~/.agents/skills`（跨仓可见） | `pnpm run skills:install:global` |
| `dev/` | **开发侧**：写 / 审 x-basalt 自身代码时召回 | 本仓 `.claude/skills` + `.agents/skills` | `pnpm run skills:install` |

> 分组对齐 x-kb 的 `cli/`+`skills/` 思路，但按受众取名：x-basalt 的 `dev/` 三个 skill 全是「开发本仓」才用，故不叫 `skills/` 而叫 `dev/`。

## 现有 skill

### `cli/` —— 消费侧入口（薄）

| skill | 用途 | 召回时机 |
| --- | --- | --- |
| `x-basalt` | **只做触发 + 指路**，把权威用法交给 `x-basalt skills get core`（不在本文重抄命令表） | 任务涉及从命令行读/查/改 Obsidian vault 时 |

### `dev/` —— 开发侧业务规范

| skill | 用途 | 召回时机 |
| --- | --- | --- |
| `biz-obsidian-spec` | Obsidian Markdown 精确文法与边界 | 实现/审查 `src/parser/**` |
| `biz-dql-subset` | DQL 子集文法 + AST→SQL 映射 + 隐式字段语义 | 实现/审查 `src/query/**`、`src/indexer/schema.ts` |
| `biz-code-comments` | 中文注释 / JSDoc / 模块头 / 跨模块不变量 / 规范来源分界 | 写或审查任意源码注释时 |

## 约定

- 每个 skill 一个目录：`skills-def/{cli,dev}/<name>/SKILL.md`，frontmatter 必含 `name` 与 `description`。
- 开发侧业务 skill 用 `biz-` 前缀，放 `dev/`。
- 消费侧入口 skill 放 `cli/`，`scope: global`（薄，指向 `skills get core`）。
- 新增/修改后跑对应 `skills:install` 重新安装，再在 Claude Code 中生效（必要时重启会话）。

## 安装机制

`scripts/install-skills.mjs` **按目录组分流**：`--global` 装 `cli/` 组到宿主全局，默认装 `dev/` 组到本仓；各自遍历组内含 `SKILL.md` 的子目录，拷贝到 `.claude/skills/<name>/` 与 `.agents/skills/<name>/`（覆盖旧产物）。跨平台、纯 Node、无第三方依赖。

# skills-def 安装与使用

开发期 AI 召回 skill 的安装、生效与编写指南。真相源在本目录 `skills-def/{cli,dev}/`，安装产物在 `.claude/skills/` 与 `.agents/skills/`（均已 gitignore）。

## 一、概念分层

| 路径 | 角色 | 是否入仓 |
| --- | --- | --- |
| `skills-def/{cli,dev}/<name>/SKILL.md` | **真相源**：开发期 AI 召回用的 skill 源码 | ✅ 入仓 |
| `.claude/skills/<name>/` + `.agents/skills/<name>/` | **安装产物**：由脚本拷贝生成，供 Claude Code / 其他 AI 运行时发现 | ❌ gitignore |
| `skills-data/*.json5`（仓库根） | **产品运行时**数据：被 `src/skill` 的 SkillRecall 加载（如自我说明书 `core`） | ✅ 入仓 |

> `skills-def/`（开发期召回）与 `skills-data/`（产品运行时）是两套东西，互不替代。

## 二、两个组与安装

按受众 / 安装去向分目录，各自一条命令：

| 组 | 受众 | 命令 | 装到 |
| --- | --- | --- | --- |
| `cli/` | **消费侧**入口（如何用 x-basalt CLI，薄，指向 `skills get core`） | `pnpm run skills:install:global` | 宿主 `~/.claude/skills` + `~/.agents/skills` |
| `dev/` | **开发侧** `biz-*`（写/审 x-basalt 自身代码时召回） | `pnpm run skills:install` | 本仓 `.claude/skills` + `.agents/skills` |

脚本 `scripts/install-skills.mjs` 按 `--global` 选组：有则装 `cli/`、无则装 `dev/`；遍历组内含 `SKILL.md` 的子目录拷贝（覆盖旧产物）。纯 Node、跨平台、零第三方依赖。

`dev/` 组输出示例：

```
✓ 安装 3 个 skill 到 <仓库根>/.claude/skills
✓ 安装 3 个 skill 到 <仓库根>/.agents/skills
完成（dev 组）：biz-code-comments、biz-dql-subset、biz-obsidian-spec
```

## 三、在 Claude Code 中生效

1. 跑对应 `skills:install`（开发侧用 `pnpm run skills:install`，消费侧入口用 `pnpm run skills:install:global`）。
2. **重启 Claude Code 会话**（或重新打开项目），使其重新扫描 skill 目录。
3. 之后 AI 在匹配场景下可召回，或用 `Skill` 工具按 `name` 调用。

## 四、现有 skill

- `cli/x-basalt`：消费侧入口（薄，触发 + 指路 `x-basalt skills get core`）。
- `dev/biz-obsidian-spec`：Obsidian Markdown 精确文法，实现/审查 `src/parser/**` 时召回。
- `dev/biz-dql-subset`：DQL 子集文法 + AST→SQL 映射 + 隐式字段语义，实现/审查 `src/query/**`、`src/indexer/schema.ts` 时召回。
- `dev/biz-code-comments`：中文注释 / JSDoc / 模块头 / 跨模块不变量 / 规范来源分界，写或审查注释时召回。

## 五、新增一个 skill

1. 选组建目录：开发侧规范放 `skills-def/dev/biz-<name>/`，消费侧入口放 `skills-def/cli/<name>/`。写 `SKILL.md`，frontmatter 必含：

   ```markdown
   ---
   name: biz-your-skill
   description: Use when ... - 一句话说明触发场景（决定召回相关性）
   ---

   # 标题

   ## 触发场景

   ## 规则 / 要点
   ```

2. 开发侧业务 skill 用 `biz-` 前缀；`description` 写清"何时用"，这是召回判据。消费侧入口 skill 加 `scope: global`。
3. 跑对应 `skills:install`，重启会话生效。
4. 在 `AGENTS.md`「Skills 真相源」与本文件「现有 skill」登记。

## 六、排错

- **装完 Claude Code 看不到**：确认已重启会话；确认 `.claude/skills/<name>/SKILL.md` 存在且 frontmatter 合法。
- **改了不生效**：安装产物是拷贝，改 `skills-def/{cli,dev}/` 后必须重跑对应 `skills:install`，别手改 `.claude/skills/` 或 `.agents/skills/`。
- **安装产物不入仓**：`.claude/skills/` 与 `.agents/skills/` 都是预期（gitignore），每个开发者本地各自 install。

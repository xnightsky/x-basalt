# skills-def 安装与使用

开发侧业务 skill 的安装、生效与编写指南。真相源在本目录 `skills-def/`，安装产物在 `.claude/skills/` 与 `.agents/skills/`（均已 gitignore）。

## 一、概念分层

| 路径 | 角色 | 是否入仓 |
|---|---|---|
| `skills-def/<name>/SKILL.md` | **真相源**：开发期 AI 召回用的 skill 源码 | ✅ 入仓 |
| `.claude/skills/<name>/` + `.agents/skills/<name>/` | **安装产物**：由脚本拷贝生成，供 Claude Code / 其他 AI 运行时发现 | ❌ gitignore |
| `skill-data/*.json5`（仓库根） | **产品运行时**数据：被 `src/skill` 的 SkillRecall 加载 | ✅ 入仓 |

> `skills-def/`（开发侧）与 `skill-data/`（产品运行时）是两套东西，互不替代。

## 二、安装

```bash
pnpm run skills:install
```

脚本 `scripts/install-skills.mjs` 会遍历 `skills-def/` 下所有含 `SKILL.md` 的子目录，拷贝到 `.claude/skills/<name>/` 与 `.agents/skills/<name>/`（覆盖旧产物）。纯 Node、跨平台、零第三方依赖。

输出示例：

```
✓ 安装 3 个 skill 到 <仓库根>/.claude/skills
✓ 安装 3 个 skill 到 <仓库根>/.agents/skills
完成：biz-code-comments、biz-dql-subset、biz-obsidian-spec
```

## 三、在 Claude Code 中生效

1. 跑 `pnpm run skills:install` 生成 `.claude/skills/` 与 `.agents/skills/`。
2. **重启 Claude Code 会话**（或重新打开项目），使其重新扫描 `.claude/skills/`。
3. 之后 AI 在匹配场景下可召回，或用 `Skill` 工具按 `name` 调用。

## 四、现有 skill

| skill | 用途 | 召回时机 |
|---|---|---|
| `biz-obsidian-spec` | Obsidian Markdown 精确文法与边界 | 实现/审查 `src/parser/**` |
| `biz-dql-subset` | DQL 子集文法 + AST→SQL 映射 + 隐式字段语义 | 实现/审查 `src/query/**`、`src/indexer/schema.ts` |

## 五、新增一个 skill

1. 建目录 `skills-def/<name>/`，写 `SKILL.md`，frontmatter 必含：

   ```markdown
   ---
   name: biz-your-skill
   description: Use when ... - 一句话说明触发场景（决定召回相关性）
   ---

   # 标题
   ## 触发场景
   ## 规则 / 要点
   ```

2. 业务 skill 用 `biz-` 前缀；`description` 写清"何时用"，这是召回判据。
3. 跑 `pnpm run skills:install`，重启会话生效。
4. 在 `AGENTS.md`「Skills 真相源」与本文件「现有 skill」登记。

## 六、排错

- **装完 Claude Code 看不到**：确认已重启会话；确认 `.claude/skills/<name>/SKILL.md` 存在且 frontmatter 合法。
- **改了不生效**：安装产物是拷贝，改 `skills-def/` 后必须重跑 `pnpm run skills:install`，别手改 `.claude/skills/` 或 `.agents/skills/`。
- **安装产物不入仓**：`.claude/skills/` 与 `.agents/skills/` 都是预期（gitignore），每个开发者本地各自 install。

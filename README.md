# x-basalt

> 纯 Node.js CLI 工具：**零依赖 Obsidian GUI / 运行时**，直接通过文件系统 API 操作 Vault 目录，实现 Obsidian 规范的解析、索引、Dataview 子集查询与 Skill 召回。

不引入 `obsidian` npm 包、不调用 `obsidian://` URI、不读取 `app.metadataCache`。所有索引与隐式字段（反向链接等）由自建 SQLite 在查询期实时计算。

## 能做什么

| 命令    | 作用                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `parse` | 单个 `.md` → 标准化 AST（wikilink/Markdown link/tag/callout/task/highlight/blockRef/inlineField + frontmatter；链接类节点含位置） |
| `index` | 全量扫描 Vault → 单文件 SQLite 索引                                                                                               |
| `scan`  | **按需增量重索引**：diff 文件系统 vs 库，只重扫新增/改动/删除（无需常驻进程）                                                     |
| `query` | 自建 Dataview（DQL）子集 → 参数化 SQL → JSON 结果                                                                                 |
| `skill` | 加载规范知识库，Fuse.js 模糊召回 Obsidian / DQL 语法                                                                              |
| `watch` | chokidar 常驻监听，实时增量更新 + 变更联动命令                                                                                    |

## 安装

要求 Node.js ≥ 22、包管理器 `pnpm`。

```bash
pnpm install          # 安装依赖（含构建 better-sqlite3 原生模块）
pnpm run build        # tsc → dist/cli.js
npm link              # 全局安装：之后任意目录可用 x-basalt 命令
```

> 全局命令跑的是编译产物 `dist/cli.js`；改了源码需 `pnpm run build` 重新编译生效。开发态也可免构建直接跑：`pnpm run cli -- <command>`。详见 [安装与运行](docs/guides/installation.md)。

## 快速上手

```bash
x-basalt index ./my-vault                                   # 建索引（默认库 .x-basalt/index.db）
x-basalt query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10"
x-basalt query 'TABLE count() FROM "" GROUP BY file.extension'   # 计数（或读任一结果的 total 字段）
x-basalt query 'LIST FROM ""' --size 50 --offset 0          # 大结果分页：每页 50，读 total 知总量
x-basalt scan ./my-vault                                    # 之后增量重扫，只处理变化的
x-basalt skills get obsidian-base-spec                      # 召回语法规范
```

不想每次传 `--db`/`<vault>`？写个 `.x-basalt/config.yaml`，或用 `X_BASALT_DIR` 环境变量——见 [配置与基目录](docs/guides/configuration.md)。

## 📖 完整教程

**[`docs/guides/usage.md`](docs/guides/usage.md)** 是教程总目录，分章覆盖：

- [安装与运行](docs/guides/installation.md) · [命令参考](docs/guides/commands.md) · [DQL 查询指南](docs/guides/querying-dql.md)
- [索引与同步](docs/guides/indexing-and-sync.md) · [配置与基目录](docs/guides/configuration.md) · [Obsidian 语法](docs/guides/obsidian-syntax.md)
- [与 AI 协作（技能召回 + 全局使用技能）](docs/guides/ai-and-skills.md) · [故障排查与限制](docs/guides/troubleshooting.md)

## 开发

详见 `AGENTS.md`（项目约定与硬约束）与 `docs/README.md`（文档路由）。

```bash
pnpm test                  # Node 原生 test runner
pnpm run typecheck         # tsc --noEmit
pnpm run lint              # oxlint
pnpm run format            # oxfmt
pnpm run skills:install         # 装 skills-def/ 的开发技能到项目 .claude/skills/ + .agents/skills/
pnpm run skills:install:global  # 装 x-basalt 使用技能到 ~/.claude/skills/ + ~/.agents/skills/（教 AI 用本 CLI）
```

`pnpm install` 经 `prepare` 把 `git config core.hooksPath` 指向 `.githooks/`；此后 **push 前**自动跑 `typecheck + test + lint`（`.githooks/pre-push`），任一失败即阻断。绕过：`git push --no-verify`。

## 约束

零 Obsidian 运行时依赖；执行层（DQL → SQL）完全自建；隐式字段一律 SQLite JOIN 实时计算。完整禁止项见 `AGENTS.md`「项目硬约束」。

## 声明

x-basalt 是独立的第三方开源工具，与 Obsidian（© Dynalist Inc.）及 Dataview 插件均**无隶属关系**，也未获得其授权或背书。「Obsidian」「Dataview」等名称仅用于说明本工具所兼容的文件格式与查询语法，属指名性合理使用，相关商标归各自权利人所有。

x-basalt 不打包、不链接、不依赖 Obsidian 运行时，仅通过文件系统操作 Markdown 文件。
_x-basalt is an independent project, not affiliated with or endorsed by Obsidian (Dynalist Inc.) or the Dataview plugin._

## License

MIT

# x-basalt

> 纯 Node.js CLI 工具：**零依赖 Obsidian GUI / 运行时**，直接通过文件系统 API 操作 Vault 目录，实现 Obsidian 规范的解析、索引、Dataview 子集查询与 Skill 召回。

不引入 `obsidian` npm 包、不调用 `obsidian://` URI、不读取 `app.metadataCache`。文件数据由自建索引器写入 SQLite；隐式字段（反向链接等）在查询期实时计算，不依赖外部缓存。实现信源：[`src/indexer/schema.ts`](./src/indexer/schema.ts)、[`src/query/sql-generator.ts`](./src/query/sql-generator.ts)。

## 能做什么

| 命令    | 作用                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `parse` | 单个 `.md` → 标准化 AST（wikilink/Markdown link/tag/callout/task/highlight/blockRef/inlineField + frontmatter；链接类节点含位置） |
| `index` | 全量扫描 Vault → 单文件 SQLite 索引                                                                                               |
| `scan`  | **按需增量重索引**：diff 文件系统 vs 库，只重扫新增/改动/删除（无需常驻进程）                                                     |
| `query` | 自建 Dataview（DQL）子集 → 参数化 SQL → JSON 结果                                                                                 |
| `base`  | `.base` view 无头查询（Bases Markdown conformance 2026-07，可选 all-files 模式将附件并入为行）→ 稳定 JSON |
| `skill` | 加载规范知识库，Fuse.js 模糊召回 Obsidian / DQL 语法                                                                              |
| `watch` | chokidar 常驻监听，实时增量更新 + 变更联动命令                                                                                    |

## 安装

要求 Node.js ≥ 22、包管理器 `pnpm`。

```bash
pnpm install          # 安装依赖（含构建 better-sqlite3 原生模块）
pnpm run build        # tsc → dist/cli.js
npm link              # 全局安装：之后任意目录可用 x-basalt 命令
```

> 全局命令跑的是编译产物 `dist/cli.js`；改了源码需 `pnpm run build` 重新编译生效。开发态也可免构建直接跑：`pnpm run cli -- <command>`。详见 [安装与运行](./docs/use/install.md)。

## 快速上手

```bash
x-basalt index ./my-vault                                   # 建索引（默认库 .x-basalt/index.db）
x-basalt query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10"
x-basalt query 'TABLE count() FROM "" GROUP BY file.extension'   # 计数（或读任一结果的 total 字段）
x-basalt query 'LIST FROM ""' --size 50 --offset 0          # 大结果分页：每页 50，读 total 知总量
x-basalt scan ./my-vault                                    # 之后增量重扫，只处理变化的
x-basalt skills get obsidian-base-spec                      # 召回语法规范
```

不想每次传 `--db`/`<vault>`？写个 `.x-basalt/config.yaml`，或用 `X_BASALT_DIR` 环境变量——见 [配置与基目录](./docs/use/config.md)。

## 📖 完整教程

**[`docs/use/`](./docs/use/README.md)** 按「我想做什么」索引全部用法：

- [安装与运行](./docs/use/install.md) · [命令参考](./docs/use/commands.md) · [索引与同步](./docs/use/indexing.md) · [配置与基目录](./docs/use/config.md)
- 查笔记：[DQL 指南](./docs/use/dql.md)（`LIST FROM #tag WHERE …`） · [Bases 指南](./docs/use/bases.md)（兼容 `.base` 定义，支持文件或 stdin 即席查询）
- [Obsidian 语法](./docs/use/obsidian-syntax.md) · [与 AI 协作](./docs/use/ai-and-skills.md) · [chat 怎么玩](./docs/use/chat.md) · [故障排查](./docs/use/troubleshooting.md)

外部 AI 先用 `x-basalt skills get summary` 发现能力，默认直接调用 CLI；用户明确要求委托时再取 `skills get chat`。自然语言任务本身不等于委托。入口策略见 [与 AI 协作](./docs/use/ai-and-skills.md)。

想知道内部怎么设计的 → **[`docs/design/`](./docs/design/README.md)**；想查历史决策 → **[`docs/history/`](./docs/history/README.md)**。

核对同类工具、检索/宿主/知识维护的适配性 → [业界调研与信源](./docs/research/2026-09-30-agent-knowledge-industry-landscape.md)。独立无头运行是部署边界，不是独有能力或效果优越性的证明。

DQL / Bases 为什么仍保留两路、官方入口与本项目即时输入有什么不同 → [局部深度调研](./docs/research/2026-10-01-dql-bases-compatibility-local-audit.md)。R08 公式文件解析上下文已修复；R09 已执行 TASK 文件级排序、明确拒绝任务分组/展开，见 [当前执行计划](./docs/plans/2026-10-01-todo-sequential-cleanup.md)。报告保留取证时状态，不代替当前实现说明；后续范围与升级顺序见 [兼容投入账本](./docs/design/query-compatibility-ledger.md)。

**写入边界**：meta 使用同目录临时文件 + rename，避免直接半写目标；当前没有并发版本前置条件/锁，不保证并发防覆盖、跨文件事务或断电持久性。chat 无逐动作确认，Ctrl+C 不回滚已写文件，也不保证立即停止已启动 CLI 子进程。先在副本验证并建立可恢复备份。信源：[`src/meta/index.ts`](./src/meta/index.ts)、[`src/chat/cli-tool.ts`](./src/chat/cli-tool.ts)、[使用指南](./docs/use/chat.md#7-当前限制--注意)。

chat 默认写成功后不追加交叉验证；明确要求复核或再次运行时，应实际执行并依据独立回执回答。`query=0` 不能代替第二次 `run`。这是提示纪律，不是模型可靠性保证，详见 [写后验收](./docs/use/chat.md#61-写后复核与幂等验证)。

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

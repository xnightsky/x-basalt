---
timestamp: 2026-06-30T23:27:23Z
sha256: fe1dfc75bc5fcf2633d49551aa061b25dd3fde0a39adef96317334272004fd43
type: guide
title: 使用指南 · x-basalt（教程总目录）
description: 面向使用者的教程总目录与分章导航
tags:
  - guide
  - usage
  - x-basalt
---
# 使用指南 · x-basalt（教程总目录）

> 面向使用者的教程**总目录**。x-basalt 是纯 Node.js CLI——**零依赖 Obsidian GUI / 运行时**，直接通过文件系统操作 Vault 目录，做五件事：解析 Obsidian 专有语法、把 Vault 索引进 SQLite、用 Dataview（DQL）子集查询、按关键字召回规范、读改笔记元数据头（frontmatter）。
> 内容较多，已拆成下面各章；本页给概览 + 快速上手 + 章节路由。实现真相源见 `../specs/`、`../research/`。

## 它是什么

| 能力     | 命令                       | 说明                                                                                                                                                                       |
| -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 解析     | `parse`                    | 单个 `.md` → 标准化 AST（wikilink/tag/callout/task/highlight/blockRef + frontmatter）                                                                                      |
| 索引     | `index` / `scan` / `watch` | 全量建库 / **按需增量重扫** / 常驻监听，写入单文件 SQLite                                                                                                                  |
| 查询     | `query`                    | 自建 Dataview（DQL）子集 → 参数化 SQL → JSON 结果                                                                                                                          |
| 召回     | `skill`                    | 加载规范知识库，Fuse.js 模糊召回                                                                                                                                           |
| 改元数据 | `meta`                     | 读 / 改单文件 frontmatter（**唯一写侧**）：get/set/unset/rename + **normalize 归一** + **profile 元数据策略**（apply 按约定补缺/补全），YAML 往返保真、原子写、`--dry-run` |

**硬约束（设计红线）**：不引入 `obsidian` npm 包、不调 `obsidian://`、不使用 dataview 的执行层、不依赖浏览器自动化；文件操作仅经 `fs`/`chokidar`；反向链接等隐式字段**一律在查询期由 SQLite JOIN 实时计算**，不假设任何外部缓存。

## 快速上手（5 分钟）

```bash
# 1) 全局安装（在仓库根；详见 installation.md）
npm link                      # 之后任意目录可用 x-basalt 命令；改源码后需 pnpm build

# 2) 全量建索引
x-basalt index ./my-vault     # 默认库 .x-basalt/index.db（可由 --db / 配置 / X_BASALT_DIR 改）

# 3) 查询：#project 下 status=active 的最近 10 篇
x-basalt query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10"

# 4) 之后增量重扫（无需常驻监听，人/AI 周期触发即可）
x-basalt scan ./my-vault      # 只重扫新增/改动/删除

# 5) 召回 Obsidian / DQL 语法规范
x-basalt skills recall wikilink
```

(3) 的输出形态：

```json
{
  "type": "LIST",
  "columns": ["file.name", "file.path"],
  "rows": [{ "file.name": "Alpha", "file.path": "Projects/Alpha.md" }]
}
```

> 💡 不想每次敲 `--db`/`<vault>`？写个 `.x-basalt/config.yaml`，或用 `X_BASALT_DIR` 环境变量把状态搬到固定位置——详见 [配置与基目录](configuration.md)。

## 教程目录

| 章节                                 | 内容                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [安装与运行](installation.md)        | 要求（Node ≥ 22）、从源码构建、**全局安装（npm link）**、三种运行方式、改源码后重编译                                  |
| [命令参考](commands.md)              | 9 个命令逐项：`parse` / `index` / `scan` / `query` / `skills` / `meta` / `watch` / `run` / `chat`（签名、选项、默认、示例） |
| [DQL 查询指南](querying-dql.md)      | 完整 Dataview 子集文法（LIST/TABLE/TASK + WHERE + GROUP BY/FLATTEN/WITHOUT ID + 多键 SORT + 函数）、隐式字段、报错口径 |
| [索引与同步](indexing-and-sync.md)   | `index` vs `scan` vs `watch` 何时用；scan 深入（mtime/`--rehash`/`--dry-run`/分批断点续）；5 表数据模型；路径感知链接  |
| [配置与基目录](configuration.md)     | 配置文件（cosmiconfig 向上查找、yaml/json5）、可配置项、**`X_BASALT_DIR`**、优先级                                     |
| [Obsidian 语法](obsidian-syntax.md)  | `parse` 覆盖的 6 类节点字段与边界、代码区掩码、已知近似                                                                |
| [与 AI 协作](ai-and-skills.md)       | `skills recall` 自助召回（Fuse.js）、**全局 `x-basalt` 使用技能**（教 AI 用 CLI）、三类「skill」之别                   |
| [chat 怎么玩](chat.md)               | 用自然语言驱动 vault 的可选-AI `chat`（单发 + REPL）：前置 / 建索引 / 试哪些指令 / 玩时看什么（工具可见·撞顶续跑·失败换策略）/ 限制 |
| [故障排查与限制](troubleshooting.md) | 常见报错→处理、已知限制与近似                                                                                          |

---

> 维护：命令签名 / DQL 子集 / 数据模型 / 配置项变化时，同步对应章节、`README.md`、自我说明书 skill（`skill-data/x-basalt.json5`）与 `docs/specs`，确保互相验证（见 `../README.md` 三层口径）。

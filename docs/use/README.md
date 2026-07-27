---
type: index
title: 怎么用 x-basalt
description: 按「我想做什么」索引全部用法：五分钟上手、查笔记（DQL/Bases）、改笔记、体检 vault、搞懂机制、出问题了
tags:
  - guide
  - index
  - usage
  - x-basalt
timestamp: 2026-07-27T18:11:37Z
sha256: 78fc6727d4fe69afe3a1a32a30f0373b39233468b189132f126413dbf00f2b4b
---
# 怎么用 x-basalt

**x-basalt 是纯 Node.js 命令行工具，直接读写 Obsidian vault 的文件——不需要装 Obsidian，也不需要它开着。**

## 五分钟跑通

```bash
npm link                                        # 全局装（在仓库根；改源码后要 pnpm build）
x-basalt index ./my-vault                       # 建索引，查询查的是索引不是文件
x-basalt query "LIST FROM #project WHERE status = 'active' LIMIT 10"
x-basalt scan ./my-vault                        # 笔记改了之后增量重扫
```

输出长这样：

```json
{
  "type": "LIST",
  "columns": ["file.name", "file.path"],
  "rows": [{ "file.name": "Alpha", "file.path": "Projects/Alpha.md" }]
}
```

> 不想每次敲 `--db` / vault 路径？写个 `.x-basalt/config.yaml` → [配置](config.md)

## 我想……

### 查笔记

| | |
| --- | --- |
| 用 Dataview 语法查（`LIST FROM #tag WHERE …`） | [DQL 指南](dql.md) |
| 用官方 `.base` 文件查 | [Bases 指南](bases.md) |
| 全文搜正文（中英文子串） | `x-basalt search` → [命令参考](commands.md) |
| 不确定该用 DQL 还是 Bases | [两者对比](bases.md#14-和-dataview--dql-是什么关系) |

### 改笔记

| | |
| --- | --- |
| 读 / 改 frontmatter（唯一写侧） | `x-basalt meta` → [命令参考](commands.md) |
| 按管道批量改 | `x-basalt run` → [命令参考](commands.md) |
| 用自然语言驱动（需 AI key） | [chat 怎么玩](chat.md) |

### 体检 vault

| | |
| --- | --- |
| 找断链、给修复建议 | `x-basalt links` → [命令参考](commands.md) |
| 按规则集 lint（metadata / links） | `x-basalt lint` → [命令参考](commands.md) |

### 搞懂机制

| | |
| --- | --- |
| `index` / `scan` / `watch` 什么时候用哪个 | [索引与同步](indexing.md) |
| 解析器认得哪些 Obsidian 语法 | [Obsidian 语法](obsidian-syntax.md) |
| 正文里的 `key:: value` 怎么用 | [inline fields 教程](tutorial-inline-fields.md) |
| 配置文件、`X_BASALT_DIR` | [配置](config.md) |
| 让 AI 会用这个 CLI | [与 AI 协作](ai-and-skills.md) |

### 出问题了

| | |
| --- | --- |
| 报错了 / 结果不对 | [故障排查](troubleshooting.md) |
| 装不上 / 跑不起来 | [安装与运行](install.md) |

## 全部命令

`parse` `index` `scan` `query` `base` `search` `skills` `meta` `watch` `run` `chat` `links` `lint`

逐个命令的签名、选项、默认值、示例 → [命令参考](commands.md)

## 设计红线

不引入 `obsidian` npm 包、不调 `obsidian://`、不用 dataview 的执行层、不依赖浏览器自动化。文件操作只经 `fs`/`chokidar`。反向链接这类隐式字段一律在查询期由 SQLite JOIN 实时算，不假设任何外部缓存。

想知道为什么这么定 → [设计文档](../design/README.md)

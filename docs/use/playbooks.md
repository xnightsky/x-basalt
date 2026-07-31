---
type: guide
title: 玩法 · 按任务选命令
description: x-basalt 按任务选命令的玩法索引：批量改/查字段/查正文/计数/建库/Bases/监听/体检各走哪个命令，含常见走错的坑
tags:
  - guide
  - cli
  - x-basalt
timestamp: 2026-07-31T04:39:06Z
sha256: a3eff861ac2153730d0e0830c3092cb16ddf6c8dfe0007cc0a3e89e0eb51b1b9
---
# 玩法 · 按任务选命令

← [使用指南索引](README.md)

> 本页回答**「这件事该用哪个命令」**，不重复参数细节——每条末尾给出该去哪查。
> 命令签名与选项 → [命令参考](commands.md)；CLI 自己也有一份 ~1.8 KB 的机读摘要：`x-basalt skills get summary`。

选错命令是这个工具最贵的错误：`query` 查不了正文、`LIST` 全量再数会白烧一遍库、循环 `meta set` 改一百个文件要跑一百次。下面每条都标了这类坑。

---

## 速查

| 你要做的事 | 走这个 | chat 里 |
| --- | --- | --- |
| [改一批文档](#改一批文档) | `run --pipe` | `pipeline_run` |
| [改单篇的元数据](#改单篇的元数据) | `meta set` / `meta apply` | `meta_*` |
| [按字段找笔记](#按字段找笔记) | `query`（DQL） | `query` |
| [按正文找笔记](#按正文找笔记) | `search`（FTS5） | `search` |
| [数有多少篇](#数有多少篇) | `query` 读 `total` | `query{size:0}` |
| [建库与刷新索引](#建库与刷新索引) | `index` / `scan` | 只有 `scan` |
| [跑 .base 视图](#跑-base-视图) | `base` | **没有** |
| [看单个文件的结构](#看单个文件的结构) | `parse` | `parse` / `read_note` |
| [常驻自动维护](#常驻自动维护) | `watch` | **禁止** |
| [查断链 / 按规则体检](#查断链--按规则体检) | `links` / `lint` | 经 `pipeline_run` |
| [用自然语言干活](#用自然语言干活) | `chat` | — |

---

## 改一批文档

**判据很简单：改动对象超过一个文件，就别用 `meta set`。**

```bash
# 给 docs 下所有缺 type 的文档补上 type: guide
x-basalt run --pipe where='LIST FROM "docs" WHERE !type' --pipe actions="set type=guide" --apply
```

- `where=` 必须是**完整 DQL**（以 `LIST`/`TABLE`/`TASK` 开头），不能只写 `FROM …` 或 `WHERE …` 裸子句。
- **默认 dry-run**，加 `--apply` 才落盘。先不加跑一遍看报告，是这条命令的正常用法。
- 写完**索引已自动刷新**（报告里的 `reindexed`），不必再补 `index`/`scan` 复核。
- 复杂链路用 `--pipe step=`（一个 flag 一个算子、不切分），能串 `query`/`base`/`filter`/`limit`/`map` 和 `{{row.x}}` 插值。

> 坑：`--pipe actions=` 用逗号分隔，算子参数里带顶层逗号会被劈碎——这种情况改用 `step=`。
> 细节 → [管道教程](pipelines.md)｜机读：`x-basalt skills get pipe`

## 改单篇的元数据

```bash
x-basalt meta set note.md status done
x-basalt meta get note.md                 # 读整个 frontmatter
x-basalt meta apply llm-wiki docs/a.md --set type=guide --refresh-derived
```

- 写只碰 frontmatter，**正文逐字节不动**；原子写、幂等。
- 要按既定规范补齐字段用 `meta apply <profile>`——先 `meta profile show <profile>` 读规范，再决定 `--set` 补什么。
- **改过正文的文档重新 apply 时必须带 `--refresh-derived`**，否则 `sha256` 停在旧值，漂移检测失效。

> 细节 → [命令参考](commands.md#meta--读改-frontmatter)｜机读：`x-basalt skills get core meta profile`

## 按字段找笔记

```bash
x-basalt query 'LIST FROM "docs" WHERE type = "guide"'
x-basalt query 'LIST WHERE !status'        # status 缺失或 falsy
x-basalt query 'TABLE file.inlinks FROM [[Index]]'
```

查的是 **frontmatter / tag / 链接 / 任务** 这类结构化字段（正文里的 `key:: value` 也算）。

> **坑：`query` 查不了正文内容**。「哪篇提到了 X」要用 `search`。
> 文法 → [DQL 子集](dql.md)｜机读：`x-basalt skills get obsidian-base-spec`

## 按正文找笔记

```bash
x-basalt search "回归测试"
```

FTS5 子串匹配，用于「不知道是哪篇、只记得内容」。

> **坑一**：这是子串匹配，**不是语义检索**，同义词搜不到。
> **坑二**：含中文时走 trigram **宽松 OR 召回**，`total` 不等于「含该完整短语的篇数」——判断「到底有没有这一串」看排最前的结果，或改用 `query` 的 `contains()` 精确判定。
> **坑三**：基于索引快照，新写的文件要先 `scan` 才搜得到（`run` 管道写完会自动刷）。

## 数有多少篇

```bash
x-basalt query 'LIST FROM #draft' --size 0            # 只要总数
x-basalt query 'TABLE count() FROM "" GROUP BY type'  # 分组计数
```

> **坑：绝不 `LIST` 全量再数行数。** 任何 `query` 结果都带 `total`（独立 COUNT，不随分页变），直接读它。
> `count()` 是 `GROUP BY` 的聚合列，单独 `TABLE count()` 不带 `GROUP BY` 无效。

## 建库与刷新索引

```bash
x-basalt index ./vault      # 全量：首次建库或想整体重来
x-basalt scan               # 增量：日常、cron/CI，只重扫变动的
```

> **坑：`run`/`watch` 的写动作已自动刷索引**，写完不用手动补。
> 两者怎么选 → [索引与同步](indexing.md)

## 跑 .base 视图

```bash
x-basalt base reports/tasks.base --view Active
```

消费 vault 里已有的 Obsidian Bases 视图文件。**Bases 表达式不是 DQL**，两套文法。

> chat 里没有这个工具，只能经 `pipeline_run` 的 `base` 算子间接用。
> 语法与契约 → [Bases](bases.md)

## 看单个文件的结构

```bash
x-basalt parse note.md
```

解析成 AST（wikilink / tag / task / callout / inline field），带 `line`/`column` 可用于定位。纯函数，不碰索引。

## 常驻自动维护

```bash
x-basalt watch ./vault --pipe actions=normalize --apply
```

前台长驻，文件变动即增量索引并触发管道。

> **坑：绝不在 `chat` 里跑它**——会永不返回、把会话挂死。要么另开终端，要么用 cron 跑 `scan --pipe`。

## 查断链 / 按规则体检

```bash
x-basalt links check          # 断链、指向不存在的目标
x-basalt links suggest a.md   # 给修复建议
x-basalt lint                 # 按规则集体检（metadata / links）
```

也可作为管道算子接进批量链路：`--pipe step=links.check`（诊断挂在行上，不算失败）。

## 用自然语言干活

```bash
x-basalt chat "把 docs 下没有 type 的文档都补上" --quiet
```

说不清要哪个命令、或要多步组合时用。需 `AI_GATEWAY_API_KEY`。

> **被脚本或别的 AI 调用时务必加 `--quiet`（或 `--json`）**，否则整个 plan→act→observe 过程会进对方上下文白占 token。
> 工具清单与配 key → [与 AI 协作](ai-and-skills.md)｜机读：`x-basalt skills get chat`

---

## 给 AI 用的版本

上面这些 CLI 自己也讲得出来，且**随版本走**，不会像文档一样漂移：

```bash
x-basalt skills get summary        # ~1.8 KB：能干什么、该看哪篇
x-basalt skills get pipe           # 批量的完整用法
x-basalt skills get core meta      # 只取 core 里 meta 那一条（~2.6 KB，整篇是 ~17 KB）
x-basalt skills list core          # 先看 core 有哪些条目 id
```

在别的仓库里给 AI 写提示词时，**别把命令表抄过去**——抄一份就多一处会漂移的副本。写一句「本仓 docs 用 x-basalt 管，用法跑 `x-basalt skills get summary`」就够，剩下的让它自己问。

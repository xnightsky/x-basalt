---
name: x-basalt
description: 用 x-basalt CLI 在终端无头操作 Obsidian vault（不依赖 Obsidian App）——解析笔记为 AST、构建/增量刷新 SQLite 索引、用 Dataview(DQL) 子集查询笔记、按需重扫文件夹变更、读改笔记 frontmatter 元数据（get/set/unset/rename、normalize 归一、按 profile 策略补全）、召回 Obsidian/DQL 语法规范。当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用。
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

本文只做「触发 + 指路」——用法真相源不在本文，一律以 `x-basalt skills get core` 现打印为准（随 CLI 版本走，不在此重抄）。

## 怎么用

1. 确认已装：`x-basalt --version`（装不上则按常规方式干活，别强用本 skill）。
2. 动手前先 `x-basalt skills get core`，按它说的做——这是「怎么用 x-basalt」的权威正文：命令全集（parse/index/scan/query/skills/meta/watch/run/chat）、变更编排管道、DQL 子集、可选 AI 的 chat、项目配置。
   其它 AI/脚本通过 bash 程序化调用 `chat` 时默认加 `--quiet`（纯答案）或 `--json`（结构化），完全隐藏过程；调用方通常会合并 stdout+stderr 进模型上下文，过程轨迹只会白占 token。人交互/REPL 才用默认完整轨迹。
3. 要精确 Obsidian/DQL 语法与边界：`x-basalt skills get obsidian-base-spec`（取整篇）或 `x-basalt skills recall <关键字>`（如 wikilink/dataview/callout，模糊召回）。

**不要**在本文（或调用方 prompt 里）复制命令表、DQL 细节或选项——一律以 `x-basalt skills get core` 现打印为准，避免二次漂移。

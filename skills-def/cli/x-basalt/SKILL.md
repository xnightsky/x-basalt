---
name: x-basalt
description: 用 x-basalt CLI 在终端无头操作 Obsidian vault（不依赖 Obsidian App）——解析笔记为 AST、构建/增量刷新 SQLite 索引、用 Dataview(DQL) 子集查询笔记、按需重扫文件夹变更、读改笔记 frontmatter 元数据（get/set/unset/rename、normalize 归一、按 profile 策略补全）、召回 Obsidian/DQL 语法规范。当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用。
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

本文只做「触发 + 指路」——用法真相源不在本文，一律以 `x-basalt skills` 系列现打印为准（随 CLI 版本走，不在此重抄）。

## 怎么用

1. 确认已装：`x-basalt --version`（装不上则按常规方式干活，别强用本 skill）。
2. **先跑 `x-basalt skills get summary`**——能力摘要分 `core`（查与改）/ `pipe`（批量）/ `chat`（自然语言委托）。**先看它挑一组，再取需要的条目**，别一上来取全文。
   最容易漏的是**批量**：改动对象超过一个文件走 `run --pipe`（见 `skills get pipe`），不要循环调 `meta set`。
3. **外部 AI 默认直接调用 CLI**：按任务取 `core` 或 `pipe` 后执行；用户用自然语言描述任务，不等于要求再委托一个模型。**用户明确要求委托 chat 时**再取 `skills get chat`（调用方式、真实工具面、禁止项与配 key），保留这条可选入口。
   **按条取**：`skills list <name>` 看条目 id → `skills get <name> <id>...` 只取所需部分；全文只在确有需要时取。
4. 要精确 Obsidian/DQL 语法与边界：`x-basalt skills get obsidian-base-spec`（取整篇）或 `x-basalt skills recall <关键字>`（如 wikilink/dataview/callout，模糊召回）。

> 召回按 triggers 分层，**一个关键字只召回对应那一篇**：总览词（摘要/总览/能干什么）→ summary；管道词（批量/管道/算子）→ pipe；AI 词（配 key/ollama/自然语言）→ chat；说明书词（用法/manual）→ core；语法词（wikilink/callout）→ obsidian-base-spec。所以 `recall` 拿到的就是该看的那篇，不必再自行筛。

**配置复用**：`X_BASALT_DIR` 或就近配置已设 `vault` 时，在对应项目根运行即可，CLI 自读配置；正常使用不必先读取配置文件或补传路径。需要覆盖默认或排查配置时，取 `skills get core config`，不要猜路径。

**不要**在本文（或调用方 prompt 里）复制命令表、DQL 细节或选项——一律以 `x-basalt skills get core` 现打印为准，避免二次漂移。

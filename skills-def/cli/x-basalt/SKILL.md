---
name: x-basalt
description: 用 x-basalt CLI 在终端无头操作 Obsidian vault（不依赖 Obsidian App）——解析笔记为 AST、构建/增量刷新 SQLite 索引、用 Dataview(DQL) 子集查询笔记、按需重扫文件夹变更、读改笔记 frontmatter 元数据（get/set/unset/rename、normalize 归一、按 profile 策略补全）、召回 Obsidian/DQL 语法规范。当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用。
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

本文只做「触发 + 指路」——用法真相源不在本文，一律以 `x-basalt skills` 系列现打印为准（随 CLI 版本走，不在此重抄）。

## 怎么用

1. 确认已装：`x-basalt --version`（装不上则按常规方式干活，别强用本 skill）。
2. **先跑 `x-basalt skills get summary`**——约 1.8KB 的能力摘要，三组各一屏：`core`（查与改）/ `pipe`（批量）/ `chat`（自然语言），并标明每组在 chat 侧有没有对应工具。**先看它挑一组，再取那一篇**，别一上来取全文。
   最容易漏的是**批量**：改动对象超过一个文件走 `run --pipe`（见 `skills get pipe`），不要循环调 `meta set`。
3. 挑定后取正文：`skills get core`（命令全集、DQL 子集、meta 写侧、项目配置）/ `skills get pipe`（`--pipe` 参数面、三种源、算子链、写与索引刷新）/ `skills get chat`（调用形态、15 个内部工具与 CLI 的对应、chat 侧没有或禁止的能力、配 key）。
   其它 AI/脚本通过 bash 程序化调用 `chat` 时默认加 `--quiet`（纯答案）或 `--json`（结构化），完全隐藏过程；调用方通常会合并 stdout+stderr 进模型上下文，过程轨迹只会白占 token。人交互/REPL 才用默认完整轨迹。
4. 要精确 Obsidian/DQL 语法与边界：`x-basalt skills get obsidian-base-spec`（取整篇）或 `x-basalt skills recall <关键字>`（如 wikilink/dataview/callout，模糊召回）。

> 召回按 triggers 分层，**一个关键字只召回对应那一篇**：总览词（摘要/总览/能干什么）→ summary；管道词（批量/管道/算子）→ pipe；AI 词（配 key/ollama/自然语言）→ chat；说明书词（用法/manual）→ core；语法词（wikilink/callout）→ obsidian-base-spec。所以 `recall` 拿到的就是该看的那篇，不必再自行筛。

**免配直调**：`X_BASALT_DIR` 或就近 `.x-basalt/config` 已设 `vault` 时，**站 repo 根直接** `x-basalt chat "<自然语言>" --quiet` 即可——CLI 自读 env+配置解析 db/vault。**别去定位或 `cat` `.x-basalt/config.*`，也别手动补 `--vault`/`--db`**（要覆盖默认才显式传）。上游无需感知 `X_BASALT_DIR`：它常配相对值（如 `.tmp/.x-basalt`）以一套 env 适配多 repo，站对 repo 根即自动对应该 repo 的状态目录与 vault。

**不要**在本文（或调用方 prompt 里）复制命令表、DQL 细节或选项——一律以 `x-basalt skills get core` 现打印为准，避免二次漂移。

---
type: guide
title: chat 怎么玩 · x-basalt
description: 用自然语言驱动 vault 的可选-AI chat 子命令：怎么从零跑起、试哪些指令、玩时看什么、限制
tags:
  - guide
  - cli
  - chat
  - x-basalt
timestamp: 2026-06-30T23:25:31Z
sha256: 2ebe1be083aaa9994ea4e90a687d837c51da2ca41d12a14ddb4600db2e8accae
---
# chat 怎么玩 · x-basalt

> `chat` 是用**自然语言驱动 vault** 的可选-AI 子命令：你说人话，它自己多步调用 x-basalt 的读写原语（query / parse / read_note / scan / list / meta / skills / pipeline）去办。本篇教你从零跑起来、试哪些指令、玩的时候看什么、注意什么。
>
> ⚠ 当前是**手玩验证**阶段：AI 行为质量（成功率 / 撞顶率）尚无场景库做量化回归，体验因模型与库而异。这篇就是给你「拿来即玩」用的。

## 1. 前置

- **Node 22+**。
- **一个 vault**（一堆 `.md`）。想要现成的：仓库自带 `tests/fixtures/sample-vault/`（拿来只读玩最稳）；写类指令请用**你自己库的副本**或测试库，别拿重要库玩（见 §7）。
- **建议先配好 `config`**：在 vault 根放个 `.x-basalt/config.yaml`（填 `vault`，`db` 可省，默认 `.x-basalt/index.db`），之后 **所有命令含 `chat` 都不用再带 `--vault`/`--db`**。**下面示例默认你已配好**；没配就给每条命令补 `--vault <vault路径>`（库不在默认位置再加 `--db <库路径>`）。详见 [配置与基目录](configuration.md)。
- **一个 AI provider key**：环境变量 `AI_GATEWAY_API_KEY`（兼容 `AI_GATEWAY_*`）。**无 key 时 chat 友好退出、不影响其他命令**。
- 可选：`AI_GATEWAY_MODEL` 或 `--model <name>` 指定模型。

## 2. 先建索引（读类指令依赖它）

chat 的 `query` / `scan` 走 SQLite 索引，先建好（读 config 里的 vault，建到默认库 `.x-basalt/index.db`）：

```bash
x-basalt index
```

> 没配 config 就一次性指库：`x-basalt index ./my-vault`（库仍默认进 `.x-basalt/index.db`，不必带 `--db`）。
> 没建库就问「有多少笔记」会得到一条**结构化错误**（库未建 → 建议先 `index`）——这本身就是可玩的一幕（见 §6「失败换策略」）。

## 3. 跑起来

**单发**（一句话，跑完即退）：

```bash
x-basalt chat "这个库有多少篇笔记？"
```

**REPL**（多轮、记上下文）：

```bash
x-basalt chat
```

进去先打 `examples` 看一屏可玩指令。

## 4. REPL 里能打什么

| 输入                  | 作用                                                       |
| --------------------- | ---------------------------------------------------------- |
| `examples` / `例子`   | 列出可直接试的示例指令                                     |
| `help` / `?`          | 用法速查                                                   |
| `继续` / `continue`   | 撞步数顶没跑完时，用现有上下文接着跑（**仅撞顶后**可用）    |
| `quit` / `exit` / `q` | 退出                                                       |
| `Ctrl+C`              | 中断当前轮、回到提示符；空闲提示符再按一次退出             |

## 5. 试这些（`examples` 同款）

```
读：
  这个 vault 一共有多少篇笔记？
  列出所有带 #spec 标签的笔记
  查 type 是 research 的笔记
  读 <某篇>.md 的 frontmatter 有哪些字段
  读一下 <某篇>.md 的正文，讲了什么
  列出 <某目录>/ 下的笔记
  扫一下有哪些文件还没进索引
写（会直接改文件，先在测试库上玩）：
  给 <某篇>.md 把 status 设成 done
  把 <某篇>.md 的 tags 规范化
能力 / 排错：
  你能做什么？
  x-basalt 支持哪些 DQL 写法？
  用 DQL「FOOBAR 乱写」查一下 —— 看它撞错后怎么换法自纠
```

`<…>` 换成你库里真实文件名。`--max-steps`（默认 20）控制单轮最多几步。

## 6. 玩的时候重点看什么

- **工具调用可见**：每步打印 `· 调用 <工具> <入参>` 和 `↳ <结果预览>`——能看到它真在调 query/meta，而不是空口编答案。
- **撞顶不静默停**：步数用满会显式提示「已达步数上限、任务可能未完成」；REPL 里打 `继续` 用现有上下文接着跑（单发则提示加大 `--max-steps`）。
- **失败换策略（A≠B）**：故意写错（如乱写 DQL），看它收到 `[工具失败·dql] …去 obsidian-base-spec 核对 / 换写法` 后是否**换个写法重试**，而不是对同一句硬磨。库未建会得 `[工具失败·not-found] …先建索引`。
- **写直接落盘**：写类指令（设 status / 规范化 tags）**直接改文件**——所以务必先在测试库 / 副本上玩。

## 7. 当前限制 / 注意

- **能读单篇正文，但不能跨库全文搜**：`read_note` 能读某一篇的正文（非 AST、非仅 frontmatter），但没有 FTS5 全文检索（backlog），问「哪篇正文提到 X」（不知道是哪篇、要跨全库搜）它会老实说做不到。
- **写无确认闸**：写动作直接改文件，靠 `Ctrl+C` 中断 + 原子写兜底，**没有逐动作确认**。别拿重要库直接玩写。
- **常驻/监听不可用**：chat 工具皆一次性；不存在 watch（会挂死对话），它被系统提示禁止尝试。
- **效果未量化**：AI 行为质量尚无场景库回归（见 [`../research/2026-06-30-chat-gap-vs-agent-browser.md`](../research/2026-06-30-chat-gap-vs-agent-browser.md) §3）。

## 8. 没 key 怎么办

`chat` 会打印配置指引并以非 0 退出，**完全不影响** `parse` / `index` / `query` / `meta` 等纯本地命令——它们不需要任何 key。配置见 [configuration.md](configuration.md)、[ai-and-skills.md](ai-and-skills.md)。

---

← [命令参考](commands.md) · [使用指南索引](usage.md) · [配置](configuration.md)

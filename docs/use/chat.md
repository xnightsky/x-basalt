---
type: guide
title: chat 怎么玩 · x-basalt
description: 用自然语言驱动 vault 的可选-AI chat 子命令：怎么从零跑起、试哪些指令、玩时看什么、限制
tags:
  - guide
  - cli
  - chat
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 7c6de2faf91891a689d746b03af76e7c00bea773c241e364bb403a4e9326b1bf
---
# chat 怎么玩 · x-basalt

> `chat` 是用**自然语言驱动 vault** 的可选-AI 子命令：你说人话，它自己多步调用 x-basalt 的 CLI 原语（经单一 `cli` 工具——query / parse / scan / search / meta / run / base 等子命令）去办。本篇教你从零跑起来、试哪些指令、玩的时候看什么、注意什么。
>
> ⚠ 当前是**手玩验证**阶段：AI 行为质量（成功率 / 撞顶率）尚无场景库做量化回归，体验因模型与库而异。这篇就是给你「拿来即玩」用的。

外部 AI 默认先读 `skills get summary`，再直接编排 CLI；本篇面向主动选择 chat 的用户或明确委托 chat 的调用方。程序化委托的调用与输出契约见 `skills get chat`，不在入口 skill 复制工具清单。

## 1. 前置

- **Node 22+**。
- **一个 vault**（一堆 `.md`）。想要现成的：仓库自带 `tests/fixtures/sample-vault/`（拿来只读玩最稳）；写类指令请用**你自己库的副本**或测试库，别拿重要库玩（见 §7）。
- **建议先配好 `config`**：在 vault 根放个 `.x-basalt/config.yaml`（填 `vault`，`db` 可省，默认 `.x-basalt/index.db`），之后 **所有命令含 `chat` 都不用再带 `--vault`/`--db`**。**下面示例默认你已配好**；没配就给每条命令补 `--vault <vault路径>`（库不在默认位置再加 `--db <库路径>`）。详见 [配置与基目录](config.md)。
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

**带会话落盘**（撞顶/进程退出后可跨进程续跑）：

```bash
x-basalt chat "长任务第一步" --session               # 新建：系统生成 UUID，首行打印
x-basalt chat "接着把剩下的跑完" --session <uuid>    # 严格续跑（不存在/非法即报错）
x-basalt chat --session <uuid>                       # 带历史进 REPL
```

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
  哪篇笔记的正文提到「<某关键词>」？（不知道是哪篇，全文检索）
  扫一下有哪些文件还没进索引
写（会直接改文件，先在测试库上玩）：
  给 <某篇>.md 把 status 设成 done
  把 <某篇>.md 的 tags 规范化
能力 / 排错：
  你能做什么？
  x-basalt 支持哪些 DQL 写法？
  用 DQL「FOOBAR 乱写」查一下 —— 看它撞错后怎么换法自纠
```

`<…>` 换成你库里真实文件名。`--max-steps`（默认 50）控制**单轮**最多几步——它是每轮预算、与续跑正交：续跑时可换值（如 `--session <uuid> --max-steps 100`）。

## 6. 玩的时候重点看什么

- **工具调用可见**：每步打印 `· 调用 <工具> <入参>` 和 `↳ <结果预览>`——能看到它真在调 `cli`（子命令可见），而不是空口编答案。
- **索引路径可直接复用**：`query` / `search` 返回的 `file.path` 可直接交给 `parse` / `meta`；chat 会按已配置的单根或多根 vault 自动还原物理文件，不需要也不应该猜 repo / vault 目录前缀。
- **撞顶不静默停**：步数用满会显式提示「已达步数上限、任务可能未完成」；REPL 里打 `继续` 用现有上下文接着跑；带 `--session` 的落盘会话还能跨进程续跑——`x-basalt chat "继续" --session <uuid>`（UUID 在每轮收尾打印）；单发也可加大 `--max-steps`。
- **失败换策略（A≠B）**：故意写错（如乱写 DQL），看它收到 `[工具失败·dql] …去 obsidian-base-spec 核对 / 换写法` 后是否**换个写法重试**，而不是对同一句硬磨。库未建会得 `[工具失败·not-found] …先建索引`。
- **写遵循 CLI 开关**：`meta` 写操作默认落盘，`run` 批量写需 `--apply`；chat 壳不自动补开关，所以务必先在测试库 / 副本上玩。

### 6.1 写后复核与幂等验证

默认情况下，成功写入后依据工具回执回答，不额外查询、扫描或重复运行。需要验收时请明确提出，例如本轮合成测试使用的两种要求：

- 「写完后用 query 复核 inbox 下还有多少篇缺失 type」：应在写后实际查询；复核不是重复写入授权。
- 「再执行一次同样的批量命令验证幂等，报告两次各改动多少篇」：应真实执行第二次同范围、同动作、同落盘开关的 `run`，读取两次独立回执。`query` 返回 0 行不能代替第二次执行。

检查 `dryRun`、`failed`、`changed` 和 `reindexed`，不只看 `changed>0`：dry-run 不代表 Markdown 已写入，部分失败不能说全部成功，索引刷新依回执与配置判断。只有第二次成功回执 `changed=0` 才能报告本次验证无新增改动；未执行、失败或撞顶须如实说明。

这是**提示纪律而非宿主强制验收器**。本轮同一模型的旧／新提示各三题均满足上述执行义务，没有证明成功率提升；测试条件、原始证据位置与未验证边界见[执行记录](../archive/plans/2026-10-02-chat-write-verification.md)。

## 7. 当前限制 / 注意

- **全文检索是子串匹配，非语义搜索**：`search` 走 FTS5 + trigram，按字面子串找（查询**至少 2 个字符**，中英文皆可），不理解同义词/概念相关；且基于索引快照，新改动要先 `scan`/`index` 才搜得到。
  匹配口径**分两档**：纯 ASCII 是字面短语（多词 AND）；含中文时切 trigram 取并集 **OR 宽松召回**——只命中部分片段的笔记也会计入 `total`，完整子串命中者由 bm25 排最前。所以别把 `search` 的 `total` 当成「确实含这一串的篇数」，详见 [命令参考 `search`](commands.md#search--全文检索正文)。
- **写无确认闸，不等于可自动恢复**：`meta` 写操作默认落盘，`run` 批量写需显式 `--apply`，chat 壳不自动补开关。Ctrl+C 中断模型/循环，不回滚已完成写入，也不保证立即终止已启动 CLI 子进程；临时文件 + rename 只避免直接半写目标，不保证并发防覆盖、跨文件事务或断电持久性。先在副本验证，建立可恢复备份，避免与 Sync/其他写者并发。信源：[`src/chat/cli-tool.ts`](../../src/chat/cli-tool.ts)、[`src/chat/loop.ts`](../../src/chat/loop.ts)、[`src/meta/index.ts`](../../src/meta/index.ts)。
- **会话文件含 vault 原文**：`--session` 落盘的 `.x-basalt/sessions/chat-<uuid>.jsonl`（JSONL 事件流，逐 step 追加——崩溃/Ctrl+C 只丢在途 step，已完成的进度都在盘上）保存完整对话（含 `<<VAULT_DATA>>` 包裹的工具结果原文）——已 gitignore，但请自行清理；同一会话别并行跑（行会交错串线）。不带 `--session` 的临时会话零落盘。
- **常驻/监听不可用**：chat 工具皆一次性；不存在 watch（会挂死对话），它被系统提示禁止尝试。
- **效果未量化**：AI 行为质量尚无场景库回归（见 [`../research/2026-06-30-chat-gap-vs-agent-browser.md`](../archive/research/2026-06-30-chat-gap-vs-agent-browser.md) §3）。

## 8. 没 key 怎么办

`chat` 会打印配置指引并以非 0 退出，**完全不影响** `parse` / `index` / `query` / `meta` 等纯本地命令——它们不需要任何 key。配置见 [configuration.md](config.md)、[ai-and-skills.md](ai-and-skills.md)。

---

← [命令参考](commands.md) · [使用指南索引](README.md) · [配置](config.md)

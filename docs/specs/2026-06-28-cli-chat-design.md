---
type: design
title: CLI chat（自然语言驱动 vault）设计评估
description: 评估 x-basalt 将来若做 CLI chat 的可落地设计：对标 agent-browser、最小可选 AI、AI_GATEWAY_* 配置兼容、写动作安全闸
tags:
  - chat
  - ai
  - optional-ai
  - design
  - agent-browser
timestamp: 2026-06-28T09:33:57Z
sha256: 41eafa44ae0ebb5fb5ffc4e2807c032ba73ec370f888689384daaa38cf7883c3
---
# 设计评估：CLI chat（自然语言驱动 vault）—— 对标 agent-browser，最小可选 AI

> 日期：2026-06-28 · 类型：设计评估（**非开工**，只论"将来若做，怎么做才立得住"）
> 触发：用户问 qmd 借鉴价值 → 收敛到"CLI chat 对标 `agent-browser chat`"。
> 关联：检索后端见 [`2026-06-28-semantic-retrieval-integration.md`](2026-06-28-semantic-retrieval-integration.md)；现状/backlog 见 [`../../TODO.md`](../../TODO.md)；AI/技能定位见 [`../guides/ai-and-skills.md`](../guides/ai-and-skills.md)。
> 外部对标：`vercel-labs/agent-browser`（Rust，`chat` 命令把自然语言翻成既有 CLI 原语执行）。

## 0. 这份文档要回答的问题

> 「x-basalt 能不能像 agent-browser 那样有个 `chat` 命令，用自然语言驱动 vault？如果能，怎么做才不破坏'纯离线、装上即用'的身份？」

**结论先行（TL;DR）**

1. **能，且代价很小**——agent-browser 证明了一种模式：chat 只是"套在既有确定性命令上的一圈薄 LLM 循环"，不为 AI 另造能力。x-basalt 现有原语（query/scan/meta/skill…）天然就是这圈循环的工具面。
2. **但现在不做**——本文是可落地性评估，不是开工计划。AI 能力一律推迟到 dogfood 暴露出真实需求之后。
3. **若将来做，必须是"最小可选 AI"**：内核保持纯离线零 AI；chat 是独立、懒加载、默认关、用户自配 provider 的挂件；**没配 = 命令不可用，但 x-basalt 全部原语照常工作**。这是不可协商的前提（见 §2）。

## 1. 设计脊梁：最小可选 AI（不可协商）

这条统领全文，任何与之冲突的设计一律否决：

- **内核永远纯离线、零 AI**。`parse`/`index`/`scan`/`query`/`meta`/`skill` 不得 import 任何 AI SDK，不得产生对外 LLM 网络调用。
- **AI 是挂件不是依赖**。chat 是唯一会触达 LLM 的子命令，隔离在独立模块（`src/chat/`），其依赖**懒加载**（仅 `chat` 被调用时才 require AI SDK），不进核心依赖路径。
- **默认关、用户自配**。无 provider 配置 → `chat` 友好报"未配置 AI"并指向文档，**绝不崩、绝不影响其他命令**。
- **可以全程离线**。provider 配置须允许把端点（`AI_GATEWAY_URL`）改指**本地模型**（如 Ollama / llama.cpp 的 OpenAI 兼容端点），让"可选 AI"在用户愿意时也能不出本地、不联网——与项目离线身份对齐（见 §7）。

> 对照硬约束（`AGENTS.md`）：chat **不违反**任何一条——硬约束禁的是 `obsidian` 包 / `obsidian://` / Electron·Puppeteer·Playwright / 非 fs 文件操作 / 隐式字段假设缓存；都与"可选 LLM 调用"无关。但它确实**拉伸**了"纯离线 Node CLI"的气质，故用 §1 这套纪律把拉伸限制在一个可拔的角落。

## 2. 对标：agent-browser `chat` 的可迁移模式

实查 `vercel-labs/agent-browser` 后，提炼出 5 条可直接迁移的设计：

| # | agent-browser 的做法 | 迁移到 x-basalt |
|---|---|---|
| 1 | chat 的"工具" = CLI 本来就有的命令（`open`/`click`/`snapshot`…，定义在 `mcp.rs`），不为 AI 另造能力 | chat 的工具面 = 现有原语子集（`query`/`scan`/`meta get`… + 写动作），不新增 vault 能力 |
| 2 | 两模式：`chat "<指令>"` 单发即退；`chat` 进 REPL（quit/exit/q 退出） | 同形：`x-basalt chat "<指令>"` + `x-basalt chat` REPL |
| 3 | **plan→act→observe** 循环：NL→翻成原语→执行→把结果喂回→修正 | 同环：NL→选 query/meta→执行→把行/diff 喂回→下一步 |
| 4 | LLM 完全可选、env/flag 可配（`AI_GATEWAY_*` + `--model`），无 key 即禁用 | 同：env + `--model` 配 provider，无配置即禁用（§7） |
| 5 | 安全闸：`--confirm-actions` 对破坏性类别要批准；非 TTY 自动拒；60s 超时拒；内容边界防注入；输出截断防爆上下文 | 同：写 `.md` 的 meta 动作走确认/dry-run；非 TTY 拒；查询结果截断（§6） |

**关键洞察**：x-basalt 本就以 skill 被外部 agent（Claude Code）驱动——那是"外部 AI 出口"。`chat` 只是补一个**自驱出口**，让不在 agent 会话里的用户也能在终端用自然语言操作 vault。两个出口共享同一套原语。

## 3. 形态

```bash
# 单发：翻译 → 执行 → 输出 → 退出
x-basalt chat "把 projects/ 下所有 status 为空的笔记列出来"
x-basalt chat "给 2024 年的周报补上 tag #weekly"      # 含写动作 → 走确认

# 交互 REPL：保持上下文连续提问，quit/exit/q 退出
x-basalt chat

# 配置见 §7（完全兼容 agent-browser 的 AI_GATEWAY_* 环境变量）；无配置则禁用
AI_GATEWAY_API_KEY=gw_xxx x-basalt chat "..."
x-basalt chat --model anthropic/claude-sonnet-4.6 "..."   # --model 覆盖默认模型
```

- **会话上下文**：REPL 内累积对话 + 已执行动作的观察结果；单发模式无历史。
- **输出**：流式回显模型推理与每步动作（对标 agent-browser 的 stream），便于用户看清"它要对 vault 做什么"。

## 4. 架构

```
x-basalt chat "<NL>"
        │
        ▼
  src/chat/（独立模块，懒加载 AI SDK）
        │  plan → act → observe 循环
        ▼
  工具面 = 现有原语的受控子集
   ├─ 读（直接放行）：query(DQL) / parse / scan / index / skills recall / meta get
   └─ 写（确认闸后）：meta set / unset / rename / normalize / apply
        │
        ▼
  复用 commander 命令实现 + src/query、src/meta、src/indexer（零改动或极小改动）
```

- **不重写原语**：chat 通过结构化 tool-call schema 调用既有命令实现，参数校验复用现有逻辑。
- **observe 喂回**：query 返回的行、meta get 的当前值、写动作的 diff 预览，作为下一轮模型输入——这是 chat 比"一次性翻译成一条命令"更强的地方（能根据结果纠偏）。
- **典型链路**：`"找讲 CAP 定理的笔记"` → 模型发 `search`/`query` → observe 命中文件 → 模型读取/汇总 → 回答。（注：纯结构化 DQL 查不了正文，"找内容"这步要靠 [检索后端 spec](2026-06-28-semantic-retrieval-integration.md) 的 FTS5；没有它时 chat 仍能做结构化任务，只是"按内容找"会弱。）

## 5. 隔离纪律：怎么保证"没配 AI 也全功能"

这是 §1 脊梁的工程兑现，评估重点：

1. **模块边界**：所有 AI 代码进 `src/chat/`；`src/cli.ts` 仅在 `chat` 子命令分支里 `await import('./chat/…')`，其余命令分支不触达。
2. **依赖懒加载**：AI SDK 列为 `optionalDependencies` 或运行时动态 import；`pnpm install` 不装 = 其他命令完全不受影响；`chat` 调用时若缺失，报"运行 `x-basalt chat --setup` 或安装 X 以启用"。
3. **配置缺省即禁用**：无 `AI_GATEWAY_API_KEY` → `chat` 打印一段说明（如何配置、隐私边界）后退出码非 0；**不抛栈、不污染**。
4. **测试可在无网络/无 key 下全绿**：chat 的循环逻辑用 mock provider 测，CI 不需要真 LLM。

## 6. 写动作安全闸（对标 `--confirm-actions`）

vault 是用户的真实笔记，让 LLM 自动改 `.md` 风险最高，故：

- **读写分级**：读动作（query/parse/scan/skills/meta get）直接执行；写动作（meta set/unset/rename/normalize/apply）默认**先出 diff、需确认**。
- **确认方式**：交互 TTY 弹 `应用此改动？[y/N]`；`--yes` 批量放行；**非 TTY 自动拒**（防脚本里被静默改库）。
- **dry-run 优先**：写动作默认 dry-run 预览，确认后才落盘；复用未来 migrate/已有 meta 的原子写。
- **防注入**：vault 内容回灌给模型时用边界包裹（对标 agent-browser 的 `BOUNDARY_NONCE`），降低"笔记正文里藏指令"的提示注入面。
- **输出截断**：大查询结果截断后再入模型上下文，防爆 context。

## 7. provider 配置：完全兼容 agent-browser（`AI_GATEWAY_*`）

**决定**：若将来做 chat，**采用与 `agent-browser` 完全一致的环境变量契约**，让已在用 agent-browser 的用户零迁移成本复用同一套配置：

```bash
export AI_GATEWAY_API_KEY=gw_your_key_here                   # 必填：配了才启用 chat；不配 = 命令禁用（§1 默认关）
export AI_GATEWAY_MODEL=anthropic/claude-sonnet-4.6          # 可选，默认值（网关的 provider/model slug 格式）
export AI_GATEWAY_URL=https://ai-gateway.vercel.sh           # 可选，默认 Vercel AI Gateway
```

- **`--model <name>` flag 覆盖 `AI_GATEWAY_MODEL`**（同 agent-browser）。
- **底层用 OpenAI 兼容客户端**，`base_url` 取 `AI_GATEWAY_URL`：默认走 Vercel AI Gateway（一个 key 多厂商、含 Claude 系列），而 `AI_GATEWAY_URL` 可改指**任意 OpenAI 兼容端点**——包括本地 Ollama / llama.cpp。
- **离线性由此保住**：默认联网走网关，但把 `AI_GATEWAY_URL` 指向本地端点即可让"可选 AI"也全程不出本地、不联网——既对齐 §1 离线身份，又不破坏与 agent-browser 的配置兼容（同一组 env 同时满足两个目标）。
- **默认模型** `anthropic/claude-sonnet-4.6` 沿用 agent-browser 默认；用户可换任意网关支持的模型。

> 为什么不另起一套 env：与 agent-browser 共用 `AI_GATEWAY_*`，让两个工具能被同一份 shell 配置 / 同一个网关 key 一起驱动，是"最小可选"的自然延伸——用户已为 agent-browser 配过的，x-basalt 直接认，不重复造配置。

## 8. 可落地证据与工作量分级

把"今天就能做"与"需新增"标清，证明可落地、也圈出真实成本：

| 部件 | 现状 | 工作量 |
|---|---|---|
| 工具面（原语） | **已存在**：query/scan/meta/skills/parse 命令实现齐全 | 极小：包一层 tool-call schema |
| plan→act→observe 循环 | 无 | 中：一个标准 agent 循环（~1 个模块） |
| provider 适配（`AI_GATEWAY_*`，§7） | 无 | 小：OpenAI 兼容客户端 + 配置加载（复用 cosmiconfig） |
| 写动作确认闸 | meta 有原子写；无确认/dry-run 交互 | 小-中：加 diff 预览 + TTY 确认 |
| REPL | 无 | 小：readline 循环 |
| 防注入/截断 | 无 | 小：边界包裹 + 长度裁剪 |

**"按内容找"依赖**：chat 的核心价值之一是自然语言找笔记，但纯 DQL 查不了正文——这要 [检索后端 spec](2026-06-28-semantic-retrieval-integration.md) 的 FTS5 先落地。故两份文档是组合关系：chat 是前端，FTS5/语义检索是它最重要的一个后端动作。**chat 不依赖语义检索也能做结构化任务，但有了它才完整。**

## 9. 风险 / 不做 / 边界

- **风险·身份拉伸**：见 §1 脊梁——用隔离纪律把 AI 限制在可拔角落是化解前提，落地时须有"无 key 场景"的测试守门。
- **风险·让 LLM 改用户笔记**：靠 §6 安全闸 + dry-run + 非 TTY 拒；首版若做，建议**只读 chat 先行**（不暴露写动作），写动作等真实信任建立后再开。
- **不做**：不把 x-basalt 变成通用 agent 框架；不内置多 agent/工作流编排；不默认联网；不绑定单一云厂商。
- **与 MCP 的关系**：若将来还想要"外部 agent 出口"，同一套 tool-call schema 可同时供一个 `mcp` 子命令（对标 agent-browser 既有 `chat` 又有 `mcp`）——但那是另一份评估，不在本文范围。

## 10. 结论与触发条件

- **可落地**：是。模式成熟（agent-browser 实证），工具面已具备，增量集中在"一个 agent 循环 + 一个可选 provider + 一道确认闸"。
- **何时才值得做**（触发条件，满足再立计划）：
  1. dogfood 中反复出现"想用自然语言而非记 DQL 语法"的真实场景；且
  2. [检索后端](2026-06-28-semantic-retrieval-integration.md) 的 FTS5 已落地（否则 chat 的"按内容找"先天残缺）；且
  3. 已确认能守住 §1 的"最小可选"纪律（有无 key 双场景测试）。
- **现在的动作**：仅把本评估存档，并在 `TODO.md` 把它登记为"有评估背书的 backlog（可选 AI · 远期）"。**不写实现代码。**

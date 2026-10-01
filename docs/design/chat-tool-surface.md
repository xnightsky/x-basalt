---
type: design
title: chat 工具面架构：单一真相源评估（对标 agent-browser）
description: 当前 chat 单 CLI 工具面、迁移背景与宿主职责对照：argv、allowlist、路径还原及业务单一真相源；投入建议附信源。
tags:
  - design
  - chat
  - agent-browser
  - architecture
timestamp: 2026-09-30T23:53:31Z
sha256: 33aca83b1b723c2aaa290b68183b602e53c95ea5e59775c47bdc3304faf1257b
---
# chat 工具面架构：单一真相源评估（对标 agent-browser）

> 初始讨论：2026-07-30；当前单 CLI 工具面已实现，2026-09-30 补充职责与投入边界。
> **实现状态：✅ 已落地（2026-08-03，计划 [2026-08-03-chat-cli-tool.md](../plans/2026-08-03-chat-cli-tool.md)）**——`src/chat/cli-tool.ts` 单工具 + `tools.ts` 收编为 { cli, skills_recall, skills_get } + `X_BASALT_CHAT_CHILD` 防递归。
> 触发：chat 审查实锤 `pipeline_run` 的 `paths` 参数静默失效（`src/chat/tools.ts:467` 把模型给的路径 `toAbs` 成绝对路径，喂给匹配**相对主键**的 glob 路由过滤 `src/orchestrator/route.ts:53`，永不命中）——根因不是某行代码写错，而是 chat 手工维护着第二张能力表面，语义靠人肉对齐 CLI，必漂移。
> 关联：[chat 读写机制](chat-readwrite.md)、[chat skill grounding](chat-skill-grounding.md)、对标调研 [`../research/2026-06-30-chat-gap-vs-agent-browser.md`](../research/2026-06-30-chat-gap-vs-agent-browser.md)。

## 0. 本文回答的问题

> 「为什么不只维护一份教 AI 用 CLI 的 skill，让 chat 直接执行这个 CLI（跨 win/unix）？」——这条路线对不对？对的话 x-basalt 该怎么落？

**结论先行**：方向对（agent-browser 就是这么做的），但落地的关键不在「执行 CLI」，而在两条纪律——**工具 schema 与 CLI 一处定义**、**模型永远不拼 shell 字符串（参数走数组）**。满足这两条，win/unix 差异结构性消失；不满足，skill 文档会退化成 shell 引用手册。

## 1. 迁移前的问题：chat 曾手工维护第二张能力表面

```mermaid
flowchart TD
    user([用户 / 模型]) --> cli["cli.ts<br/>CLI 命令面（真相源）"]
    user --> chat["src/chat/tools.ts<br/>chat 手写工具面（第二表面）"]

    cli -->|"commander 解析 +<br/>resolvePipelineParams 校验"| libs["orchestrator / meta / query / indexer<br/>既有库层"]
    chat -->|"进程内直调，<br/>参数语义自行解释"| libs

    chat -.->|"⚠ 语义靠人肉对齐 CLI，无代码级共享<br/>paths bug：toAbs 绝对路径 vs 相对主键 glob → 永不命中"| cli
```

- CLI 面的参数语义集中在 `src/orchestrator/params.ts`（`resolvePipelineParams`，声明期报错）；chat 面在 `tools.ts` 里**重新解释**同一批参数（`toAbs`、默认值、源选择）。
- CLI 加能力 → chat 要人工跟进；跟漏、跟错都无声无息。`paths` 在 CLI 里是 glob 路由过滤（文件列表源归 `--stdin`），chat 包装层把它理解成「文件列表」——双重错位，模型一传就静默零处理。
- skills 侧（`skills-data/core.json5`）教的是 CLI 用法，和 chat 工具面描述的又是第三份近似表述。

## 2. 对标：agent-browser 怎么做（chat 与 dashboard）

```mermaid
flowchart LR
    subgraph surfaces["三个表面 · 共享一份工具定义"]
        mcp["MCP server"]
        chatcmd["chat 命令"]
        dash["dashboard chat 面板<br/>（Next.js 嵌入二进制，:4848）"]
    end

    skills["skills/ 目录<br/>（语义层教学：何时用哪个命令）"]
    tools["mcp.rs tools()<br/>name + description + JSON schema<br/>单一真相源，按 profile 过滤<br/>Core/Network/State/Debug/Tabs/..."]
    llm([LLM])

    llm -->|"① 结构化 tool call<br/>(name + JSON args)"| ct["call_tool(name, args)"]
    ct --> handlers["call_open / call_click / call_snapshot ..."]
    handlers -->|"② argv 数组<br/>vec![get, url] · 无 shell"| send["send_command"]
    send -->|"③ JSON over IPC socket"| daemon[("常驻 daemon<br/>校验并执行")]

    surfaces --> tools
    tools --> ct
    skills -.->|"system prompt 强框 stub：<br/>动手前先 skills get core"| llm
```

可迁移的四条纪律（deepwiki 两源核实，调用链以 `call_tool → handler → argv 数组 → send_command → daemon` 为准）：

1. **schema 单一真相源**：`tools()` 一处定义 name/description/JSON schema，MCP、chat、dashboard 三面共享；`McpConfig` 按 profile 过滤暴露子集。不存在第二张手写表面。
2. **模型不见 shell**：LLM 产出结构化 tool call，handler 拼 **argv 数组**直接分发——跨平台不是「教两套引用规则」，而是引用问题不存在。
3. **skills 管语义、schema 管参数**：skills（`skills get core`）教「什么时候用哪个命令」；参数校验是代码层的 JSON schema + 结构化 `ParseError`（UnknownCommand/MissingArguments/InvalidValue），不靠文档防漂移。
4. **容错在分发层**：瞬时错误重试 5 次（200ms 递增退避），daemon 不可达则 `ensure_daemon` 重生——模型侧只看到干净的结构化错误。

> x-basalt 无 daemon，等价物是：spawn `execFile(process.execPath, [cli.js, ...argv])`（参数数组、无 shell），或把 CLI 命令实现抽成库函数进程内分发。两者都满足纪律 2。
>
> **补充实证（2026-07-30 deepwiki）**：agent-browser 的 chat 会话甚至只暴露**一个**工具——`CHAT_TOOLS` 常量定义单个 `agent_browser` 工具（入参一条 `command` 字符串，由 CLI 解析执行）。「全部能力收一个执行口」不是 x-basalt 的激进发明，而是对标库的既验形态；这也顺带解释了它的防递归：模型词表里根本没有能起新 AI loop 的入口（详见 §5）。

## 3. 目标形态：彻底切到「chat = 薄执行壳 + CLI 唯一真相源」

```mermaid
flowchart TD
    llm([LLM]) --> loop["chat loop（src/chat/loop.ts）"]

    loop --> cliT["cli 工具（唯一执行口）<br/>execFile(node, [cli.js, ...args])<br/>参数数组 · 无 shell · 子命令 allowlist<br/>输出过 safety（VAULT_DATA 边界 + 截断）"]

    cliT --> cli["cli.ts（唯一能力真相源）<br/>统一 --json / 统一分页 / 结构化错误码<br/>--vault/--db 由工具壳注入"]
    cli --> libs["parser / query / indexer / meta / orchestrator<br/>库层（现状不变）"]

    skills["skills-data/core.json5<br/>语义层：教何时用哪个命令<br/>（唯一说明书）"] -.->|"skills_get（现状保留）"| llm
```

**决策（2026-07-30 讨论拍板方向）**：不留混合过渡形态。曾被考虑的「高频读工具保留进程内 + 写侧走 cli 工具」混合案被否决——它只是把漂移面缩小、不消失，还长期背两份 schema 的维护债。「先补契约再切」是同一计划内的**步骤排序**，不构成一个并存的架构阶段。

**彻底切的第三个理由（用户拍板）：工具名额预算。** LLM 工具面每多一个工具都是 prompt 体积与选择错误率的双重成本。全部能力收进**一个** `cli` 工具后，chat 的工具面只占一个名额，腾出的预算留给将来真正的 AI-native 新能力（各种读取 / search 工具）。准入规则由此清晰：

- **能力属于 CLI**（vault 操作原语）→ 进 CLI 子命令，经 `cli` 工具到达，**不配独立工具**；
- **能力不属于 CLI**（如语义/embedding 检索、外部源——CLI 不该长的能力）→ 才配独立 AI 工具，注册在保留下来的 `tools.ts` 装配点（见 §4 第 3 步）。

目标形态下 AI 视野 ≡ CLI 视野（对齐 agent-browser 实证）：

- **同一词表**：模型可用能力 = CLI 子命令集（allowlist 过滤后），不多不少；
- **同一分发**：模型 args 数组与人敲的 argv 汇入同一个 `cli.ts` 入口，校验、执行、错误格式一致；
- **同一输出契约**：模型观察到的 stdout 就是 `--json` 结构化输出，分页口径全命令统一。

## 4. 执行序列（一次到位，四步有先后、无并存）

1. **前置 · CLI 输出契约统一**：全命令 `--json`；统一分页（`offset/size/total/hasMore`）；错误结构化（错误码 + 消息，非零 exit code 分类）。这是唯一起点，契约不齐时切换 = 模型观察面退化。
2. **chat 侧新增 `cli` 工具**：input `{ args: string[] }` → `execFile(process.execPath, [cliEntry, ...args])`；`--vault/--db` 由工具壳注入；超时 + 子命令 allowlist；stdout/stderr 过 `observe(safety, …)`（边界包裹 + 8000 字符截断留在薄壳，**不需要 CLI 本体感知 AI**）。
3. **删除手写工具面、保留 `tools.ts` 框架**（2026-07-30 用户拍板 + 评估确认）：删的是 `buildTools` 里那 ~14 个手写工具定义（schema + execute 全套，约 360 行）；**留的是框架**——`buildTools(ctx, safety)` 装配点（`loop.ts` 的消费签名不变，loop/repl 零改动）、`observe` safety 输出处理、`wrapToolErrors` 错误分类外壳、RECALL 追踪机制（改为解析 `args` 子命令）。「腾出空间」指的是 **ToolSet 条目从 ~14 个收编为个位数**，不是删文件——框架正是未来 AI-native 工具的注册缝。`cli` 工具实现放独立模块（如 `src/chat/cli-tool.ts`），`tools.ts` 只剩装配；`skills_get`/`skills_recall` 保留为独立工具（grounding 是最高风险的第一步，且它们是「模型说明书」元工具、非 vault 能力面——agent-browser 的 `TOOL_SKILLS_GET` 同样单列）。`tool-errors.ts` 分类改为「exit code + stderr 结构化错误」驱动。
4. **回归验证**：用 `../x-basalt-evals` 场景库在切换前后各跑一遍，对比操作失败率 / 撞顶率——大爆炸切换的质量回归由此兜底（这是「敢直接切」的前提，不是可选项）。

顺手项：`paths` bug 随工具面删除自然消亡——文件列表语义归 CLI 的 `--stdin` 源（或给 `run` 补显式 `--paths` 源），不再有 chat 层 `toAbs`。

### 4.1 文件路径不是普通 argv：索引主键必须在壳层还原

切 C 后仍有一条不能“逐项原样透传”的跨层不变量：`query` / `search` 给模型的 `file.path` 是 **vault 布局主键**，而 `parse` / `meta` 的公开 CLI 接收的是物理文件路径、按 cwd 解析。两者只在“vault 根恰好等于 cwd”时偶然相同：

- 单根位于嵌套目录时，主键 `a.md` 实际应读 `<vault>/a.md`；
- 多根时，主键 `plans/a.md` 的 `plans` 是根命名空间，物理根可能是 `.tmp/plans`，不能当 cwd 下的目录；
- 读侧解析错会触发模型反复猜前缀并撞 error-storm，写侧解析错则可能静默修改 cwd 下的同名文件。

因此 `src/chat/cli-tool.ts` 在 spawn 前仅对 `parse` / `meta` 的文件位置参数调用既有 `resolveVaultLayout(...).toAbs(...)`，再把绝对路径交给原 CLI。转换放在 chat 壳而非 `cli.ts`：壳持有本轮确定的 `ToolContext.vaultPath`，能无歧义解释索引主键；公开 `parse` / `meta` 仍可独立操作任意显式文件路径，不新增 `--vault`，也不复制第二套路由算法。

后续扩展口（非本轮）：AI-native 新工具（语义检索等，§3 准入规则第二条）以独立工具加入，与 `cli` 工具并存——工具面只有「1 个 CLI 执行口 + N 个 AI-native 能力」，N 的每个都要过「CLI 不该长这个」的审查。

## 5. 当前边界与风险（2026-09-30 复核）

- **已实现，不再待立项**：`buildTools` 装配 `cli`、`skills_recall`、`skills_get`，CLI 壳以 argv 数组分发、排除 watch/chat；路径还原与参数注入以 [`src/chat/tools.ts`](../../src/chat/tools.ts) / [`src/chat/cli-tool.ts`](../../src/chat/cli-tool.ts) 为准。§1 与 §4 保留迁移前问题及执行记录，不代表仍有两套工具面。
- **风险·能力暴露面扩大（含递归调用 chat）**：`cli` 工具让模型触达全部子命令，allowlist 必须排除两类：① 常驻/交互类（`watch` 永不返回、挂死对话——系统提示现行禁令要变成壳层硬约束）；② **`chat` 自身**（否则模型可 `chat` 套 `chat` 起嵌套 AI loop）。防递归对照 agent-browser：它**没有**深度计数器，靠的是结构性排除——chat 会话的 LLM 只拿到一个 `agent_browser` 工具（`CHAT_TOOLS` 单工具、typed、无 shell），而 `chat` 命令在 `main.rs` 顶层分发、不走普通命令路径，`batch` 也不能嵌 `chat`。即「能起新 AI loop 的入口根本不进模型词表」。x-basalt 同理用 allowlist 结构性排除 `chat`，另加一道便宜加固：工具壳 spawn 时注入 `X_BASALT_CHAT_CHILD=1` 环境变量，chat 启动检测到即拒——兜住 allowlist 误配/被绕。
- **写入开关遵循 CLI**：`meta` 写动作默认落盘，`run` 的批量写需显式 `--apply`；当前 `execCli()` 不自动补该开关。模型调用与人调用走同一命令语义，不能因没有确认弹窗就假设所有批量调用都已写入。信源：[`src/cli.ts`](../../src/cli.ts)、[`src/chat/cli-tool.ts`](../../src/chat/cli-tool.ts)。
- **风险·性能**：每步一次 spawn 冷启动（node + SQLite 打开），20 步 loop 多出数秒——可接受，但场景库回归时顺带记录耗时变化。
- **已核实 / 未核实**：原 agent-browser 对照经 deepwiki 两源交叉确认，未直读对应版本源码；只作为当时设计背景，不据此证明当前实现优劣。当前项目机制以本仓源码为准。

## 6. 宿主投入与接口纪律（2026-09-30）

**保持已实现的薄壳，不把调查中的宿主能力当成新增实现要求。** Anthropic 的 [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 与 [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)说明按需上下文/工具发现已有现成路线；[Is Grep All You Need? v1](https://arxiv.org/html/2605.15184v1)提示效果仍取决于模型、宿主和交付方式。它们支持先比较外部宿主的建议，不支持“通用宿主必然更省或更准”。

```mermaid
flowchart LR
    U["用户任务"] --> H{"调用方"}
    H --> LOCAL["当前 chat<br/>可选模型 / 会话 / 有界循环"]
    H --> EXT["外部 Agent<br/>自有权限与上下文管理"]
    LOCAL --> WRAP["cli-tool.ts<br/>argv / 无 shell / allowlist / 路径还原"]
    WRAP --> CLI["同一 CLI 业务入口<br/>参数校验 / 执行 / 输出"]
    EXT --> CLI
    SK["运行时 skills<br/>按需取规范，不替代参数校验"] -.-> LOCAL
    SK -.-> EXT
    CLI --> CORE["确定性内核<br/>DQL / Bases / FTS / meta"]
    CORE --> DATA[("文件 + 派生 SQLite")]
    LOCAL -. 待量化对照 .-> EVAL["任务成功 / 证据 / 费用 / 失败模型"]
    EXT -. 待量化对照 .-> EVAL
    classDef core fill:#eaf3ff,stroke:#3274b7,stroke-width:2px;
    classDef compare fill:#fff3df,stroke:#bc7c22,stroke-width:2px,stroke-dasharray:5 5;
    class CLI,CORE,DATA core;
    class EVAL compare;
```

图中 chat 路径依据上述本仓源码，外部路径表示 CLI 可供调用，不代表所有宿主已集成或通过验收。比较协议见[最新调研 §9](../research/2026-09-30-agent-knowledge-industry-landscape.md#9-下一步实验可复现能推翻建议)。新增 MCP/工具 schema 应共享业务语义；[MCP Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)的发现/annotations 不替代权限执行。保留封闭工具面、明确部署体验的理由可以成立，但须实测而非由工具数量推出质量。

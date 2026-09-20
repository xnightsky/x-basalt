---
type: design
title: chat 会话落盘与续跑设计：--session [uuid] 单一入口
description: 给 x-basalt chat 加可选的会话落盘与跨进程续跑：默认不落盘；--session 裸用新建（系统生成 UUID）、--session <uuid> 严格续跑（不存在即报错）；JSONL 事件流逐 step 追加落盘 <BASE_DIR>/sessions/chat-<uuid>.jsonl，崩溃只丢在途 step；返回时任何形态必带 session id；--max-steps 与续跑正交
tags:
  - design
  - chat
  - session
  - jsonl
timestamp: 2026-09-20T11:57:07Z
sha256: 39877090deeb05926680e7aad80b6d5365aaf88bf323d05eeaef8bab3c28120a
---
# chat 会话落盘与续跑设计：`--session [uuid]` 单一入口

> 日期：2026-09-20 · 类型：可行性结论 + 实现设计提案（**未落码**，按本 spec 开工）
> 状态：**提案（可行性已验证）**
> 关联：[`chat-trace.md`](chat-trace.md)（事件流落盘，与本文的会话落盘互补不互替）、[`chat-readwrite.md`](chat-readwrite.md)（chat 总体实现设计）、[`chat-tool-surface.md`](chat-tool-surface.md)（工具面）、[`../use/chat.md`](../use/chat.md)（用户侧现状）

## 1. 结论

**跨进程续跑可行，且改动是小切口**：`runLoop` 返回的 `ModelMessage[]` 是纯 JSON 形态，落盘读回后能被新一轮 `streamText` 原样接受，模型能收到含 tool-call / tool-result 的完整历史（§3 有 spike 实录）。同进程内这套机制已在 REPL「继续」里生产运行，本文只是把它的上下文载体从内存换成文件。

设计基调（2026-09-20 两轮拍板 + 一轮修正）：**参考 pi 的 session 机制**——pi 默认落 session（`~/.pi/agent/sessions/*.jsonl`，JSONL 树结构）、`--no-session` 可选不落、`pi -c` / `pi -r` 续跑恢复；x-basalt 在此基础上按自身语境**取反与对齐**（默认不落盘、UUID 严格语义、JSONL 事件流追加、不抄会话树）：

| | pi | x-basalt chat |
| --- | --- | --- |
| 默认 | **落 session**（`~/.pi/agent/sessions/*.jsonl`） | **不落 session**（现状，零成本零隐私面） |
| 会话开关 + 续跑入口 | `--no-session` 可选不落；`pi -c` / `pi -r` 续 | **`--session` 一个参数**：裸用 = 新建（系统生成 UUID）；`--session <uuid>` = 严格续跑（不存在即报错）。**不设 `--continue`** |
| 步数预算 | 无 max-steps 概念 | `--max-steps` 是**每轮**预算，续跑时可自由调整，与会话文件正交不冲突 |
| 存储格式 | JSONL 树（id/parentId） | **JSONL 事件流追加**（线性，无树）：header + 逐 message 行 + 轮次收尾行 |

> **决策记录**：
> ① 第一轮：不设独立 `--continue`，复用 `--session` 单入口——双 flag 要用户先想「我是新开还是续」，单入口没这个问题。
> ② 第二轮：会话标识收紧为**系统生成的 UUID，禁止自由文本名**（`--session my-task` 不允许）。由此 `--session <uuid>` 获得严格语义（不存在 → 报错退出非 0）——手打的 UUID 几乎不可能恰好撞上已有会话，① 遗留的 typo 静默分叉风险被 UUID 空间**天然消除**，最终形态比 upsert 初版更严。代价：新建入口只能由系统生成 UUID，定为裸 `--session`（§4.1）。
> ③ 第三轮（落码后修正）：存储从「单 JSON 快照 + 原子写」改为 **JSONL 事件流追加**——快照模型下崩溃（含网络崩溃）会丢掉整个在途轮次；追加式让每个已完成的 step 实时在盘上，崩溃只丢在途 step，且与业界主流（pi/Claude Code 均 JSONL 追加）对齐。追加粒度定为 **step 完成**（`onStepFinish`）：每步的 assistant(tool-call)+tool(result) 成对落盘，盘上历史恒停在完整步边界。

一句话原理：**撞顶不是对话死亡，只是本轮预算用完**。`messages` 是完整可序列化的上下文快照；续跑 = 快照读回 + 新的 `--max-steps` 预算再跑一轮 `runLoop`。

## 2. 背景与现状

| 场景 | 撞顶后能否续跑 | 机制 |
| --- | --- | --- |
| REPL 内同一进程 | ✅ 已支持 | `repl.ts`：`stopReason === "exhausted"` 后置 `canContinue`，输入「继续」用累积的内存 `messages` 再跑一轮，获得全新预算 |
| 单发（`chat "指令"` / 管道） | ❌ 不支持 | `runOnce` 的 `messages` 是纯内存数组，进程退出即丢；只提示「加大 `--max-steps`」 |
| Ctrl+C 中断后 | ❌ 刻意不支持 | 上下文可能不一致（`repl.ts` 注释明示），本文沿用该纪律，见 §4.3 |

为什么默认**不**落盘（与 pi 取反的理由）：

1. **隐私面默认收敛**：chat 的 tool-result 携带 `<<VAULT_DATA>>` 包裹的 vault 原文，默认落盘等于把库内容静默写第二份到磁盘；opt-in 让用户知情。
2. **YAGNI**：chat 处于手玩验证阶段（见 `use/chat.md` 头注），先把开关做出来，默认行为零变化。
3. **一致性**：`--trace` 已是同款 opt-in 哲学（`chat-trace.md` §1：可选增强、不成为主流程单点故障）。

**trace ≠ session，两者互补不互替**：`--trace` 落的是 `LoopEvent` 事件流（排障回放用，含渲染噪声与元信息），不能喂回模型；session 落的是 `ModelMessage[]` 消息快照（续跑用）。一个会话可以同时开两者，各写各的文件。

### 2.1 业界校准（2026-09-20 调研）

调研六家 agent CLI 的会话契约（信源：各家官方文档 2026-09-20 逐字抓取 + pi 本机源码；调研过程稿已删，结论内联于此）：

| 工具 | 默认落盘 | 续最近 | 续指定 | id 形态 | 存储 |
| --- | --- | --- | --- | --- | --- |
| pi | ✅（`--no-session` 退出） | `pi -c` | `pi -r` / `--session <id>` | 文件 id | JSONL 树 |
| Claude Code | ✅ | `--continue`/`-c` | `--resume <id\|name>` | UUID | JSONL |
| Codex CLI | ✅ | `codex resume` | 同左（搜索选择） | — | — |
| Gemini CLI | ✅ 自动保存 | 裸 `--resume` | `--resume <N\|uuid>` | UUID | 每会话一文件 + retention 30d |
| OpenCode | ✅ | `--continue`/`-c` | `--session <id>`/`-s` | Session ID | — |
| Aider | 落历史但恢复默认关 | — | `--restore-chat-history`（默认 False） | — | Markdown |

与本设计直接相关的校准点：

- **默认落盘是业界主流**（五家全默认落；Aider 落了历史但默认不恢复）。我们「默认不落」是**有意偏离主流**，理由即本节三条；偏离由此从隐含变明示。
- **裸 flag 的业界语义 = 续最近**（Gemini 裸 `--resume` 即最近；`-c`/`--continue` 家家有），「裸 flag = 新建」无一家采用。我们裸 `--session` = 新建是**与肌肉记忆相反的有意偏离**：默认不落盘时新建需要显式 opt-in 入口，且 UUID 只能由系统生成。冲突靠 §4.1 规则表与严格报错文案消解。
- **UUID 作 id、返回 session id** 与业界对齐（Claude/Gemini 官方示例均 UUID；Claude `--bg` 明示「Prints the session ID」）。
- **存储格式**：业界主流是追加式 JSONL（pi / Claude Code 均如此，崩溃不丢已写部分、不重写大历史）——**决策记录③后我们已对齐**（§4.2）。
- **生命周期管理是业界标配而我们暂无**：Gemini 有 retention（默认 30d 自动清理）+ `--delete-session`，多家有会话选择器；本期 `ls .x-basalt/sessions/` 兜底，列入非目标（§7）。

## 3. 可行性验证（spike 实录）

核心假设：*跨进程续跑 = 上轮 `messages` 经 JSON 落盘/读回后，新一轮 `runLoop` 能接受且模型收到完整历史。*

验证方法：一次性 spike 脚本（不入仓），用 `tests/chat/loop.test.ts` 同款 `MockLanguageModelV4` 脚本化模型跑两轮，中间经 `JSON.stringify → 写文件 → 读回 → JSON.parse` 模拟跨进程：

```text
轮 1: user → runLoop(mock: tool-call → 文本) → messages(2 条)
                │ JSON.stringify → /tmp 文件 → 读回 parse
                ▼
轮 2: restored + user「继续」 → runLoop(mock: 文本) → messages(4 条)
```

实测输出：

```text
第一轮 stopReason: done | messages 条数: 2
JSON round-trip 深度相等: ✅ | 落盘字节数: 237
第二轮 stopReason: done | messages 条数: 4
第二轮模型收到的 prompt 含历史 tool-call/tool-result 原文: ✅（tc1 / 观察:hi 逐字在列）
```

两个结论 + 一个已知边角：

- ✅ **模型侧零障碍**：反序列化后的历史（含 `tool-call` / `tool-result` part）被 `streamText` 直接接受，第二轮 prompt 里历史逐字可见。
- ✅ **快照语义正确**：第二轮返回的 `messages` 在快照基础上正确追加（2 → 4 条），可继续链式续跑。
- ⚠ **JSON round-trip 非逐字节恒等**：ai SDK 内部 part 带 `providerOptions: undefined`，`JSON.stringify` 丢弃 undefined 值键，故 `deepStrictEqual` 不通过——但 JSON 规范化后完全相等，对模型语义无影响。落盘格式照此接受即可，不做 undefined 键保留。

> **实现期修正（2026-09-20 落码时发现并修复）**：上述 spike 的 T2 等价命题实际只验证了「文本历史」送达——落码时实测暴露 `result.response.messages` 在 ai@7 只含**最后一步**的消息（step0=assistant(tool-call)+tool(result)、step1=assistant(text) 时，final 只剩 assistant(text)），即**现有 runLoop 的 messages 累积本就丢工具历史**（REPL 多轮与撞顶「继续」同样受影响，模型下轮看不到自己查过什么）。已修复：`runLoop` 改为逐 step 拼接 `steps[i].response.messages`（`src/chat/loop.ts` 注释锁定）；T2/T4 用例按修复后的完整形状断言（含 tool 角色消息、第二轮 prompt 逐字含历史 tool-call/tool-result）。

## 4. 方案

### 4.1 CLI 契约

**一个参数两个形态**：裸 `--session` = 新建（UUID 唯一来源是系统）；`--session <uuid>` = 严格续跑（不存在即报错）。不设 `--continue`、不设自由文本名（决策记录见 §1）。

```bash
x-basalt chat "列出本周新建笔记"                      # 临时会话（现状，不落盘）
x-basalt chat "长任务第一步" --session                # 新建：系统生成 UUID 并打印
#   → · 会话 3f2a8c1e-… 已创建 → .x-basalt/sessions/chat-3f2a8c1e-….jsonl
x-basalt chat "接着把剩下的跑完" --session 3f2a8c1e-…  # 载入历史续跑（单发）
x-basalt chat --session 3f2a8c1e-…                    # 续跑进 REPL（带历史）
x-basalt chat --session 3f2a8c1e-… --max-steps 100    # 续跑同时调大本轮预算
```

行为规则（每条配一例）：

| 输入 | 行为 | 例 |
| --- | --- | --- |
| 不带 `--session` | 临时会话，零落盘（现状逐字节不变） | 一次性问答 |
| `--session`（裸） | **新建**：`crypto.randomUUID()` 生成 id，首行打印 `· 会话 <uuid> 已创建 → <文件路径>`；此后**逐 step 追加落盘**（崩溃只丢在途 step） | 长任务开局带上，防进程挂掉丢上下文 |
| `--session <uuid>`，存在 | 打印 `· 已续会话 <uuid>（N 条消息，上轮 <stopReason>）`，载入历史**续跑**，本轮起追加到同一文件 | 复制上轮打印的 UUID 继续推进 |
| `--session <uuid>`，不存在或格式非法 | **报错退出非 0**（严格语义即 typo 防线：手打 UUID 撞不上已有会话，报错就是最好的提示） | `--session my-task` → `✗ 无效会话 id（须为 UUID）` |
| `--max-steps <n>` | 每轮独立预算，与落盘/续跑正交；header 里记的 `maxSteps` 只是元信息（同 trace session 行），不构成续跑约束 | 上轮 50 步撞顶，`--session <uuid> --max-steps 100` 续 |

- **返回时必带 session id（硬契约，无论什么形态）**：只要本次运行带了 `--session`（裸或 `<uuid>`），进程返回前必须让调用方拿到当前会话 id——
  - `full` 档：stdout 收尾打 `· 会话 <uuid> → <路径>`；
  - `summary` / `quiet` 档：同一行打 **stderr**（不污染 stdout 的答案管道）；
  - `--json` 档：聚合 JSON 对象新增 `"sessionId": "<uuid>"` 字段（机器可读的唯一权威通道）；
  - REPL：横幅常驻 + 退出语再打一次；
  - 中断（Ctrl+C）/ 出错等非正常返回：照常向 stderr 打该行——正因为跑了半截，UUID 才是找回现场的唯一线索。
  人读靠打印行，脚本读靠 `--json.sessionId`。
- **载入后行为**：单发把 input 追加为新 user 消息（无 input 则进带历史的 REPL）；REPL 恢复 `messages` 与 `canContinue`（上轮 exhausted 则进去即可打「继续」）。
- **无「续最近」快捷**：砍掉（YAGNI）——每轮结束都打印 UUID，复制即续；将来确有疲劳再另开决策。
- **边界：非 TTY 且无 input 时带 `--session <uuid>`**：现有「chat 未提供输入」报错升级为「会话 `<uuid>` 已定位，但未提供输入」——避免用户误以为 UUID 错了；语义不变（非 0 退出）。

### 4.2 落盘格式与写入纪律

**路径**：`<BASE_DIR>/sessions/chat-<uuid>.jsonl`（`BASE_DIR = X_BASALT_DIR ?? .x-basalt`；目录自动创建、`.x-basalt/*` 已在 `.gitignore`）。`sessions/` 统一收口各类会话产物、`chat-` 前缀标来源——与既有 `chat-traces/` 平级演进，同目录下 `ls` 一眼可分拣。

**JSONL 事件流追加（决策记录③）**：消息快照语义不变（续跑读出的仍是完整 `ModelMessage[]`），变的是**写入时机**——不再每轮结束整体覆写，而是逐条追加：每完成一个 step 就把它的 assistant/tool 消息追加落盘。于是崩溃（含网络崩溃、Ctrl+C）只丢**在途 step**，盘上永远留着「半截但可用」的进度；这也是业界主流形态（pi / Claude Code 均为追加式 JSONL，§2.1）。

行 schema（三类行，`kind` 区分）：

```jsonl
{"kind":"session","version":1,"id":"3f2a8c1e-…","createdAt":"2026-09-20T10:00:00.000Z","model":"openai/gpt-5","vault":["/abs/vault"],"db":".x-basalt/index.db","maxSteps":50}
{"kind":"message","turn":1,"ts":"…","message":{"role":"user","content":"长任务第一步"}}
{"kind":"message","turn":1,"ts":"…","message":{"role":"assistant","content":[{"type":"tool-call",…}]}}
{"kind":"message","turn":1,"ts":"…","message":{"role":"tool","content":[{"type":"tool-result",…}]}}
{"kind":"turn","turn":1,"ts":"…","stopReason":"done","steps":2}
```

- **追加粒度 = step 完成**（`onStepFinish`）：每步的 assistant(+tool-call) 与 tool(result) 在同一批追加里成对落盘，盘上历史恒停在**完整步边界**——不存在半截 tool-call 悬空挂在文件里的正常形态。
- **每次追加一次 `appendFileSync`**：不缓存 fd、不写缓冲，行落盘即持久（本消息量级下开销可忽略）；崩溃可能留下**半截尾行**，读侧容错跳过（见下）。
- **轮次边界 = `kind:"turn"` 收尾行**：一轮正常结束（done/exhausted/error-storm）才写。文件末尾有 message 行却无对应 turn 收尾 = 上轮中断/崩溃半程（`interrupted`）。
- **读侧重建与容错**（`loadSession`）：首行必须是合法 header（version 不符 → 报错）；中间行损坏 → 报错不静默；**仅末尾半截行容忍跳过**（崩溃写一半的合法形态）；若历史以「未被 tool 结果回答的 assistant tool-call」收尾（同批两行被崩溃劈开），截掉该孤儿 assistant 消息并置 `interrupted`——保证喂回模型的历史恒一致。
- **`system` 不落盘**：系统提示随 CLI 版本演进，每次续跑现拼 `SYSTEM_PROMPT`。
- **`messages` 原文落盘**：含 `<<VAULT_DATA>>` 包裹的 tool-result 原文——续跑保真所必需，也意味着文件含 vault 内容（§5 风险表）。
- **默认路径下行为逐字节不变**：不带 `--session` 时零文件 I/O、零新分支。

### 4.3 续跑守卫

1. **vault/db 一致性校验（仅续跑时）**：会话文件里的 `vault`/`db` 与本次解析结果不一致 → 拒绝续跑、退出非 0、报「会话属于另一个库」。防跨天续跑时对着换过的库误写（chat 写工具无确认闸，这是唯一的事前防线）；新建无历史可校验，跳过。
2. **`lastStopReason` 分级**：`exhausted`/`done` → 直接续；`error-storm` → 打一行警告仍允许（用户显式给 `--session <uuid>` 即知情），因为续跑可能重蹈死循环；**中断/崩溃轮（无 turn 收尾行）**：盘上历史恒停在完整步边界（§4.2），续跑合法——截掉可能的孤儿 tool-call、置 `interrupted`，恢复时提示「上轮中断于第 N 轮进行中」；REPL 恢复后可直接「继续」。快照时代的「abort 不落盘」规则随之作废（事件流下已完成的 step 天然在盘，这正是改 JSONL 的目的）。
3. **损坏与版本**：JSON 解析失败或 `version` 不支持 → 报错退出非 0，**不静默开新会话**（静默重置会让用户误以为历史还在）。
4. **id 严格校验**：值必须是 UUID 形态（`[0-9a-fA-F-]` 白名单）——斜杠、点号、自由文本一律被拒，**路径穿越与 typo 分叉同死于这一条**；格式合法但文件不存在同样报错（§4.1 规则表）。
5. **model 变更提示**：header 记的 `model` 与本次 `--model`/环境解析结果不同 → 打一行提示仍允许续跑（`ModelMessage` 是 provider-agnostic 格式，换模型合法；但上下文由旧模型产出，提示让用户知情）。

### 4.4 REPL 集成

- 现有内存「继续」（`interpretLine` 的 `canContinue` 分支）**不变**——同进程秒级续跑仍是最快路径，不绕文件。
- 带 `--session`（裸或 `<uuid>`）时：逐 step 追加落盘（崩溃只丢在途 step），轮次正常结束写 turn 收尾行；横幅常驻会话 id，退出语再打一次 UUID 与文件路径。
- 续跑进 REPL（`--session <uuid>` 命中已有会话）：横幅追加一行「已续会话 `<uuid>`（N 条消息，上轮 `<stopReason>`）」，提示符逻辑照 `canContinue` 恢复。

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 会话文件含 vault 原文（隐私面） | 库内容多一份磁盘副本 | opt-in 才落盘；落在已 gitignore 的 `.x-basalt/`；`use/chat.md` 明示该文件含 vault 内容、自行清理 |
| 跨天续跑时 vault 已漂移 | 模型基于过期上下文写文件 | §4.3 守卫 1（vault/db 不一致即拒）；同库漂移属用户知情范围（与 REPL 内续跑同源风险，只是时间窗拉长） |
| ai SDK 大版本升级改 `ModelMessage` 形状 | 旧会话喂不进新 SDK | header 带 `version`；读时不兼容直接报错（守卫 3），不尝试迁移 |
| 并发写同一 UUID | 两进程行交错，语义串线 | 不实现锁——单用户 CLI 场景，文档注明「同一会话别并行跑」；append 行级写入保证文件不烂（最坏只是交错，读侧逐行解析不受损） |
| 上下文只增不减撞模型窗口 | 长会话后期 provider 报错 | 本设计不解决（非目标 §7）；`--max-steps` 控制的是步数不是 token，超窗由 provider 报错如实上浮 |
| UUID 不好记、不如具名直观 | 续跑要先找回 UUID | 新建/每轮收尾/REPL 横幅三处显眼打印（§4.1）；`ls .x-basalt/sessions/` 按 mtime 找；这是严格语义换来的代价，已在 §1 决策记录明示 |

## 6. 测试要点

按 AGENTS「复杂模块重测试」精神，落盘/读回/守卫逐项独立用例（mock 模型走 `MockLanguageModelV4`，与 `tests/chat/loop.test.ts` 同基建）：

| # | 测试项 | 覆盖目标 |
| --- | --- | --- |
| T1 | round-trip 等价 | `messages` 经 JSON 落盘读回后规范化相等；含 tool-call/tool-result part |
| T2 | 续跑端到端（mock） | 裸 `--session` 新建落盘 → 新「进程」`--session <uuid>` 载入续跑 → 第二轮 prompt 含完整历史、`messages` 正确追加 |
| T3 | 默认不落盘 | 不带 `--session` 跑完，`sessions/` 不存在 |
| T4 | 追加语义与崩溃安全 | 两轮后行序正确（header→message…→turn→message…→turn）；**崩溃只丢在途 step**：step 完成即落盘，模拟崩溃后读回含全部已完成 step |
| T5 | vault/db 守卫 | 会话与当前 vault 不一致 → 非 0 退出且报错文案指明朝向 |
| T6 | 损坏文件 | 首行/header 损坏、中间行损坏、`version: 999` → 非 0 退出、不静默开新会话；**仅末尾半截行容忍跳过** |
| T7 | `--max-steps` 正交 | header 记 50、`--session <uuid> --max-steps 2` → 第二轮 2 步撞顶、`stopReason=exhausted` |
| T8 | REPL 恢复 | `--session <uuid>` 续跑进 REPL：历史在列、上轮 exhausted 时提示符为续跑变体、横幅带会话 id |
| T9 | id 严格校验 | `my-task`（自由文本）/ `../x`（穿越）/ `.hidden` / 空串 → 一律报错拒绝 |
| T10 | 裸 `--session` 新建 | 生成合法 UUID、首行打印含 UUID 与完整路径、文件按 `sessions/chat-<uuid>.jsonl` 落盘 |
| T11 | 不存在会话 | `--session <合法但不存在的 UUID>` → 非 0 退出、报错文案明确「会话不存在」 |
| T12 | session id 全形态可见 | full 收尾 stdout 有；summary/quiet 收尾 **stderr** 有且 stdout 答案不被污染；`--json` 对象含 `sessionId`；模拟中断/出错路径 stderr 仍有 |
| T13 | model 变更提示 | header 记 A 模型、`--model B` 续跑 → 正常续跑且输出含变更提示行 |
| T14 | 非 TTY 无 input 边界 | 管道无输入 + `--session <uuid>` → 报错文案含「会话已定位但未提供输入」，非 0 退出 |
| T15 | 中断轮恢复 | 文件末尾有 message 行无 turn 收尾（模拟崩溃）→ 载入置 `interrupted`；孤儿 assistant tool-call 被截断，历史恒一致；REPL 恢复后可「继续」 |

## 7. 非目标

- **不做默认落盘**：与 pi 相反，理由见 §2；将来要翻默认值另开决策。
- **不做自由文本会话名**：UUID 唯一标识（§1 决策记录②）；将来若要别名，另设映射层而非放宽 id 校验。
- **不做会话列表 / 删除 / retention**：业界标配（Gemini 默认 30d 自动清理、多家有选择器），本期靠 `ls .x-basalt/sessions/` 兜底；疲劳再议（§2.1）。
- **不做「续最近」快捷**：UUID 三处打印已够用（§4.1）。
- **不做会话树 / 分支**（pi 的 `/tree`、`/fork` 不抄）：chat 在手玩验证阶段，线性事件流够用（YAGNI）。
- **不做云端同步 / 分享 / 导出 HTML**：本地文件即全部。
- **不做上下文压缩**：撞模型窗口的远期解法是 compaction 类机制，另开设计。
- **不动 `--trace`**：事件流与消息快照各司其职（§2）。

## 8. 验收口径

1. §6 测试矩阵全绿（`pnpm test` 覆盖 `tests/chat/` 新增用例）。
2. 消费侧文档同批更新（完成定义硬要求）：`docs/use/chat.md` §4 表格与 §7 限制、`docs/use/commands.md` chat 条目、运行时自我说明书 `skills-data/core.json5`。
3. 新文档落盘后经 x-basalt 自举补 frontmatter（dogfood）。
4. 全量 `typecheck` + `lint`（新增模块 + CLI 契约变更，触及公共面）。

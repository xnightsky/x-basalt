---
type: record
title: chat 会话方案演变与可行性记录
description: 从 docs/design/chat-session-continue.md 摘出的历史章节与旧导言，保留当时证据、版本及纠偏；当前契约和未完成义务仍由来源文档维护。
tags:
  - archive
  - history
  - x-basalt
timestamp: 2026-10-02T11:25:55Z
sha256: 7fda9596a3c6e922f982d8cac0ce86d73ac6a9ebacf34a4a95562eb628885c41
---
# chat 会话方案演变与可行性记录

> 归档于 2026-10-02；来源：[docs/design/chat-session-continue.md](../../design/chat-session-continue.md) 的下列原章节。仅保留当时过程、提案或观察，不代表当前实现；有效契约与后续义务以来源文档及根 TODO 为准。

保留来源章节的原读数、旧选择与纠偏经过；章节中的“当前”“待实施”均按原阶段基线阅读，不作为归档后的新授权。

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

## 整理前导言（历史上下文）

# chat 会话落盘与续跑设计：`--session [uuid]` 单一入口

> 日期：2026-09-20 · 类型：可行性结论 + 实现设计提案（**未落码**，按本 spec 开工）
> 状态：**提案（可行性已验证）**
> 关联：[`chat-trace.md`](../../design/chat-trace.md)（事件流落盘，与本文的会话落盘互补不互替）、[`chat-readwrite.md`](../../design/chat-readwrite.md)（chat 总体实现设计）、[`chat-tool-surface.md`](../../design/chat-tool-surface.md)（工具面）、[`../use/chat.md`](../../use/chat.md)（用户侧现状）

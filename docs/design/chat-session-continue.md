---
type: design
title: chat 会话落盘与续跑设计：--session [uuid] 单一入口
description: 已实现的可选 UUID 会话与 JSONL 逐 step 追加、严格恢复守卫及 T1–T15；默认不落盘，无并发锁或断电持久性保证。
tags:
  - design
  - chat
  - session
  - jsonl
timestamp: 2026-10-02T12:14:45Z
sha256: 984f4f31d2514dc6d961db41d5530df71926cf8b6d952d74158afe3da7f4ab29
---
# chat 会话落盘与续跑设计：`--session [uuid]` 单一入口

> 状态：**已实现**。当前契约由 `src/chat/session.ts`、`loop.ts`、`index.ts`、`repl.ts` 与 `tests/chat/session.test.ts` 承载；[执行与验收记录](../archive/plans/2026-09-20-chat-session-continue.md)已归档。
> 关联：[`chat-trace.md`](chat-trace.md)（事件流落盘，与本文的会话落盘互补不互替）、[`chat-readwrite.md`](chat-readwrite.md)（chat 总体实现设计）、[`chat-tool-surface.md`](chat-tool-surface.md)（工具面）、[`../use/chat.md`](../use/chat.md)（用户侧现状）

## 1. 结论

默认不落 session，避免静默复制 Vault 内容；裸 `--session` 新建 UUID，带 UUID 严格续跑，不存在即报错。JSONL 按已完成 step 追加，读回完整工具历史；中断轮经容错/孤儿 tool-call 截断后可恢复。`--trace` 是排障事件，session 是模型消息，二者互补不互替。方案演变、业界对照及 spike 纠偏见[归档](../archive/decisions/2026-09-20-chat-session-record.md#1-结论)，不把早期 spike 当完整工具历史的最终证明。

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

**JSONL 事件流追加（决策记录③）**：消息快照语义不变（续跑读出的仍是完整 `ModelMessage[]`），变的是**写入时机**——不再每轮结束整体覆写，而是逐条追加：每完成一个 step 就把它的 assistant/tool 消息追加落盘。于是崩溃（含网络崩溃、Ctrl+C）只丢**在途 step**，盘上永远留着「半截但可用」的进度；设计依据见[日期调研](../archive/decisions/2026-09-20-chat-session-record.md#21-业界校准2026-09-20-调研)，不承诺系统断电只丢在途 step。

行 schema（三类行，`kind` 区分）：

```jsonl
{"kind":"session","version":1,"id":"3f2a8c1e-…","createdAt":"2026-09-20T10:00:00.000Z","model":"openai/gpt-5","vault":["/abs/vault"],"db":".x-basalt/index.db","maxSteps":50}
{"kind":"message","turn":1,"ts":"…","message":{"role":"user","content":"长任务第一步"}}
{"kind":"message","turn":1,"ts":"…","message":{"role":"assistant","content":[{"type":"tool-call",…}]}}
{"kind":"message","turn":1,"ts":"…","message":{"role":"tool","content":[{"type":"tool-result",…}]}}
{"kind":"turn","turn":1,"ts":"…","stopReason":"done","steps":2}
```

- **追加粒度 = step 完成**（`onStepFinish`）：每步的 assistant(+tool-call) 与 tool(result) 在同一批追加里成对落盘，盘上历史恒停在**完整步边界**——不存在半截 tool-call 悬空挂在文件里的正常形态。
- **每次追加一次 `appendFileSync`**：逐次追加、不维持用户层缓冲；未调用 fsync，不承诺断电持久性；崩溃可能留下**半截尾行**，读侧容错跳过（见下）。
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
| 并发写同一 UUID | 两进程行交错，语义串线 | 未实现锁，同一会话不可并行运行；不保证多进程写入原子性或历史完整，损坏按读侧校验处理 |
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

- **不做默认落盘**：避免默认复制 Vault 内容，理由见 §1；翻默认值需另开决策。
- **不做自由文本会话名**：UUID 唯一标识（§1 决策记录②）；将来若要别名，另设映射层而非放宽 id 校验。
- **不做会话列表 / 删除 / retention**：业界标配（Gemini 默认 30d 自动清理、多家有选择器），本期靠 `ls .x-basalt/sessions/` 兜底；使用负担成为真实需求后再议，日期对照见归档。
- **不做「续最近」快捷**：UUID 三处打印已够用（§4.1）。
- **不做会话树 / 分支**（pi 的 `/tree`、`/fork` 不抄）：chat 在手玩验证阶段，线性事件流够用（YAGNI）。
- **不做云端同步 / 分享 / 导出 HTML**：本地文件即全部。
- **不做上下文压缩**：撞模型窗口的远期解法是 compaction 类机制，另开设计。
- **不动 `--trace`**：排障事件与续跑消息各司其职（§1）。

## 8. 验收口径

1. §6 测试矩阵全绿（`pnpm test` 覆盖 `tests/chat/` 新增用例）。
2. 消费侧文档同批更新（完成定义硬要求）：`docs/use/chat.md` §4 表格与 §7 限制、`docs/use/commands.md` chat 条目、运行时自我说明书 `skills-data/core.json5`。
3. 新文档落盘后经 x-basalt 自举补 frontmatter（dogfood）。
4. 全量 `typecheck` + `lint`（新增模块 + CLI 契约变更，触及公共面）。

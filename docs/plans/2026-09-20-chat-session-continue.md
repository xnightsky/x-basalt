---
type: plan
title: chat 会话落盘与续跑 执行计划
description: 按设计契约 docs/design/chat-session-continue.md 落地 --session 新建/续跑：session 存储层、CLI/入口/REPL 接线、T1-T14 测试矩阵、消费侧文档同步；已收口，Evidence 1188/1188 全绿
tags:
  - plan
  - chat
  - session
  - x-basalt
timestamp: 2026-09-20T12:14:51Z
sha256: d98d2e42d3b26f691f3e90693fc617170b645ffd83ab43f4c099739564a6e613
---
# 计划：chat 会话落盘与续跑（2026-09-20）

> 设计契约（先读）：[`../design/chat-session-continue.md`](../design/chat-session-continue.md)——CLI 契约、落盘格式、守卫、风险、非目标全部以它为准；本文只列执行切口与验收记录。

## 目标

给 `x-basalt chat` 加可选会话落盘与跨进程续跑：默认不落盘；`--session` 裸用新建（系统 UUID 并打印）；`--session <uuid>` 严格续跑（不存在/非法即报错）；任何形态返回必带 session id；`--max-steps` 与续跑正交。

## 切口（按依赖序）

1. `src/chat/session.ts`（新）：会话类型 + UUID 校验 + create/load（JSONL 事件流重建、半截尾行容错、孤儿 tool-call 截断）+ openSessionLog（逐 step 追加写口）+ vault/db 守卫。
2. 接线：`src/cli.ts`（`--session [uuid]`、非 TTY 无 input 文案）→ `src/chat/loop.ts`（`onStep` step 级落盘钩子）→ `src/chat/index.ts`（新建/续跑、全形态 id 返回、`--json.sessionId`、model 变更提示、EXHAUSTED_NOTICE 更新）→ `src/chat/repl.ts`（恢复 messages/canContinue、横幅/退出语带 id、onUserMessage/onStep/onTurnEnd 三回调）。
3. 测试 `tests/chat/session.test.ts`：设计文档 §6 的 T1–T15。
4. 消费侧同步：`docs/use/chat.md`、`docs/use/commands.md`、`skills-data/core.json5`。

## 验收

- `pnpm run typecheck`、`pnpm run build`、`pnpm test`（chat 域全绿；公共契约变更 → 全量 test）、`pnpm run lint`。
- 设计文档 §6 的 T1–T14 逐项有用例且绿。
- 消费侧文档与 `core.json5` 同批更新；改动文档 dogfood 元数据刷新。

## Evidence / Verify

- `pnpm run typecheck`（tsc --noEmit）：通过。
- `pnpm run build`（tsc）：通过。
- `pnpm run lint`（oxlint）：0 警告（初报 2 条 `session.ts` 风格警告——`toSorted`/函数外提，已修）。
- `pnpm run format:check`（oxfmt）：通过（3 个改动文件已格式化）。
- `pnpm test`（node --import tsx --test）：**1189/1189 通过**，含 `tests/chat/session.test.ts` 16 用例覆盖设计 §6 的 T1–T15（T14 为 dist 形态真实 spawn；另加 T5b 守卫接线、T15 中断轮恢复/孤儿 tool-call 截断）。
- 实现期发现并修复存量缺陷：`runLoop` 只拼 final step 的 `response.messages`（ai@7 仅含最后一步）导致多轮/续跑丢工具历史 → 逐 step 拼接；`tests/chat/loop.test.ts` 10 用例回归全绿。已记入设计文档 §3 补记与 CHANGELOG Fixed。
- 落码后口径修正（决策记录③）：存储从单 JSON 快照改为 **JSONL 事件流逐 step 追加**（崩溃只丢在途 step）；新增 `onStep` 钩子与读侧容错（半截尾行跳过、孤儿 tool-call 截断、`interrupted` 恢复可「继续」）。
- 消费侧同批更新：`docs/use/chat.md`、`docs/use/commands.md`、`skills-data/chat.json5`（invoke 条 pattern+description、patterns 行）、`CHANGELOG.md` [Unreleased]。

---
type: plan
title: chat 工具面彻底切 C（cli 单工具 + 动态 base 走 stdin）
description: 按 2026-07-30 拍板架构决策把 chat 的 15 个手写工具收编为单一 cli 工具（execFile 执行 cli.js），动态 base 经 base - 子命令接入，消除第二表面漂移
tags:
  - plan
  - chat
  - cli-tool
  - architecture
timestamp: 2026-08-03T17:11:59Z
sha256: a7da9d37dc754ce8a8141d2770d9e059611e27911af447f5ffb0c0bdce95b8f3
---
# chat 工具面彻底切 C（cli 单工具 + 动态 base 走 stdin）

> **For agentic workers:** 用 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。
> 日期：2026-08-03 · 主题：chat 工具面从「15 个手写工具」收编为「单一 cli 工具」，动态 base 经 `base -` 子命令接入
> 真相源（设计）：[`docs/design/chat-tool-surface.md`](../design/chat-tool-surface.md)（2026-07-30 拍板「彻底切 C」）
> 触发：用户拍板动态 base 第二步走「按切 C 走 cli 工具」（2026-08-03 提问答复）

**Goal:** 执行 2026-07-30 已拍板的「彻底切 C」架构决策：chat 的工具面从手工维护的第二表面（15 个工具，语义靠人肉对齐 CLI、`paths` 静默失效 bug 已实证）收编为**单一 `cli` 工具**——`execFile(node, [cli.js, ...args])`、参数走数组、子命令 allowlist、`--vault/--db` 由工具壳注入、输出过 safety、防递归（allowlist 排除 `chat` + `X_BASALT_CHAT_CHILD` 环境变量兜底）。**动态 base（本仓已完成第一步 stdin 入参）经 `cli base -` 子命令自然接入 chat**——工具壳把结构化入参转成 argv，source 走 stdin。

**为什么现在做（两个独立理由合流）**：
1. **切 C 是已拍板的架构决策**（chat-tool-surface.md §决策）：第二表面必漂移（`paths` bug 实证），「先补契约再切」是计划内步骤排序，不留混合过渡形态。
2. **动态 base 第二步的最小验证路径需要 chat 侧**：TODO「🧪 动态 base」段——stdin 入参（第一步 ✅）→ chat 接入 → evals A/B。切 C 后 `base` 自动成为 chat 能力（`cli base -`），无需手写 `base_query` 工具堆第二表面。

**Architecture:** cli 工具 = 唯一执行口；`tools.ts` 保留装配框架（`buildTools` 签名不变，loop/repl 零改动）；`skills_get`/`skills_recall` 保留为独立工具（grounding 元工具，agent-browser 同款单列）；RECALL_TOOL_NAMES 收编为 `["cli"]`（vault 召回判定改为「cli 工具被调用」）。

**Tech Stack:** Node 22+ / TS ESM(NodeNext) / AI SDK 7.x / node:test。

## Global Constraints（每个 task 隐含遵守）

- 不 `import 'obsidian'`、不调 `obsidian://`；文件操作仅经 `fs`/`chokidar`。
- **模型永远不拼 shell 字符串**：cli 工具入参 `{ args: string[] }` → `execFile(process.execPath, [cliEntry, ...args])`，无 shell、参数走数组（chat-tool-surface.md §0 两条纪律之一）。
- 工具 schema 与 CLI 一处定义：工具壳不做参数语义解释，只透传 argv（切 C 核心）。
- 防递归：allowlist 结构性排除 `chat`；工具壳 spawn 注入 `X_BASALT_CHAT_CHILD=1`，chat 启动检测到即拒（双保险）。
- 中文注释解释「为什么/边界/副作用」；`@behavior` 固化行为契约。

---

## 范围切分

| 部件 | 本计划 | 说明 |
| --- | --- | --- |
| `src/chat/cli-tool.ts` 新建：cli 单工具 | **CC-1** | execFile + allowlist + 注入 + safety + 防递归 + 超时 |
| `tools.ts` 收编：删 15 手写工具、保留装配 | **CC-2** | buildTools 签名不变；RECALL_TOOL_NAMES → ["cli"] |
| SYSTEM_PROMPT / 文档同步（chat.json5、chat-tool-surface 标记已落地、commands.md） | **CC-3** | 契约收口 |
| 动态 base 验证：chat 里 `cli base -` 端到端 | **CC-4** | evals 场景库 A/B（第二步第 3 步行） |
| 测试：cli-tool 单测 + loop 集成 + CLI e2e | **CC-5** | TDD 重测试 |

---

## 文件与职责

```
src/chat/cli-tool.ts    新增：buildCliTool(ctx, safety) —— AI SDK tool（input { args: string[] }）。
                        execFile(process.execPath, [cliEntry, ...args])；allowlist（读/写子命令白名单，
                        排除 watch 常驻与 chat 递归）；--vault/--db 注入；X_BASALT_CHAT_CHILD=1 注入；
                        超时（默认 60s）；stdout/stderr 过 observe(safety, …)。
src/chat/tools.ts       收编：删 15 个手写工具定义（query/parse/read_note/scan/list/search/meta_*/pipeline_run），
                        buildTools 返回 { cli, skills_recall, skills_get }；RECALL_TOOL_NAMES → ["cli"]。
                        paginateScan/clampSize/observe 等辅助保留（若 cli-tool 需要）或随删。
src/chat/index.ts       SYSTEM_PROMPT 改：工具名从 query/search/meta_* 改为 cli 子命令形态；
                        「动手前必做」取 core 不变。
src/cli.ts              chat 启动处检测 X_BASALT_CHAT_CHILD=1 → 拒绝（防递归兜底）。
src/chat/cli-tool.test.ts  新增：allowlist 拒绝 watch/chat；argv 数组透传（含带空格参数）；注入 --vault/--db；
                            超时；输出 safety 包裹；错误分类。
tests/chat/*.test.ts    既有 loop/repl 测试适配（tools 面变化）。
```

---

## 原子子步（TDD）

### CC-1：cli 单工具

- [x] **CC-1a `buildCliTool` 骨架（red→green）** → commit `0d9ba9d`
- [x] **CC-1b allowlist + 防递归（red→green）** → 同上
- [x] **CC-1c 注入 + safety + 超时（red→green）** → 同上

### CC-2：tools.ts 收编

- [x] **CC-2a 删 15 手写工具（red→green）** → commit `0bffea8`（-602 行）
- [x] **CC-2b loop/repl 适配（red→green）** → 同上（loop/repl 零改动，tools.test 重写）

### CC-3：SYSTEM_PROMPT + 文档同步

- [x] **CC-3a SYSTEM_PROMPT 改写** → commit `e980c05`（含 cli.ts 防递归 X_BASALT_CHAT_CHILD 检测）
- [x] **CC-3b chat.json5 / chat-tool-surface.md / commands.md 同步** → 同上

### CC-4：动态 base 端到端验证

- [x] **CC-4a chat 里 cli base - 端到端（red→green）** → commit `9515965`：mock 模型经 cli 工具跑 `base -`（source 走 stdin）完整 loop 链路成功
- [ ] **CC-4b evals 场景库 A/B（后续计划）**：TODO「动态 base」第三步留待 evals 侧（需真实 chat + key），不在本计划

### CC-5：重测试 + 收口

- [x] **CC-5a 全量回归**：typecheck / lint / test **1141** 全绿（切 C 后工具面测试 7+6 新用例）
- [x] **CC-5b commit**：本计划全部落地

---

## 验收

- `pnpm run typecheck` / `pnpm run lint` / `pnpm test` 全绿。
- chat 工具面 = `{ cli, skills_recall, skills_get }` 三个工具；`RECALL_TOOL_NAMES = ["cli"]`。
- `cli` 工具：allowlist 拒绝 `watch`/`chat`；`X_BASALT_CHAT_CHILD=1` 注入；`--vault/--db` 自动补；argv 数组透传（含空格参数不切碎）；输出 safety 包裹；超时 60s。
- chat 端到端（mock）：`cli base -` 经 stdin 传 source 查询成功，结果含 `<stdin>`。
- SYSTEM_PROMPT / chat.json5 / chat-tool-surface.md / commands.md 与实现一致，无残留「15 工具」表述。
- 无残留「后续」注释指向已实现的能力。

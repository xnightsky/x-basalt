---
timestamp: 2026-06-30T00:01:23Z
sha256: 1b2e0c00d2662b57ad295c89adfe6e89c7b0ab5991aeb0e929bcdd14a113fb44
type: plan
title: 变更编排器 P0 实现计划（change orchestration）
description: run/scan/watch 变更编排管道 P0 实现计划
tags:
  - plan
  - orchestrator
  - x-basalt
---
# 变更编排器 P0 实现计划（change orchestration）

> **For agentic workers:** 用 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。
> 日期：2026-06-29 · 主题：把 watch/scan/手动统一为声明式变更管线
> 真相源（设计）：[`../specs/2026-06-29-change-orchestration-design.md`](../specs/2026-06-29-change-orchestration-design.md)
> 触发：用户 goal「基于这份 SPEC 进行开发」。本计划只实现 spec §12 的 **P0** 范围。

**Goal:** 新增 `src/orchestrator/`，把现有 `watch`/`scan`/手动选择统一为「源 → 堆积 → 去重 → 路由 → 执行」一条声明式管线，跑一串强类型内建动作自动维护 vault；写动作默认 dry-run。

**Architecture:** 纯函数核心（去重折叠 / 堆积 / 路由过滤）+ 有状态执行引擎（串行管道 + 有界并发 + 重启语义 + 超时 + 失败 continue + 优雅退出 + 无限循环防护）。编排器只**调度**现有 indexer/meta/query 四层，不绕过其边界。

**Tech Stack:** Node 22+ / TS ESM(NodeNext) / commander / better-sqlite3(同步) / chokidar / yaml / node:test。

## Global Constraints（每个 task 隐含遵守，逐字抄自 spec/AGENTS）

- 纯离线、零 AI；不 `import 'obsidian'`、不调 `obsidian://`、不用浏览器自动化；文件操作仅经 `fs`/`chokidar`。
- `indexer` 是唯一写 SQLite 的层；`meta` 是唯一写 `.md` 的层；隐式字段查询期 JOIN 实时算。编排器不绕过。
- **写动作默认 dry-run**，显式开写；非 TTY 默认拒写。
- **无限循环防护是命门**：写动作改 `.md` 不得触发 watch 回环（自产生集 + debounce 兜底）。
- 中文注释解释「为什么/边界/副作用」；Obsidian 规范来源处用 `// === Obsidian 规范来源 ===`，自建逻辑用 `// === 自建实现 ===`。
- 复杂模块重测试：去重/堆积/执行语义必须覆盖边界、异常、对抗。

---

## 范围切分

| 部件                                                               | 本计划   | 说明                      |
| ------------------------------------------------------------------ | -------- | ------------------------- |
| 类型 + 去重折叠（L2/L3）                                           | **P0-A** | 纯函数，重测试            |
| 堆积（debounce+maxWait）                                           | **P0-B** | 注入时钟，可测            |
| 路由（match/glob + where(dql)）                                    | **P0-C** | 纯过滤 + 复用 query       |
| 动作契约 + 内建动作（index/normalize/parse，写动作 dry-run）       | **P0-D** | 包装现有层                |
| 执行引擎（pipe/limit/onBusy/timeout/onError/报告/优雅退出/防回环） | **P0-E** | 有状态核心                |
| 源适配（scan/手动/watch → 事件流）                                 | **P0-F** | 复用 indexer              |
| 配置 pipelines 段 + CLI 接线 + 端到端                              | **P0-G** | 收口                      |
| P1/P2（背压/缓存/DAG/写动作落盘/检查点…）                          | roadmap  | 见 spec §12，各自再开计划 |

---

## 文件与职责

```
src/orchestrator/types.ts      ChangeEvent / EventType / Action / ActionContext / ActionResult /
                               PipelineConfig / RunReport。纯类型，无运行时依赖。
src/orchestrator/dedup.ts      foldEvents(events): ChangeEvent[]——L2 路径折叠(LWW)+L3 事件类型折叠。纯函数。
src/orchestrator/accumulate.ts Accumulator——debounce(wait)+maxWait 强制 flush；时钟/定时器经构造注入（可测）。
src/orchestrator/route.ts      matchEvent(ev, {on,paths})——事件类型+glob 过滤（纯函数）；
                               selectByDql(engine, dql): Set<path>——语义路由（复用 DataviewEngine）。
src/orchestrator/actions.ts    内建动作注册表：index/normalize/parse；统一 Action 契约；写动作默认 dryRun。
src/orchestrator/run.ts        Executor.run(batch, pipeline): 串行 pipe + limit 有界并发 + timeout +
                               onError(continue/stop) + dryRun + RunReport 汇总。
src/orchestrator/engine.ts     Orchestrator：组装 源→accumulate→dedup→route→run；无限循环防护（自产生集）；
                               优雅退出（停接新批→跑完当前→关 DB/watcher）。
src/orchestrator/index.ts      barrel：对外导出 Orchestrator + 类型。
src/config.ts                  扩展：PipelineConfig 的配置读取（pipelines: 段）。
src/cli.ts                     接线：watch/scan/run 子命令接入 --pipeline；run <pipeline> 手动源。
tests/orchestrator-*.test.ts   各部件单测 + 端到端。
```

---

## 接口契约（供各 task 对齐，类型唯一定义在 types.ts）

```ts
export type EventType = "add" | "change" | "unlink";
export interface ChangeEvent {
  path: string;
  type: EventType;
  mtime?: number;
  size?: number;
}

export interface ActionContext {
  vaultPath: string;
  indexer: VaultIndexer; // 复用现有
  engine?: DataviewEngine; // 路由/查询用，可选
  dryRun: boolean;
}
export interface ActionResult {
  action: string;
  path: string;
  changed: boolean;
  skipped: boolean;
  error?: string;
}
export interface Action {
  name: string;
  write: boolean; // 是否写 .md（决定 dry-run 闸）
  run(ev: ChangeEvent, ctx: ActionContext): Promise<ActionResult>;
}

export interface PipelineConfig {
  on?: EventType[]; // 事件类型过滤；缺省全部
  paths?: string[]; // glob 入口过滤
  where?: string; // DQL 语义路由
  debounce?: { wait: number; maxWait: number };
  concurrency?: number; // 默认 4
  onBusy?: "queue" | "restart" | "ignore"; // 默认 queue
  onError?: "continue" | "stop"; // 默认 continue
  dryRun?: boolean; // 写动作；默认 true
  actions: string[]; // 内建动作名序列
}
export interface RunReport {
  total: number;
  changed: number;
  skipped: number;
  failed: ActionResult[];
  dryRun: boolean;
}
```

---

## 原子子步（TDD）

> 最后同步：2026-07-22。代码已全部实现（含测试），checklist 更新到实际状态。

### P0-A：类型 + 去重折叠

- [x] **CO-A1 types.ts（无测试，被后续消费）** ✅ 2026-06-29
  - 文件：`src/orchestrator/types.ts`（9 个类型/interface 定义）。
  - 证据：`pnpm run typecheck` 通过。前置：无。

- [x] **CO-A2 foldEvents 去重折叠（red→green）** ✅ 2026-06-29
  - 文件：`src/orchestrator/dedup.ts` + `tests/orchestrator-dedup.test.ts`。
  - 验收涵盖 L2/L3 折叠表全部场景。
  - 证据：`pnpm test tests/orchestrator-dedup.test.ts`。前置：CO-A1。

- [x] **CO-A3 commit** ✅

### P0-B：堆积

- [x] **CO-B1 Accumulator（red→green）** ✅ 2026-06-29
  - 文件：`src/orchestrator/accumulate.ts` + `tests/orchestrator-accumulate.test.ts`（注入假时钟）。
  - 证据：`pnpm test tests/orchestrator-accumulate.test.ts`。前置：CO-A1。

- [x] **CO-B2 commit** ✅

### P0-C：路由

- [x] **CO-C1 matchEvent 纯过滤（red→green）** ✅ 2026-06-29
  - 文件：`src/orchestrator/route.ts` + `tests/orchestrator-route.test.ts`。
  - 证据：`pnpm test tests/orchestrator-route.test.ts`。前置：CO-A1。

- [x] **CO-C2 selectByDql 语义路由（red→green）** ✅ 2026-06-29
  - 文件：扩 `route.ts`，复用 DataviewEngine。
  - 证据：`pnpm test tests/orchestrator-route.test.ts`。前置：CO-C1。

- [x] **CO-C3 commit** ✅

### P0-D：动作契约 + 内建动作

- [x] **CO-D1 内建动作（red→green）** ✅ 2026-06-29
  - 文件：`src/orchestrator/actions.ts`（index/normalize/parse）+ `tests/orchestrator-actions.test.ts`。
  - 证据：`pnpm test tests/orchestrator-actions.test.ts`。前置：CO-A1。

- [x] **CO-D2 commit** ✅

### P0-E：执行引擎

- [x] **CO-E1 Executor 串行管道 + 失败 continue + 报告（red→green）** ✅ 2026-06-29
  - 文件：`src/orchestrator/run.ts` + `tests/orchestrator-run.test.ts`。
  - 证据：`pnpm test tests/orchestrator-run.test.ts`。前置：CO-D1。

- [x] **CO-E2 有界并发 limit + 超时 timeout（red→green）** ✅ 2026-06-29
  - 文件：扩 `run.ts` 含并发限制。
  - 证据：`pnpm test tests/orchestrator-run.test.ts`。前置：CO-E1。

- [x] **CO-E3 commit** ✅

### P0-F：源适配 + 引擎组装 + 防回环 + 优雅退出

- [x] **CO-F1 源适配（red→green）** ✅ 2026-06-29
  - 首次提交：`492c84d` 2026-06-29。
  - 证据：`pnpm test tests/orchestrator-sources.test.ts`。前置：CO-A1。

- [x] **CO-F2 Orchestrator 组装 + 无限循环防护 + 优雅退出（red→green）** ✅ 2026-06-29
  - 首次提交：`f2b0e0f` 2026-06-29。
  - 证据：`pnpm test tests/orchestrator-engine.test.ts`。前置：CO-E*、CO-F1。

- [x] **CO-F3 commit** ✅

### P0-G：配置 + CLI + 端到端 + 收口

- [x] **CO-G1 配置 pipelines 段（red→green）** ✅ 2026-06-29
  - 首次提交：`3ad68cb` 2026-06-29。
  - 证据：`pnpm test tests/orchestrator-config.test.ts`。前置：CO-A1。

- [x] **CO-G2 CLI 接线 + 端到端（red→green）** ✅ 2026-06-29
  - 首次提交：`3ad68cb` 2026-06-29（--pipeline），`738c6e6` 2026-06-29（scan 对称补齐）。
  - 证据：`pnpm test tests/orchestrator-cli.test.ts`。前置：CO-F2、CO-G1。

- [x] **CO-G3 收口：质量门 + 文档 + skill** ✅ 2026-06-29
  - 首次提交：`1871dd4` 2026-06-29（doc/skill 同步 + TODO 标 P0 完成）。

---

## 风险与剩余不确定

- **glob 依赖**：route 的 paths glob 若不引第三方（如 picomatch），需自实现简易 glob；先用最小实现，复杂模式留 P1。
- **并发与 SQLite 同步**：better-sqlite3 写是同步阻塞，`limit` 对写动作意义有限（天然串行），主要约束读盘/解析并发；测试用可注入的异步动作验证并发上界。
- **watch 防回环**：自产生集 + mtime 比对是启发式；编辑器原子保存（unlink+add）已由 chokidar atomic 兜底，但跨平台需 dogfood 验证。
- **重启语义 onBusy**：P0 先实现 queue（默认，最安全）；restart/ignore 可 P0 内补或留 P1。
- **写动作落盘**：P0 写动作默认 dry-run，真正落盘的确认闸（`--apply`）留 P1（spec §12）。

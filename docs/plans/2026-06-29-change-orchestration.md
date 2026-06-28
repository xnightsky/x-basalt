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

| 部件 | 本计划 | 说明 |
|---|---|---|
| 类型 + 去重折叠（L2/L3） | **P0-A** | 纯函数，重测试 |
| 堆积（debounce+maxWait） | **P0-B** | 注入时钟，可测 |
| 路由（match/glob + where(dql)） | **P0-C** | 纯过滤 + 复用 query |
| 动作契约 + 内建动作（index/normalize/parse，写动作 dry-run） | **P0-D** | 包装现有层 |
| 执行引擎（pipe/limit/onBusy/timeout/onError/报告/优雅退出/防回环） | **P0-E** | 有状态核心 |
| 源适配（scan/手动/watch → 事件流） | **P0-F** | 复用 indexer |
| 配置 pipelines 段 + CLI 接线 + 端到端 | **P0-G** | 收口 |
| P1/P2（背压/缓存/DAG/写动作落盘/检查点…） | roadmap | 见 spec §12，各自再开计划 |

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
export interface ChangeEvent { path: string; type: EventType; mtime?: number; size?: number; }

export interface ActionContext {
  vaultPath: string;
  indexer: VaultIndexer;          // 复用现有
  engine?: DataviewEngine;        // 路由/查询用，可选
  dryRun: boolean;
}
export interface ActionResult { action: string; path: string; changed: boolean; skipped: boolean; error?: string; }
export interface Action {
  name: string;
  write: boolean;                 // 是否写 .md（决定 dry-run 闸）
  run(ev: ChangeEvent, ctx: ActionContext): Promise<ActionResult>;
}

export interface PipelineConfig {
  on?: EventType[];               // 事件类型过滤；缺省全部
  paths?: string[];               // glob 入口过滤
  where?: string;                 // DQL 语义路由
  debounce?: { wait: number; maxWait: number };
  concurrency?: number;           // 默认 4
  onBusy?: "queue" | "restart" | "ignore";   // 默认 queue
  onError?: "continue" | "stop";  // 默认 continue
  dryRun?: boolean;               // 写动作；默认 true
  actions: string[];              // 内建动作名序列
}
export interface RunReport { total: number; changed: number; skipped: number; failed: ActionResult[]; dryRun: boolean; }
```

---

## 原子子步（TDD）

### P0-A：类型 + 去重折叠

- [ ] **CO-A1 types.ts（无测试，被后续消费）**
  - 动作：写 `src/orchestrator/types.ts`，定义上方契约全部类型。
  - 验收：`pnpm run typecheck` 通过。前置：无。

- [ ] **CO-A2 foldEvents 去重折叠（red→green）**
  - 动作：`tests/orchestrator-dedup.test.ts` 先写期望；再实现 `dedup.ts`。
  - 验收（L2+L3 折叠表，spec §6.3）：`add→change(×N)`=add；`change(×N)`=change；`add→unlink`=**抵消(丢弃)**；`change→unlink`=unlink；`unlink→add`=change；多文件互不干扰；按最新 mtime 取 LWW；空输入=空；幂等（再折叠不变）。
  - 证据：`pnpm test tests/orchestrator-dedup.test.ts`。前置：CO-A1。

- [ ] **CO-A3 commit**：`feat(orchestrator): 事件去重折叠（L2 路径+L3 类型）`。

### P0-B：堆积

- [ ] **CO-B1 Accumulator（red→green）**
  - 动作：`tests/orchestrator-accumulate.test.ts`（注入假时钟/手动 tick）；实现 `accumulate.ts`：push(ev) 累积，静默 `wait` 后 flush；自首事件起超 `maxWait` 强制 flush；flush 产出一批并清空。
  - 验收：连续 push 在 wait 内不 flush；静默 wait 后 flush 一次；持续 push 到 maxWait 强制 flush（防饿死）；flush 回调拿到累积批；flush 后状态清空；有界源（scan/手动）可旁路直接整批。
  - 证据：`pnpm test tests/orchestrator-accumulate.test.ts`。前置：CO-A1。

- [ ] **CO-B2 commit**：`feat(orchestrator): 堆积 debounce+maxWait`。

### P0-C：路由

- [ ] **CO-C1 matchEvent 纯过滤（red→green）**
  - 动作：`tests/orchestrator-route.test.ts`；实现 `route.ts` 的 `matchEvent(ev,{on,paths})`：事件类型命中 + glob 命中（用 minimatch 风格；若不引依赖则用现有 path 工具/正则实现简易 glob）。
  - 验收：on 缺省=全放行；on 指定只放行对应类型；paths glob 命中/不命中；隐藏路径已被源滤除（不在此重复）。
  - 证据：`pnpm test tests/orchestrator-route.test.ts`。前置：CO-A1。

- [ ] **CO-C2 selectByDql 语义路由（red→green）**
  - 动作：扩 `route.ts`：`selectByDql(engine, dql): Set<string>`——执行 DQL 取命中文件相对路径集；管道用它对去重批做 where 过滤。
  - 验收：给定库内 DQL，返回命中 path 集；语法错抛 DqlSyntaxError（不静默空选）；与 matchEvent 组合后只剩「类型∩glob∩dql」的事件。**索引新鲜度纪律**：注释标明 where 依赖索引，watch 流须先 index 再 where（在 P0-E/engine 落实）。
  - 证据：`pnpm test tests/orchestrator-route.test.ts`。前置：CO-C1。

- [ ] **CO-C3 commit**：`feat(orchestrator): 路由 match/glob + DQL 选择`。

### P0-D：动作契约 + 内建动作

- [ ] **CO-D1 内建动作（red→green）**
  - 动作：`tests/orchestrator-actions.test.ts`（临时 vault）；实现 `actions.ts`：
    - `index`：调 `indexer.update(path)`（unlink → `indexer.remove`）；write=false（写 DB 非 .md）。
    - `normalize`：调 `editMeta(path, normalizeDoc, {dryRun})`；write=true。
    - `parse`：只读解析（验证可解析）；write=false。
    - 注册表 `getAction(name)`，未知名报错列可用。
  - 验收：index 后查询能查到该文件；normalize dryRun 不落盘、非 dryRun 落盘且幂等；写动作 ctx.dryRun=true 时不写；unlink 事件 index 删除记录；未知动作报错。
  - 证据：`pnpm test tests/orchestrator-actions.test.ts`。前置：CO-A1。

- [ ] **CO-D2 commit**：`feat(orchestrator): 内建动作 index/normalize/parse（写动作 dry-run）`。

### P0-E：执行引擎

- [ ] **CO-E1 Executor 串行管道 + 失败 continue + 报告（red→green）**
  - 动作：`tests/orchestrator-run.test.ts`；实现 `run.ts`：对一批事件，每个事件按 `actions` 顺序串行跑（pipe），单动作失败按 onError 决定 continue/stop，汇总 RunReport。
  - 验收：批内每文件按动作序执行；某文件某动作抛错 → onError=continue 跳过该文件剩余动作并记 failed、其余文件照常；onError=stop 停止；报告 total/changed/skipped/failed 正确；dryRun 透传动作。
  - 证据：`pnpm test tests/orchestrator-run.test.ts`。前置：CO-D1。

- [ ] **CO-E2 有界并发 limit + 超时 timeout（red→green）**
  - 动作：扩 `run.ts`：`limit(N)` 控制同时在跑的文件数（自实现信号量，不引 p-limit 若要零依赖；或评估引入）；`timeout(ms)` 用 `Promise.race`+`AbortController` 兜底单动作卡死。
  - 验收：并发不超过 N（用可观察的并发计数断言峰值≤N）；超时动作被中止并记 failed，不拖垮整批。
  - 证据：`pnpm test tests/orchestrator-run.test.ts`。前置：CO-E1。

- [ ] **CO-E3 commit**：`feat(orchestrator): 执行引擎 串行管道+并发+超时+失败策略`。

### P0-F：源适配 + 引擎组装 + 防回环 + 优雅退出

- [ ] **CO-F1 源适配（red→green）**
  - 动作：`tests/orchestrator-sources.test.ts`；实现 `sources.ts`：
    - `scanSource(indexer)`：`computeDiff` 投影成 `ChangeEvent[]`（added→add / modified→change / deleted→unlink），有界整批。
    - `manualSource(paths|dql)`：文件列表 / DQL 命中 → `type=change` 事件批。
    - `watchSource(indexer)`：包 `indexer.watch` 的 add/change/unlink 回调成事件流回调（接 accumulate）。
  - 验收：scanSource 三类事件映射正确；manualSource 由 DQL/列表得批；watchSource 回调投影类型正确。
  - 证据：`pnpm test tests/orchestrator-sources.test.ts`。前置：CO-A1。

- [ ] **CO-F2 Orchestrator 组装 + 无限循环防护 + 优雅退出（red→green）**
  - 动作：`tests/orchestrator-engine.test.ts`；实现 `engine.ts`：
    - 组装：源 → (watch 经 accumulate) → dedup → route(match→[index 先行]→where) → run。
    - **防回环**：写动作落盘后把 `path+mtime` 记入「自产生集」；watch 事件命中自产生集则跳过（叠加 meta「无变化不落盘」天然收敛 + debounce 兜底）。
    - **优雅退出**：stop() 停止接新批 → await 当前批跑完 → 关 watcher/DB。
    - **索引新鲜度**：watch/手动流在 where 之前先跑 index 动作落库，使 where 看到新鲜索引（spec §6.4）。
  - 验收：scan 源端到端跑 index 管道后库内一致；写动作产生的变更不二次触发（自产生集生效）；stop() 后无新批执行、当前批完成；where 在 index 之后路由（断言新鲜）。
  - 证据：`pnpm test tests/orchestrator-engine.test.ts`。前置：CO-E*、CO-F1。

- [ ] **CO-F3 commit**：`feat(orchestrator): 源适配+引擎组装+防回环+优雅退出`。

### P0-G：配置 + CLI + 端到端 + 收口

- [ ] **CO-G1 配置 pipelines 段（red→green）**
  - 动作：扩 `src/config.ts` + `tests/config.test.ts`：读 `.x-basalt/config` 的 `pipelines:` 段为 `Record<string, PipelineConfig>`；缺省值（concurrency=4/onBusy=queue/onError=continue/dryRun=true）。
  - 验收：解析含 pipelines 的配置；缺省填充；非法配置报错。
  - 证据：`pnpm test tests/config.test.ts`。前置：CO-A1。

- [ ] **CO-G2 CLI 接线 + 端到端（red→green）**
  - 动作：`cli.ts`：`scan --pipeline <name>` / `run <pipeline> [--where dql]`（手动源）/ `watch --pipeline <name>`；扩 `tests/cli.test.ts`（subprocess）。
  - 验收：`run <pipeline>` 端到端对选中文件跑只读管道并出报告；写动作默认 dry-run（非 TTY 拒写）；未知 pipeline/动作报错退出码；`--pipeline` 与现有 scan/watch 兼容。
  - 证据：`pnpm test tests/cli.test.ts`。前置：CO-F2、CO-G1。

- [ ] **CO-G3 收口：质量门 + 文档 + skill**
  - 动作：`typecheck`/`lint`/`build`/相关测试全绿；更新 `docs/guides/commands.md`+`usage.md` 加编排器命令；自我说明书 `skill-data/x-basalt.json5` 同步；TODO 标 P0 完成。
  - 验收：全绿；命令签名在代码/文档/skill 一致。
  - 证据：`pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`。前置：CO-G2。

---

## 风险与剩余不确定

- **glob 依赖**：route 的 paths glob 若不引第三方（如 picomatch），需自实现简易 glob；先用最小实现，复杂模式留 P1。
- **并发与 SQLite 同步**：better-sqlite3 写是同步阻塞，`limit` 对写动作意义有限（天然串行），主要约束读盘/解析并发；测试用可注入的异步动作验证并发上界。
- **watch 防回环**：自产生集 + mtime 比对是启发式；编辑器原子保存（unlink+add）已由 chokidar atomic 兜底，但跨平台需 dogfood 验证。
- **重启语义 onBusy**：P0 先实现 queue（默认，最安全）；restart/ignore 可 P0 内补或留 P1。
- **写动作落盘**：P0 写动作默认 dry-run，真正落盘的确认闸（`--apply`）留 P1（spec §12）。

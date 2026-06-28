// === 自建实现: 变更编排器 barrel（对外统一出口）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md ；计划：docs/plans/2026-06-29-change-orchestration.md。
// 上游：cli.ts 的 watch/scan/run 命令；下游：engine 组装的五段管线。

export { Accumulator, type AccumulatorOptions } from "./accumulate.js";
export { getAction, listActions } from "./actions.js";
export { foldEvents } from "./dedup.js";
export { isSelfWrite, Orchestrator, type OrchestratorOptions } from "./engine.js";
export { matchEvent, type RouteFilter, selectByDql } from "./route.js";
export { type RunOptions, runPipeline } from "./run.js";
export {
  manualSourceFromDql,
  manualSourceFromPaths,
  scanSource,
  watchSource,
} from "./sources.js";
export type * from "./types.js";

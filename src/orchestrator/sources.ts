import { relative } from "node:path";
import type { VaultIndexer } from "../indexer/index.js";
import { startWatch } from "../indexer/watcher.js";
import type { DataviewEngine } from "../query/index.js";
import { toPosix } from "../utils/path.js";
import { selectByDql } from "./route.js";
import type { ChangeEvent } from "./types.js";

// === 自建实现: 源适配（watch/scan/手动 → 统一 ChangeEvent）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §6.1、§14.1 源算子。
// 三种源只是「事件来源」不同：scan=拉（FS↔DB diff）、手动=点（DQL/列表）、watch=推（chokidar 流）；
// 产出统一 ChangeEvent 后，堆积/去重/路由/执行四段完全复用。源不落库——落库交给管道的 index 动作。

/**
 * scan 源：diff 文件系统 vs 索引（dryRun，不写库），投影成事件批。
 * added→add / modified→change / deleted→unlink。有界整批（可旁路堆积直接下传）。
 */
export async function scanSource(indexer: VaultIndexer): Promise<ChangeEvent[]> {
  const report = await indexer.scan({ dryRun: true });
  return [
    ...report.added.map((path): ChangeEvent => ({ path, type: "add" })),
    ...report.modified.map((path): ChangeEvent => ({ path, type: "change" })),
    ...report.deleted.map((path): ChangeEvent => ({ path, type: "unlink" })),
  ];
}

/** 手动源（文件列表）：相对路径列表 → change 事件批。 */
export function manualSourceFromPaths(paths: string[]): ChangeEvent[] {
  return paths.map((path): ChangeEvent => ({ path, type: "change" }));
}

/** 手动源（DQL）：执行 DQL 取命中文件 → change 事件批（= 原 migrate 的"语义选一批"）。 */
export function manualSourceFromDql(engine: DataviewEngine, dql: string): ChangeEvent[] {
  return [...selectByDql(engine, dql)].map((path): ChangeEvent => ({ path, type: "change" }));
}

/**
 * watch 源：底层 chokidar 事件流（不经 indexer.update——落库由管道 index 动作做，避免双重索引）。
 * 把绝对路径投影为相对 POSIX 路径事件，推给 onEvent（通常接堆积器）。
 *
 * @returns 停止监听的函数（供优雅退出调用）
 */
export function watchSource(
  vaultPath: string,
  onEvent: (ev: ChangeEvent) => void,
  onReady?: () => void,
): () => void {
  const toRel = (abs: string): string => toPosix(relative(vaultPath, abs));
  return startWatch(vaultPath, {
    onAdd: (p) => onEvent({ path: toRel(p), type: "add" }),
    onChange: (p) => onEvent({ path: toRel(p), type: "change" }),
    onUnlink: (p) => onEvent({ path: toRel(p), type: "unlink" }),
    onError: () => {}, // 监听错误由引擎层处理；源层不崩（沿用 indexer.watch 的降级策略）
    onReady,
  });
}

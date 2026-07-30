import type { VaultIndexer } from "../indexer/index.js";
import { startWatch } from "../indexer/watcher.js";
import type { DataviewEngine } from "../query/index.js";
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

/**
 * 原生管道（stdin）源的行解析（spec §8.3）：文本 → vault 相对路径列表。
 *
 * 边界：按行 trim、跳空行与 `#` 注释行；**不按空格切**（文件名可含空格）；
 * **不猜 JSON**——结构化输入先用 `jq` 抽路径，保持单一职责（例见 guides/commands.md）。
 * 路径合法性不在此校验：不存在的路径由动作层如实上报 failed，源层不预判。
 *
 * @param text - stdin 读到 EOF 的全部文本
 * @returns 去空行与注释后的相对路径列表（可能为空）
 */
export function parsePathList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * 读一个流到 EOF 再解析成路径列表。
 *
 * 为什么读完再解析：`--stdin` 的语义是「一批」——上游（如 `query --json | jq`）产出完整列表后
 * 才作为一次手动源跑管道；边读边跑会让去重/堆积拿到残缺批。流经参数注入（不直接摸
 * `process.stdin`）以便测试用 `Readable.from` 灌分片。
 *
 * @param stream - 字符串或 Buffer 分片流（CLI 传 `process.stdin`）
 */
export async function readPathList(stream: AsyncIterable<string | Buffer>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return parsePathList(chunks.join(""));
}

/**
 * `--stdin` 前置闸：stdin 是交互终端（无管道输入）时立刻报错。
 *
 * 为什么必须报错：终端上 stdin 永不 EOF，静默等待会表现为「命令挂住」——最难排查的一类体验。
 *
 * @param isTTY - `process.stdin.isTTY`（管道输入时为 undefined）
 * @throws 当 stdin 是交互终端时抛出带示例的错误
 */
export function assertPipedStdin(isTTY: boolean | undefined): void {
  if (isTTY) {
    throw new Error(
      '--stdin 需要管道输入（例：x-basalt query "LIST FROM #pkm" --json | jq -r \'.rows[]["file.path"]\' | x-basalt run --stdin --pipe actions=normalize）；当前 stdin 是交互终端',
    );
  }
}

/** 手动源（DQL）：执行 DQL 取命中文件 → change 事件批（= 原 migrate 的"语义选一批"）。 */
export function manualSourceFromDql(engine: DataviewEngine, dql: string): ChangeEvent[] {
  return [...selectByDql(engine, dql)].map((path): ChangeEvent => ({ path, type: "change" }));
}

/**
 * watch 源：底层 chokidar 事件流（不经 indexer.update——落库由管道 index 动作做，避免双重索引）。
 * 把绝对路径投影为相对 POSIX 路径事件，推给 onEvent（通常接堆积器）。
 *
 * @param roots - 实际监听的 vault 根集合（单个或多个）
 * @param toKey - 绝对路径 → 索引主键（与 indexer 同一 VaultLayout，多根=根名命名空间，无公共祖先 base）
 * @returns 停止监听的函数（供优雅退出调用）
 */
export function watchSource(
  roots: string | string[],
  toKey: (abs: string) => string,
  onEvent: (ev: ChangeEvent) => void,
  onReady?: () => void,
): () => void {
  const toRel = (abs: string): string => toKey(abs);
  return startWatch(roots, {
    onAdd: (p) => onEvent({ path: toRel(p), type: "add" }),
    onChange: (p) => onEvent({ path: toRel(p), type: "change" }),
    onUnlink: (p) => onEvent({ path: toRel(p), type: "unlink" }),
    onError: () => {}, // 监听错误由引擎层处理；源层不崩（沿用 indexer.watch 的降级策略）
    onReady,
  });
}

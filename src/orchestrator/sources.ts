import { isAbsolute, resolve, sep } from "node:path";
import type { VaultIndexer } from "../indexer/index.js";
import { startWatch } from "../indexer/watcher.js";
import type { DataviewEngine } from "../query/index.js";
import { selectByDql } from "./route.js";
import type { ChangeEvent } from "./types.js";

// === 自建实现: 源适配（watch/scan/手动 → 统一 ChangeEvent）===
//
// 设计：docs/design/change-orchestration.md §6.1、§14.1 源算子。
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
 * 存在性不在此校验：不存在的路径由动作层如实上报 failed，源层不预判；
 * vault 边界（`..` 越界 / 根外绝对路径）另由 {@link assertPathsInVault} 在接线处声明期拦截。
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
 * stdin 文件列表源的 vault 边界校验（安全闸）：任一路径 resolve 后逃出全部根即声明期报错。
 *
 * 为什么必须在校验：下游 `layout.toAbs` 对 `..` 会归一化逃根、对绝对路径透传，
 * `--apply` 下写动作（set/normalize/apply/rename）可借此改写 vault 外文件（C1）。
 * 单根逐根校验、多根落在任一根内即合法（与多根 toAbs 的「根名命名空间」两种解读都留在根内一致）。
 *
 * 边界：本函数只挡「逃出根」——`../x.md`（归一化越界）、根外绝对路径；
 * **不存在的相对路径不算非法**，仍由动作层如实上报 failed（spec §8.3 口径不变）。
 * 纯路径演算，不碰 fs（存在性不在此预判）。
 *
 * @param paths - parsePathList 产出的路径列表
 * @param roots - vault 根集合（已 resolve 的绝对路径，取自 VaultLayout.roots）
 * @throws 存在越界路径时抛出，错误信息列出全部非法行与可用根
 */
export function assertPathsInVault(paths: string[], roots: string[]): void {
  const bad = paths.filter((p) => {
    if (isAbsolute(p)) {
      // 绝对路径：必须落在某根内（根外绝对路径是越界的主要形态之一）。
      return !roots.some((root) => p === root || p.startsWith(root + sep));
    }
    // 相对路径：按根 resolve 归一化 `..` 后仍须留在根内。
    return !roots.some((root) => {
      const abs = resolve(root, p);
      return abs === root || abs.startsWith(root + sep);
    });
  });
  if (bad.length > 0) {
    throw new Error(
      `--stdin 路径越出 vault 根（非法行）：\n  ${bad.join("\n  ")}\nvault 根：${roots.join(", ")}`,
    );
  }
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

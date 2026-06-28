import { VaultIndexer } from "../indexer/index.js";
import { DataviewEngine } from "../query/index.js";
import { Accumulator } from "./accumulate.js";
import { getAction } from "./actions.js";
import { foldEvents } from "./dedup.js";
import { matchEvent, selectByDql } from "./route.js";
import { manualSourceFromDql, manualSourceFromPaths, scanSource, watchSource } from "./sources.js";
import type { ActionContext, ChangeEvent, PipelineConfig, RunReport } from "./types.js";
import { runPipeline } from "./run.js";

// === 自建实现: 编排引擎（组装五段 + 防回环 + 优雅退出）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §4/§6/§9。
// 组装：源 → (watch 经堆积) → 去重(foldEvents) → 路由(matchEvent + [index 先行 → where]) → 执行(runPipeline)。
// 三种源（scan/手动/watch）复用同一 runBatch 核心；watch 额外有堆积、防回环、优雅退出。

/** watch 写动作落盘后到 chokidar 捕获之间的忽略窗（ms）：宽于 awaitWriteFinish，足够覆盖一次回环。 */
const SELF_WRITE_WINDOW = 2000;

/** 事件是否为"刚由写动作自产生的变更"（在忽略窗内）——防 normalize/apply 改 .md 触发 watch 回环（§9 坑①）。 */
export function isSelfWrite(
  selfWritten: Map<string, number>,
  ev: ChangeEvent,
  now: number,
  windowMs: number,
): boolean {
  const t = selfWritten.get(ev.path);
  return t !== undefined && now - t < windowMs;
}

export interface OrchestratorOptions {
  vaultPath: string;
  dbPath: string;
}

export class Orchestrator {
  private readonly vaultPath: string;
  private readonly dbPath: string;
  private readonly indexer: VaultIndexer;
  /** 自产生写记录：path → 落盘时刻（ms）。watch 据此跳过回环事件。 */
  private readonly selfWritten = new Map<string, number>();
  private stopWatch: (() => void) | null = null;
  private accumulator: Accumulator | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** 当前批执行链：新批 .then 串到链尾（onBusy=queue 雏形）；stop 时 await 它实现优雅退出。 */
  private running: Promise<void> = Promise.resolve();
  private stopped = false;
  private closed = false;

  constructor(opts: OrchestratorOptions) {
    this.vaultPath = opts.vaultPath;
    this.dbPath = opts.dbPath;
    this.indexer = new VaultIndexer({ vaultPath: opts.vaultPath, dbPath: opts.dbPath });
  }

  /**
   * 核心管线：去重 → 入口过滤 → [where 前先 index 保新鲜] → 执行动作链。
   *
   * @behavior
   * Given 同文件多事件 When runBatch Then foldEvents 去重后只处理一次
   *
   * @behavior
   * Given pipeline.where When runBatch Then 先对候选 index 落库再 selectByDql 过滤（索引新鲜度，§6.4）
   */
  async runBatch(events: ChangeEvent[], pipeline: PipelineConfig): Promise<RunReport> {
    const deduped = foldEvents(events);
    let routed = deduped.filter((e) => matchEvent(e, { on: pipeline.on, paths: pipeline.paths }));

    // 索引新鲜度（§6.4）：where 读的是索引，先把候选落库再查询，避免按陈旧索引选错/漏选。
    if (pipeline.where && routed.length > 0) {
      for (const e of routed) {
        if (e.type === "unlink") this.indexer.remove(e.path);
        else await this.indexer.update(e.path);
      }
      const engine = new DataviewEngine(this.dbPath);
      try {
        const hit = selectByDql(engine, pipeline.where);
        routed = routed.filter((e) => hit.has(e.path));
      } finally {
        engine.close();
      }
    }

    const actions = pipeline.actions.map(getAction);
    const ctx: ActionContext = {
      vaultPath: this.vaultPath,
      indexer: this.indexer,
      dryRun: pipeline.dryRun ?? true, // 写动作默认 dry-run（spec §6.6）
      onWrite: (p) => this.selfWritten.set(p, Date.now()),
    };
    return runPipeline(routed, actions, ctx, {
      concurrency: pipeline.concurrency,
      onError: pipeline.onError,
    });
  }

  /** 一次性：scan 源（FS↔DB diff）跑一条管道。 */
  async runScan(pipeline: PipelineConfig): Promise<RunReport> {
    return this.runBatch(await scanSource(this.indexer), pipeline);
  }

  /** 一次性：手动源（DQL 选 或 文件列表）跑一条管道——原 migrate 的"语义选一批改造"。 */
  async runManual(
    pipeline: PipelineConfig,
    sel: { paths?: string[]; dql?: string },
  ): Promise<RunReport> {
    let events: ChangeEvent[];
    if (sel.dql !== undefined) {
      const engine = new DataviewEngine(this.dbPath);
      try {
        events = manualSourceFromDql(engine, sel.dql);
      } finally {
        engine.close();
      }
    } else {
      events = manualSourceFromPaths(sel.paths ?? []);
    }
    return this.runBatch(events, pipeline);
  }

  /**
   * 常驻：watch 源 + 堆积 + 防回环。定时检查堆积器，到点 flush 一批跑管道。
   * 批之间用 running 链串行（不重叠执行 = onBusy queue 雏形）。
   */
  watch(pipeline: PipelineConfig, onReport?: (r: RunReport) => void, onReady?: () => void): void {
    const wait = pipeline.debounce?.wait ?? 300;
    const maxWait = pipeline.debounce?.maxWait ?? 3000;
    this.accumulator = new Accumulator({ wait, maxWait });
    this.stopWatch = watchSource(
      this.vaultPath,
      (ev) => {
        // 防回环：跳过刚由写动作自产生的变更（消费后清除该记录）。
        if (isSelfWrite(this.selfWritten, ev, Date.now(), SELF_WRITE_WINDOW)) {
          this.selfWritten.delete(ev.path);
          return;
        }
        this.accumulator?.push(ev, Date.now());
      },
      onReady,
    );
    this.flushTimer = setInterval(
      () => {
        if (this.stopped) return;
        const acc = this.accumulator;
        if (acc && acc.shouldFlush(Date.now())) {
          const batch = acc.flush();
          this.running = this.running
            .then(async () => {
              const r = await this.runBatch(batch, pipeline);
              onReport?.(r);
            })
            .catch((e: unknown) => console.warn(`⚠ 管道执行失败：${(e as Error).message}`));
        }
      },
      Math.min(wait, 100),
    );
  }

  /** 优雅退出：停止接新事件 → 等当前批跑完 → 关监听与 DB。 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.stopWatch?.();
    this.stopWatch = null;
    await this.running; // 等当前批执行完（优雅退出，不留半写）
    this.close();
  }

  /** 关闭索引连接（幂等）。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.indexer.close();
  }
}

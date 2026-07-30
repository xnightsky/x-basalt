import { VaultIndexer } from "../indexer/index.js";
import { DataviewEngine } from "../query/index.js";
import { Accumulator } from "./accumulate.js";
import { registerBuiltinOps } from "./ops.js";
import { resolve } from "./registry.js";
import { foldEvents } from "./dedup.js";
import { matchEvent, selectByDql } from "./route.js";
import {
  assertPathsInVault,
  manualSourceFromDql,
  manualSourceFromPaths,
  scanSource,
  watchSource,
} from "./sources.js";
import type { ChangeEvent, OpContext, PipelineConfig, Row, RunReport } from "./types.js";
import { runOpPipeline } from "./run.js";
import { resolveVaultLayout, type VaultLayout } from "../utils/path.js";

// === 自建实现: 编排引擎（组装五段 + 防回环 + 优雅退出）===
//
// 设计：docs/design/change-orchestration.md §4/§6/§9。
// 组装：源 → (watch 经堆积) → 去重(foldEvents) → 路由(matchEvent + [index 先行 → where]) → 执行(runOpPipeline)。
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
  vaultPath: string | string[];
  dbPath: string;
}

export class Orchestrator {
  /** vault 物理布局：监听的根集合 + 主键↔绝对路径互转（按根命名空间，无公共祖先 base）。 */
  private readonly layout: VaultLayout;
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
    // 与 indexer 同源布局：watch 用 layout.roots，动作经 ctx.indexer.toAbsolute 还原绝对路径，键方案一致。
    this.layout = resolveVaultLayout(opts.vaultPath);
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

    // 统一创建 DataviewEngine：供 where 过滤与 ctx.engine 共享（片二 query/search 算子依赖 ctx.engine）。
    // D11：算子依赖的 ctx 资源不能按「有行才准备」条件供给——源算子是 0→N，空批下也必须能获取引擎。
    let engine: DataviewEngine | undefined;
    try {
      engine = new DataviewEngine(this.dbPath);

      // 索引新鲜度（§6.4）：where 读的是索引，先把候选落库再查询，避免按陈旧索引选错/漏选。
      if (pipeline.where && engine && routed.length > 0) {
        const indexed: ChangeEvent[] = [];
        for (const e of routed) {
          if (e.type === "unlink") {
            this.indexer.removeByKey(e.path);
            indexed.push(e);
            continue;
          }
          try {
            await this.indexer.update(e.path);
            indexed.push(e);
          } catch (err) {
            // I1：单文件失败（如 stdin 源的不存在路径 ENOENT）降级——warn 指出路径 + 从 routed 剔除，
            // 不让一条事件拖垮整批（同 indexer 批内「单文件失败降级跳过」策略；
            // 不带 where 时不存在路径仍由动作层如实上报 failed，§8.3 口径不变）。
            console.warn(`⚠ 预索引失败，剔除 ${e.path}：${(err as Error).message}`);
          }
        }
        routed = indexed;
        const hit = selectByDql(engine, pipeline.where);
        routed = routed.filter((e) => hit.has(e.path));
      }

      // 注册内建算子（幂等：重复调仅覆盖同名注册，不会出错）
      registerBuiltinOps();
      // 解析 action tokens 为 Op 实例；steps（声明式步骤列表，D12）存在时优先于逗号分隔面的 actions
      const ops = (pipeline.steps ?? pipeline.actions ?? []).map((token) => resolve(token));
      // 投影 ChangeEvent[] → Row[]
      const rows: Row[] = routed.map((e) => ({
        path: e.path,
        event: e.type,
        fields: {},
      }));
      const ctx: OpContext = {
        indexer: this.indexer,
        engine, // 片二 query/search 算子依赖此字段
        dryRun: pipeline.dryRun ?? true, // 写动作默认 dry-run（spec §6.6）
        ifExists: pipeline.ifExists ?? "skip",
        onWrite: (p) => this.selfWritten.set(p, Date.now()),
        vaultRoots: this.layout.roots,
        dbPath: this.dbPath,
      };
      const report = await runOpPipeline(rows, ops, ctx, {
        concurrency: pipeline.concurrency,
        onError: pipeline.onError,
      });

      // 索引新鲜度·写后（§6.4 纪律的另一半）：上面 where 过滤前会先把候选落库，避免按陈旧索引选错；
      // 但写动作改完 .md 之后此前**不刷回去**——于是管道报 changed:N，紧接着 query 却查到旧值，
      // 「成功回执」和「验证通道」互相矛盾，调用方只能靠 scan + 手动 index 兜一圈才敢信（dogfood 实测）。
      // 这里补上对称的那一半：非 dry-run 且真有改动时，把改动过的文件刷进索引。
      // 动作链自带 index 时跳过（那一步已经落库，再刷是纯浪费）。
      const wantRefresh = pipeline.refreshIndex ?? true;
      const selfIndexes = ops.some((a) => a.name === "index");
      if (wantRefresh && !ctx.dryRun && !selfIndexes && report.changedPaths.length > 0) {
        const typeOf = new Map(routed.map((e) => [e.path, e.type]));
        for (const p of report.changedPaths) {
          // 写动作不会作用在已删除文件上，但 unlink 事件仍可能混在批里——按事件类型分流，别让 update 抛。
          if (typeOf.get(p) === "unlink") this.indexer.removeByKey(p);
          else await this.indexer.update(p);
          report.reindexed++;
        }
      }
      return report;
    } finally {
      engine?.close();
    }
  }

  /** 一次性：scan 源（FS↔DB diff）跑一条管道。 */
  async runScan(pipeline: PipelineConfig): Promise<RunReport> {
    return this.runBatch(await scanSource(this.indexer), pipeline);
  }

  /**
   * stdin 文件列表源的 vault 边界校验（C1 安全闸）：越界即声明期报错，列出非法行。
   * 接线在引擎层（而非 CLI 重算布局）——roots 只有这里知道，保证与动作层 toAbs 同源。
   */
  assertStdinPaths(paths: string[]): void {
    assertPathsInVault(paths, this.layout.roots);
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
      this.layout.roots,
      this.layout.toKey,
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

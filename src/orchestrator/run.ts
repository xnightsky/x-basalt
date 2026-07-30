import type {
  Action,
  ActionContext,
  ActionResult,
  ChangeEvent,
  Op,
  OpContext,
  OpFailure,
  OpOutcome,
  Row,
  RunReport,
  StepReport,
} from "./types.js";

// === 自建实现: 执行引擎（串行管道 + 有界并发 + 失败策略 + 超时）===
//
// 设计：docs/design/change-orchestration.md §6.6、§14.5 执行算子（pipe/limit/timeout/onError）。
// 每个文件按动作序串行跑（pipe，顺序即依赖）；文件之间有界并发（limit，自实现 worker 池，零依赖）；
// 单动作超时用 Promise 竞速兜底（P0 不真正中止动作，仅丢弃其结果记 failed）；失败按 onError 续/停。

export interface RunOptions {
  /** 文件间并发上限（默认 4）。 */
  concurrency?: number;
  /** 失败策略（默认 continue）：跳过该文件剩余动作并继续 / 立即停止整批。 */
  onError?: "continue" | "stop";
  /** 单动作超时（ms）；缺省/0 = 不限。 */
  timeout?: number;
}

/** 给 promise 套超时：超时则 reject（动作仍在后台跑，结果被丢弃）。 */
async function withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
  if (!ms || ms <= 0) return p;
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`动作超时 ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/** Op 管道执行选项（runOpPipeline）。 */
export interface OpRunOptions {
  /** 批内并发上限（rowwise 算子有效，默认 4）。 */
  concurrency?: number;
  /** 失败策略（默认 continue）：从后续算子输入中剔除失败行继续 / 当前算子返回后停止。 */
  onError?: "continue" | "stop";
  /** 单次 Op.run 超时（ms）；缺省/0 = 不限。 */
  timeout?: number;
}

/**
 * Op 管道执行器：外层串行跑算子，内层每算子批进批出。
 *
 * 与 runPipeline 并存，不改动后者。
 *
 * 执行模型（§3.2 设计）：外层按顺序串行跑每个 Op，每个 Op 吃当前存活的整批 rows，
 * 产出的 rows 传给下一个 Op。这与 runPipeline 的「外层并发文件、内层串行动作」是
 * 循环嵌套对调，属有意为之。
 *
 * @param rows - 初始行批
 * @param ops  - 已解析的算子链（串行 pipe）
 * @param ctx  - 算子上下文
 * @param opts - 并发/失败/超时
 */
export async function runOpPipeline(
  rows: Row[],
  ops: Op[],
  ctx: OpContext,
  opts: OpRunOptions = {},
): Promise<RunReport> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const onError = opts.onError ?? "continue";
  const steps: StepReport[] = [];
  const allFailed: OpFailure[] = [];
  // D9: 跨算子聚合 changed/skipped 信号
  const allChangedPaths: string[] = [];
  const seenChangedSet = new Set<string>();
  const allSkippedSet = new Set<string>();
  const byAction: Record<string, number> = {};
  let currentRows: Row[] = [...rows];
  let stopped = false;

  for (const op of ops) {
    if (stopped) break;

    const rowsIn = currentRows.length;

    let outcome: OpOutcome;

    if (op.rowwise) {
      // 逐行领取：共享游标 + Promise.all（复用 runPipeline 的 worker 池写法，§3.2.1/D10）
      // 每个 worker 从共享游标领一行，保证同时在跑的行数不超过 concurrency。
      const outcomes = Array.from<OpOutcome>({ length: currentRows.length });
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < currentRows.length) {
          const idx = next++;
          const row = currentRows[idx]!; // idx 保证 < length（while 条件确保）
          try {
            outcomes[idx] = await withTimeout(op.run([row], ctx), opts.timeout);
          } catch (err) {
            outcomes[idx] = {
              rows: [],
              failed: [{ path: row.path, op: op.name, error: String(err) }],
              changed: [],
              skipped: [],
            };
          }
        }
      };
      const poolSize = Math.min(concurrency, currentRows.length);
      await Promise.all(Array.from({ length: poolSize }, () => worker()));

      // 按原始入参顺序归并（outcomes 按 idx 索引，天然有序）
      const allRows: Row[] = [];
      const opFailed: OpFailure[] = [];
      const opChanged: string[] = [];
      const opSkipped: string[] = [];
      for (const o of outcomes) {
        if (o) {
          allRows.push(...o.rows);
          opFailed.push(...o.failed);
          opChanged.push(...o.changed);
          opSkipped.push(...o.skipped);
        }
      }
      outcome = { rows: allRows, failed: opFailed, changed: opChanged, skipped: opSkipped };
    } else {
      // rowwise=false：整批一次调用，不切片
      try {
        outcome = await withTimeout(op.run(currentRows, ctx), opts.timeout);
      } catch (err) {
        outcome = {
          rows: [],
          failed: currentRows.map((row) => ({
            path: row.path,
            op: op.name,
            error: String(err),
          })),
          changed: [],
          skipped: [],
        };
      }
    }

    steps.push({ op: op.name, rowsIn, rowsOut: outcome.rows.length, failed: outcome.failed });
    allFailed.push(...outcome.failed);

    // D9: 跨算子聚合 changed/skipped（按 RunReport 口径：changedPaths 去重保序、byAction 计件）
    for (const path of outcome.changed) {
      byAction[op.name] = (byAction[op.name] ?? 0) + 1;
      if (!seenChangedSet.has(path)) {
        seenChangedSet.add(path);
        allChangedPaths.push(path);
      }
    }
    for (const path of outcome.skipped) {
      allSkippedSet.add(path);
    }

    // onError=stop：当前 Op 返回后即停，不进入下一个 Op；批内已开跑的行跑完当前算子
    if (onError === "stop" && outcome.failed.length > 0) {
      stopped = true;
      // 不 break 在当前 Op 后触发——外层 for 循环顶部下一轮会检查 stopped
    }

    // onError=continue（默认）：从后续算子的输入中剔除失败行
    if (outcome.failed.length > 0) {
      const failedPaths = new Set(outcome.failed.map((f) => f.path));
      currentRows = outcome.rows.filter((row) => !failedPaths.has(row.path));
    } else {
      currentRows = outcome.rows;
    }
  }

  // 构建 RunReport：失败记录映射为 ActionResult 格式
  const failedResults: ActionResult[] = allFailed.map((f) => ({
    action: f.op,
    path: f.path,
    changed: false,
    skipped: false,
    error: f.error,
  }));

  return {
    total: rows.length,
    changed: allChangedPaths.length,
    skipped: allSkippedSet.size,
    failed: failedResults,
    dryRun: ctx.dryRun,
    changedPaths: allChangedPaths,
    byAction,
    reindexed: 0, // 留待 engine 回填
    steps,
  };
}

/**
 * 对一批（已去重）事件跑一条动作链，汇总结构化报告。
 *
 * @param batch - 去重后的事件批
 * @param actions - 已解析的动作链（串行 pipe）
 * @param ctx - 动作上下文（含 dryRun 安全闸）
 * @param opts - 并发/失败/超时
 *
 * @behavior
 * Given 多动作 When 单文件 Then 按动作序串行执行（顺序即依赖）
 *
 * @behavior
 * Given 某动作失败 onError=continue When 执行 Then 跳过该文件剩余动作、其余文件照常、记 failed
 *
 * @behavior
 * Given 某动作失败 onError=stop When 执行 Then 停止接新文件、不处理后续
 *
 * @behavior
 * Given concurrency=N When 执行 Then 同时在跑的文件数不超过 N
 *
 * @behavior
 * Given 动作超时 When 执行 Then 记 failed 不拖垮整批
 */
export async function runPipeline(
  batch: ChangeEvent[],
  actions: Action[],
  ctx: ActionContext,
  opts: RunOptions = {},
): Promise<RunReport> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const onError = opts.onError ?? "continue";
  const results: ActionResult[] = [];
  let stopped = false;

  // 处理单个文件：串行跑动作链；某动作失败（抛错或结果含 error）按 onError 决定续/停。
  const processEvent = async (e: ChangeEvent): Promise<void> => {
    for (const action of actions) {
      if (stopped) return;
      try {
        const r = await withTimeout(action.run(e, ctx), opts.timeout);
        results.push(r);
        if (r.error !== undefined) {
          if (onError === "stop") {
            stopped = true;
            return;
          }
          break; // continue：跳过该文件剩余动作
        }
      } catch (err) {
        results.push({
          action: action.name,
          path: e.path,
          changed: false,
          skipped: false,
          error: (err as Error).message,
        });
        if (onError === "stop") {
          stopped = true;
          return;
        }
        break; // continue：跳过该文件剩余动作
      }
    }
  };

  // 有界并发：worker 池从共享游标领取事件；stop 后不再领新事件。
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < batch.length) {
      if (stopped) return; // onError=stop 后不再领新文件（processEvent 内置 stopped）
      const idx = next++;
      const e = batch[idx];
      if (e) await processEvent(e);
    }
  };
  const poolSize = Math.min(concurrency, batch.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  // 按**文件**聚合（口径见 RunReport 注释）：changed/skipped 与 total 同单位，
  // 分动作明细另存 byAction。changedPaths 供上层写后刷索引与调用方复核。
  const changedPaths: string[] = [];
  const skippedPaths = new Set<string>();
  const byAction: Record<string, number> = {};
  const seenChanged = new Set<string>();
  for (const r of results) {
    if (r.changed) {
      byAction[r.action] = (byAction[r.action] ?? 0) + 1;
      if (!seenChanged.has(r.path)) {
        seenChanged.add(r.path);
        changedPaths.push(r.path); // 保持批内顺序，便于复现
      }
    }
    if (r.skipped) skippedPaths.add(r.path);
  }

  return {
    total: batch.length,
    changed: changedPaths.length,
    skipped: skippedPaths.size,
    failed: results.filter((r) => r.error !== undefined),
    dryRun: ctx.dryRun,
    changedPaths,
    byAction,
    reindexed: 0, // 由 engine.runBatch 在写后刷索引时回填
  };
}

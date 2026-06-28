import type { Action, ActionContext, ActionResult, ChangeEvent, RunReport } from "./types.js";

// === 自建实现: 执行引擎（串行管道 + 有界并发 + 失败策略 + 超时）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §6.6、§14.5 执行算子（pipe/limit/timeout/onError）。
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

  return {
    total: batch.length,
    changed: results.filter((r) => r.changed).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => r.error !== undefined),
    dryRun: ctx.dryRun,
  };
}

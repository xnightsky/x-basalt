import type { ChangeEvent } from "./types.js";

// === 自建实现: 堆积（debounce + maxWait 防饿死）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §6.2、§14.2 算子 `debounce`。
// 借鉴：RxJS debounceTime（静默窗）+ Lodash debounce 的 maxWait（持续活动时的强制上限）。
// 关注点分离：本类只管「攒事件 + 判断该不该 flush」，时间由调用方传入（push(ev, now)/shouldFlush(now)）——
// 纯逻辑、确定性可测，不内嵌定时器；引擎层用真实 setTimeout 驱动 shouldFlush 的轮询/调度。

export interface AccumulatorOptions {
  /** 静默窗：最后一个事件后静默满 wait(ms) 即可 flush（trailing-edge debounce）。 */
  wait: number;
  /** 强制上限：自首个事件起累计达 maxWait(ms) 必须 flush，防止持续编辑把 debounce 饿死。 */
  maxWait: number;
}

/**
 * 变更事件堆积器：把 burst 攒成一批；何时该 flush 由 debounce(wait) 与 maxWait 共同决定。
 *
 * @behavior
 * Given 持续 push 不间断 When 累计达 maxWait Then shouldFlush 返回 true（防饿死）
 *
 * @behavior
 * Given push 后静默满 wait When shouldFlush Then 返回 true
 *
 * @behavior
 * Given flush 后 When shouldFlush Then 返回 false（状态已清空）
 */
export class Accumulator {
  private events: ChangeEvent[] = [];
  /** 本批首个事件时间戳（ms）；空批为 -1。用于 maxWait 判定。 */
  private firstTs = -1;
  /** 最近一次事件时间戳（ms）；空批为 -1。用于 wait（静默窗）判定。 */
  private lastTs = -1;

  constructor(private readonly opts: AccumulatorOptions) {}

  /** 当前累积的事件数。 */
  get size(): number {
    return this.events.length;
  }

  /** 累积一个事件；now 为调用方提供的当前时间（ms）。 */
  push(ev: ChangeEvent, now: number): void {
    if (this.events.length === 0) this.firstTs = now;
    this.events.push(ev);
    this.lastTs = now;
  }

  /** 在时间 now 是否应当 flush：静默满 wait 或累计达 maxWait；空批永远 false。 */
  shouldFlush(now: number): boolean {
    if (this.events.length === 0) return false;
    return now - this.lastTs >= this.opts.wait || now - this.firstTs >= this.opts.maxWait;
  }

  /** 取出整批并清空状态（去重交由下游 foldEvents）。 */
  flush(): ChangeEvent[] {
    const batch = this.events;
    this.events = [];
    this.firstTs = -1;
    this.lastTs = -1;
    return batch;
  }
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { Accumulator } from "../src/orchestrator/accumulate.js";
import type { ChangeEvent } from "../src/orchestrator/types.js";

// === CO-B1 堆积 debounce + maxWait（防饿死）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §6.2、§14.2 算子 `debounce`。
// 纯逻辑：时间作为参数注入（push(ev,now)/shouldFlush(now)），确定性可测，无需真实定时器。

function ev(path: string): ChangeEvent {
  return { path, type: "change" };
}

test("CO-B1 Given 刚 push When 仍在静默窗内 Then 不该 flush", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 1000 });
  acc.push(ev("a.md"), 0);
  assert.equal(acc.shouldFlush(50), false);
});

test("CO-B1 Given push 后静默满 wait When shouldFlush Then 该 flush", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 1000 });
  acc.push(ev("a.md"), 0);
  assert.equal(acc.shouldFlush(100), true);
});

test("CO-B1 Given 持续 push（每次重置静默窗）When 未达 maxWait Then 推迟 flush（debounce 语义）", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 1000 });
  acc.push(ev("a.md"), 0);
  acc.push(ev("a.md"), 50);
  acc.push(ev("a.md"), 99);
  // 距最后一次（99）才 51ms < 100，不该 flush
  assert.equal(acc.shouldFlush(150), false);
  // 距最后一次（99）满 100ms，该 flush
  assert.equal(acc.shouldFlush(199), true);
});

test("CO-B1 Given 持续 push 永不静默 When 累计达 maxWait Then 强制 flush（防饿死）", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 200 });
  acc.push(ev("a.md"), 0); // firstTs=0
  acc.push(ev("a.md"), 50);
  acc.push(ev("a.md"), 100);
  acc.push(ev("a.md"), 150);
  acc.push(ev("a.md"), 199); // 始终在静默窗内编辑
  // 距最后(199)仅 1ms < wait，但距首个(0)已 200ms = maxWait → 强制 flush
  assert.equal(acc.shouldFlush(200), true);
});

test("CO-B1 Given 累积若干事件 When flush Then 返回整批并清空状态", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 1000 });
  acc.push(ev("a.md"), 0);
  acc.push(ev("b.md"), 10);
  assert.equal(acc.size, 2);
  const batch = acc.flush();
  assert.deepEqual(
    batch.map((e) => e.path),
    ["a.md", "b.md"],
  );
  assert.equal(acc.size, 0);
  assert.equal(acc.shouldFlush(99999), false); // 空了不再 flush
});

test("CO-B1 Given 空累积器 When shouldFlush Then false", () => {
  const acc = new Accumulator({ wait: 100, maxWait: 1000 });
  assert.equal(acc.shouldFlush(99999), false);
});

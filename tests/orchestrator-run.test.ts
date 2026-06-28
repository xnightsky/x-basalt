import assert from "node:assert/strict";
import { test } from "node:test";
import { runPipeline } from "../src/orchestrator/run.js";
import type { Action, ActionContext, ChangeEvent } from "../src/orchestrator/types.js";

// === CO-E1/E2 执行引擎（串行管道 + 失败策略 + 并发 + 超时 + 报告）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §6.6、§14.5 执行算子。
// runPipeline 接收已解析的 Action[]（依赖注入）——用测试动作验证编排语义，不依赖真实 IO。

/** mock ctx：执行引擎本身不触 indexer，测试动作也不用，故强转占位。 */
const ctx = { vaultPath: "/tmp", dryRun: false } as unknown as ActionContext;

function ev(path: string): ChangeEvent {
  return { path, type: "change" };
}

/** 记录执行轨迹的动作（changed=true）。 */
function recording(name: string, log: string[]): Action {
  return {
    name,
    write: false,
    async run(e) {
      log.push(`${name}:${e.path}`);
      return { action: name, path: e.path, changed: true, skipped: false };
    },
  };
}

/** 总是抛错的动作。 */
function failing(name: string): Action {
  return {
    name,
    write: false,
    async run() {
      throw new Error("boom");
    },
  };
}

test("CO-E1 Given 多动作 When runPipeline Then 单文件按动作序串行执行", async () => {
  const log: string[] = [];
  await runPipeline([ev("f.md")], [recording("a", log), recording("b", log)], ctx);
  assert.deepEqual(log, ["a:f.md", "b:f.md"]);
});

test("CO-E1 Given 某动作抛错 onError=continue When runPipeline Then 跳过该文件剩余动作、其余文件照常、记 failed", async () => {
  const log: string[] = [];
  const report = await runPipeline(
    [ev("x.md"), ev("y.md")],
    [failing("boom"), recording("after", log)],
    ctx,
    { onError: "continue" },
  );
  // 两个文件都被 failing 拦下，after 都不执行
  assert.deepEqual(log, []);
  assert.equal(report.failed.length, 2);
  assert.equal(report.failed[0]?.error, "boom");
  assert.equal(report.total, 2);
});

test("CO-E1 Given 某动作抛错 onError=stop When runPipeline Then 立即停止、后续文件不执行", async () => {
  const log: string[] = [];
  const report = await runPipeline([ev("x.md"), ev("y.md")], [failing("boom"), recording("after", log)], ctx, {
    onError: "stop",
    concurrency: 1,
  });
  assert.deepEqual(log, []);
  // stop：第一个文件失败后不再处理第二个
  assert.equal(report.failed.length, 1);
});

test("CO-E1 Given 成功与跳过混合 When runPipeline Then 报告 changed/skipped/total 正确", async () => {
  const skip: Action = {
    name: "skip",
    write: true,
    async run(e) {
      return { action: "skip", path: e.path, changed: false, skipped: true };
    },
  };
  const log: string[] = [];
  const report = await runPipeline([ev("a.md"), ev("b.md")], [recording("idx", log), skip], ctx);
  assert.equal(report.total, 2);
  assert.equal(report.changed, 2); // 两文件各一次 recording changed
  assert.equal(report.skipped, 2); // 两文件各一次 skip
  assert.equal(report.failed.length, 0);
});

test("CO-E2 Given concurrency=2 When runPipeline Then 同时在跑的文件数不超过 2", async () => {
  let active = 0;
  let peak = 0;
  const concurrentAction: Action = {
    name: "c",
    write: false,
    async run(e) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { action: "c", path: e.path, changed: true, skipped: false };
    },
  };
  const batch = Array.from({ length: 6 }, (_, i) => ev(`f${i}.md`));
  await runPipeline(batch, [concurrentAction], ctx, { concurrency: 2 });
  assert.ok(peak <= 2, `峰值并发应 ≤ 2，实际 ${peak}`);
  assert.ok(peak >= 2, `应确实并发到 2，实际 ${peak}`);
});

test("CO-E2 Given 慢动作 + timeout When runPipeline Then 超时记 failed 不拖垮整批", async () => {
  const slow: Action = {
    name: "slow",
    write: false,
    async run(e) {
      await new Promise((r) => setTimeout(r, 200));
      return { action: "slow", path: e.path, changed: true, skipped: false };
    },
  };
  const report = await runPipeline([ev("a.md")], [slow], ctx, { timeout: 30, onError: "continue" });
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0]?.error ?? "", /超时|timeout/i);
});

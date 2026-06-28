import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePipelines } from "../src/config.js";

// === CO-G1 配置 pipelines 段解析（带缺省值）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §8 配置形态。

test("CO-G1 Given 完整 pipeline When parsePipelines Then 字段如实解析", () => {
  const r = parsePipelines({
    maintain: {
      on: ["add", "change"],
      paths: ["pkm/**"],
      where: "LIST FROM #pkm",
      actions: ["index", "normalize"],
      concurrency: 2,
      onBusy: "restart",
      onError: "stop",
      dryRun: false,
      debounce: { wait: 200, maxWait: 2000 },
    },
  });
  assert.deepEqual(r.maintain?.actions, ["index", "normalize"]);
  assert.equal(r.maintain?.concurrency, 2);
  assert.equal(r.maintain?.onBusy, "restart");
  assert.equal(r.maintain?.onError, "stop");
  assert.equal(r.maintain?.dryRun, false);
  assert.equal(r.maintain?.where, "LIST FROM #pkm");
  assert.deepEqual(r.maintain?.debounce, { wait: 200, maxWait: 2000 });
});

test("CO-G1 Given 仅 actions When parsePipelines Then 填缺省（concurrency=4/onBusy=queue/onError=continue/dryRun=true）", () => {
  const r = parsePipelines({ p: { actions: ["index"] } });
  assert.equal(r.p?.concurrency, 4);
  assert.equal(r.p?.onBusy, "queue");
  assert.equal(r.p?.onError, "continue");
  assert.equal(r.p?.dryRun, true);
});

test("CO-G1 Given pipeline 缺 actions When parsePipelines Then 抛错", () => {
  assert.throws(() => parsePipelines({ bad: {} }), /actions/);
  assert.throws(() => parsePipelines({ bad: { actions: "index" } }), /actions/);
});

test("CO-G1 Given null/undefined When parsePipelines Then 空对象", () => {
  assert.deepEqual(parsePipelines(undefined), {});
  assert.deepEqual(parsePipelines(null), {});
});

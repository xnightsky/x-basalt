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
      onBusy: "queue",
      onError: "stop",
      dryRun: false,
      debounce: { wait: 200, maxWait: 2000 },
    },
  });
  assert.deepEqual(r.maintain?.actions, ["index", "normalize"]);
  assert.deepEqual(r.maintain?.on, ["add", "change"]);
  assert.deepEqual(r.maintain?.paths, ["pkm/**"]);
  assert.equal(r.maintain?.concurrency, 2);
  assert.equal(r.maintain?.onBusy, "queue");
  assert.equal(r.maintain?.onError, "stop");
  assert.equal(r.maintain?.dryRun, false);
  assert.equal(r.maintain?.where, "LIST FROM #pkm");
  assert.deepEqual(r.maintain?.debounce, { wait: 200, maxWait: 2000 });
});

// PC-1d：配置段与命令行共用 params 校验器后，配置里的非法值也在加载期报错（曾裸转型带进执行层）。
test("PC-1d Given 配置段字段非法 When parsePipelines Then 报错并定位到 pipelines.<name>.<key>", () => {
  assert.throws(
    () => parsePipelines({ m: { actions: ["index"], on: ["modified"] } }),
    /pipelines\.m\.on.*modified/s,
  );
  assert.throws(
    () => parsePipelines({ m: { actions: ["index"], concurrency: 0 } }),
    /pipelines\.m\.concurrency/,
  );
  assert.throws(
    () => parsePipelines({ m: { actions: ["index"], debounce: { wait: 3000, maxWait: 300 } } }),
    /pipelines\.m\.debounce/,
  );
  assert.throws(
    () => parsePipelines({ m: { actions: ["index"], onError: "halt" } }),
    /pipelines\.m\.onError/,
  );
  assert.throws(
    () => parsePipelines({ m: { actions: ["index"], ifExists: "clobber" } }),
    /pipelines\.m\.ifExists/,
  );
});

// onBusy 的 restart/ignore 需要执行引擎支持协作取消（AbortSignal），尚未实现。
// 此前配置里写 restart 会被静默当 queue 跑——声明与实际语义不符，故改为加载期显式报错。
test("PC-1d Given 配置段 onBusy=restart/ignore When parsePipelines Then 报「尚未实现」而非静默按 queue 跑", () => {
  assert.throws(() => parsePipelines({ m: { actions: ["index"], onBusy: "restart" } }), /尚未实现/);
  assert.throws(() => parsePipelines({ m: { actions: ["index"], onBusy: "ignore" } }), /尚未实现/);
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

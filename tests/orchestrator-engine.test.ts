import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DataviewEngine } from "../src/query/index.js";
import { isSelfWrite, Orchestrator } from "../src/orchestrator/engine.js";

// === CO-F2 引擎组装 + 防回环 + 优雅退出 ===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §6.4/§6.6/§9 坑①。

function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-eng-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("CO-F2 Given Map 记录自产生写 When isSelfWrite Then 窗内 true、窗外/无记录 false", () => {
  const m = new Map([["a.md", 1000]]);
  assert.equal(isSelfWrite(m, { path: "a.md", type: "change" }, 1500, 2000), true);
  assert.equal(isSelfWrite(m, { path: "a.md", type: "change" }, 4000, 2000), false);
  assert.equal(isSelfWrite(m, { path: "b.md", type: "change" }, 1500, 2000), false);
});

test("CO-F2 Given 空库 When runScan index 管道 Then 文件落库", async () => {
  const dir = mkVault({ "a.md": "---\ntags: [pkm]\n---\nA\n" });
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    const report = await orch.runScan({ actions: ["index"], dryRun: true });
    assert.equal(report.total, 1);
    assert.equal(report.failed.length, 0);
  } finally {
    orch.close();
  }
  const engine = new DataviewEngine(dbPath);
  assert.ok(
    engine.query("LIST").rows.some((r) => r["file.path"] === "a.md"),
    "a.md 应已落库",
  );
  engine.close();
  rmSync(dir, { recursive: true, force: true });
});

test("CO-F2 Given DQL 手动源 When runManual Then 只处理命中文件", async () => {
  const dir = mkVault({ "a.md": "---\ntags: [pkm]\n---\nA\n", "b.md": "B\n" });
  const orch = new Orchestrator({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    await orch.runScan({ actions: ["index"], dryRun: true }); // 先落库供 DQL 查询
    const report = await orch.runManual(
      { actions: ["parse"], dryRun: true },
      { dql: "LIST FROM #pkm" },
    );
    assert.equal(report.total, 1, "只 a.md 命中 #pkm");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given 同文件多事件 When runBatch Then 去重后只处理一次", async () => {
  const dir = mkVault({ "a.md": "# A\n" });
  const orch = new Orchestrator({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const report = await orch.runBatch(
      [
        { path: "a.md", type: "add" },
        { path: "a.md", type: "change" },
      ],
      { actions: ["parse"], dryRun: true },
    );
    assert.equal(report.total, 1);
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given watch 模式新建文件 When 触发后 stop Then 跑过管道且优雅退出", async () => {
  const dir = mkVault({});
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  const reports: number[] = [];
  await new Promise<void>((resolve) => {
    orch.watch(
      { actions: ["index"], dryRun: true, debounce: { wait: 100, maxWait: 500 } },
      (r) => reports.push(r.total),
      () => resolve(),
    );
  });
  try {
    writeFileSync(join(dir, "new.md"), "x\n");
    for (let i = 0; i < 80 && reports.length === 0; i++) await sleep(50);
    assert.ok(reports.length >= 1, "watch 应至少跑一次管道");
    assert.ok(
      reports.some((t) => t >= 1),
      "应处理到 new.md",
    );
  } finally {
    await orch.stop(); // 优雅退出不应抛/卡死
    rmSync(dir, { recursive: true, force: true });
  }
});

// === CO-F2 写后索引新鲜度（§6.4 纪律的另一半）===
// 背景（dogfood 实测）：写动作落盘后不刷索引 → 管道报 changed:N，紧接着 query 却查到旧值，
// 「成功回执」与「验证通道」互相矛盾，调用方只能 scan + 手动 index 兜一圈才敢信。
// 下列用例锁住：写完立刻查即为新值；opt-out 能关；动作链自带 index 时不重复刷。

/** 建库 + 落库，返回 vault 目录与 db 路径。 */
function mkIndexedVault(files: Record<string, string>): { dir: string; dbPath: string } {
  const dir = mkVault(files);
  return { dir, dbPath: join(dir, "i.db") };
}

/** 数一下当前索引里 type 仍缺失的篇数。 */
function countMissingType(dbPath: string): number {
  const engine = new DataviewEngine(dbPath);
  try {
    return engine.query("LIST WHERE type = null").rows.length;
  } finally {
    engine.close();
  }
}

const TWO_UNTYPED = { "a.md": "---\ncaptured: x\n---\nA\n", "b.md": "---\ncaptured: y\n---\nB\n" };

test("CO-F2 Given 写动作落盘 When runManual Then 索引已刷新、紧接着 query 即为新值", async () => {
  const { dir, dbPath } = mkIndexedVault(TWO_UNTYPED);
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    await orch.runScan({ actions: ["index"], dryRun: true });
    assert.equal(countMissingType(dbPath), 2, "前置：两篇都缺 type");

    const report = await orch.runManual(
      { actions: ["set type=note"], dryRun: false },
      { dql: "LIST WHERE type = null" },
    );
    assert.equal(report.changed, 2);
    assert.equal(report.reindexed, 2, "写完应自动刷索引");
    // 关键断言：**不再手动 index**，直接查——此前这里会仍然返回 2（索引陈旧）。
    assert.equal(countMissingType(dbPath), 0, "写完立刻查就该是新值");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given refreshIndex=false When runManual Then 不刷索引（opt-out 生效，索引保持陈旧）", async () => {
  const { dir, dbPath } = mkIndexedVault(TWO_UNTYPED);
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    await orch.runScan({ actions: ["index"], dryRun: true });
    const report = await orch.runManual(
      { actions: ["set type=note"], dryRun: false, refreshIndex: false },
      { dql: "LIST WHERE type = null" },
    );
    assert.equal(report.changed, 2, "盘上确实改了");
    assert.equal(report.reindexed, 0);
    assert.equal(countMissingType(dbPath), 2, "关掉刷新后索引保持陈旧——这正是 opt-out 的代价");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given 动作链自带 index When runManual Then 不重复刷（reindexed=0 但索引仍新鲜）", async () => {
  const { dir, dbPath } = mkIndexedVault(TWO_UNTYPED);
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    await orch.runScan({ actions: ["index"], dryRun: true });
    const report = await orch.runManual(
      { actions: ["set type=note", "index"], dryRun: false },
      { dql: "LIST WHERE type = null" },
    );
    assert.equal(report.reindexed, 0, "index 动作已落库，再刷是纯浪费");
    assert.equal(report.changed, 2, "仍按文件计——不是 2 文件 × 2 动作");
    assert.equal(countMissingType(dbPath), 0);
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given dry-run When runManual Then 不写盘也不刷索引", async () => {
  const { dir, dbPath } = mkIndexedVault(TWO_UNTYPED);
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    await orch.runScan({ actions: ["index"], dryRun: true });
    const report = await orch.runManual(
      { actions: ["set type=note"], dryRun: true },
      { dql: "LIST WHERE type = null" },
    );
    assert.equal(report.reindexed, 0);
    assert.equal(countMissingType(dbPath), 2, "dry-run 不该动盘也不该动索引");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

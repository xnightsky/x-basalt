import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";
import {
  manualSourceFromDql,
  manualSourceFromPaths,
  scanSource,
  watchSource,
} from "../src/orchestrator/sources.js";
import type { ChangeEvent } from "../src/orchestrator/types.js";

// === CO-F1 源适配（scan/手动/watch → ChangeEvent）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §6.1、§14.1 源算子。

function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-src-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("CO-F1 Given 空库 When scanSource Then 全部为 add 事件", async () => {
  const dir = mkVault({ "a.md": "A\n", "b.md": "B\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const evs = await scanSource(indexer);
    assert.deepEqual(evs.map((e) => [e.path, e.type]).toSorted(), [
      ["a.md", "add"],
      ["b.md", "add"],
    ]);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F1 Given 已建库后改一个删一个 When scanSource Then change + unlink", async () => {
  const dir = mkVault({ "a.md": "A\n", "b.md": "BBBB\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    await indexer.rebuild();
    writeFileSync(join(dir, "a.md"), "A modified longer content\n"); // size 变 → modified
    rmSync(join(dir, "b.md")); // deleted
    const m = (await scanSource(indexer)).map((e) => [e.path, e.type]);
    assert.ok(
      m.some(([p, t]) => p === "a.md" && t === "change"),
      "改动文件应为 change",
    );
    assert.ok(
      m.some(([p, t]) => p === "b.md" && t === "unlink"),
      "删除文件应为 unlink",
    );
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F1 Given 文件列表 When manualSourceFromPaths Then 全部 change 事件", () => {
  assert.deepEqual(
    manualSourceFromPaths(["x.md", "y.md"]).map((e) => [e.path, e.type]),
    [
      ["x.md", "change"],
      ["y.md", "change"],
    ],
  );
});

test("CO-F1 Given DQL When manualSourceFromDql Then 命中文件的 change 事件", async () => {
  const dir = mkVault({ "a.md": "---\ntags: [pkm]\n---\nA\n", "b.md": "B\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  await indexer.rebuild();
  indexer.close();
  const engine = new DataviewEngine(join(dir, "i.db"));
  try {
    const evs = manualSourceFromDql(engine, "LIST FROM #pkm");
    assert.deepEqual(
      evs.map((e) => [e.path, e.type]),
      [["a.md", "change"]],
    );
  } finally {
    engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F1 Given 启动监听后新建文件 When watchSource Then 收到 add 事件", async () => {
  const dir = mkVault({});
  const evs: ChangeEvent[] = [];
  let stop: (() => void) | undefined;
  await new Promise<void>((resolve) => {
    stop = watchSource(
      dir,
      (e) => evs.push(e),
      () => resolve(),
    );
  });
  try {
    writeFileSync(join(dir, "new.md"), "x\n");
    for (let i = 0; i < 60 && !evs.some((e) => e.path === "new.md"); i++) await sleep(50);
    assert.ok(
      evs.some((e) => e.path === "new.md" && e.type === "add"),
      "应收到 new.md 的 add 事件",
    );
  } finally {
    stop?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

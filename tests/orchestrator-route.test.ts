import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";
import { matchEvent, selectByDql } from "../src/orchestrator/route.js";
import type { ChangeEvent } from "../src/orchestrator/types.js";

// === CO-C1 路由：事件类型 + glob 入口过滤（纯函数）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §6.4、§14.4 算子 match/glob。
// 自实现简易 glob（**=跨目录任意，*=同级任意），不引第三方，守零依赖身份。

function ev(path: string, type: ChangeEvent["type"] = "change"): ChangeEvent {
  return { path, type };
}

test("CO-C1 Given on/paths 都缺省 When matchEvent Then 全放行", () => {
  assert.equal(matchEvent(ev("any/where.md"), {}), true);
});

test("CO-C1 Given on 指定 When 事件类型命中/不命中 Then 放行/拒绝", () => {
  assert.equal(matchEvent(ev("a.md", "add"), { on: ["add"] }), true);
  assert.equal(matchEvent(ev("a.md", "change"), { on: ["add"] }), false);
  assert.equal(matchEvent(ev("a.md", "unlink"), { on: ["add", "unlink"] }), true);
});

test("CO-C1 Given paths glob `pkm/**` When 路径在/不在该目录 Then 放行/拒绝", () => {
  assert.equal(matchEvent(ev("pkm/note.md"), { paths: ["pkm/**"] }), true);
  assert.equal(matchEvent(ev("pkm/sub/deep.md"), { paths: ["pkm/**"] }), true);
  assert.equal(matchEvent(ev("other/note.md"), { paths: ["pkm/**"] }), false);
});

test("CO-C1 Given `*` 不跨目录 When 匹配 Then 仅同级命中", () => {
  assert.equal(matchEvent(ev("a.md"), { paths: ["*.md"] }), true);
  assert.equal(matchEvent(ev("dir/a.md"), { paths: ["*.md"] }), false);
});

test("CO-C1 Given 多个 glob When 任一命中 Then 放行", () => {
  assert.equal(matchEvent(ev("blog/x.md"), { paths: ["pkm/**", "blog/**"] }), true);
  assert.equal(matchEvent(ev("zzz/x.md"), { paths: ["pkm/**", "blog/**"] }), false);
});

test("CO-C1 Given on 与 paths 同时给 When 二者都满足才放行", () => {
  assert.equal(matchEvent(ev("pkm/a.md", "add"), { on: ["add"], paths: ["pkm/**"] }), true);
  assert.equal(matchEvent(ev("pkm/a.md", "change"), { on: ["add"], paths: ["pkm/**"] }), false);
  assert.equal(matchEvent(ev("x/a.md", "add"), { on: ["add"], paths: ["pkm/**"] }), false);
});

// === CO-C2 DQL 语义路由（复用 DataviewEngine，需真实临时 vault + 索引）===

/** 建临时 vault + 索引，回调拿到只读 engine；自动清理。 */
async function withIndexedVault(
  files: Record<string, string>,
  fn: (engine: DataviewEngine) => void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "xb-route-"));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    const dbPath = join(dir, "index.db");
    const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
    await indexer.rebuild();
    indexer.close(); // 关写连接，再只读打开（WAL）
    const engine = new DataviewEngine(dbPath);
    try {
      fn(engine);
    } finally {
      engine.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CO-C2 Given DQL `LIST FROM #pkm` When selectByDql Then 返回命中文件路径集", async () => {
  await withIndexedVault(
    {
      "a.md": "---\ntags: [pkm]\n---\nA\n",
      "b.md": "---\ntags: [other]\n---\nB\n",
    },
    (engine) => {
      const hit = selectByDql(engine, "LIST FROM #pkm");
      assert.ok(hit.has("a.md"), "a.md 应命中 #pkm");
      assert.ok(!hit.has("b.md"), "b.md 不该命中");
    },
  );
});

test("CO-C2 Given 非法 DQL When selectByDql Then 抛错（不静默空选）", async () => {
  await withIndexedVault({ "a.md": "x\n" }, (engine) => {
    assert.throws(() => selectByDql(engine, "TOTALLY NOT DQL"));
  });
});

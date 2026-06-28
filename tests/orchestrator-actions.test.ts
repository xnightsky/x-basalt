import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";
import { getAction } from "../src/orchestrator/actions.js";
import type { ActionContext } from "../src/orchestrator/types.js";

// === CO-D1 内建动作（index / normalize / parse）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §7 动作契约。
// 动作把现有 indexer/meta/parser 能力包装成统一 Action；写动作受 ctx.dryRun 安全闸约束。

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-act-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

test("CO-D1 Given 未知动作名 When getAction Then 抛错并列可用名", () => {
  assert.throws(() => getAction("nope"), /未知动作/);
  assert.equal(getAction("index").name, "index");
});

test("CO-D1 Given add 事件 When index 动作 Then 文件入库可查；unlink 后删除", async () => {
  const dir = mkVault({ "a.md": "---\ntags: [pkm]\n---\nA\n" });
  const dbPath = join(dir, "index.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  const ctx: ActionContext = { vaultPath: dir, indexer, dryRun: true };
  try {
    const r = await getAction("index").run({ path: "a.md", type: "add" }, ctx);
    assert.equal(r.changed, true);
    assert.equal(r.skipped, false);
    indexer.close();
    let engine = new DataviewEngine(dbPath);
    assert.ok(
      engine.query("LIST").rows.some((row) => row["file.path"] === "a.md"),
      "index 后应可查到 a.md",
    );
    engine.close();

    // unlink → 删除索引
    const indexer2 = new VaultIndexer({ vaultPath: dir, dbPath });
    await getAction("index").run({ path: "a.md", type: "unlink" }, { ...ctx, indexer: indexer2 });
    indexer2.close();
    engine = new DataviewEngine(dbPath);
    assert.ok(
      !engine.query("LIST").rows.some((row) => row["file.path"] === "a.md"),
      "unlink 后应查不到 a.md",
    );
    engine.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 不规范 frontmatter When normalize 动作 dryRun Then 不落盘", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const before = readFileSync(join(dir, "a.md"), "utf8");
    const r = await getAction("normalize").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true },
    );
    assert.equal(r.skipped, true);
    assert.equal(r.changed, false);
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), before, "dryRun 不应改文件");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 不规范 frontmatter When normalize 动作非 dryRun Then 落盘且幂等", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const ctx: ActionContext = { vaultPath: dir, indexer, dryRun: false };
    const r1 = await getAction("normalize").run({ path: "a.md", type: "change" }, ctx);
    assert.equal(r1.changed, true);
    assert.match(readFileSync(join(dir, "a.md"), "utf8"), /tags:/, "应迁移单数 tag→tags");
    // 幂等：再跑无变化
    const r2 = await getAction("normalize").run({ path: "a.md", type: "change" }, ctx);
    assert.equal(r2.changed, false);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 可解析文件 When parse 动作 Then 成功且不写", async () => {
  const dir = mkVault({ "a.md": "# Title\n[[Link]] #tag\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await getAction("parse").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true },
    );
    assert.equal(r.changed, false);
    assert.equal(r.skipped, false);
    assert.equal(r.error, undefined);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

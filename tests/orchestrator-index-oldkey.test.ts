import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { Orchestrator } from "../src/orchestrator/index.js";
import { resolveVaultLayout } from "../src/utils/path.js";

// === 自建实现: index 动作对旧式单根主键的 unlink 端到端验证 ===
//
// 根因：多根布局下，旧式主键（无命名空间前缀）经 toAbs 会被「保守退回首个根」误解析，
// 导致 remove 删错行；同时 actions.ts 的 indexAction 曾无条件返回 changed:true，汇报失真。
// 覆盖：单根 → 多根切换后旧键被清、新键正确、报告 changed/failed 真实、toAbs 对无前缀键抛错。

const tmpDirs: string[] = [];
function freshDir(prefix = "x-basalt-oldkey-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function filePaths(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT path FROM files ORDER BY path").all() as { path: string }[];
    return rows.map((r) => r.path);
  } finally {
    db.close();
  }
}

function writeNote(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content);
}

test("单根切多根后，index 动作按主键精确删除旧键并诚实汇报", async () => {
  const base = freshDir();
  const legacy = join(base, "legacy");
  const doc = join(base, "doc");
  const docs = join(base, "docs");
  const dbPath = join(base, "index.db");

  mkdirSync(legacy);
  mkdirSync(doc);
  mkdirSync(docs);

  // 阶段 1：单根布局，生成无前缀旧键 a.md / b.md。
  writeNote(legacy, "a.md", "# A\n");
  writeNote(legacy, "b.md", "# B\n");

  const idx1 = new VaultIndexer({ vaultPath: legacy, dbPath });
  await idx1.rebuild();
  idx1.close();
  assert.deepEqual(filePaths(dbPath), ["a.md", "b.md"]);

  // 阶段 2：切换到多根 doc + docs，各自也有 a.md / b.md。
  writeNote(doc, "a.md", "# Doc A\n");
  writeNote(doc, "b.md", "# Doc B\n");
  writeNote(docs, "a.md", "# Docs A\n");
  writeNote(docs, "b.md", "# Docs B\n");

  const orch = new Orchestrator({ vaultPath: [doc, docs], dbPath });
  const report = await orch.runScan({
    actions: ["index"],
    dryRun: false,
    onError: "continue",
  });
  orch.close();

  // 旧键必须被清掉，新键按命名空间正确入库。
  assert.deepEqual(filePaths(dbPath), ["doc/a.md", "doc/b.md", "docs/a.md", "docs/b.md"]);

  // 汇报必须诚实：2 个旧键 unlink + 4 个新键 add = 6 次真实变更，0 失败。
  assert.equal(report.total, 6);
  assert.equal(report.changed, 6);
  assert.equal(report.failed.length, 0);
  assert.equal(report.skipped, 0);
  assert.equal(report.dryRun, false);
});

test("多根 toAbs 对无命名空间前缀的旧式键抛出清晰错误", () => {
  const base = freshDir();
  const doc = join(base, "doc");
  const docs = join(base, "docs");
  mkdirSync(doc);
  mkdirSync(docs);

  const layout = resolveVaultLayout([doc, docs]);
  assert.throws(() => layout.toAbs("a.md"), /a\.md.*doc.*docs|可用根：doc, docs/);
});

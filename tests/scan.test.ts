import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";

// === scan：按需增量重索引（无 watcher，diff 文件系统 vs 库快照）===
// 设计：docs/specs/2026-06-28-scan-incremental-reindex-design.md

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 建临时 vault（A.md 含标签、B.md 链接 A），rebuild 全量索引后返回句柄。 */
async function setupVault(): Promise<{ vault: string; dbPath: string; idx: VaultIndexer }> {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-scan-"));
  tmpDirs.push(dir);
  const vault = join(dir, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "A.md"), "# A\n#x\n");
  await writeFile(join(vault, "B.md"), "# B\n[[A]]\n");
  const dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  return { vault, dbPath, idx };
}

/** 只读连接数 files 行数。 */
function fileCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  const c = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  db.close();
  return c;
}

test("Given 索引后未改动 When scan Then 0 变更（幂等）", async () => {
  const { idx } = await setupVault();
  const r = await idx.scan();
  assert.deepEqual([r.added, r.modified, r.deleted], [[], [], []]);
  assert.equal(r.unchanged, 2);
  // 连扫两次第二次仍 0。
  const r2 = await idx.scan();
  assert.deepEqual([r2.added, r2.modified, r2.deleted], [[], [], []]);
  idx.close();
});

test("Given 新增文件 When scan Then 报告 added 且入库", async () => {
  const { vault, dbPath, idx } = await setupVault();
  await writeFile(join(vault, "C.md"), "# C\n");
  const r = await idx.scan();
  assert.deepEqual(r.added, ["C.md"]);
  assert.equal(fileCount(dbPath), 3);
  idx.close();
});

test("Given 修改文件 When scan Then 报告 modified 且重索引", async () => {
  const { vault, dbPath, idx } = await setupVault();
  await writeFile(join(vault, "A.md"), "# A\n#x\n#y\n"); // size 变（多一行）
  const r = await idx.scan();
  assert.deepEqual(r.modified, ["A.md"]);
  const db = new Database(dbPath, { readonly: true });
  const tags = (
    db.prepare("SELECT COUNT(*) c FROM tags WHERE file_path='A.md'").get() as { c: number }
  ).c;
  db.close();
  assert.equal(tags, 2, "改动后应重索引为 2 个行内标签");
  idx.close();
});

test("Given 删除文件 When scan Then 报告 deleted 且移除记录", async () => {
  const { vault, dbPath, idx } = await setupVault();
  await rm(join(vault, "B.md"));
  const r = await idx.scan();
  assert.deepEqual(r.deleted, ["B.md"]);
  assert.equal(fileCount(dbPath), 1);
  idx.close();
});

test("Given --dry-run When scan Then 报告变更但库不写", async () => {
  const { vault, dbPath, idx } = await setupVault();
  await writeFile(join(vault, "C.md"), "# C\n");
  const r = await idx.scan({ dryRun: true });
  assert.deepEqual(r.added, ["C.md"]);
  assert.equal(fileCount(dbPath), 2, "dry-run 不应写库");
  idx.close();
});

test("Given 多个变更 + 小 batchSize When scanIter Then 按批 yield、累计正确", async () => {
  const { vault, idx } = await setupVault();
  for (let i = 0; i < 5; i++) await writeFile(join(vault, `N${i}.md`), `# N${i}\n`);
  const perBatch: number[] = [];
  let last: { added: string[]; remaining: number } | undefined;
  for await (const p of idx.scanIter({ batchSize: 2 })) {
    perBatch.push(p.added.length); // 累计已落库新增
    last = p;
  }
  assert.ok(perBatch.length >= 3, `5 新增 / batch 2 应至少 3 批，实际 ${perBatch.length}`);
  assert.equal(last?.added.length, 5);
  assert.equal(last?.remaining, 0);
  idx.close();
});

test("Given iter 中途 break 只处理一批 When 下次 scan Then 续扫剩余（断点续）", async () => {
  const { vault, dbPath, idx } = await setupVault();
  for (let i = 0; i < 5; i++) await writeFile(join(vault, `N${i}.md`), `# N${i}\n`);
  for await (const p of idx.scanIter({ batchSize: 2 })) {
    assert.ok(p.remaining > 0, "首批后应还有剩余");
    break; // 只处理第一批就停
  }
  assert.equal(fileCount(dbPath), 4, "原 A/B + 首批 2 个新增 = 4");
  const r = await idx.scan(); // 续扫补完
  assert.equal(r.added.length, 3, "续扫只补剩余 3 个");
  assert.equal(fileCount(dbPath), 7, "A/B + 5 新增");
  idx.close();
});

test("Given 内容变但 size 与 mtime 都不变 When 默认漏判、--rehash 检出", async () => {
  const { vault, idx } = await setupVault();
  const p = join(vault, "A.md");
  // 用固定整数毫秒 mtime 消除亚毫秒抖动（floor 跨 FS 往返才确定性相等）；钉好后 rebuild 入库该值。
  const fixed = new Date(1700000000000);
  await utimes(p, fixed, fixed);
  await idx.rebuild();
  // 同尺寸改动 '#x' → '#y'（字节数不变）+ 还原同一固定 mtime（模拟 cp -p 保留时间戳的复制）。
  await writeFile(p, "# A\n#y\n");
  await utimes(p, fixed, fixed);
  // 默认 mtime+size：两者皆未变 → 漏判（git racy 同款已知局限）。
  const def = await idx.scan({ dryRun: true });
  assert.ok(!def.modified.includes("A.md"), "默认路径在 size+mtime 均不变时漏判（已知局限）");
  // --rehash：按内容检出。
  const re = await idx.scan({ dryRun: true, rehash: true });
  assert.ok(re.modified.includes("A.md"), "--rehash 应按内容检出改动");
  idx.close();
});

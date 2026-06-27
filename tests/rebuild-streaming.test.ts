import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";

// === S3.3: 大库流式 rebuild（分批读写，内存 O(批) 而非 O(库)）的行数/反链正确性特征测试 ===
//
// 不直接断言内存（不可移植），改以「跨多个批次仍行数精确、反链不丢不重」证明流式重构无副作用。
// 文件数 250 > 批大小，强制多批，覆盖批边界。

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 生成含 N 个笔记 + 1 个 Hub 的临时 vault，每笔记：2 标签 / 1 链接 Hub / 1 任务。 */
async function makeLargeVault(n: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-large-"));
  tmpDirs.push(dir);
  const vault = join(dir, "vault");
  const buckets = 5;
  for (let b = 0; b < buckets; b++) await mkdir(join(vault, `dir-${b}`), { recursive: true });
  await writeFile(join(vault, "Hub.md"), "# Hub\n");
  const writes: Promise<void>[] = [];
  for (let i = 0; i < n; i++) {
    const body =
      `---\ntags: [bucket/${i % buckets}]\n---\n` +
      `# Note ${i}\n\n[[Hub]]\n\n#inline/${i % 3}\n\n- [ ] task ${i} 2026-07-01\n`;
    writes.push(writeFile(join(vault, `dir-${i % buckets}`, `note-${i}.md`), body));
  }
  await Promise.all(writes);
  return vault;
}

test("Given 250 文件大库 When rebuild Then files/links/tags/tasks 行数精确（跨批不丢不重）", async () => {
  const n = 250;
  const vault = await makeLargeVault(n);
  const dbPath = join(mkdtempSync(join(tmpdir(), "x-basalt-largedb-")), "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  idx.close();

  const db = new Database(dbPath, { readonly: true });
  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  // 251 = 250 笔记 + Hub。
  assert.equal(count("SELECT COUNT(*) c FROM files"), n + 1);
  // 每笔记 1 条 [[Hub]] 链接。
  assert.equal(count("SELECT COUNT(*) c FROM links"), n);
  // 每笔记 2 标签（frontmatter bucket/* + 行内 inline/*）。
  assert.equal(count("SELECT COUNT(*) c FROM tags"), n * 2);
  // 每笔记 1 任务。
  assert.equal(count("SELECT COUNT(*) c FROM tasks"), n);
  db.close();
});

test("Given 大库 When 查 Hub 的 inlinks Then 全部 250 笔记反链精确（批边界不丢）", async () => {
  const n = 250;
  const vault = await makeLargeVault(n);
  const dbPath = join(mkdtempSync(join(tmpdir(), "x-basalt-largedb-")), "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  idx.close();

  const engine = new DataviewEngine(dbPath);
  try {
    const r = engine.query("TABLE file.inlinks WHERE file.path = 'Hub.md'");
    const inlinks = (r.rows[0]?.["file.inlinks"] as string[]) ?? [];
    assert.equal(inlinks.length, n, "Hub 应被全部 250 笔记反链");
  } finally {
    engine.close();
  }
});

test("Given 重复 rebuild When 第二次重建 Then 行数不累加（DELETE 清空后重写）", async () => {
  const n = 120;
  const vault = await makeLargeVault(n);
  const dbPath = join(mkdtempSync(join(tmpdir(), "x-basalt-largedb-")), "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  await idx.rebuild(); // 第二次：先清空再写，不应翻倍。
  idx.close();

  const db = new Database(dbPath, { readonly: true });
  const c = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  db.close();
  assert.equal(c, n + 1);
});

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";

// === Bases P3 片一：附件数据集 vault_entries 的 indexer 写入路径（BASE-ALL-001 的 indexer 侧支撑）===
// 计划：docs/plans/2026-07-27-bases-p3-attachments.md「片一」；DDL：决策 §3 原样。
// 覆盖六条写入路径：rebuild / computeDiff+scanIter（scan）/ update / remove / watch，
// 以及边界（隐藏附件跳过 / 无扩展名 / 大写扩展名归一 / 多根命名空间 / 改名=unlink+add）。
// 不变量：同一物理文件只进一张表（扩展名分派）——附件只进 vault_entries、.md 只进 files。

const basesVault = fileURLToPath(new URL("./fixtures/bases/p1/vault", import.meta.url));

/** 每个用例独立临时目录（vault + db），统一在 after 清理。 */
const tmpDirs: string[] = [];
function freshDir(prefix = "x-basalt-att-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 以只读连接打开索引库，断言期专用。 */
function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}

/** 建临时 vault（1 篇 .md + 指定附件相对路径清单），rebuild 后返回句柄。 */
async function setupVault(entries: string[]): Promise<{
  vault: string;
  dbPath: string;
  idx: VaultIndexer;
}> {
  const dir = freshDir();
  const vault = join(dir, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "A.md"), "# A\n");
  for (const rel of entries) {
    await mkdir(join(vault, ...rel.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(vault, ...rel.split("/")), `bin:${rel}`);
  }
  const dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  return { vault, dbPath, idx };
}

/** 数 vault_entries 行数（每次新建只读连接，避免 WAL 快照陈旧）。 */
function entryCount(dbPath: string): number {
  const db = openReadonly(dbPath);
  const c = (db.prepare("SELECT COUNT(*) c FROM vault_entries").get() as { c: number }).c;
  db.close();
  return c;
}

function fileCount(dbPath: string): number {
  const db = openReadonly(dbPath);
  const c = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  db.close();
  return c;
}

test("BASE-ALL-001(indexer 侧)：rebuild 含附件 fixture，vault_entries 行数正确且 files 不受附件影响", async () => {
  const dbPath = join(freshDir("x-basalt-attdb-"), "index.db");
  const idx = new VaultIndexer({ vaultPath: basesVault, dbPath });
  await idx.rebuild();
  idx.close();

  const db = openReadonly(dbPath);
  // 7 篇 .md：Alpha/Beta/Empty/NullProps/Projects/Gamma/Projects/Sub/Delta/Projects2/Epsilon。
  assert.equal((db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c, 7);
  // 16 个附件：assets/cover.png、note.pdf、standalone.base、views/ 下 13 个 .base。
  assert.equal((db.prepare("SELECT COUNT(*) c FROM vault_entries").get() as { c: number }).c, 16);

  // 列口径：path 与 files 同命名空间、name 去扩展名、extension 不含点小写、folder POSIX（根为空串）。
  const cover = db
    .prepare("SELECT name, extension, folder FROM vault_entries WHERE path = 'assets/cover.png'")
    .get() as { name: string; extension: string; folder: string };
  assert.deepEqual(cover, { name: "cover", extension: "png", folder: "assets" });
  const standalone = db
    .prepare("SELECT name, extension, folder FROM vault_entries WHERE path = 'standalone.base'")
    .get() as { name: string; extension: string; folder: string };
  assert.deepEqual(standalone, { name: "standalone", extension: "base", folder: "" });

  // 跨表 path 唯一性不变量：同一 path 不同时存在于 files 与 vault_entries。
  const overlap = db
    .prepare("SELECT COUNT(*) c FROM files f JOIN vault_entries e ON e.path = f.path")
    .get() as { c: number };
  assert.equal(overlap.c, 0);
  db.close();
});

test("BASE-ALL-001(indexer 侧)：rebuild 幂等，重复重建 vault_entries 不累加", async () => {
  const { dbPath, idx } = await setupVault(["img.png", "doc.pdf"]);
  assert.equal(entryCount(dbPath), 2);
  await idx.rebuild();
  assert.equal(entryCount(dbPath), 2);
  assert.equal(fileCount(dbPath), 1);
  idx.close();
});

test("scan 增量：新增/改动/删除附件分别计 added/modified/deleted 并同步 vault_entries", async () => {
  const { vault, dbPath, idx } = await setupVault(["img.png"]);
  // 基线幂等：无变更时附件计数全 0、unchanged = 1。
  const idle = await idx.scan();
  assert.deepEqual(idle.attachments, { added: 0, modified: 0, deleted: 0, unchanged: 1 });

  // 新增附件 → added。
  await writeFile(join(vault, "new.pdf"), "pdf");
  const r1 = await idx.scan();
  assert.equal(r1.attachments.added, 1);
  assert.equal(entryCount(dbPath), 2);
  assert.equal(fileCount(dbPath), 1, "附件不入 files");

  // 改动附件（size 变）→ modified。
  await writeFile(join(vault, "img.png"), "bin:img.png:longer-content");
  const r2 = await idx.scan();
  assert.equal(r2.attachments.modified, 1);
  assert.equal(entryCount(dbPath), 2);

  // 删除附件 → deleted，行移除。
  await rm(join(vault, "new.pdf"));
  const r3 = await idx.scan();
  assert.equal(r3.attachments.deleted, 1);
  assert.equal(entryCount(dbPath), 1);
  idx.close();
});

test("scan 增量：附件改名 = unlink+add，旧行删新行插（一次 scan 同步）", async () => {
  const { vault, dbPath, idx } = await setupVault(["img.png"]);
  await rename(join(vault, "img.png"), join(vault, "renamed.png"));
  const r = await idx.scan();
  assert.equal(r.attachments.added, 1);
  assert.equal(r.attachments.deleted, 1);
  const db = openReadonly(dbPath);
  const paths = db.prepare("SELECT path FROM vault_entries").all() as { path: string }[];
  db.close();
  assert.deepEqual(paths, [{ path: "renamed.png" }]);
  idx.close();
});

test("scan --dry-run：报告附件差异但不写库", async () => {
  const { vault, dbPath, idx } = await setupVault([]);
  await writeFile(join(vault, "img.png"), "bin");
  const r = await idx.scan({ dryRun: true });
  assert.equal(r.attachments.added, 1);
  assert.equal(entryCount(dbPath), 0, "dry-run 不应写 vault_entries");
  idx.close();
});

test("update/remove 分派：附件只进 vault_entries、.md 只进 files（跨表 path 唯一性）", async () => {
  const { vault, dbPath, idx } = await setupVault([]);
  // update 附件 → 仅 vault_entries。
  await writeFile(join(vault, "img.png"), "bin");
  await idx.update("img.png");
  assert.equal(entryCount(dbPath), 1);
  assert.equal(fileCount(dbPath), 1, "附件 update 不进 files");

  // update .md → 仅 files。
  await idx.update("A.md");
  assert.equal(fileCount(dbPath), 1);
  assert.equal(entryCount(dbPath), 1, ".md update 不进 vault_entries");

  // update 幂等：重复调用不重复累加。
  await idx.update("img.png");
  assert.equal(entryCount(dbPath), 1);

  // remove 双表幂等：删附件后两表都无该行；对 .md 再 remove 不炸。
  idx.remove("img.png");
  assert.equal(entryCount(dbPath), 0);
  idx.remove("img.png"); // 二次删除幂等
  idx.remove("A.md");
  assert.equal(fileCount(dbPath), 0);
  idx.close();
});

test("边界：隐藏附件（.foo.png 与隐藏目录内附件）跳过", async () => {
  const { vault, dbPath, idx } = await setupVault(["visible.png"]);
  await writeFile(join(vault, ".foo.png"), "hidden-file");
  await mkdir(join(vault, ".hdir"), { recursive: true });
  await writeFile(join(vault, ".hdir", "x.png"), "hidden-dir");
  await idx.rebuild();
  assert.equal(entryCount(dbPath), 1, "隐藏附件与隐藏目录内附件一律跳过");
  idx.close();
});

test("边界：无扩展名文件 extension 为空串入表；大写扩展名 .PNG 归一为 png", async () => {
  const { dbPath, idx } = await setupVault(["LICENSE", "Photo.PNG"]);
  const db = openReadonly(dbPath);
  const rows = db
    .prepare("SELECT path, name, extension FROM vault_entries ORDER BY path")
    .all() as { path: string; name: string; extension: string }[];
  db.close();
  assert.deepEqual(rows, [
    { path: "LICENSE", name: "LICENSE", extension: "" },
    { path: "Photo.PNG", name: "Photo", extension: "png" },
  ]);
  idx.close();
});

test("多根：附件 path 带 <根目录名>/ 命名空间前缀", async () => {
  const parent = freshDir("x-basalt-attmr-");
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  await writeFile(join(a, "x.md"), "# X\n");
  await writeFile(join(a, "img.png"), "a");
  await writeFile(join(b, "img.png"), "b"); // 同名附件跨根不撞键

  const dbPath = join(freshDir("x-basalt-attmrdb-"), "index.db");
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await idx.rebuild();
  const db = openReadonly(dbPath);
  const paths = db.prepare("SELECT path FROM vault_entries ORDER BY path").all() as {
    path: string;
  }[];
  db.close();
  assert.deepEqual(paths, [{ path: "docs/img.png" }, { path: "notes/img.png" }]);

  // 多根 scan 增量：第二根新增附件被识别为命名空间路径。
  await writeFile(join(b, "new.pdf"), "pdf");
  const r = await idx.scan();
  assert.equal(r.attachments.added, 1);
  assert.equal(entryCount(dbPath), 3);
  idx.close();
});

/** 轮询等待异步条件（chokidar awaitWriteFinish + 增量落库有延迟）。 */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

test("watch：附件 add/unlink 事件驱动 vault_entries 行变化，.md 路径不受影响", async () => {
  const vaultDir = freshDir("x-basalt-attwatch-");
  const vault = join(vaultDir, "vault");
  mkdirSync(vault, { recursive: true });
  // db 放 vault 外：避免 watch 监听到索引文件(含 WAL)自身变化 + Windows 文件锁干扰。
  const dbPath = join(freshDir("x-basalt-attwatchdb-"), "index.db");
  await writeFile(join(vault, "A.md"), "# A\n");

  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  assert.equal(entryCount(dbPath), 0);

  // 等 chokidar 初始扫描完成（ready）：否则 ignoreInitial 会跳过 ready 前写入的文件。
  let ready = false;
  idx.watch(undefined, () => {
    ready = true;
  });
  assert.ok(await waitFor(() => ready, 3000), "chokidar 应进入 ready");
  try {
    // add：新增附件应入 vault_entries、不进 files。
    await writeFile(join(vault, "img.png"), "bin");
    assert.ok(await waitFor(() => entryCount(dbPath) === 1), "附件 add 应入 vault_entries");
    assert.equal(fileCount(dbPath), 1, "附件不进 files");

    // change：改附件内容应保持 1 行（先删后插不重复累加）。
    await writeFile(join(vault, "img.png"), "bin:changed");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(entryCount(dbPath), 1, "附件 change 不重复累加");

    // unlink：删附件应移除其 vault_entries 行。
    await rm(join(vault, "img.png"));
    assert.ok(await waitFor(() => entryCount(dbPath) === 0), "附件 unlink 应移除索引行");
    assert.equal(fileCount(dbPath), 1, ".md 索引不受附件事件影响");
  } finally {
    idx.close();
  }
});

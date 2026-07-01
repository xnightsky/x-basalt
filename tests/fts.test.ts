import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";

// === FTS5 全文检索（trigram，唯一写边界内同步）===
// 设计：docs/specs/2026-06-28-semantic-retrieval-integration.md；对应 TODO backlog S3.5。
// 覆盖：① ensureFts 新建/旧库补建/版本守卫重建；② insertPayload/deleteByPath/rebuild 增量同步；
//      ③ DataviewEngine.search 的 trigram 子串匹配、CJK、MATCH 注入防护、分页、缺表报错。

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function newTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// === ① ensureFts：新库 / 旧库补建 / 版本守卫 ===

test("新库：rebuild 后 files_fts 已建好，可直接 search 命中", async () => {
  const dir = newTmpDir("x-basalt-fts-new-");
  await writeFile(join(dir, "a.md"), "# a\nmentions distributed systems design\n");
  const dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();
  idx.close();

  const engine = new DataviewEngine(dbPath);
  const r = engine.search("distributed");
  assert.equal(r.total, 1);
  assert.equal(r.rows[0]?.path, "a.md");
  engine.close();
});

test("旧库（只有手工建的 files 表，无 files_fts）：VaultIndexer 开库自动补建，search 可用", () => {
  const dir = newTmpDir("x-basalt-fts-old-");
  const dbPath = join(dir, "index.db");
  const raw = new Database(dbPath);
  raw.exec(`CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    name_key TEXT NOT NULL, path_key TEXT NOT NULL, extension TEXT NOT NULL, folder TEXT NOT NULL,
    size INTEGER NOT NULL, mtime INTEGER NOT NULL, ctime INTEGER NOT NULL, content TEXT NOT NULL, frontmatter TEXT NOT NULL
  )`);
  raw
    .prepare(
      `INSERT INTO files (path,name,name_key,path_key,extension,folder,size,mtime,ctime,content,frontmatter)
       VALUES ('legacy.md','legacy','legacy','legacy','md','',10,0,0,'legacy body mentions consensus algorithms','{}')`,
    )
    .run();
  raw.close();

  // 只开库（不做任何写操作）：ensureFts 应侦测到 files_fts 缺失并从 files 全量回填。
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  idx.close();

  const engine = new DataviewEngine(dbPath);
  const r = engine.search("consensus");
  assert.ok(r.rows.some((row) => row.path === "legacy.md"));
  engine.close();
});

test("版本守卫：fts_version 不符 → 下次开库自动重建 files_fts（清掉手工注入的假行）", async () => {
  const dir = newTmpDir("x-basalt-fts-ver-");
  await writeFile(join(dir, "a.md"), "# a\nmentions distributed systems design\n");
  const dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();
  idx.close();

  // 手工注入一条不该存在的 FTS 行 + 把版本号改花，模拟"分词策略升级前的旧索引"。
  const raw = new Database(dbPath);
  raw
    .prepare(
      "INSERT INTO files_fts(rowid, path, name, content) VALUES (9999, 'zzz-bogus.md', 'zzz', 'totally bogus row')",
    )
    .run();
  const cur = raw.prepare("SELECT value FROM store_config WHERE key = 'fts_version'").get() as
    | { value: string }
    | undefined;
  raw
    .prepare(
      "INSERT INTO store_config(key, value) VALUES ('fts_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(`${cur?.value ?? ""}-stale`);
  raw.close();

  const idx2 = new VaultIndexer({ vaultPath: dir, dbPath });
  idx2.close();

  const check = new Database(dbPath, { readonly: true });
  assert.equal(
    check.prepare("SELECT rowid FROM files_fts WHERE rowid = 9999").get(),
    undefined,
    "重建应清掉手工注入的假行",
  );
  const hit = check.prepare("SELECT rowid FROM files_fts WHERE files_fts MATCH ?").all('"distributed"');
  assert.ok(hit.length > 0, "真实内容重建后应仍可搜到");
  check.close();
});

// === ② 增量同步：update/remove/rebuild 与 files_fts 保持一致 ===

test("增量同步：update 写入可搜到；改内容后旧词消失新词命中；remove 后消失", async () => {
  const dir = newTmpDir("x-basalt-fts-inc-");
  const dbPath = join(dir, "index.db");
  const file = join(dir, "note.md");
  await writeFile(file, "# note\nthis mentions distributed systems design\n");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.update(file);

  let engine = new DataviewEngine(dbPath);
  assert.ok(engine.search("distributed").rows.some((r) => r.path === "note.md"));
  engine.close();

  await writeFile(file, "# note\nnow mentions consensus algorithms only\n");
  await idx.update(file);
  engine = new DataviewEngine(dbPath);
  assert.equal(engine.search("distributed").total, 0, "旧词应已消失");
  assert.ok(engine.search("consensus").rows.some((r) => r.path === "note.md"), "新词应命中");
  engine.close();

  idx.remove(file);
  engine = new DataviewEngine(dbPath);
  assert.equal(engine.search("consensus").total, 0, "删除后不应再命中");
  engine.close();
  idx.close();
});

test("rebuild 全量重建：files_fts 与 files 保持一致（旧内容不残留）", async () => {
  const dir = newTmpDir("x-basalt-fts-rebuild-");
  const dbPath = join(dir, "index.db");
  await writeFile(join(dir, "one.md"), "# one\nmentions raccoon habitats\n");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();

  await writeFile(join(dir, "one.md"), "# one\nmentions penguin colonies\n");
  await idx.rebuild(); // 全量重建：files/files_fts 均先清空再重插

  const engine = new DataviewEngine(dbPath);
  assert.equal(engine.search("raccoon").total, 0, "旧内容不应残留在 FTS 里");
  assert.ok(engine.search("penguin").rows.some((r) => r.path === "one.md"));
  engine.close();
  idx.close();
});

// === ③ DataviewEngine.search：trigram/CJK/MATCH 注入防护/分页/缺表报错 ===

let searchDbPath: string;
before(async () => {
  const dir = newTmpDir("x-basalt-fts-search-");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "cap.md"), "CAP 定理与分布式系统设计，也叫 the CAP theorem。\n");
  await writeFile(join(dir, "quote.md"), 'He said "hi there" to greet me.\n');
  await writeFile(join(dir, "near.md"), "foo NEAR bar operator test\n");
  await writeFile(join(dir, "plain.md"), "nothing relevant here at all\n");
  searchDbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath: searchDbPath });
  await idx.rebuild();
  idx.close();
});

test("search：CJK 3 字 trigram 子串命中", () => {
  const engine = new DataviewEngine(searchDbPath);
  const r = engine.search("分布式");
  assert.deepEqual(
    r.rows.map((row) => row.path),
    ["cap.md"],
  );
  assert.match(r.rows[0]?.snippet ?? "", /分布式/);
  engine.close();
});

test("search：ASCII 词命中", () => {
  const engine = new DataviewEngine(searchDbPath);
  const r = engine.search("theorem");
  assert.deepEqual(
    r.rows.map((row) => row.path),
    ["cap.md"],
  );
  engine.close();
});

test("search：查询 < 3 字符（含 CJK 2 字）抛不合法错误，不静默返回空", () => {
  const engine = new DataviewEngine(searchDbPath);
  assert.throws(() => engine.search("ab"), /不合法/);
  assert.throws(() => engine.search("分布"), /不合法/);
  engine.close();
});

test("search：空串/纯空白抛不合法错误（而非裸 SQLite 语法错误）", () => {
  const engine = new DataviewEngine(searchDbPath);
  assert.throws(() => engine.search(""), /不合法/);
  assert.throws(() => engine.search("   "), /不合法/);
  engine.close();
});

test("search：MATCH 注入防护——特殊语法字符当字面短语，不抛错不误判语法", () => {
  const engine = new DataviewEngine(searchDbPath);
  // NEAR 是 FTS5 查询语法关键字：应被转义为字面短语命中 near.md，而非解释为 NEAR() 操作符。
  assert.deepEqual(
    engine.search("NEAR bar").rows.map((r) => r.path),
    ["near.md"],
  );
  // 未闭合引号 / 悬空布尔操作符：不转义直接传给 MATCH 会抛裸 SQLite 语法错误，转义后应安全无害。
  assert.doesNotThrow(() => engine.search('foo "bar'));
  assert.doesNotThrow(() => engine.search("foo OR"));
  assert.doesNotThrow(() => engine.search('foo" OR "1"="1'));
  // 用户查询里带字面引号：应命中包含该短语的笔记（转义后按字面子串匹配）。
  assert.deepEqual(
    engine.search("hi there").rows.map((r) => r.path),
    ["quote.md"],
  );
  engine.close();
});

test("search：分页 total/hasMore/snippet 元信息正确", () => {
  const engine = new DataviewEngine(searchDbPath);
  const r = engine.search("relevant", { size: 1 });
  assert.equal(r.total, 1);
  assert.equal(r.returned, 1);
  assert.equal(r.hasMore, false);
  assert.equal(r.size, 1);
  assert.ok(typeof r.rows[0]?.snippet === "string" && r.rows[0].snippet.length > 0);
  engine.close();
});

test("search：files_fts 不存在时给出「先建索引」的清晰提示（而非裸 SQLite 错误）", () => {
  const dir = newTmpDir("x-basalt-fts-missing-");
  const dbPath = join(dir, "index.db");
  const raw = new Database(dbPath);
  raw.exec("CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, name TEXT, content TEXT)");
  raw.close();
  const engine = new DataviewEngine(dbPath);
  assert.throws(() => engine.search("hello"), /不存在.*索引|索引.*不存在/);
  engine.close();
});

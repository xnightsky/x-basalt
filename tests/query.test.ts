import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine, DqlSyntaxError } from "../src/query/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/sample-vault", import.meta.url));

let tmpDir: string;
let dbPath: string;
let engine: DataviewEngine;

// 全套用例共享一份索引：先全量 rebuild 到临时库，再以只读引擎查询。
before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-qry-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开
  engine = new DataviewEngine(dbPath);
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test("DataviewEngine 可实例化（:memory:）", () => {
  const e = new DataviewEngine(":memory:");
  assert.ok(e);
  e.close();
});

test("README 示例：LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10", () => {
  const r = engine.query(
    "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10",
  );
  assert.equal(r.type, "LIST");
  assert.deepEqual(r.columns, ["file.name", "file.path"]);
  // #project = Alpha/Beta；status active 仅 Alpha。
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]?.["file.name"], "Alpha");
  assert.equal(r.rows[0]?.["file.path"], "Projects/Alpha.md");
});

test('TABLE 多列 + FROM "folder" + SORT', () => {
  const r = engine.query('TABLE status, due FROM "Projects" SORT file.name ASC');
  assert.equal(r.type, "TABLE");
  assert.deepEqual(r.columns, ["file.name", "status", "due"]);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha", "Beta"],
  );
  assert.deepEqual(
    r.rows.map((row) => row.status),
    ["active", "done"],
  );
  // 日期按 frontmatter 解析后以 ISO 存储，前缀仍为原日期（§3.3#3）。
  assert.ok(String(r.rows[0]?.due).startsWith("2026-07-15"));
});

test("FROM [[link]] 反向链接：指向 Index 的文件", () => {
  const r = engine.query("LIST FROM [[Index]] SORT file.name ASC");
  // Alpha/Beta/Concepts/Daily 均链接 Index；按 file.name 升序。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["2026-06-25", "Alpha", "Beta", "Concepts"],
  );
});

test("WHERE contains(file.tags, ...) 前缀语义", () => {
  const r = engine.query('LIST WHERE contains(file.tags, "area") SORT file.name ASC');
  // 含 area* 标签：Index/Alpha/Concepts/Daily。
  assert.deepEqual(r.rows.map((row) => row["file.name"]).toSorted(), [
    "2026-06-25",
    "Alpha",
    "Concepts",
    "Index",
  ]);
});

test("TABLE file.tags 聚合列解析为数组", () => {
  const r = engine.query("TABLE file.tags FROM \"Projects\" WHERE file.name = 'Alpha'");
  const tags = r.rows[0]?.["file.tags"];
  assert.ok(Array.isArray(tags), "file.tags 应为数组");
  assert.ok((tags as string[]).includes("area/work"));
  assert.ok((tags as string[]).includes("status/active"));
});

test("file.inlinks 聚合去重：同源多次链接只列一次", () => {
  const r = engine.query("TABLE file.inlinks WHERE file.name = 'Alpha'");
  const inlinks = r.rows[0]?.["file.inlinks"] as string[];
  // Beta 经 [[Projects/Alpha|Alpha]] 与 [[Projects/Alpha#^decision-1]] 两次指向 Alpha，去重后一次。
  assert.deepEqual(inlinks.toSorted(), [
    "Daily/2026-06-25.md",
    "Index.md",
    "Notes/Concepts.md",
    "Projects/Beta.md",
  ]);
});

test("regexmatch 走自定义 REGEXP 函数", () => {
  const r = engine.query('LIST WHERE regexmatch(file.name, "^A") SORT file.name ASC');
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha"],
  );
});

test("AND / OR / NOT 组合", () => {
  const r = engine.query("LIST WHERE status = 'done' OR status = 'active' SORT file.name ASC");
  // active: Index/Alpha；done: Beta。按 file.name 升序。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha", "Beta", "Index"],
  );
});

test("非子集字段（file.day）明确报错而非静默", () => {
  assert.throws(() => engine.query("TABLE file.day"), /不支持的查询字段/);
});

test("语法错误抛 DqlSyntaxError（带位置）", () => {
  assert.throws(() => engine.query("LISTE FROM #x"), DqlSyntaxError);
  assert.throws(() => engine.query("LIST FROM"), DqlSyntaxError);
});

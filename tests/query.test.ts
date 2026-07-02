import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("S2.18 端到端 LIST GROUP BY status：每组一行 + rows 数组", () => {
  const r = engine.query("LIST GROUP BY status");
  assert.deepEqual(r.columns, ["status", "rows"]);
  // 每组 rows 为该组文件路径数组（json 列已解析）。
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((row) => Array.isArray(row.rows)));
  // active 组应含 Alpha。
  const active = r.rows.find((row) => row.status === "active");
  assert.ok(active, "应有 active 分组");
  assert.ok((active.rows as string[]).includes("Projects/Alpha.md"));
});

test("S2.19 端到端 FLATTEN file.tags：标签展开为多行", () => {
  // 固定子句顺序：WHERE 先于 FLATTEN（子集简化，Dataview 灵活顺序暂不支持）。
  const r = engine.query("LIST WHERE file.name = 'Alpha' FLATTEN file.tags");
  // Alpha 有多个标签（area/work、status/active…），展开成多行，每行一个标签字符串。
  assert.ok(r.rows.length > 1, `应展开多行，实际 ${r.rows.length}`);
  assert.ok(r.rows.every((row) => typeof row["file.tags"] === "string"));
  const tags = r.rows.map((row) => row["file.tags"]);
  assert.ok(tags.includes("area/work"));
});

test("S2.19 端到端 TABLE tag 列：FLATTEN file.tags 时 tag 为展开值", () => {
  const r = engine.query(
    "TABLE file.name, tag FROM \"Projects\" WHERE file.name = 'Alpha' FLATTEN file.tags",
  );
  assert.deepEqual(r.columns, ["file.name", "tag"]);
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((row) => typeof row.tag === "string" && row.tag !== null));
  assert.ok(r.rows.some((row) => (row.tag as string).includes("/")));
});

test('FROM "" 匹配全库文件', () => {
  const all = engine.query('LIST FROM ""');
  const guides = engine.query('LIST FROM "guides"');
  assert.ok(all.rows.length > guides.rows.length);
});

test("S2.21 端到端 TASK：返回任务行（status/text/file）", () => {
  const r = engine.query("TASK");
  assert.equal(r.type, "TASK");
  assert.deepEqual(r.columns, ["task.text", "task.status", "task.due", "file.path"]);
  // fixture（Alpha.md 等）含任务行。
  assert.ok(r.rows.length > 0, "应返回任务行");
  assert.ok(r.rows.every((row) => typeof row["task.text"] === "string"));
});

test("S2.22 隐式字段全集：file.* 各字段可查且类型正确", () => {
  const r = engine.query(
    "TABLE file.folder, file.extension, file.size, file.mtime, file.ctime, file.outlinks, file.tasks " +
      "FROM \"Projects\" WHERE file.name = 'Alpha'",
  );
  const row = r.rows[0];
  assert.ok(row, "应命中 Alpha");
  assert.equal(row["file.folder"], "Projects");
  assert.equal(row["file.extension"], "md");
  assert.equal(typeof row["file.size"], "number");
  assert.equal(typeof row["file.mtime"], "number");
  assert.equal(typeof row["file.ctime"], "number");
  // outlinks/tasks 为查询期 JOIN 实时计算的聚合数组（硬约束第 6 条）。
  assert.ok(Array.isArray(row["file.outlinks"]), "outlinks 应为数组");
  assert.ok(Array.isArray(row["file.tasks"]), "tasks 应为数组");
});

test("S2.22 file.outlinks 含 embed、正向链接实时计算", () => {
  const r = engine.query("TABLE file.outlinks WHERE file.name = 'Alpha'");
  const outlinks = r.rows[0]?.["file.outlinks"] as string[];
  assert.ok(Array.isArray(outlinks));
  // Alpha 链接 Index（正向）。
  assert.ok(outlinks.some((l) => l.includes("Index")));
});

test("S2.23 SQL 注入：恶意值作为参数绑定，不破库", () => {
  // 注入意图的值经占位符绑定为字面量，不被当 SQL 执行。
  const r = engine.query('LIST WHERE status = "\'; DROP TABLE files; --"');
  assert.equal(r.rows.length, 0, "恶意值作字面比较应无命中");
  // files 表未被破坏，仍可正常查询。
  assert.ok(engine.query("LIST").rows.length > 0, "files 表应完好");
});

test("非子集字段（file.day）明确报错而非静默", () => {
  assert.throws(() => engine.query("TABLE file.day"), /不支持的查询字段/);
});

test("语法错误抛 DqlSyntaxError（带位置）", () => {
  assert.throws(() => engine.query("LISTE FROM #x"), DqlSyntaxError);
  assert.throws(() => engine.query("LIST FROM"), DqlSyntaxError);
});

test("分页：不带 size 时返回全部，total=行数、hasMore=false（向后兼容）", () => {
  const r = engine.query('LIST FROM "" SORT file.name ASC');
  assert.equal(r.total, r.rows.length);
  assert.equal(r.returned, r.rows.length);
  assert.equal(r.offset, 0);
  assert.equal(r.hasMore, false);
  assert.equal(r.size, undefined);
});

test("分页：size/offset 切窗口，total 恒为命中总数、顺序与全量一致", () => {
  const full = engine.query('LIST FROM "" SORT file.name ASC');
  const N = full.rows.length;
  assert.ok(N >= 3, "fixture 应有 ≥3 篇便于分页");
  const names = full.rows.map((row) => row["file.name"]);

  const p0 = engine.query('LIST FROM "" SORT file.name ASC', { size: 2, offset: 0 });
  assert.equal(p0.total, N);
  assert.equal(p0.size, 2);
  assert.equal(p0.returned, 2);
  assert.equal(p0.hasMore, N > 2);
  assert.deepEqual(
    p0.rows.map((row) => row["file.name"]),
    names.slice(0, 2),
  );

  const p1 = engine.query('LIST FROM "" SORT file.name ASC', { size: 2, offset: 2 });
  assert.equal(p1.offset, 2);
  assert.deepEqual(
    p1.rows.map((row) => row["file.name"]),
    names.slice(2, 4),
  );
});

test("分页：size=0 只回 total 不取行；offset 越界返回空页", () => {
  const N = engine.query('LIST FROM ""').total;
  const c = engine.query('LIST FROM ""', { size: 0 });
  assert.equal(c.total, N);
  assert.equal(c.returned, 0);
  assert.equal(c.rows.length, 0);
  assert.equal(c.hasMore, N > 0);

  const over = engine.query('LIST FROM ""', { size: 5, offset: N + 10 });
  assert.equal(over.total, N);
  assert.equal(over.returned, 0);
  assert.equal(over.hasMore, false);
});

test("分页：count() GROUP BY 一次取总量（各组求和=全库文件数）", () => {
  const groups = engine.query('TABLE count() FROM "" GROUP BY file.extension');
  const sum = groups.rows.reduce((a, row) => a + Number(row["count()"]), 0);
  assert.equal(sum, engine.query('LIST FROM ""').total);
});

// === 2026-07-01 S2.15b：一元 !/裸字段真值 端到端（对标官方 isTruthy） ===

test("裸字段真值：WHERE status → 有 status 的 3 篇；!status → 缺的 2 篇", () => {
  const has = engine.query("LIST WHERE status");
  assert.equal(has.total, 3);
  assert.deepEqual(has.rows.map((r) => r["file.name"]).toSorted(), ["Alpha", "Beta", "Index"]);
  const missing = engine.query("LIST WHERE !status");
  assert.equal(missing.total, 2);
  assert.deepEqual(missing.rows.map((r) => r["file.name"]).toSorted(), ["2026-06-25", "Concepts"]);
});

test("本 fixture 无 falsy 值：status != null=3 与 = null=2 与真值一致", () => {
  assert.equal(engine.query("LIST WHERE status != null").total, 3);
  assert.equal(engine.query("LIST WHERE status = null").total, 2);
});

test("真值 vs =null 分歧：present-but-falsy（flag:0）——!flag 视为无、!=null 视为有", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-truthy-"));
  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "on.md"), "---\nflag: true\n---\n# on\n");
  writeFileSync(join(vault, "zero.md"), "---\nflag: 0\n---\n# zero\n");
  writeFileSync(join(vault, "none.md"), "---\ntitle: none\n---\n# none\n");
  const db = join(dir, "i.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath: db });
  await idx.rebuild();
  idx.close();
  const e = new DataviewEngine(db);
  try {
    assert.equal(e.query("LIST WHERE flag").total, 1); // 仅 flag:true（0 为 falsy）
    assert.equal(e.query("LIST WHERE !flag").total, 2); // zero + none
    assert.equal(e.query("LIST WHERE flag != null").total, 2); // true + 0（0 是「有值」）
    assert.equal(e.query("LIST WHERE flag = null").total, 1); // 仅 none
  } finally {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === 2026-07-02：file.frontmatter 存在性 端到端（对治场景库 messy/no-index-count 坐实的缺口）===
// 三篇对照：有键 / 空 `---\n---` / 完全无 `---`——索引层空与无归一存同一个 '{}'（已知限制，见
// docs/plans/2026-07-02-deterministic-eval-gaps.md），故「无 frontmatter」定义为「无任意顶层键」，
// 空围栏与完全无围栏在此定义下**同归为"无"**、不可再区分。

test("file.frontmatter 存在性：有键 1 篇 vs 无键（空围栏+无围栏）2 篇，四种写法互相一致", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-fm-"));
  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "keyed.md"), "---\ntitle: hello\n---\n# keyed\n");
  writeFileSync(join(vault, "empty-fence.md"), "---\n---\n# empty fence\n");
  writeFileSync(join(vault, "no-fence.md"), "# no fence\n");
  const db = join(dir, "i.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath: db });
  await idx.rebuild();
  idx.close();
  const e = new DataviewEngine(db);
  try {
    const has = e.query("LIST WHERE file.frontmatter");
    assert.equal(has.total, 1);
    assert.equal(has.rows[0]?.["file.name"], "keyed");

    const missing = e.query("LIST WHERE !file.frontmatter");
    assert.equal(missing.total, 2);
    assert.deepEqual(
      missing.rows.map((r) => r["file.name"]).toSorted(),
      ["empty-fence", "no-fence"],
    );

    // = null / != null 是同一存在性判断的另一惯用法，应与真值/!真值同集。
    assert.equal(e.query("LIST WHERE file.frontmatter = null").total, 2);
    assert.equal(e.query("LIST WHERE file.frontmatter != null").total, 1);

    // 选列：有键笔记的 frontmatter 对象含该键；无键笔记（空围栏/无围栏）均为空对象 {}（不可再区分）。
    const table = e.query('TABLE file.frontmatter FROM "" SORT file.name ASC');
    const byName = new Map(table.rows.map((r) => [r["file.name"], r["file.frontmatter"]]));
    assert.deepEqual(byName.get("keyed"), { title: "hello" });
    assert.deepEqual(byName.get("empty-fence"), {});
    assert.deepEqual(byName.get("no-fence"), {});
  } finally {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === 2026-07-02 #28 inline fields 端到端（spec §1 目标：只有 inline 元数据的笔记可查）===

/** 建临时 vault 并全量建索引，返回只读引擎与清理句柄（inline fields 用例共用）。 */
async function setupInlineVault(
  files: Record<string, string>,
): Promise<{ engine: DataviewEngine; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-inline-"));
  const vault = join(dir, "vault");
  mkdirSync(vault, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(vault, name), content);
  const db = join(dir, "i.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath: db });
  await idx.rebuild();
  idx.close();
  const e = new DataviewEngine(db);
  return {
    engine: e,
    cleanup: () => {
      e.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('#28 只有 inline 字段的笔记可查：WHERE rating / rating > "4" / TABLE 选列 / 大小写归一', async () => {
  const { engine: e, cleanup } = await setupInlineVault({
    "book1.md": "# 三体\nrating:: 5\n",
    "book2.md": "# 基地\nrating:: 3\n",
    "plain.md": "# 无字段\n",
  });
  try {
    assert.equal(e.query("LIST WHERE rating").total, 2);
    const top = e.query('TABLE rating WHERE rating > "4"');
    assert.equal(top.total, 1);
    assert.equal(top.rows[0]?.["file.name"], "book1");
    assert.equal(top.rows[0]?.rating, "5"); // v1 恒 TEXT（D2），字典序比较
    // 查询字段大小写经 key_norm 归一命中 inline（fm 侧 json path 保留原大小写）。
    assert.equal(e.query("LIST WHERE RATING").total, 2);
  } finally {
    cleanup();
  }
});

test("#28 D1 优先级：frontmatter 与 inline 同名时 frontmatter 胜，缺键兜底 inline；存在性/真值把 inline 算进", async () => {
  const { engine: e, cleanup } = await setupInlineVault({
    "both.md": "---\nstatus: fm-wins\n---\nstatus:: inline-loses\n",
    "only-inline.md": "status:: inline-only\n",
    "neither.md": "# 无\n",
  });
  try {
    const t = e.query('TABLE status FROM ""');
    const byName = new Map(t.rows.map((r) => [r["file.name"], r.status]));
    assert.equal(byName.get("both"), "fm-wins");
    assert.equal(byName.get("only-inline"), "inline-only");
    assert.equal(byName.get("neither"), null);
    // 存在性（= null / != null）与真值（裸字段 / !field）均把 inline 算作「有」。
    assert.equal(e.query("LIST WHERE status != null").total, 2);
    assert.equal(e.query("LIST WHERE status = null").total, 1);
    assert.equal(e.query("LIST WHERE status").total, 2);
    assert.equal(e.query("LIST WHERE !status").total, 1);
  } finally {
    cleanup();
  }
});

test("#28 last-wins 端到端 + 值注入对抗：value 含 SQL 片段仅作字面数据；未知 file.* 字段仍报错", async () => {
  const { engine: e, cleanup } = await setupInlineVault({
    "multi.md": "k:: a\nk:: b\n",
    "evil.md": "attack:: '; DROP TABLE files; --\n",
  });
  try {
    const t = e.query("TABLE k WHERE k");
    assert.equal(t.total, 1);
    assert.equal(t.rows[0]?.k, "b"); // 同名 key 提取期 last-wins（D3）
    const ev = e.query("TABLE attack WHERE attack != null");
    assert.equal(ev.total, 1);
    assert.equal(ev.rows[0]?.attack, "'; DROP TABLE files; --");
    assert.ok(e.query("LIST").rows.length > 0, "files 表应完好（inline 值恒为数据）");
    // 白名单之外的 file.* 未知字段路径不受 #28 影响，仍显式报错。
    assert.throws(() => e.query("TABLE file.day"), DqlSyntaxError);
  } finally {
    cleanup();
  }
});

// === DataviewEngine.list（chat list 工具的执行层：按 folder/tag/name 过滤 + 分页，复用样例 Vault）===

test("list：无过滤返回全部文件（含 folder/mtime），按 path 排序", () => {
  const r = engine.list();
  assert.equal(r.total, 5);
  assert.equal(r.returned, 5);
  assert.equal(r.hasMore, false);
  assert.deepEqual(
    r.files.map((f) => f.path),
    ["Daily/2026-06-25.md", "Index.md", "Notes/Concepts.md", "Projects/Alpha.md", "Projects/Beta.md"],
  );
  assert.ok(r.files.every((f) => typeof f.mtime === "number" && typeof f.folder === "string"));
});

test("list：folder 前缀过滤（含子目录）", () => {
  const r = engine.list({ folder: "Projects" });
  assert.deepEqual(r.files.map((f) => f.name).toSorted(), ["Alpha", "Beta"]);
});

test("list：tag 前缀语义（area 命中 area/work 等嵌套标签）", () => {
  const r = engine.list({ tag: "area" });
  assert.deepEqual(r.files.map((f) => f.name).toSorted(), ["2026-06-25", "Alpha", "Concepts", "Index"]);
});

test("list：tag 精确匹配非嵌套（project 命中 Alpha/Beta，不误命中其他）", () => {
  const r = engine.list({ tag: "project" });
  assert.deepEqual(r.files.map((f) => f.name).toSorted(), ["Alpha", "Beta"]);
});

test("list：name 子串不区分大小写", () => {
  const r = engine.list({ name: "alpha" });
  assert.deepEqual(r.files.map((f) => f.name), ["Alpha"]);
});

test("list：folder+tag 组合 AND", () => {
  const r = engine.list({ folder: "Projects", tag: "status/done" });
  assert.deepEqual(r.files.map((f) => f.name), ["Beta"]);
});

test("list：分页 total/hasMore 独立于窗口大小", () => {
  const r = engine.list({}, { size: 2 });
  assert.equal(r.total, 5);
  assert.equal(r.size, 2);
  assert.equal(r.returned, 2);
  assert.equal(r.hasMore, true);
});

test("list：size=0 只回 total，不取行", () => {
  const r = engine.list({}, { size: 0 });
  assert.equal(r.total, 5);
  assert.equal(r.returned, 0);
  assert.deepEqual(r.files, []);
});

test("list：无命中返回空数组（非报错）", () => {
  const r = engine.list({ folder: "NoSuchFolder" });
  assert.equal(r.total, 0);
  assert.deepEqual(r.files, []);
  assert.equal(r.hasMore, false);
});

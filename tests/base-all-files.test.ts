/**
 * Bases P3 片二端到端测试：all-files 数据源（files ∪ vault_entries）+ conformance 开关。
 *
 * 建库模式照 tests/base-engine.test.ts：VaultIndexer rebuild 到临时库 → close → BaseEngine 只读。
 * 三类库：
 * - fixture 库（tests/fixtures/bases/p1/vault，7 篇 .md + 16 个附件）——行数/合并序/embed 命中；
 * - 临时 vault 库（2 笔记 + 2 附件 + 1 个 .base 视图文件）——file 字段逐字段断言/filter/sort/maxRows；
 * - 手工旧库（无 vault_entries 表，照 tests/fts.test.ts 手工建表模式）——降级与 markdown 零感知。
 *
 * 编号可追溯至 docs/testing/2026-07-22-bases-scenario-matrix.md §6（BASE-ALL-001/002）
 * 与 docs/plans/2026-07-27-bases-p3-attachments.md「片二」节。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  BASE_RULES,
  BaseEngine,
  type BaseConformance,
  type BaseQueryResult,
} from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const fixtureVault = fileURLToPath(new URL("./fixtures/bases/p1/vault", import.meta.url));

let tmpDir: string;
let fixtureDb: string; // fixture vault（7 .md + 16 附件）
let avault: string; // 临时 vault 根
let avaultDb: string;
let legacyVault: string; // 旧式 vault（.base 真实存在，索引库手工建、无 vault_entries）
let legacyDb: string;
let engine: BaseEngine;

/** 与 indexer 写入口径一致的时间戳期望值（src/indexer/index.ts：floor + birthtime 回退）。 */
function expectedTimes(abs: string): { mtime: number; ctime: number } {
  const st = statSync(abs);
  return { mtime: Math.floor(st.mtimeMs), ctime: Math.floor(st.birthtimeMs || st.ctimeMs) };
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-all-"));

  // fixture vault 建库（含 16 个附件进 vault_entries）。
  fixtureDb = join(tmpDir, "fixture.db");
  const idx = new VaultIndexer({ vaultPath: fixtureVault, dbPath: fixtureDb });
  await idx.rebuild();
  idx.close();

  // 临时 vault：2 笔记（Note1 embed 附件 + 行内 tag）+ 2 附件 + 1 个 .base 视图文件。
  avault = join(tmpDir, "avault");
  mkdirSync(join(avault, "img"), { recursive: true });
  mkdirSync(join(avault, "views"), { recursive: true });
  writeFileSync(
    join(avault, "Note1.md"),
    "---\nstatus: active\n---\n# Note1\n\n嵌入 ![[img/pic.png]]，标签 #area。\n",
    "utf8",
  );
  writeFileSync(join(avault, "Note2.md"), "# Note2\n\n纯笔记。\n", "utf8");
  writeFileSync(join(avault, "img", "pic.png"), Buffer.alloc(2000, 1));
  writeFileSync(join(avault, "doc.pdf"), Buffer.alloc(5000, 2));
  writeFileSync(
    join(avault, "views", "all.base"),
    [
      "# all-files 模式：全 file 字段投影 + note 属性 filter + file.size 排序",
      "views:",
      "  - type: table",
      "    name: all",
      "    order:",
      "      - file.path",
      "      - file.name",
      "      - file.basename",
      "      - file.folder",
      "      - file.ext",
      "      - file.size",
      "      - file.ctime",
      "      - file.mtime",
      "      - file.tags",
      "      - file.links",
      "      - status",
      "  - type: table",
      "    name: note-filter",
      "    filters: 'status == \"active\"'",
      "    order:",
      "      - file.name",
      "  - type: table",
      "    name: size-sort",
      "    order:",
      "      - file.name",
      "      - file.size",
      "    sort:",
      "      - property: file.size",
      "        direction: DESC",
      "",
    ].join("\n"),
    "utf8",
  );
  avaultDb = join(tmpDir, "avault.db");
  const aidx = new VaultIndexer({ vaultPath: avault, dbPath: avaultDb });
  await aidx.rebuild();
  aidx.close();

  // 旧式库：vault 里放真实 .md 与 .base，但索引库手工建（files/tags/links 三表，
  // 无 vault_entries）——模拟 P3 之前的 indexer 产物。
  legacyVault = join(tmpDir, "legacy-vault");
  mkdirSync(join(legacyVault, "views"), { recursive: true });
  writeFileSync(join(legacyVault, "a.md"), "# A\n", "utf8");
  writeFileSync(
    join(legacyVault, "views", "min.base"),
    "views:\n  - type: table\n    name: main\n",
    "utf8",
  );
  legacyDb = join(tmpDir, "legacy.db");
  const raw = new Database(legacyDb);
  raw.exec(`CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    extension TEXT NOT NULL, folder TEXT NOT NULL, size INTEGER NOT NULL,
    mtime INTEGER NOT NULL, ctime INTEGER NOT NULL, frontmatter TEXT NOT NULL
  )`);
  raw.exec(
    "CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT NOT NULL, tag TEXT NOT NULL)",
  );
  raw.exec(
    "CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, target TEXT NOT NULL)",
  );
  raw
    .prepare(
      "INSERT INTO files (path,name,extension,folder,size,mtime,ctime,frontmatter) VALUES ('a.md','a','md','',10,0,0,'{}')",
    )
    .run();
  raw.close();

  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** fixture 库查询便捷入口。 */
function queryFixture(base: string, extra?: { conformance?: BaseConformance }): BaseQueryResult {
  return engine.query({
    basePath: join(fixtureVault, "views", base),
    dbPath: fixtureDb,
    vaultRoots: [fixtureVault],
    ...extra,
  });
}

/** 临时 vault 查询便捷入口（view 名在 all.base 内）。 */
function queryA(
  view: string,
  extra?: { conformance?: BaseConformance; maxRows?: number },
): BaseQueryResult {
  const { maxRows, ...rest } = extra ?? {};
  return engine.query({
    basePath: join(avault, "views", "all.base"),
    view,
    dbPath: avaultDb,
    vaultRoots: [avault],
    ...(maxRows !== undefined ? { limits: { maxRows } } : {}),
    ...rest,
  });
}

/** 结果中的 error 级诊断。 */
function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** 结果的诊断 rule 列表（按出现顺序）。 */
function rulesOf(r: BaseQueryResult): string[] {
  return r.diagnostics.map((d) => d.rule);
}

// ---------- BASE-ALL-001：附件作为行 ----------

// BASE-ALL-001：all-files 模式附件（图片/PDF/.base）作为行——file fields 逐字段正确、
// note fields 缺失（投影 null）、合并集全局 path ASC
test("BASE-ALL-001: all-files 附件为行，file fields 可用、note fields 缺失、合并序 path ASC", () => {
  const r = queryA("all", { conformance: "bases-all-files-2026-07" });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.conformance, "bases-all-files-2026-07");
  // 行总数 = files（2）+ vault_entries（pic.png + doc.pdf + views/all.base = 3）= 5。
  assert.equal(r.total, 5);
  assert.equal(r.rows.length, 5);

  // 合并序全局 path ASC（无显式 sort → file.path ASC tie-break；ASCII：大写 N 先于小写 d/i/v）。
  const paths = r.rows.map((row) => String(row["file.path"]));
  assert.deepEqual(paths, ["Note1.md", "Note2.md", "doc.pdf", "img/pic.png", "views/all.base"]);

  const png = r.rows.find((row) => row["file.path"] === "img/pic.png");
  assert.ok(png !== undefined);
  assert.equal(png["file.name"], "pic.png");
  assert.equal(png["file.basename"], "pic");
  assert.equal(png["file.folder"], "img");
  assert.equal(png["file.ext"], ".png");
  assert.equal(png["file.size"], statSync(join(avault, "img", "pic.png")).size);
  const pngTimes = expectedTimes(join(avault, "img", "pic.png"));
  assert.equal(png["file.mtime"], pngTimes.mtime);
  assert.equal(png["file.ctime"], pngTimes.ctime);
  assert.deepEqual(png["file.tags"], []);
  assert.deepEqual(png["file.links"], []);
  assert.equal(png["status"], null, "附件行 note 属性缺失 → 投影 null");

  const pdf = r.rows.find((row) => row["file.path"] === "doc.pdf");
  assert.ok(pdf !== undefined);
  assert.equal(pdf["file.name"], "doc.pdf");
  assert.equal(pdf["file.folder"], "");
  assert.equal(pdf["file.ext"], ".pdf");
  assert.equal(pdf["file.size"], 5000);
  assert.equal(pdf["status"], null);

  const baseRow = r.rows.find((row) => row["file.path"] === "views/all.base");
  assert.ok(baseRow !== undefined, ".base 文件自身也是附件行");
  assert.equal(baseRow["file.ext"], ".base");
  assert.equal(baseRow["file.basename"], "all");
  assert.equal(baseRow["status"], null);

  // 笔记行不受影响：note 属性 / tags / links 照常。
  const note1 = r.rows.find((row) => row["file.path"] === "Note1.md");
  assert.ok(note1 !== undefined);
  assert.equal(note1["status"], "active");
  assert.deepEqual(note1["file.tags"], ["area"]);
  assert.deepEqual(note1["file.links"], ["img/pic.png"]);
});

// BASE-ALL-001（行数口径）：fixture vault 行总数 = files（7）+ vault_entries（16）
test("BASE-ALL-001(fixture): 行总数 = files + vault_entries，合并序全局 path ASC", () => {
  const r = queryFixture("default.base", { conformance: "bases-all-files-2026-07" });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 23); // 7 篇 .md + 16 个附件
  // 无显式 sort 的 file.path 投影：全局 path ASC（files ∪ vault_entries 内存合并序）。
  const r2 = queryFixture("nosort.base", { conformance: "bases-all-files-2026-07" });
  const paths = r2.rows.map((row) => String(row["file.path"]));
  const sorted = paths.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(paths, sorted);
  assert.ok(paths.includes("assets/cover.png"));
  assert.ok(paths.includes("note.pdf"));
  assert.ok(paths.includes("standalone.base"));
});

// ---------- BASE-ALL-002：附件链接口径 ----------

// BASE-ALL-002：附件行出链恒 []（不伪造内容链接）；附件作为链接 target 的命中关系可查询——
// 笔记行 file.links 含附件原始 target 文本，embed ![[...]] 命中（is_embed=1 计入口径不变）
test("BASE-ALL-002: 附件行 links/tags 恒 []，笔记行 file.links 含附件 embed 原始 target", () => {
  // 附件行出链/标签恒 []（临时 vault，全字段投影）。
  const r = queryA("all", { conformance: "bases-all-files-2026-07" });
  for (const row of r.rows) {
    if (!String(row["file.name"]).endsWith(".md")) {
      assert.deepEqual(row["file.links"], [], `附件行出链恒 []：${String(row["file.path"])}`);
      assert.deepEqual(row["file.tags"], []);
    }
  }
  // embed 命中关系：file.hasLink 按原始 target 命中附件（fixture Alpha.md embed assets/cover.png）。
  const embed = engine.query({
    basePath: join(fixtureVault, "views", "files.base"),
    view: "haslink-embed",
    dbPath: fixtureDb,
    vaultRoots: [fixtureVault],
    conformance: "bases-all-files-2026-07",
  });
  assert.deepEqual(errorsOf(embed), []);
  assert.equal(embed.total, 1);
  assert.equal(embed.rows[0]?.["file.name"], "Alpha.md");
});

// ---------- conformance 开关 ----------

// 缺省 = markdown：附件不为行、md-only warning 照发（BASE-DATA-001/002 零回归的补充锁定）
test("conformance 缺省 = markdown：附件不为行且 md-only warning 照发", () => {
  const r = queryFixture("default.base");
  assert.equal(r.conformance, "bases-markdown-2026-07");
  assert.equal(r.total, 7);
  for (const row of r.rows) {
    assert.ok(
      String(row["file.name"]).endsWith(".md"),
      `附件不应为行：${String(row["file.name"])}`,
    );
  }
  assert.ok(rulesOf(r).includes(BASE_RULES.markdownOnlyDataset));
});

// 显式 all-files：不发 markdownOnlyDataset warning
test("conformance 显式 all-files：不发 markdownOnlyDataset warning", () => {
  const r = queryFixture("default.base", { conformance: "bases-all-files-2026-07" });
  assert.equal(r.conformance, "bases-all-files-2026-07");
  assert.ok(!rulesOf(r).includes(BASE_RULES.markdownOnlyDataset));
});

// 未知 conformance id → base/invalid-schema（error）+ 空结果（不新增 rule，复用配置形状口径）
test("未知 conformance id → invalid-schema error 与空结果", () => {
  const r = queryFixture("default.base", {
    conformance: "bogus" as BaseConformance,
  });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  const errors = r.diagnostics.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.rule, BASE_RULES.invalidSchema);
  assert.equal(errors[0]?.reason, "unknown_conformance");
  assert.match(errors[0]?.message ?? "", /未知 conformance id/);
});

// ---------- 旧库降级 ----------

// 降级：无 vault_entries 表的旧库 → all-files 按 md-only 出结果 + compat warning，不崩；
// 回传实际生效口径 markdown
test("旧库无 vault_entries 表：all-files 降级 md-only + compat warning，不崩", () => {
  const r = engine.query({
    basePath: join(legacyVault, "views", "min.base"),
    dbPath: legacyDb,
    vaultRoots: [legacyVault],
    conformance: "bases-all-files-2026-07",
  });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1); // 仅手工插入的 a.md（md-only 行为）
  assert.equal(r.rows[0]?.["file.name"], "a.md");
  assert.equal(r.conformance, "bases-markdown-2026-07", "回传实际生效口径");
  const degraded = r.diagnostics.find((d) => d.reason === "all_files_degraded_no_vault_entries");
  assert.ok(degraded !== undefined);
  assert.equal(degraded.severity, "warning");
  assert.equal(degraded.rule, BASE_RULES.unsupportedFeature);
  // 降级后按 md-only 执行，md-only 声明 warning 照发。
  assert.ok(rulesOf(r).includes(BASE_RULES.markdownOnlyDataset));
});

// markdown 模式对同一旧库零感知：不查 vault_entries 存在性，无降级诊断
test("旧库无 vault_entries 表：markdown 模式零感知（无降级诊断）", () => {
  const r = engine.query({
    basePath: join(legacyVault, "views", "min.base"),
    dbPath: legacyDb,
    vaultRoots: [legacyVault],
  });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1);
  assert.ok(!rulesOf(r).includes(BASE_RULES.unsupportedFeature));
  assert.ok(rulesOf(r).includes(BASE_RULES.markdownOnlyDataset));
});

// ---------- filter / sort / maxRows ----------

// all-files 下 note 属性 filter：附件行 note 属性 MISSING 传播为假值被排除，不崩、无行级错误
test("all-files 下 note 属性 filter：附件行 MISSING 传播不崩", () => {
  const r = queryA("note-filter", { conformance: "bases-all-files-2026-07" });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1); // 仅 Note1.md（status == "active"）
  assert.equal(r.rows[0]?.["file.name"], "Note1.md");
  // MISSING == "active" 为 false，非类型错误：不应产生行级 property-type-mismatch 诊断。
  assert.ok(!rulesOf(r).includes(BASE_RULES.propertyTypeMismatch));
});

// all-files 下按 file.size 排序：笔记/附件混排正确（DESC + file.path tie-break）
test("all-files 下 file.size 排序：笔记/附件混排正确", () => {
  const r = queryA("size-sort", { conformance: "bases-all-files-2026-07" });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 5);
  const sizes = r.rows.map((row) => Number(row["file.size"]));
  const sorted = sizes.toSorted((a, b) => b - a);
  assert.deepEqual(sizes, sorted, "file.size DESC 混排");
  // 头两名是大附件（doc.pdf 5000 > pic.png 2000），笔记在尾部——混排确为跨类型。
  assert.equal(r.rows[0]?.["file.name"], "doc.pdf");
  assert.equal(r.rows[1]?.["file.name"], "pic.png");
});

// maxRows：all-files 对 files ∪ vault_entries 合并集计数截断（与 md-only 单侧口径不同）
test("maxRows：all-files 对合并集截断（markdown 同预算可通过）", () => {
  // 合并集 5 行（2 笔记 + 3 附件）：maxRows=4 时 markdown（2 行）通过、all-files 预算耗尽。
  const md = queryA("all", { maxRows: 4 });
  assert.deepEqual(errorsOf(md), []);
  assert.equal(md.total, 2);
  const all = queryA("all", { conformance: "bases-all-files-2026-07", maxRows: 4 });
  const budget = all.diagnostics.find((d) => d.rule === BASE_RULES.executionBudget);
  assert.ok(budget !== undefined);
  assert.equal(budget.severity, "error");
  assert.deepEqual(all.rows, []);
  assert.equal(all.total, 0);
});

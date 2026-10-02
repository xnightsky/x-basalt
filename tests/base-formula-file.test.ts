/**
 * R08：公式关联读取经真实索引与引擎验证，不以函数单测代替上下文接线。
 * BASE-FORM-FILE-001..016 对应顺序清理计划的公式/数据集/预算/CLI 验收边界。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import {
  BASE_RULES,
  BaseEngine,
  type BaseQueryOptions,
  type BaseQueryResult,
} from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
let dir: string;
let vault: string;
let dbPath: string;
let engine: BaseEngine;
const refs = { follow: 'ref.asFile().properties["estimate"]' };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "xb-formula-file-"));
  vault = join(dir, "vault");
  dbPath = join(dir, "index.db");
  const notes: [string, Record<string, unknown>][] = [
    ["a/Alpha.md", { estimate: 8, ref: "[[b/Beta|决策]]", target: "b/Beta.md" }],
    ["b/Beta.md", { estimate: 21, ref: "[[Gamma]]", target: "Gamma.md" }],
    ["Gamma.md", { estimate: 5, ref: "[[a/Alpha]]", target: "a/Alpha.md" }],
    ["a/Dupe.md", { estimate: 11 }],
    ["z/Dupe.md", { estimate: 13 }],
  ];
  for (const [path, data] of notes) {
    const file = join(vault, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${stringify(data)}---\n正文保留。\n`);
  }
  writeFileSync(join(vault, "asset.pdf"), "synthetic attachment");
  writeFileSync(join(dir, "outside.md"), "---\nestimate: 999\n---\n");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath });
  await idx.rebuild();
  idx.close();
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(dir, { recursive: true, force: true });
});

function source(
  formulas: Record<string, string>,
  view: Record<string, unknown> = {},
  top: Record<string, unknown> = {},
): string {
  return stringify({
    formulas,
    ...top,
    views: [{ type: "table", name: "Read", order: ["file.path", "formula.follow"], ...view }],
  });
}
function query(text: string, extra: Partial<BaseQueryOptions> = {}): BaseQueryResult {
  return engine.query({ source: text, dbPath, vaultRoots: [vault], ...extra });
}
function clean(r: BaseQueryResult): void {
  assert.deepEqual(
    r.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.ok(!r.diagnostics.some((d) => d.rule === BASE_RULES.unsupportedFeature));
}
function values(r: BaseQueryResult, column = "formula.follow"): Record<string, unknown> {
  return Object.fromEntries(r.rows.map((row) => [row["file.path"], row[column]]));
}

test("BASE-FORM-FILE-001: file() 公式投影读到关联属性而不是 unsupported/null", () => {
  const r = query(source({ follow: 'file("b/Beta.md").properties["estimate"]' }));
  assert.equal(r.total, 5);
  for (const row of r.rows) assert.equal(row["formula.follow"], 21);
  clean(r);
});

test("BASE-FORM-FILE-002: frontmatter link.asFile() 按当前行读取，不串行缓存", () => {
  const r = query(source(refs));
  assert.deepEqual(values(r), {
    "Gamma.md": 8,
    "a/Alpha.md": 21,
    "a/Dupe.md": null,
    "b/Beta.md": 5,
    "z/Dupe.md": null,
  });
  clean(r);
});

test("BASE-FORM-FILE-003: 公式用于 filter，关联目标可位于过滤后行集之外", () => {
  const r = query(source(refs, { filters: 'file.path == "a/Alpha.md" && formula.follow == 21' }));
  assert.deepEqual(values(r), { "a/Alpha.md": 21 });
  clean(r);
});

test("BASE-FORM-FILE-004: 关联公式排序在 limit 前执行，空值保持最后", () => {
  const r = query(
    source(refs, { sort: [{ property: "formula.follow", direction: "DESC" }], limit: 3 }),
  );
  assert.equal(r.total, 5);
  assert.deepEqual(
    r.rows.map((row) => row["file.path"]),
    ["a/Alpha.md", "Gamma.md", "b/Beta.md"],
  );
  clean(r);
});

test("BASE-FORM-FILE-005: 关联公式作为分组键与内置汇总目标", () => {
  const r = query(
    source(refs, {
      groupBy: { property: "formula.follow", direction: "ASC" },
      summaries: { "formula.follow": "Sum" },
    }),
  );
  assert.deepEqual(
    r.groups?.map((g) => [g.key, g.rows.length]),
    [
      [5, 1],
      [8, 1],
      [21, 1],
      [null, 2],
    ],
  );
  assert.equal(r.summaries?.["formula.follow"], 34);
  assert.equal(r.groups?.[2]?.summaries?.["formula.follow"], 21);
  clean(r);
});

test("BASE-FORM-FILE-006: 关联公式依赖与 YAML 声明顺序无关", () => {
  const r = query(
    source({ twice: "formula.follow * 2", ...refs }, { order: ["file.path", "formula.twice"] }),
  );
  assert.deepEqual(values(r, "formula.twice"), {
    "Gamma.md": 16,
    "a/Alpha.md": 42,
    "a/Dupe.md": null,
    "b/Beta.md": 10,
    "z/Dupe.md": null,
  });
  clean(r);
});

test("BASE-FORM-FILE-007: 精确路径、pathKey 与歧义 basename 沿用现解析策略", () => {
  for (const [target, expected] of [
    ["z/Dupe.md", 13],
    ["Z/DUPE", 13],
    ["Dupe", 11],
  ] as const) {
    const r = query(source({ follow: `file(${JSON.stringify(target)}).properties["estimate"]` }));
    for (const row of r.rows) assert.equal(row["formula.follow"], expected, target);
    clean(r);
  }
});

test("BASE-FORM-FILE-008: 多根命名空间路径在公式内解析", async () => {
  const roots = [join(vault, "a"), join(vault, "z")];
  const multiDb = join(dir, "multi.db");
  const idx = new VaultIndexer({ vaultPath: roots, dbPath: multiDb });
  await idx.rebuild();
  idx.close();
  const r = query(source({ follow: 'link("z/Dupe").asFile().properties["estimate"]' }), {
    vaultRoots: roots,
    dbPath: multiDb,
  });
  assert.equal(r.total, 3);
  for (const row of r.rows) assert.equal(row["formula.follow"], 13);
  clean(r);
});

test("BASE-FORM-FILE-009: 附件解析遵循 md-only/all-files 数据集而不是额外读文件", () => {
  const text = source({ follow: 'file("asset.pdf").ext' });
  const md = query(text);
  for (const row of md.rows) assert.equal(row["formula.follow"], null);
  clean(md);
  const all = query(text, { conformance: "bases-all-files-2026-07" });
  assert.equal(all.total, 6);
  for (const row of all.rows) assert.equal(row["formula.follow"], ".pdf");
  clean(all);
});

test("BASE-FORM-FILE-010: 缺失、原型键与库外路径不读取额外内容", () => {
  for (const target of ["missing", "__proto__", "constructor", join(dir, "outside.md")]) {
    for (const lookup of [
      `file(${JSON.stringify(target)})`,
      `link(${JSON.stringify(target)}).asFile()`,
    ]) {
      const r = query(source({ follow: `${lookup}.properties["estimate"]` }));
      for (const row of r.rows) assert.equal(row["formula.follow"], null);
      clean(r);
    }
  }
});

test("BASE-FORM-FILE-011: 公式关联读取共用显式 this 与固定 clock", () => {
  const r = query(
    source(
      { follow: 'file(this.target).properties["estimate"]', stamp: "now()" },
      { order: ["file.path", "formula.follow", "formula.stamp"] },
    ),
    { contextFile: "a/Alpha.md", clock: () => new Date("2026-10-01T12:00:00.000Z") },
  );
  for (const row of r.rows) {
    assert.equal(row["formula.follow"], 21);
    assert.deepEqual(row["formula.stamp"], { type: "datetime", value: "2026-10-01T12:00:00.000Z" });
  }
  clean(r);
});

test("BASE-FORM-FILE-012: 非法 file 参数保留公式源位置，每行只报一次", () => {
  const r = query(
    source(
      { follow: "file(7)", again: "formula.follow" },
      {
        order: ["file.path", "formula.follow", "formula.again"],
        groupBy: { property: "formula.follow", direction: "ASC" },
      },
    ),
  );
  assert.equal(r.total, 5);
  const warnings = r.diagnostics.filter((d) => d.rule === BASE_RULES.propertyTypeMismatch);
  assert.equal(warnings.length, 5);
  for (const d of warnings) {
    assert.ok(d.line > 1);
    assert.match(d.message, /行：.*\.md/);
  }
  for (const row of r.rows) assert.equal(row["formula.follow"], null);
  clean(r);
});

test("BASE-FORM-FILE-013: 共享预算耗尽不返回部分公式结果", () => {
  const r = query(source(refs), { limits: { maxTotalOperations: 1 } });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.ok(
    r.diagnostics.some((d) => d.rule === BASE_RULES.executionBudget && d.severity === "error"),
  );
});

test("BASE-FORM-FILE-014: 关联读取不绕过公式循环/深度检查", () => {
  const cycle = query(
    source({
      follow: 'file("b/Beta").properties["estimate"] + formula.other',
      other: "formula.follow",
    }),
  );
  assert.deepEqual(cycle.rows, []);
  assert.ok(cycle.diagnostics.some((d) => d.rule === BASE_RULES.formulaCycle));
  const deep = query(
    source(
      { follow: 'file("b/Beta").properties["estimate"]', next: "formula.follow" },
      { order: ["formula.next"] },
    ),
    { limits: { maxFormulaDepth: 1 } },
  );
  assert.deepEqual(deep.rows, []);
  assert.ok(deep.diagnostics.some((d) => d.rule === BASE_RULES.executionBudget));
});

test("BASE-FORM-FILE-015: 未引用公式不求值，自定义汇总仍禁止行外解析", () => {
  const lazy = query(source({ ...refs, unused: "file(7)" }));
  clean(lazy);
  assert.ok(!lazy.diagnostics.some((d) => d.rule === BASE_RULES.propertyTypeMismatch));
  const summary = query(
    source(
      refs,
      { summaries: { "formula.follow": "external" } },
      { summaries: { external: 'file("b/Beta").properties["estimate"]' } },
    ),
  );
  assert.equal(summary.summaries?.["formula.follow"], null);
  assert.equal(
    summary.diagnostics.filter((d) => d.rule === BASE_RULES.unsupportedFeature).length,
    1,
  );
});

test("BASE-FORM-FILE-016: CLI stdin 真实索引返回关联公式数值", () => {
  const r = spawnSync(
    process.execPath,
    ["--import", TSX, CLI, "base", "--stdin", "--vault", vault, "--db", dbPath],
    { input: source({ follow: 'file("b/Beta").properties["estimate"]' }), encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout) as BaseQueryResult;
  assert.equal(result.total, 5);
  for (const row of result.rows) assert.equal(row["formula.follow"], 21);
  clean(result);
});

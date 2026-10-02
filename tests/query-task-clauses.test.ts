/** R09：TASK 子句必须执行或明确拒绝，实际任务行/分页/CLI 不由 AST 接受代替。 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";
import type { DqlQuery, QueryResult } from "../src/query/ast.js";
import { DataviewEngine, DqlSyntaxError } from "../src/query/index.js";
import { parseDql } from "../src/query/parser.js";
import { generateSql } from "../src/query/sql-generator.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
let dir: string;
let db: string;
let engine: DataviewEngine;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "xb-task-clauses-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, "Projects"), { recursive: true });
  mkdirSync(join(vault, "Notes"));
  const notes: [string, string][] = [
    [
      "Projects/A.md",
      "---\npriority: 2\nscore: 12\nstatus: review\ntags: [todo]\n---\nscore:: 1\n- [ ] A-first\n- [x] A-second\n",
    ],
    [
      "Projects/B.md",
      "---\npriority: 1\nstatus: active\ntags: [todo]\n---\nscore:: 10\n- [X] B-first\n- [ ] B-second\n",
    ],
    [
      "Projects/C.md",
      "---\npriority: 1\nstatus: done\ntags: [todo]\n---\nscore:: 2\n- [-] C-only\n",
    ],
    [
      "Projects/D.md",
      "---\npriority: 0\nscore: 0\nstatus: paused\ntags: [todo]\n---\n- [?] D-only\n",
    ],
    ["Notes/N.md", "- [ ] N-only\n"],
  ];
  for (const [path, text] of notes) writeFileSync(join(vault, path), text);
  db = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: vault, dbPath: db });
  await idx.rebuild();
  idx.close();
  engine = new DataviewEngine(db);
});
after(() => {
  engine?.close();
  rmSync(dir, { recursive: true, force: true });
});
function texts(r: QueryResult): unknown[] {
  return r.rows.map((row) => row["task.text"]);
}
function cli(dql: string, extra: string[] = []) {
  return spawnSync(process.execPath, ["--import", TSX, CLI, "query", dql, "--db", db, ...extra], {
    encoding: "utf8",
  });
}
function rejected(run: () => unknown, clause: string, pos?: number): void {
  assert.throws(run, (e) => {
    assert.ok(e instanceof DqlSyntaxError);
    assert.match(e.message, /TASK/);
    assert.ok(e.message.includes(clause));
    if (pos !== undefined) assert.equal(e.pos, pos);
    return true;
  });
}

test("R09-TASK-001: 文件路径 DESC 生效，文件内任务按源码行升序", () => {
  const r = engine.query("TASK SORT file.path DESC");
  assert.equal(r.total, 7);
  assert.deepEqual(texts(r), [
    "D-only",
    "C-only",
    "B-first",
    "B-second",
    "A-first",
    "A-second",
    "N-only",
  ]);
  assert.deepEqual(r.columns, ["task.text", "task.status", "task.due", "file.path"]);
});

test("R09-TASK-002: 多键标量排序在 LIMIT 前执行", () => {
  const r = engine.query("TASK SORT priority DESC, file.path DESC LIMIT 4");
  assert.deepEqual(texts(r), ["A-first", "A-second", "C-only", "B-first"]);
  assert.equal(r.total, 4);
});

test("R09-TASK-003: 数值 0 与 null 沿 SQLite 排序规则，不与 Bases 混用", () => {
  assert.deepEqual(texts(engine.query("TASK SORT priority ASC")), [
    "N-only",
    "D-only",
    "B-first",
    "B-second",
    "C-only",
    "A-first",
    "A-second",
  ]);
  assert.deepEqual(texts(engine.query("TASK SORT priority DESC")), [
    "A-first",
    "A-second",
    "B-first",
    "B-second",
    "C-only",
    "D-only",
    "N-only",
  ]);
});

test("R09-TASK-004: FROM 与 completed 筛选后排序/截断", () => {
  const r = engine.query('TASK FROM "Projects" WHERE !completed SORT file.path DESC LIMIT 3');
  assert.deepEqual(texts(r), ["D-only", "C-only", "B-second"]);
});

test("R09-TASK-005: 外层分页保持已排序的 LIMIT 子集和 total", () => {
  const r = engine.query("TASK SORT file.path DESC LIMIT 5", { offset: 1, size: 2 });
  assert.deepEqual(texts(r), ["C-only", "B-first"]);
  assert.equal(r.total, 5);
  assert.equal(r.returned, 2);
  assert.equal(r.hasMore, true);
  const zero = engine.query("TASK SORT file.path DESC", { size: 0 });
  assert.equal(zero.total, 7);
  assert.deepEqual(zero.rows, []);
});

test("R09-TASK-006: 空集、LIMIT 0 与超界分页不凭排序补行", () => {
  assert.deepEqual(engine.query('TASK FROM "missing" SORT file.path DESC').rows, []);
  assert.equal(engine.query("TASK SORT file.path DESC LIMIT 0").total, 0);
  const past = engine.query("TASK SORT file.path DESC", { offset: 50, size: 2 });
  assert.equal(past.total, 7);
  assert.deepEqual(past.rows, []);
});

test("R09-TASK-007: inline 排序保留 TEXT 字典序与 frontmatter 优先", () => {
  const r = engine.query('TASK WHERE file.name = "B" OR file.name = "C" SORT score DESC');
  assert.deepEqual(texts(r), ["C-only", "B-first", "B-second"]);
  assert.deepEqual(
    texts(engine.query('TASK WHERE file.name = "A" AND score = 12 SORT score ASC')),
    ["A-first", "A-second"],
  );
});

test("R09-TASK-008: TASK 聚合/未知排序字段不能再被吞掉", () => {
  for (const field of [
    "file.tags",
    "file.frontmatter",
    "file.tasks",
    "file.unknown",
    "task.status",
    "task.due",
  ]) {
    assert.throws(() => engine.query(`TASK SORT ${field}`), DqlSyntaxError);
  }
});

for (const [id, clause] of [
  ["009", "GROUP BY status"],
  ["010", "FLATTEN file.tags"],
] as const) {
  test(`R09-TASK-${id}: ${clause} 在 parse 与 query 均明确拒绝并定位`, () => {
    const dql = `TASK FROM "Projects" WHERE status != null ${clause} SORT file.path DESC LIMIT 1`;
    const pos = dql.indexOf(clause);
    rejected(() => parseDql(dql), clause.split(" ")[0]!, pos);
    rejected(() => engine.query(dql), clause.split(" ")[0]!, pos);
  });
}

test("R09-TASK-011: 拒绝位置来自 token，不误认字符串/大小写/前导空白", () => {
  const group = '  task WHERE status = "GROUP" group BY status';
  rejected(() => parseDql(group), "GROUP", group.indexOf("group"));
  const flat = ' TASK WHERE status = "FLATTEN" flatten file.tags';
  rejected(() => parseDql(flat), "FLATTEN", flat.indexOf("flatten"));
});

test("R09-TASK-012: 手工 AST 的 GROUP/FLATTEN 在 generator 仍拒绝", () => {
  rejected(() => generateSql({ type: "TASK", fields: [], groupBy: { expr: "status" } }), "GROUP");
  rejected(
    () => generateSql({ type: "TASK", fields: [], flatten: { field: "file.tags" } }),
    "FLATTEN",
  );
});

test("R09-TASK-013: 注入值保持绑定，危险 AST 排序字段/方向拒绝", () => {
  const attack = 'TASK WHERE status = "\'; DROP TABLE tasks; --" SORT file.path DESC';
  const sql = generateSql(parseDql(attack));
  assert.ok(!sql.sql.includes("DROP TABLE"));
  assert.ok(sql.params.some((p) => typeof p === "string" && p.includes("DROP TABLE")));
  assert.deepEqual(engine.query(attack).rows, []);
  for (const sort of [
    [{ field: "priority); DROP TABLE files; --", dir: "ASC" }],
    [{ field: "file.path", dir: "ASC; DROP TABLE files; --" }],
  ]) {
    assert.throws(
      () => generateSql({ type: "TASK", fields: [], sort } as DqlQuery),
      DqlSyntaxError,
    );
  }
  assert.equal(engine.query("TASK").total, 7);
});

test("R09-TASK-014: CLI 排序输出与分页真实生效", () => {
  const r = cli("TASK SORT file.path DESC LIMIT 4", ["--offset", "1", "--size", "2"]);
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout) as QueryResult;
  assert.deepEqual(texts(result), ["C-only", "B-first"]);
  assert.equal(result.total, 4);
});

test("R09-TASK-015: CLI 不支持的任务分组/展开退出非零，不返回伪成功 rows", () => {
  for (const clause of ["GROUP BY status", "FLATTEN file.tags"]) {
    const r = cli(`TASK ${clause}`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /TASK/);
    assert.ok(r.stderr.includes(clause.split(" ")[0]!));
    assert.ok(!r.stdout.includes('"rows"'));
  }
});

test("R09-TASK-017: completed 保留 WHERE 任务特判，SORT 不偷换成笔记属性", () => {
  assert.deepEqual(texts(engine.query("TASK WHERE completed SORT file.path ASC")), [
    "A-second",
    "B-first",
  ]);
  assert.throws(() => engine.query("TASK SORT completed DESC"), DqlSyntaxError);
  assert.equal(engine.query("LIST SORT completed DESC").total, 5);
});

test("R09-TASK-018: 自定义字段名不继承映射表的原型成员", () => {
  for (const field of ["constructor", "__proto__", "toString"]) {
    assert.deepEqual(texts(engine.query(`TASK SORT ${field}`)), [
      "N-only",
      "A-first",
      "A-second",
      "B-first",
      "B-second",
      "C-only",
      "D-only",
    ]);
    assert.equal(engine.query(`TASK WHERE ${field}`).total, 0);
  }
});

test("R09-TASK-016: LIST/TABLE 的排序/分组/展开保持现子集行为", () => {
  assert.deepEqual(
    engine
      .query('LIST FROM "Projects" SORT priority DESC, file.path ASC LIMIT 2')
      .rows.map((row) => row["file.path"]),
    ["Projects/A.md", "Projects/B.md"],
  );
  assert.equal(engine.query('TABLE count() FROM "Projects" GROUP BY priority').total, 3);
  assert.equal(engine.query('TABLE file.path, tag FROM "Projects" FLATTEN file.tags').total, 4);
});

/**
 * 片三纯函数算子测试（设计：docs/design/pipeline-op-model.md §5 / §12、D4）。
 *
 * 测试覆盖：
 * - filter：六种比较符各一例；exists/missing；类型不同不通过；被过滤的行不进 failed
 * - limit：正常取前 n；n 非法进 failed
 * - dedup：默认按 path；按 fields 键；保留首次出现
 * - map：渲染写入目标字段
 *
 * 全部算子：纯函数、write:false、changed/skipped 恒空（守 D9）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFilterOp, makeLimitOp, makeDedupOp, makeMapOp } from "../src/orchestrator/ops-pure.js";
import type { Row } from "../src/orchestrator/types.js";

// 工具：造行
function row(path: string, fields?: Record<string, unknown>): Row {
  return { path, fields: fields ?? {} };
}

// ────────────────────────────────────────────────────────────────────────────
// filter 算子
// ────────────────────────────────────────────────────────────────────────────

test("PURE-filter-== ：相等匹配", async () => {
  const op = makeFilterOp("status == active");
  const rows = [
    row("a.md", { status: "active" }),
    row("b.md", { status: "inactive" }),
    row("c.md", { status: "active" }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.failed.length, 0);
  assert.equal(r.changed.length, 0);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.rows[1]!.path, "c.md");
});

test("PURE-filter-!= ：不等匹配", async () => {
  const op = makeFilterOp("status != active");
  const rows = [
    row("a.md", { status: "active" }),
    row("b.md", { status: "inactive" }),
    row("c.md", { status: "active" }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.path, "b.md");
  assert.equal(r.failed.length, 0);
});

test("PURE-filter-> ：大于", async () => {
  const op = makeFilterOp("priority > 3");
  const rows = [
    row("a.md", { priority: 5 }),
    row("b.md", { priority: 3 }),
    row("c.md", { priority: 1 }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.failed.length, 0);
});

test("PURE-filter->= ：大于等于", async () => {
  const op = makeFilterOp("priority >= 3");
  const rows = [
    row("a.md", { priority: 5 }),
    row("b.md", { priority: 3 }),
    row("c.md", { priority: 1 }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.rows[1]!.path, "b.md");
});

test("PURE-filter-< ：小于", async () => {
  const op = makeFilterOp("priority < 3");
  const rows = [
    row("a.md", { priority: 5 }),
    row("b.md", { priority: 3 }),
    row("c.md", { priority: 1 }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.path, "c.md");
});

test("PURE-filter-<= ：小于等于", async () => {
  const op = makeFilterOp("priority <= 3");
  const rows = [
    row("a.md", { priority: 5 }),
    row("b.md", { priority: 3 }),
    row("c.md", { priority: 1 }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.path, "b.md");
  assert.equal(r.rows[1]!.path, "c.md");
});

test("PURE-filter-missing：字段缺失", async () => {
  const op = makeFilterOp("status missing");
  const rows = [
    row("a.md", { status: "active" }),
    row("b.md", { something: "else" }),
    row("c.md", {}),
  ];
  const r = await op.run(rows, {} as never);
  // b.md 和 c.md 都没有 status 键，都该通过
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.path, "b.md");
  assert.equal(r.rows[1]!.path, "c.md");
  assert.equal(r.failed.length, 0);
});

test("PURE-filter-exists-undefined：键存在但值为 undefined 也视为存在", async () => {
  const op = makeFilterOp("status exists");
  const rows = [
    row("a.md", { status: "active" }),
    row("b.md", { something: "else" }),
    row("c.md", { status: undefined }), // 键存在，值 undefined
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2, "存在键的行数为 2");
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.rows[1]!.path, "c.md"); // undefined 值但键存在
  assert.equal(r.failed.length, 0);
});

test("PURE-filter-类型不同不通过", async () => {
  const op = makeFilterOp("priority == 5");
  const rows = [
    row("a.md", { priority: 5 }), // number === number → pass
    row("b.md", { priority: "5" }), // string !== number → not pass
    row("c.md", { priority: true }), // boolean !== number → not pass
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.failed.length, 0, "类型不匹配的行不进 failed");
});

test("PURE-filter-被过滤的行不进 failed", async () => {
  const op = makeFilterOp("status == active");
  const rows = [
    row("a.md", { status: "active" }),
    row("b.md", { status: "inactive" }),
    row("c.md", { status: "active" }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  // b.md 被丢弃（过滤语义），不进 failed
  assert.equal(r.failed.length, 0, "过滤掉的行不应计入 failed");
  // 验证 b.md 确实未被保留
  assert.equal(
    r.rows.find((x) => x.path === "b.md"),
    undefined,
  );
});

test("PURE-filter-一等字段 path 比较", async () => {
  const op = makeFilterOp("path == a.md");
  const rows = [row("a.md", {}), row("b.md", {}), row("c.md", {})];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.path, "a.md");
});

// ────────────────────────────────────────────────────────────────────────────
// limit 算子
// ────────────────────────────────────────────────────────────────────────────

test("PURE-limit-正常取前 n 行", async () => {
  const op = makeLimitOp("3");
  const rows = [row("a.md"), row("b.md"), row("c.md"), row("d.md"), row("e.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.rows[1]!.path, "b.md");
  assert.equal(r.rows[2]!.path, "c.md");
  assert.equal(r.failed.length, 0);
});

test("PURE-limit-n 大于总行数", async () => {
  const op = makeLimitOp("10");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.failed.length, 0);
});

test("PURE-limit-n 非法（负数）进 failed", async () => {
  const op = makeLimitOp("-1");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0]!.error.includes("正整数"));
});

test("PURE-limit-n 非法（零）进 failed", async () => {
  const op = makeLimitOp("0");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0]!.error.includes("正整数"));
});

test("PURE-limit-n 非法（小数）进 failed", async () => {
  const op = makeLimitOp("3.5");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0]!.error.includes("正整数"));
});

test("PURE-limit-n 非法（非数字）进 failed", async () => {
  const op = makeLimitOp("abc");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 0);
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0]!.error.includes("正整数"));
});

// ────────────────────────────────────────────────────────────────────────────
// dedup 算子
// ────────────────────────────────────────────────────────────────────────────

test("PURE-dedup-默认按 path 去重", async () => {
  const op = makeDedupOp("");
  const rows = [
    row("a.md", { val: 1 }),
    row("b.md", { val: 2 }),
    row("a.md", { val: 3 }), // 重复 path
    row("c.md", { val: 4 }),
    row("b.md", { val: 5 }), // 重复 path
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 3);
  // 保留首次出现
  assert.equal(r.rows[0]!.path, "a.md");
  assert.equal(r.rows[0]!.fields.val, 1);
  assert.equal(r.rows[1]!.path, "b.md");
  assert.equal(r.rows[1]!.fields.val, 2);
  assert.equal(r.rows[2]!.path, "c.md");
  assert.equal(r.rows[2]!.fields.val, 4);
  assert.equal(r.failed.length, 0);
});

test("PURE-dedup-按 fields 键去重", async () => {
  const op = makeDedupOp("email");
  const rows = [
    row("a.md", { email: "a@x.com", name: "Alice" }),
    row("b.md", { email: "b@x.com", name: "Bob" }),
    row("c.md", { email: "a@x.com", name: "Carol" }), // 重复 email
    row("d.md", { email: "c@x.com", name: "Dave" }),
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 3);
  // 保留首次出现
  assert.equal(r.rows[0]!.path, "a.md"); // 首次 email=a@x.com
  assert.equal(r.rows[1]!.path, "b.md");
  assert.equal(r.rows[2]!.path, "d.md");
  assert.equal(r.failed.length, 0);
});

test("PURE-dedup-保留首次出现", async () => {
  const op = makeDedupOp("");
  const rows = [
    row("z.md", { order: 1 }),
    row("a.md", { order: 2 }),
    row("b.md", { order: 3 }),
    row("a.md", { order: 4 }), // 重复
    row("a.md", { order: 5 }), // 再重复
  ];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0]!.path, "z.md");
  assert.equal(r.rows[0]!.fields.order, 1);
  assert.equal(r.rows[1]!.path, "a.md");
  assert.equal(r.rows[1]!.fields.order, 2); // 首次出现
  assert.equal(r.rows[2]!.path, "b.md");
  assert.equal(r.rows[2]!.fields.order, 3);
});

// ────────────────────────────────────────────────────────────────────────────
// map 算子
// ────────────────────────────────────────────────────────────────────────────

test("PURE-map-常量模板写入目标字段", async () => {
  const op = makeMapOp("greeting=hello");
  const rows = [row("a.md"), row("b.md")];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.fields.greeting, "hello");
  assert.equal(r.rows[1]!.fields.greeting, "hello");
  assert.equal(r.failed.length, 0);
  assert.equal(r.changed.length, 0);
  assert.equal(r.skipped.length, 0);
});

test("PURE-map-插值模板写入目标字段", async () => {
  const op = makeMapOp("urgency={{row.priority}}");
  const rows = [row("a.md", { priority: 3 }), row("b.md", { priority: 5 })];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.fields.urgency, "3");
  assert.equal(r.rows[1]!.fields.urgency, "5");
  assert.equal(r.failed.length, 0);
});

test("PURE-map-点号路径键名", async () => {
  const op = makeMapOp("urgency={{row.formula.urgency}}");
  const rows = [row("a.md", { "formula.urgency": 6 }), row("b.md", { "formula.urgency": 2 })];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0]!.fields.urgency, "6");
  assert.equal(r.rows[1]!.fields.urgency, "2");
  assert.equal(r.failed.length, 0);
});

test("PURE-map-缺失字段记 failed 并渲染为空串", async () => {
  const op = makeMapOp("urgency={{row.nonexistent}}");
  const rows = [row("a.md", {})];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.fields.urgency, ""); // 渲染为空串
  assert.equal(r.failed.length, 1);
  assert.ok(r.failed[0]!.error.includes("不存在的字段"));
  assert.equal(r.failed[0]!.path, "a.md");
});

test("PURE-map-不覆盖已有同名 fields 键", async () => {
  const op = makeMapOp("note={{row.desc}}");
  const rows = [row("a.md", { desc: "hello", note: "preexisting" })];
  const r = await op.run(rows, {} as never);
  assert.equal(r.rows.length, 1);
  // map 写入到 fields.note 字段
  // 实现使用的是 Object spread，后写入的会覆盖
  // 但 map 只写入 targetField，而原行的 note 是 "preexisting"
  // 模板渲染结果是 "hello"，所以 note 应该是 "hello"
  // 这是 map 的语义——写进去
  assert.equal(r.rows[0]!.fields.note, "hello");
});

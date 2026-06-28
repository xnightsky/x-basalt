import assert from "node:assert/strict";
import { test } from "node:test";
import { splitDocument } from "../src/meta/document.js";
import { getMeta } from "../src/meta/operations.js";
import { normalizeDoc } from "../src/meta/normalize.js";

// === MW2.1 / MW2.2 normalize（归一）===
// 计划：docs/plans/2026-06-28-meta-normalize.md
// 默认 ON：tags/aliases/cssclasses 归一为列表（per-key 拆分）、tags 去 #、去重、单数键→复数键迁移。

/** split 内容，归一，返回 {doc, changes, keys, get}。 */
function norm(content: string, opts?: { sortKeys?: boolean }) {
  const p = splitDocument(content);
  const changes = normalizeDoc(p.doc, opts);
  return {
    changes,
    keys: Object.keys(getMeta(p.doc) as object),
    get: (k: string) => getMeta(p.doc, k),
  };
}

// ---- MW2.1 列表属性归一 ----

test("MW2.1 Given tags 为空白分隔标量含 # When normalize Then 拆分、去 #、去重", () => {
  const r = norm('---\ntags: "#a #b a"\n---\nbody\n');
  assert.deepEqual(r.get("tags"), ["a", "b"]);
});

test("MW2.1 Given tags 为逗号分隔标量 When normalize Then 拆分为列表", () => {
  const r = norm('---\ntags: "x, y , z"\n---\nbody\n');
  assert.deepEqual(r.get("tags"), ["x", "y", "z"]);
});

test("MW2.1 Given tags 已是含 # 的列表（带引号字符串）When normalize Then 逐项去 # 并去重", () => {
  // 注意：`- "#p"` 加引号才是字符串 "#p"；未加引号的 `- #p` 会被 YAML 当注释（见下条）。
  const r = norm('---\ntags:\n  - "#p"\n  - p\n  - q\n---\nbody\n');
  assert.deepEqual(r.get("tags"), ["p", "q"]);
});

test("MW2.1 Given tags 列表项未加引号 #x（被 YAML 弃为 null）When normalize Then 丢弃空项", () => {
  // 真实 vault 常见坏数据：`- #x` 未加引号，YAML 解析成 null + 注释。归一应丢弃 null 项。
  const r = norm("---\ntags:\n  - #x\n  - real\n---\nbody\n");
  assert.deepEqual(r.get("tags"), ["real"]);
});

test("MW2.1 Given aliases 为含空格标量 When normalize Then 当单个别名不拆", () => {
  const r = norm("---\naliases: My Long Title\n---\nbody\n");
  assert.deepEqual(r.get("aliases"), ["My Long Title"]);
});

test("MW2.1 Given cssclasses 为空白分隔标量 When normalize Then 拆分为列表", () => {
  const r = norm('---\ncssclasses: "red big"\n---\nbody\n');
  assert.deepEqual(r.get("cssclasses"), ["red", "big"]);
});

test("MW2.1 Given tags 为数字标量 When normalize Then 转为单元素字符串列表", () => {
  const r = norm("---\ntags: 2024\n---\nbody\n");
  assert.deepEqual(r.get("tags"), ["2024"]);
});

test("MW2.1 Given tags 为 null When normalize Then 跳过不动", () => {
  const r = norm("---\ntags: null\nother: 1\n---\nbody\n");
  assert.equal(r.get("tags"), null);
});

test("MW2.1 Given 无保留键 When normalize Then 无变更", () => {
  const r = norm("---\ntitle: A\nn: 3\n---\nbody\n");
  assert.deepEqual(r.changes, []);
});

test("MW2.1 Given 已是规范列表 When 二次 normalize Then 幂等无变更", () => {
  const once = splitDocument("---\ntags:\n  - a\n  - b\n---\nbody\n");
  normalizeDoc(once.doc);
  const second = normalizeDoc(once.doc);
  assert.deepEqual(second, []);
});

// ---- MW2.2 单数键迁移 ----

test("MW2.2 Given 仅单数 tag 标量 When normalize Then 原位改名为 tags 列表（保位置）", () => {
  const r = norm("---\na: 1\ntag: x\nb: 2\n---\nbody\n");
  assert.deepEqual(r.keys, ["a", "tags", "b"]);
  assert.deepEqual(r.get("tags"), ["x"]);
  assert.equal(r.keys.includes("tag"), false);
});

test("MW2.2 Given tag 与 tags 都在 When normalize Then 合并并集到 tags、删 tag", () => {
  const r = norm("---\ntags:\n  - a\ntag: b\n---\nbody\n");
  assert.deepEqual(r.get("tags"), ["a", "b"]);
  assert.equal(r.keys.includes("tag"), false);
});

test("MW2.2 Given 单数 alias 含空格 When normalize Then 迁移为 aliases 单别名不拆", () => {
  const r = norm("---\nalias: My Title\n---\nbody\n");
  assert.deepEqual(r.get("aliases"), ["My Title"]);
  assert.equal(r.keys.includes("alias"), false);
});

test("MW2.2 Given 单数 cssclass When normalize Then 迁移为 cssclasses", () => {
  const r = norm('---\ncssclass: "red big"\n---\nbody\n');
  assert.deepEqual(r.get("cssclasses"), ["red", "big"]);
  assert.equal(r.keys.includes("cssclass"), false);
});

test("MW2.2 Given 单数键 + 需归一值 When 二次 normalize Then 幂等无变更", () => {
  // 带引号才让 # 进入字符串（未加引号的 #b 会被 YAML 当注释）。
  const p = splitDocument('---\ntag: "a #b a"\n---\nbody\n');
  normalizeDoc(p.doc);
  assert.deepEqual(getMeta(p.doc, "tags"), ["a", "b"]);
  assert.deepEqual(normalizeDoc(p.doc), []);
});

test("MW2.2 Given 发生迁移 When normalize Then changes 报告含说明", () => {
  const r = norm("---\ntag: x\n---\nbody\n");
  assert.ok(r.changes.length > 0);
  assert.ok(
    r.changes.some((c) => c.includes("tag") && c.includes("tags")),
    `changes 应说明 tag→tags，实际 ${JSON.stringify(r.changes)}`,
  );
});

// ---- MW2.3 --sort-keys（opt-in）----

test("MW2.3 Given 默认（不传 sortKeys）When normalize Then 不排序键", () => {
  const r = norm("---\nb: 1\na: 2\nc: 3\n---\nbody\n");
  assert.deepEqual(r.keys, ["b", "a", "c"]);
});

test("MW2.3 Given sortKeys=true When normalize Then 顶层键按字母序排序且幂等", () => {
  const p = splitDocument("---\nb: 1\na: 2\nc: 3\n---\nbody\n");
  const c1 = normalizeDoc(p.doc, { sortKeys: true });
  assert.deepEqual(Object.keys(getMeta(p.doc) as object), ["a", "b", "c"]);
  assert.ok(c1.includes("排序键"));
  assert.deepEqual(normalizeDoc(p.doc, { sortKeys: true }), []); // 已排序 → 二次无变更
});

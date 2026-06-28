import assert from "node:assert/strict";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { serializeDocument, splitDocument } from "../src/meta/document.js";
import {
  coerceValue,
  getMeta,
  hasMeta,
  renameMeta,
  setMeta,
  unsetMeta,
} from "../src/meta/operations.js";

// === MW1.2 frontmatter CRUD（顶层扁平键）===
// 计划：docs/plans/2026-06-28-meta-frontmatter-write.md
// 在 yaml Document 上操作：保留键序/注释；set 保守类型推断；rename 保位置/值。

/** 取某文件内容跑 split，返回 parts。 */
function load(content: string) {
  return splitDocument(content);
}

test("MW1.2 Given frontmatter When getMeta 无 key Then 返回整个对象；有 key 返回值；缺失返回 undefined", () => {
  const p = load("---\ntitle: A\nn: 3\n---\nbody\n");
  assert.deepEqual(getMeta(p.doc), { title: "A", n: 3 });
  assert.equal(getMeta(p.doc, "title"), "A");
  assert.equal(getMeta(p.doc, "missing"), undefined);
  assert.equal(hasMeta(p.doc, "title"), true);
  assert.equal(hasMeta(p.doc, "missing"), false);
});

test("MW1.2 Given 已有键 When setMeta Then 原位更新、键序不变", () => {
  const p = load("---\na: 1\nb: 2\nc: 3\n---\nbody\n");
  setMeta(p.doc, "b", 20);
  assert.deepEqual(Object.keys(getMeta(p.doc) as object), ["a", "b", "c"]);
  assert.equal(serializeDocument(p), "---\na: 1\nb: 20\nc: 3\n---\nbody\n");
});

test("MW1.2 Given 新键 When setMeta Then 追加到末尾", () => {
  const p = load("---\na: 1\n---\nbody\n");
  setMeta(p.doc, "d", "x");
  assert.equal(serializeDocument(p), "---\na: 1\nd: x\n---\nbody\n");
});

test("MW1.2 Given 带注释 When setMeta 改其它键 Then 注释尽力保留", () => {
  const p = load("---\na: 1 # keep me\nb: 2\n---\nbody\n");
  setMeta(p.doc, "b", 20);
  assert.match(serializeDocument(p), /# keep me/);
});

test("MW1.2 Given 已有键 When unsetMeta Then 删除；缺失键为 no-op", () => {
  const p = load("---\na: 1\nb: 2\n---\nbody\n");
  unsetMeta(p.doc, "a");
  assert.equal(hasMeta(p.doc, "a"), false);
  assert.equal(serializeDocument(p), "---\nb: 2\n---\nbody\n");
  unsetMeta(p.doc, "nope"); // no-op，不抛
  assert.equal(serializeDocument(p), "---\nb: 2\n---\nbody\n");
});

test("MW1.2 Given 中间键 When renameMeta Then 保位置/值，注释尽力保留", () => {
  const p = load("---\na: 1\nold: 5 # note\nc: 3\n---\nbody\n");
  renameMeta(p.doc, "old", "new");
  assert.deepEqual(Object.keys(getMeta(p.doc) as object), ["a", "new", "c"]);
  assert.equal(getMeta(p.doc, "new"), 5);
  assert.equal(hasMeta(p.doc, "old"), false);
  assert.match(serializeDocument(p), /# note/);
});

test("MW1.2 Given rename 源不存在或目标已存在 When renameMeta Then 报错（不静默覆盖）", () => {
  const p = load("---\na: 1\nb: 2\n---\nbody\n");
  assert.throws(() => renameMeta(p.doc, "missing", "x"), /不存在/);
  assert.throws(() => renameMeta(p.doc, "a", "b"), /已存在/);
});

test("MW1.2 Given 各类型 When coerceValue Then 按 type 转换（auto 保守）", () => {
  assert.equal(coerceValue("42", "number"), 42);
  assert.equal(coerceValue("42", "string"), "42");
  assert.equal(coerceValue("true", "boolean"), true);
  assert.equal(coerceValue("", "null"), null);
  assert.deepEqual(coerceValue("a, b ,c", "list"), ["a", "b", "c"]);
  // auto：仅严格 number / true|false / null 被识别，其余为字符串（避开 YAML 1.1 yes/no 陷阱）
  assert.equal(coerceValue("3", "auto"), 3);
  assert.equal(coerceValue("true", "auto"), true);
  assert.equal(coerceValue("null", "auto"), null);
  assert.equal(coerceValue("yes", "auto"), "yes");
  assert.equal(coerceValue("on", "auto"), "on");
  assert.equal(coerceValue("hello", "auto"), "hello");
});

test("MW1.2 Given 非法 number/boolean When coerceValue Then 报错", () => {
  assert.throws(() => coerceValue("abc", "number"), /number/);
  assert.throws(() => coerceValue("yes", "boolean"), /true\/false/);
});

test("MW1.2 Given wikilink 字符串值 When setMeta→serialize Then 自动加引号且往返为字符串", () => {
  const p = load("---\na: 1\n---\nbody\n");
  setMeta(p.doc, "link", coerceValue("[[Episode IV]]", "string"));
  const out = serializeDocument(p);
  // 序列化结果应是合法 YAML，且 link 解析回字符串（而非嵌套数组）
  const fm = parseYaml(out.slice(out.indexOf("\n") + 1, out.lastIndexOf("\n---")));
  assert.equal(fm.link, "[[Episode IV]]");
});

test("MW1.2 Given list 值 When setMeta→serialize Then 产出块序列且往返为数组", () => {
  const p = load("---\na: 1\n---\nbody\n");
  setMeta(p.doc, "tags", coerceValue("x, y, z", "list"));
  const out = serializeDocument(p);
  assert.match(out, /tags:\n {2}- x\n {2}- y\n {2}- z/);
});

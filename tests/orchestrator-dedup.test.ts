import assert from "node:assert/strict";
import { test } from "node:test";
import { foldEvents } from "../src/orchestrator/dedup.js";
import type { ChangeEvent } from "../src/orchestrator/types.js";

// === CO-A2 事件去重折叠（L2 路径 LWW + L3 类型折叠）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；规则表：spec §6.3
// foldEvents：对一批变更事件按 path 归并，按状态机折叠事件类型，取最新 mtime（LWW）。

/** 简写构造事件。 */
function ev(path: string, type: ChangeEvent["type"], mtime?: number): ChangeEvent {
  return { path, type, mtime };
}

test("CO-A2 Given add 后多次 change（同文件）When fold Then 折叠为单个 add", () => {
  const out = foldEvents([ev("a.md", "add"), ev("a.md", "change"), ev("a.md", "change")]);
  assert.deepEqual(
    out.map((e) => [e.path, e.type]),
    [["a.md", "add"]],
  );
});

test("CO-A2 Given 多次 change（同文件）When fold Then 折叠为单个 change", () => {
  const out = foldEvents([ev("a.md", "change"), ev("a.md", "change"), ev("a.md", "change")]);
  assert.deepEqual(
    out.map((e) => [e.path, e.type]),
    [["a.md", "change"]],
  );
});

test("CO-A2 Given add 后 unlink（同文件）When fold Then 抵消（不产出该文件）", () => {
  const out = foldEvents([ev("a.md", "add"), ev("a.md", "unlink")]);
  assert.deepEqual(out, []);
});

test("CO-A2 Given change 后 unlink When fold Then 折叠为 unlink", () => {
  const out = foldEvents([ev("a.md", "change"), ev("a.md", "unlink")]);
  assert.deepEqual(
    out.map((e) => [e.path, e.type]),
    [["a.md", "unlink"]],
  );
});

test("CO-A2 Given unlink 后 add（删了又建）When fold Then 折叠为 change", () => {
  const out = foldEvents([ev("a.md", "unlink"), ev("a.md", "add")]);
  assert.deepEqual(
    out.map((e) => [e.path, e.type]),
    [["a.md", "change"]],
  );
});

test("CO-A2 Given 多文件交错 When fold Then 各自折叠、互不干扰、保持首现顺序", () => {
  const out = foldEvents([
    ev("a.md", "add"),
    ev("b.md", "change"),
    ev("a.md", "change"),
    ev("c.md", "add"),
    ev("c.md", "unlink"),
  ]);
  assert.deepEqual(
    out.map((e) => [e.path, e.type]),
    [
      ["a.md", "add"],
      ["b.md", "change"],
    ],
  );
});

test("CO-A2 Given 同文件多事件带 mtime When fold Then 取最后事件的 mtime（LWW）", () => {
  const out = foldEvents([ev("a.md", "change", 100), ev("a.md", "change", 200)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.mtime, 200);
});

test("CO-A2 Given 空输入 When fold Then 空数组", () => {
  assert.deepEqual(foldEvents([]), []);
});

test("CO-A2 Given 已折叠批 When 再次 fold Then 结果不变（幂等）", () => {
  const once = foldEvents([ev("a.md", "add"), ev("a.md", "change"), ev("b.md", "unlink")]);
  const twice = foldEvents(once);
  assert.deepEqual(twice, once);
});

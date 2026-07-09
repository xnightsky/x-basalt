import assert from "node:assert/strict";
import { test } from "node:test";
import { compileIgnore, globToRegExp } from "../../src/links/ignore.js";
import type { BasaltIssue } from "../../src/links/types.js";

const issue = (over: Partial<BasaltIssue>): BasaltIssue => ({
  file: "docs/a.md",
  line: 1,
  column: 1,
  rule: "links/no-broken-link",
  severity: "error",
  message: "",
  fixable: false,
  ...over,
});

test("globToRegExp: ** 跨段、* 单段", () => {
  assert.ok(globToRegExp(".tmp/**").test(".tmp/x/y.png"));
  assert.ok(globToRegExp("http://*").test("http://example.com"));
  assert.ok(!globToRegExp("legacy/*").test("legacy/deep/x.md"));
});

test("paths 命中被检查文件 → 忽略", () => {
  const m = compileIgnore({ paths: ["archive/**"] });
  assert.equal(m.ignored(issue({ file: "archive/old.md" })), true);
  assert.equal(m.ignored(issue({ file: "docs/a.md" })), false);
});

test("targets 命中目标字符串 → 忽略", () => {
  const m = compileIgnore({ targets: ["http://*", "https://*"] });
  assert.equal(m.ignored(issue({ target: "https://x.com" })), true);
});

test("rules.<rule> 仅对该 rule 忽略指定 file/target", () => {
  const m = compileIgnore({ rules: { "links/no-broken-link": ["legacy/**"] } });
  assert.equal(m.ignored(issue({ file: "legacy/x.md" })), true);
  assert.equal(m.ignored(issue({ file: "legacy/x.md", rule: "links/other" })), false);
});

test("空配置 → 从不忽略", () => {
  assert.equal(compileIgnore(undefined).ignored(issue({})), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectProfile } from "../../src/meta/index.js";

// 读侧 profile 校验：不写盘，复用写侧 diffProfile 算 missing.required。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.1。

const withType = "---\ntype: note\ntitle: X\n---\n# body\n";
const withoutType = "---\ntitle: X\n---\n# body\n";
const noFrontmatter = "# body only\n";

test("inspectProfile: 缺 required（llm-wiki 的 type）→ missing.required 含 type", () => {
  const diff = inspectProfile(withoutType, "llm-wiki");
  assert.ok(diff.missing.required.includes("type"));
});

test("inspectProfile: required 齐全 → missing.required 不含 type", () => {
  const diff = inspectProfile(withType, "llm-wiki");
  assert.ok(!diff.missing.required.includes("type"));
});

test("inspectProfile: 无 frontmatter → required 缺失", () => {
  const diff = inspectProfile(noFrontmatter, "llm-wiki");
  assert.ok(diff.missing.required.includes("type"));
});

test("inspectProfile: 未知 profile → 定向报错", () => {
  assert.throws(() => inspectProfile(withType, "nope"), /nope|未知/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProfileConfig } from "../../src/lint/profile.js";
import { resolveLintProfile } from "../../src/lint/profile.js";

// resolveLintProfile：把 --profile <name> 按 extends 合并成可校验的 LintProfile。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.2。

const cfgs = (o: Record<string, ProfileConfig>): Record<string, ProfileConfig> => o;

test("内置名（无同名 config）→ required 取 role、enums 空", () => {
  const p = resolveLintProfile("llm-wiki", {});
  assert.equal(p.name, "llm-wiki");
  assert.deepEqual(p.required, ["type"]); // llm-wiki 唯一 required
  assert.deepEqual(p.enums, {});
  assert.equal(p.include, undefined);
});

test("config 新建（无 extends）→ 原样 required + enums", () => {
  const p = resolveLintProfile(
    "team-note",
    cfgs({ "team-note": { required: ["owner", "area"], enums: { area: ["infra", "product"] } } }),
  );
  assert.deepEqual(p.required, ["owner", "area"]);
  assert.deepEqual(p.enums, { area: ["infra", "product"] });
});

test("config extends 内置 → required 并集、enums 合并", () => {
  const p = resolveLintProfile(
    "my-wiki",
    cfgs({ "my-wiki": { extends: "llm-wiki", required: ["author"], enums: { type: ["note"] } } }),
  );
  assert.deepEqual(p.required, ["type", "author"]); // 父 type + 子 author
  assert.deepEqual(p.enums, { type: ["note"] });
});

test("config extends config（多级链）→ required 跨链并集", () => {
  const p = resolveLintProfile(
    "leaf",
    cfgs({
      leaf: { extends: "mid", required: ["c"] },
      mid: { extends: "llm-wiki", required: ["b"] },
    }),
  );
  assert.deepEqual(p.required, ["type", "b", "c"]); // llm-wiki.type → mid.b → leaf.c
});

test("同字段 enum 在父子都定义 → 值取并集去重", () => {
  const p = resolveLintProfile(
    "child",
    cfgs({
      child: { extends: "parent", enums: { type: ["person", "design"] } },
      parent: { enums: { type: ["note", "person"] } },
    }),
  );
  assert.deepEqual(p.enums, { type: ["note", "person", "design"] });
});

test("include：子有则用子；子无则继承父；子有覆盖父", () => {
  const withOwn = resolveLintProfile(
    "a",
    cfgs({ a: { extends: "b", include: "a/**" }, b: { include: "b/**" } }),
  );
  assert.equal(withOwn.include, "a/**"); // 子覆盖父

  const inherit = resolveLintProfile("c", cfgs({ c: { extends: "b" }, b: { include: "b/**" } }));
  assert.equal(inherit.include, "b/**"); // 子无 → 继承父
});

test("extends 环（A→B→A）→ 定向报错", () => {
  assert.throws(
    () => resolveLintProfile("A", cfgs({ A: { extends: "B" }, B: { extends: "A" } })),
    /环|A → B → A/,
  );
});

test("extends 指向未知父 → 定向报错", () => {
  assert.throws(() => resolveLintProfile("x", cfgs({ x: { extends: "ghost" } })), /未知父|ghost/);
});

test("未知 profile 名（既非 config 也非内置）→ 报错", () => {
  assert.throws(() => resolveLintProfile("nope", {}), /未知 profile|nope/);
});

test("同名 config 覆盖内置（local 优先）", () => {
  const p = resolveLintProfile("llm-wiki", cfgs({ "llm-wiki": { required: ["x"] } }));
  assert.deepEqual(p.required, ["x"]); // 用 config，不含内置的 type
  assert.deepEqual(p.enums, {});
});

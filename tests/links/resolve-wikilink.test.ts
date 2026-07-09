import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWikilink } from "../../src/links/resolve.js";
import { buildTargetIndex } from "../../src/links/scan.js";
import type { CollectedFile, TargetIndex } from "../../src/links/types.js";
import type { ObsidianNode } from "../../src/parser/types.js";

type WL = Extract<ObsidianNode, { type: "wikilink" }>;
const wl = (target: string, embed = false): WL => ({
  type: "wikilink",
  target,
  embed,
  line: 1,
  column: 1,
  raw: embed ? `![[${target}]]` : `[[${target}]]`,
});
const files: CollectedFile[] = [
  { abs: "", key: "Notes/Alpha.md" },
  { abs: "", key: "Archive/Alpha.md" },
  { abs: "", key: "Notes/Beta.md" },
  { abs: "", key: "assets/img.png" },
];
const idx: TargetIndex = buildTargetIndex(files);

test("bare wikilink 唯一命中 → 有效（无 reason）", () => {
  assert.equal(resolveWikilink(wl("Beta"), idx, "Notes/x.md").reason, undefined);
});

test("bare wikilink 多命中 → ambiguous_target + 候选", () => {
  const f = resolveWikilink(wl("Alpha"), idx, "Notes/x.md");
  assert.equal(f.reason, "ambiguous_target");
  assert.equal(f.suggestions?.length, 2);
});

test("bare wikilink 无命中 → not_found", () => {
  assert.equal(resolveWikilink(wl("Ghost"), idx, "Notes/x.md").reason, "not_found");
});

test("qualified wikilink 精确命中 → 有效", () => {
  assert.equal(resolveWikilink(wl("Archive/Alpha"), idx, "Notes/x.md").reason, undefined);
});

test("大小写不敏感命中 → 有效", () => {
  assert.equal(resolveWikilink(wl("beta"), idx, "Notes/x.md").reason, undefined);
});

test("资源 embed 命中 → 有效；缺失 → not_found", () => {
  assert.equal(resolveWikilink(wl("img.png", true), idx, "Notes/x.md").reason, undefined);
  assert.equal(resolveWikilink(wl("missing.png", true), idx, "Notes/x.md").reason, "not_found");
});

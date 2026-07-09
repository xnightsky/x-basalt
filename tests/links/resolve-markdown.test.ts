import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMarkdownLink } from "../../src/links/resolve.js";
import { buildTargetIndex } from "../../src/links/scan.js";
import type { CollectedFile, TargetIndex } from "../../src/links/types.js";
import type { ObsidianNode } from "../../src/parser/types.js";

type ML = Extract<ObsidianNode, { type: "markdownLink" }>;
const ml = (target: string, image = false): ML => ({
  type: "markdownLink",
  text: "t",
  target,
  image,
  line: 1,
  column: 1,
  raw: `[t](${target})`,
});
const files: CollectedFile[] = [
  { abs: "", key: "Notes/Alpha.md" },
  { abs: "", key: "Notes/sub/Gamma.md" },
  { abs: "", key: "assets/img.png" },
];
const idx: TargetIndex = buildTargetIndex(files);

test("相对路径命中 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./sub/Gamma.md"), idx, "Notes/x.md").reason, undefined);
});

test("相对路径缺失 → not_found + 同名建议", () => {
  const f = resolveMarkdownLink(ml("./Gamma.md"), idx, "Notes/x.md");
  assert.equal(f.reason, "not_found");
  assert.ok(f.suggestions?.some((s) => s.includes("Gamma.md")));
});

test("逃出 vault 根 → outside_vault", () => {
  assert.equal(
    resolveMarkdownLink(ml("../../../etc/passwd"), idx, "Notes/x.md").reason,
    "outside_vault",
  );
});

test("反斜杠路径 → backslash_path", () => {
  assert.equal(resolveMarkdownLink(ml("sub\\Gamma.md"), idx, "Notes/x.md").reason, "backslash_path");
});

test("外部 URL / mailto / anchor-only → external_skipped", () => {
  assert.equal(resolveMarkdownLink(ml("https://x.com")).reason, "external_skipped");
  assert.equal(resolveMarkdownLink(ml("mailto:a@b.c")).reason, "external_skipped");
  assert.equal(resolveMarkdownLink(ml("#section")).reason, "external_skipped");
});

test("省略扩展名补 .md 命中 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./Alpha"), idx, "Notes/x.md").reason, undefined);
});

test("带锚点只查文件部分 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./Alpha.md#heading"), idx, "Notes/x.md").reason, undefined);
});

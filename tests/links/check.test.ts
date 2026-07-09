import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkVault } from "../../src/links/check.js";

test("checkVault: 报断链、跳过有效链、按 file/line 排序", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-check-"));
  try {
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "Alpha.md"), "# Alpha");
    writeFileSync(
      join(root, "notes", "Index.md"),
      ["[[Alpha]]", "[[Ghost]]", "[有效](./Alpha.md)", "[断](./Missing.md)"].join("\n"),
    );
    const issues = await checkVault({ vault: root });
    assert.equal(issues.length, 2);
    assert.deepEqual(
      issues.map((i) => i.reason),
      ["not_found", "not_found"],
    );
    assert.deepEqual(
      issues.map((i) => i.line),
      [2, 4],
    );
    assert.equal(issues[0]?.file, "notes/Index.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkVault: ignore.paths 过滤整文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-check-ig-"));
  try {
    mkdirSync(join(root, "legacy"));
    writeFileSync(join(root, "legacy", "Old.md"), "[[Ghost]]");
    const issues = await checkVault({ vault: root, ignore: { paths: ["legacy/**"] } });
    assert.equal(issues.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTargetIndex, collectFiles } from "../../src/links/scan.js";
import type { CollectedFile } from "../../src/links/types.js";

const files: CollectedFile[] = [
  { abs: "/v/Notes/Alpha.md", key: "Notes/Alpha.md" },
  { abs: "/v/Archive/Alpha.md", key: "Archive/Alpha.md" },
  { abs: "/v/assets/img.png", key: "assets/img.png" },
];

test("buildTargetIndex: pathSet 含全部文件（小写 POSIX）", () => {
  const idx = buildTargetIndex(files);
  assert.ok(idx.pathSet.has("notes/alpha.md"));
  assert.ok(idx.pathSet.has("assets/img.png"));
});

test("buildTargetIndex: notesByStem 聚合同名 .md（歧义可查）", () => {
  const idx = buildTargetIndex(files);
  assert.deepEqual(idx.notesByStem.get("alpha")?.toSorted(), ["Archive/Alpha.md", "Notes/Alpha.md"]);
});

test("buildTargetIndex: notesByPathKey 用 pathKey（去扩展名 POSIX 小写）", () => {
  const idx = buildTargetIndex(files);
  assert.ok(idx.notesByPathKey.has("notes/alpha"));
  assert.ok(idx.notesByPathKey.has("archive/alpha"));
});

test("buildTargetIndex: filesByBasename 含资源（含扩展名 basename）", () => {
  const idx = buildTargetIndex(files);
  assert.deepEqual(idx.filesByBasename.get("img.png"), ["assets/img.png"]);
});

test("collectFiles: 收全部文件、挑出 .md、跳过隐藏与 .obsidian", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-scan-"));
  try {
    mkdirSync(join(root, "sub"));
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, "A.md"), "# A");
    writeFileSync(join(root, "sub", "B.md"), "# B");
    writeFileSync(join(root, "sub", "img.png"), "x");
    writeFileSync(join(root, ".obsidian", "app.json"), "{}");
    writeFileSync(join(root, ".hidden.md"), "# hidden");
    const { all, markdown } = await collectFiles([root], (abs) =>
      abs.slice(root.length + 1).replaceAll("\\", "/"),
    );
    assert.deepEqual(markdown.map((f) => f.key).toSorted(), ["A.md", "sub/B.md"]);
    assert.ok(all.some((f) => f.key === "sub/img.png"));
    assert.ok(!all.some((f) => f.key.includes(".obsidian")));
    assert.ok(!all.some((f) => f.key.includes(".hidden")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";

// === S3.2 回归: inlinks/outlinks 路径感知，同名异目录不串味 ===
//
// 根因：旧实现链接键纯 basename，[[Projects/Note]] 与 [[Archive/Note]] 同键，inlinks JOIN 串味。
// 新口径（biz-dql-subset / research §3.3#1）：
//   - qualified 链接（target 含 '/'）按 path_key 精确匹配。
//   - bare 链接按 name_key basename 回退；同名多个时全列（MVP 近似）。

let tmpDir: string;
let engine: DataviewEngine;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-pathaware-"));
  const vaultPath = join(tmpDir, "vault");
  await mkdir(join(vaultPath, "Projects"), { recursive: true });
  await mkdir(join(vaultPath, "Archive"), { recursive: true });
  // 同名异目录：两个 Note.md。
  await writeFile(join(vaultPath, "Projects", "Note.md"), "# Projects Note\n");
  await writeFile(join(vaultPath, "Archive", "Note.md"), "# Archive Note\n");
  // Hub 用 qualified 链接只指向 Projects/Note。
  await writeFile(join(vaultPath, "Hub.md"), "# Hub\n\n[[Projects/Note]]\n");
  // Ref 用 bare 链接（歧义，回退 basename，命中两个同名）。
  await writeFile(join(vaultPath, "Ref.md"), "# Ref\n\n[[Note]]\n");

  const dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close();
  engine = new DataviewEngine(dbPath);
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 取某文件 inlinks 源路径（升序）。 */
function inlinksOf(path: string): string[] {
  const r = engine.query(`TABLE file.inlinks WHERE file.path = '${path}'`);
  return ((r.rows[0]?.["file.inlinks"] as string[]) ?? []).toSorted();
}

test("Given qualified [[Projects/Note]] When 取 Archive/Note 的 inlinks Then 不含 Hub（核心：不串味）", () => {
  // Hub 的 [[Projects/Note]] 绝不能反链到同名的 Archive/Note；仅 bare 的 Ref 命中。
  assert.deepEqual(inlinksOf("Archive/Note.md"), ["Ref.md"]);
});

test("Given qualified 链接 When 取 Projects/Note 的 inlinks Then 含 Hub 与 bare 的 Ref", () => {
  assert.deepEqual(inlinksOf("Projects/Note.md"), ["Hub.md", "Ref.md"]);
});

test("Given bare [[Note]] 歧义 When 回退 basename Then 同名两文件都被反链（MVP 全列）", () => {
  assert.ok(inlinksOf("Projects/Note.md").includes("Ref.md"));
  assert.ok(inlinksOf("Archive/Note.md").includes("Ref.md"));
});

test("Given qualified outlinks contains When 查指向 Projects/Note 的文件 Then 仅命中 Hub（不串味）", () => {
  const r = engine.query('LIST WHERE contains(file.outlinks, "Projects/Note")');
  assert.deepEqual(
    r.rows.map((row) => row["file.path"]),
    ["Hub.md"],
  );
});

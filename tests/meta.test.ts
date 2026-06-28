import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { editMeta, readMeta } from "../src/meta/index.js";
import { renameMeta, setMeta, unsetMeta } from "../src/meta/operations.js";

// === MW1.3 编排 + 原子写 + dry-run ===
// 计划：docs/plans/2026-06-28-meta-frontmatter-write.md
// fs 读 → split → 改 doc → serialize → 原子写；非法 YAML 拒写；幂等；dry-run 不落盘。

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 建临时文件，返回路径。 */
function tmpFile(content: string, name = "note.md"): string {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-meta-"));
  tmpDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}

test("MW1.3 Given 文件 When editMeta set Then 落盘且 changed=true、可读回", () => {
  const file = tmpFile("---\ntitle: A\n---\n# Body\n");
  const r = editMeta(file, (d) => setMeta(d, "status", "active"));
  assert.equal(r.changed, true);
  assert.equal(r.dryRun, false);
  assert.equal(readMeta(file, "status"), "active");
  assert.equal(readMeta(file, "title"), "A");
});

test("MW1.3 Given 同一 set 连跑两次 When editMeta Then 第二次 changed=false 且字节稳定（幂等）", () => {
  const file = tmpFile("---\ntitle: A\n---\nbody\n");
  editMeta(file, (d) => setMeta(d, "n", 1));
  const first = readFileSync(file, "utf8");
  const r2 = editMeta(file, (d) => setMeta(d, "n", 1));
  assert.equal(r2.changed, false);
  assert.equal(readFileSync(file, "utf8"), first);
});

test("MW1.3 Given dry-run When editMeta Then 不落盘但 content 含改动", () => {
  const file = tmpFile("---\ntitle: A\n---\nbody\n");
  const before = readFileSync(file, "utf8");
  const r = editMeta(file, (d) => setMeta(d, "x", 9), { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.changed, true);
  assert.match(r.content, /x: 9/);
  assert.equal(readFileSync(file, "utf8"), before); // 磁盘未变
});

test("MW1.3 Given frontmatter 是非法 YAML When editMeta Then 拒写并抛错、文件不变", () => {
  const file = tmpFile("---\nkey: [unclosed\n---\nbody\n");
  const before = readFileSync(file, "utf8");
  assert.throws(() => editMeta(file, (d) => setMeta(d, "x", 1)), /解析失败|拒绝/);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("MW1.3 Given 改动 When 原子写 Then 不留临时文件且 body 逐字节保留", () => {
  const file = tmpFile("---\ntitle: A\n---\n# Body\n\nsome text\n");
  editMeta(file, (d) => setMeta(d, "k", "v"));
  const out = readFileSync(file, "utf8");
  assert.ok(out.endsWith("# Body\n\nsome text\n"), "body 应原样保留");
  // 目录内只剩原文件，无 .tmp 残留
  const files = readdirSync(dirname(file));
  assert.deepEqual(
    files.filter((f) => f !== "note.md"),
    [],
  );
});

test("MW1.3 Given 无 frontmatter 文件 When set Then 顶部新建 frontmatter、原文作 body", () => {
  const file = tmpFile("# Just content\n\ntext\n");
  editMeta(file, (d) => setMeta(d, "title", "New"));
  assert.equal(readFileSync(file, "utf8"), "---\ntitle: New\n---\n# Just content\n\ntext\n");
});

test("MW1.3 Given 文件 When unset / rename Then 正确写回", () => {
  const file = tmpFile("---\na: 1\nold: 2\n---\nbody\n");
  editMeta(file, (d) => unsetMeta(d, "a"));
  assert.equal(readMeta(file, "a"), undefined);
  editMeta(file, (d) => renameMeta(d, "old", "neu"));
  assert.equal(readMeta(file, "neu"), 2);
  assert.equal(readFileSync(file, "utf8"), "---\nneu: 2\n---\nbody\n");
});

test("MW1.3 Given 无改动的 set（值相同）When editMeta Then changed=false 不写盘", () => {
  const file = tmpFile("---\nn: 5\n---\nbody\n");
  const before = readFileSync(file, "utf8");
  const r = editMeta(file, (d) => setMeta(d, "n", 5));
  assert.equal(r.changed, false);
  assert.equal(readFileSync(file, "utf8"), before);
});

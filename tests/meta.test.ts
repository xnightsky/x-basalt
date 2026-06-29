import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { applyProfile, editMeta, readMeta } from "../src/meta/index.js";
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

// === MW3.3 applyProfile 编排 ===

test("MW3.3 Given 文件 When applyProfile(pkm-note) Then 机械补 created/modified、报告仍缺语义字段", () => {
  const file = tmpFile("---\n---\n# 笔记\n正文\n");
  const r = applyProfile(file, "pkm-note");
  assert.equal(r.changed, true);
  assert.deepEqual(r.filled, ["created", "modified"]);
  assert.match(readMeta(file, "created") as string, /^\d{4}-\d{2}-\d{2}T/); // ISO
  assert.match(readMeta(file, "modified") as string, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(readMeta(file, "tags"), undefined); // 语义字段不机械补
  assert.ok(r.missing.recommended.includes("tags")); // 报告仍缺
  assert.ok(readFileSync(file, "utf8").endsWith("# 笔记\n正文\n")); // 正文保留
});

test("MW3.3 Given --set kwargs When applyProfile Then 同时补语义字段、按类型转", () => {
  const file = tmpFile("---\n---\nbody\n");
  const r = applyProfile(file, "pkm-note", { sets: { tags: "a, b", status: "active" } });
  assert.ok(r.filled.includes("tags") && r.filled.includes("status"));
  assert.deepEqual(readMeta(file, "tags"), ["a", "b"]); // list 拆
  assert.equal(readMeta(file, "status"), "active");
  assert.ok(!r.missing.recommended.includes("tags")); // 补了就不再缺
});

test("MW3.3 Given 旧的不规范字段 When applyProfile Then 收尾归一（profile 建立在标准化之上）", () => {
  // tag(单数) + 带 # → apply 应迁移为 tags、去 #、列表化，同时机械补 created/modified
  const file = tmpFile('---\ntag: "#x"\n---\nbody\n');
  applyProfile(file, "pkm-note");
  assert.deepEqual(readMeta(file, "tags"), ["x"]); // 单数迁移 + 去# + 列表化
  assert.equal(readMeta(file, "tag"), undefined);
  assert.match(readMeta(file, "created") as string, /^\d{4}-/); // 机械字段也补了
});

test("MW3.3 Given --set 覆盖机械/已有字段 When applyProfile Then 显式值优先", () => {
  const file = tmpFile("---\ntitle: Old\n---\nbody\n");
  const r = applyProfile(file, "pkm-note", { sets: { created: "2020-01-01", title: "New" } });
  assert.equal(readMeta(file, "created"), "2020-01-01"); // --set 覆盖机械 birthtime
  assert.equal(readMeta(file, "title"), "New"); // --set 覆盖已有的额外字段
  assert.ok(r.overridden.includes("title")); // 原本已有→overridden
  assert.ok(r.filled.includes("created")); // 原本缺→filled（--set 先写，机械层跳过）
});

test("MW3.3 Given 连跑两次 When applyProfile Then 第二次幂等（changed=false、字节稳定）", () => {
  const file = tmpFile("---\n---\nbody\n");
  applyProfile(file, "pkm-note");
  const first = readFileSync(file, "utf8");
  const r2 = applyProfile(file, "pkm-note");
  assert.equal(r2.changed, false);
  assert.equal(readFileSync(file, "utf8"), first);
});

test("MW3.3 Given ssg-blog When applyProfile Then 机械补 pubDate/updatedDate、报告仍缺 title/description", () => {
  const file = tmpFile("---\n---\n# Post\n正文\n");
  const r = applyProfile(file, "ssg-blog");
  assert.ok(r.filled.includes("pubDate") && r.filled.includes("updatedDate"));
  assert.match(readMeta(file, "pubDate") as string, /^\d{4}-/);
  assert.ok(r.missing.required.includes("title") && r.missing.required.includes("description"));
});

test("MW3.3 Given dry-run When applyProfile Then 不落盘", () => {
  const file = tmpFile("---\n---\nbody\n");
  const before = readFileSync(file, "utf8");
  const r = applyProfile(file, "pkm-note", { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.match(r.content, /created:/);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("MW3.3 Given 未知 profile / 非法 YAML When applyProfile Then 报错且不毁文件", () => {
  const ok = tmpFile("---\n---\nbody\n");
  assert.throws(() => applyProfile(ok, "nope"), /未知 profile/);

  const bad = tmpFile("---\nk: [unclosed\n---\nbody\n");
  const before = readFileSync(bad, "utf8");
  assert.throws(() => applyProfile(bad, "pkm-note"), /解析失败|拒绝/);
  assert.equal(readFileSync(bad, "utf8"), before);
});

// === MW3.3.1 applyProfile refreshDerived 集成：改正文后刷新 sha256；created 恒定；--set 优先 ===

test("MW3.3.1 Given 改正文后、refreshDerived=true When applyProfile Then sha256 重算并报告 refreshed", () => {
  const file = tmpFile("---\n---\n# A\n原始正文\n");
  applyProfile(file, "llm-wiki", { sets: { type: "note" } });
  const h1 = readMeta(file, "sha256") as string;
  assert.match(h1, /^[0-9a-f]{64}$/);

  // 改正文但保留 frontmatter
  const current = readFileSync(file, "utf8");
  writeFileSync(file, `${current}\n改动后新增正文\n`, "utf8");

  const r = applyProfile(file, "llm-wiki", { refreshDerived: true });
  const h2 = readMeta(file, "sha256") as string;
  assert.notEqual(h2, h1);
  assert.ok(r.refreshed.includes("sha256"));
});

test("MW3.3.1 Given 改正文后、refreshDerived=false When applyProfile Then sha256 保持不变（top-up 回归）", () => {
  const file = tmpFile("---\n---\n# A\n原始正文\n");
  applyProfile(file, "llm-wiki", { sets: { type: "note" } });
  const h1 = readMeta(file, "sha256") as string;

  const current = readFileSync(file, "utf8");
  writeFileSync(file, `${current}\n改动后新增正文\n`, "utf8");

  applyProfile(file, "llm-wiki");
  assert.equal(readMeta(file, "sha256"), h1);
});

test("MW3.3.1 Given refreshDerived=true When applyProfile Then 创建时间字段仍恒定", () => {
  const file = tmpFile("---\n---\nbody\n");
  applyProfile(file, "pkm-note");
  const c1 = readMeta(file, "created");

  const r = applyProfile(file, "pkm-note", { refreshDerived: true });
  assert.equal(readMeta(file, "created"), c1);
  assert.ok(!r.refreshed.includes("created"));
});

test("MW3.3.1 Given refreshDerived=true + --set 同时给字段 When applyProfile Then --set 显式值优先", () => {
  const file = tmpFile("---\n---\nbody\n");
  const r = applyProfile(file, "llm-wiki", {
    sets: { timestamp: "2099-01-01T00:00:00Z", type: "note" },
    refreshDerived: true,
  });
  assert.equal(readMeta(file, "timestamp"), "2099-01-01T00:00:00Z");
  assert.ok(!r.refreshed.includes("timestamp"));
});

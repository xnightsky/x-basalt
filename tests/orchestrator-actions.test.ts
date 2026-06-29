import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";
import { applyRenamePolicy, getAction, parseAction } from "../src/orchestrator/actions.js";
import { splitDocument } from "../src/meta/document.js";
import { getMeta } from "../src/meta/operations.js";
import type { ActionContext } from "../src/orchestrator/types.js";

const docOf = (content: string) => splitDocument(content).doc;

// === CO-D1 内建动作（index / normalize / parse）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §7 动作契约。
// 动作把现有 indexer/meta/parser 能力包装成统一 Action；写动作受 ctx.dryRun 安全闸约束。

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-act-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

test("CO-D1 Given 未知动作名 When getAction Then 抛错并列可用名", () => {
  assert.throws(() => getAction("nope"), /未知动作/);
  assert.equal(getAction("index").name, "index");
});

test("CO-D1 Given add 事件 When index 动作 Then 文件入库可查；unlink 后删除", async () => {
  const dir = mkVault({ "a.md": "---\ntags: [pkm]\n---\nA\n" });
  const dbPath = join(dir, "index.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  const ctx: ActionContext = { vaultPath: dir, indexer, dryRun: true };
  try {
    const r = await getAction("index").run({ path: "a.md", type: "add" }, ctx);
    assert.equal(r.changed, true);
    assert.equal(r.skipped, false);
    indexer.close();
    let engine = new DataviewEngine(dbPath);
    assert.ok(
      engine.query("LIST").rows.some((row) => row["file.path"] === "a.md"),
      "index 后应可查到 a.md",
    );
    engine.close();

    // unlink → 删除索引
    const indexer2 = new VaultIndexer({ vaultPath: dir, dbPath });
    await getAction("index").run({ path: "a.md", type: "unlink" }, { ...ctx, indexer: indexer2 });
    indexer2.close();
    engine = new DataviewEngine(dbPath);
    assert.ok(
      !engine.query("LIST").rows.some((row) => row["file.path"] === "a.md"),
      "unlink 后应查不到 a.md",
    );
    engine.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 不规范 frontmatter When normalize 动作 dryRun Then 不落盘", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const before = readFileSync(join(dir, "a.md"), "utf8");
    const r = await getAction("normalize").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true },
    );
    assert.equal(r.skipped, true);
    assert.equal(r.changed, false);
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), before, "dryRun 不应改文件");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 不规范 frontmatter When normalize 动作非 dryRun Then 落盘且幂等", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const ctx: ActionContext = { vaultPath: dir, indexer, dryRun: false };
    const r1 = await getAction("normalize").run({ path: "a.md", type: "change" }, ctx);
    assert.equal(r1.changed, true);
    assert.match(readFileSync(join(dir, "a.md"), "utf8"), /tags:/, "应迁移单数 tag→tags");
    // 幂等：再跑无变化
    const r2 = await getAction("normalize").run({ path: "a.md", type: "change" }, ctx);
    assert.equal(r2.changed, false);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D1 Given 可解析文件 When parse 动作 Then 成功且不写", async () => {
  const dir = mkVault({ "a.md": "# Title\n[[Link]] #tag\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await getAction("parse").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true },
    );
    assert.equal(r.changed, false);
    assert.equal(r.skipped, false);
    assert.equal(r.error, undefined);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given normalize 落盘 When 提供 onWrite Then 回调该路径（防回环钩子）", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const written: string[] = [];
    await getAction("normalize").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, onWrite: (p) => written.push(p) },
    );
    assert.deepEqual(written, ["a.md"]);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-F2 Given normalize dryRun When 提供 onWrite Then 不回调（未落盘）", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const written: string[] = [];
    await getAction("normalize").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true, onWrite: (p) => written.push(p) },
    );
    assert.deepEqual(written, []);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === CO-D2 parseAction 与 applyRenamePolicy 纯函数 ===
// parseAction 把声明式动作 token（动词 + 空格分隔参数）解析成绑定参数的 Action。
// applyRenamePolicy 在 yaml Document 上处理 rename 键冲突。

test("CO-D2 Given 无参动作名 When parseAction Then 返回对应单例", () => {
  const index = parseAction("index");
  assert.equal(index.name, "index");
  assert.equal(index.write, false);
  const normalize = parseAction("normalize");
  assert.equal(normalize.name, "normalize");
  assert.equal(normalize.write, true);
  const parse = parseAction("parse");
  assert.equal(parse.name, "parse");
  assert.equal(parse.write, false);
});

test("CO-D2 Given 无参动作却带参数 When parseAction Then 抛错", () => {
  assert.throws(() => parseAction("normalize x"), /不接受参数/);
});

test("CO-D2 Given 未知动词 When parseAction Then 抛错并列可用动词", () => {
  assert.throws(() => parseAction("bogus"), /未知动作/);
});

test("CO-D2 Given apply <profile> When parseAction Then 校验存在并返回写动作", () => {
  const a = parseAction("apply pkm-note");
  assert.equal(a.name, "apply");
  assert.equal(a.write, true);
});

test("CO-D2 Given apply 缺参或未知 profile When parseAction Then 抛错", () => {
  assert.throws(() => parseAction("apply"), /apply 需/);
  assert.throws(() => parseAction("apply nope"), /未知 profile/);
});

test("CO-D2 Given set key=value When parseAction Then 返回写动作；格式错误抛错", () => {
  const a = parseAction("set status=active");
  assert.equal(a.name, "set");
  assert.equal(a.write, true);
  assert.throws(() => parseAction("set bad"), /set 需/);
  assert.throws(() => parseAction("set =v"), /set 需/);
});

test("CO-D2 Given unset key When parseAction Then 返回写动作；参数错误抛错", () => {
  const a = parseAction("unset draft");
  assert.equal(a.name, "unset");
  assert.equal(a.write, true);
  assert.throws(() => parseAction("unset a b"), /unset 需/);
});

test("CO-D2 Given rename old new When parseAction Then 返回写动作；参数错误抛错", () => {
  const a = parseAction("rename tag tags");
  assert.equal(a.name, "rename");
  assert.equal(a.write, true);
  assert.throws(() => parseAction("rename only"), /rename 需/);
});

test("CO-D2 Given 源键不存在 When applyRenamePolicy Then no-op", () => {
  const doc = docOf("---\nb: 1\n---\n");
  applyRenamePolicy(doc, "a", "b", "skip");
  assert.equal(getMeta(doc, "b"), 1);
  assert.equal(getMeta(doc, "a"), undefined);
});

test("CO-D2 Given 目标键不存在 When applyRenamePolicy Then 直接重命名", () => {
  const doc = docOf("---\ntag: x\n---\n");
  applyRenamePolicy(doc, "tag", "tags", "skip");
  assert.equal(getMeta(doc, "tags"), "x");
  assert.equal(getMeta(doc, "tag"), undefined);
});

test("CO-D2 Given 冲突且 mode=skip When applyRenamePolicy Then 留原样", () => {
  const doc = docOf("---\ntag: x\ntags: y\n---\n");
  applyRenamePolicy(doc, "tag", "tags", "skip");
  assert.equal(getMeta(doc, "tags"), "y");
  assert.equal(getMeta(doc, "tag"), "x");
});

test("CO-D2 Given 冲突且 mode=overwrite When applyRenamePolicy Then 删目标后重命名", () => {
  const doc = docOf("---\ntag: x\ntags: y\n---\n");
  applyRenamePolicy(doc, "tag", "tags", "overwrite");
  assert.equal(getMeta(doc, "tags"), "x");
  assert.equal(getMeta(doc, "tag"), undefined);
});

test("CO-D2 Given 冲突且 mode=merge 且双方均为列表 When applyRenamePolicy Then 目标在前合并去重", () => {
  const doc = docOf("---\ntag: [a, b]\ntags: [b, c]\n---\n");
  applyRenamePolicy(doc, "tag", "tags", "merge");
  assert.deepEqual(getMeta(doc, "tags"), ["b", "c", "a"]);
  assert.equal(getMeta(doc, "tag"), undefined);
});

test("CO-D2 Given 冲突且 mode=merge 但非列表 When applyRenamePolicy Then 抛错", () => {
  const doc = docOf("---\ntag: x\ntags: y\n---\n");
  assert.throws(() => applyRenamePolicy(doc, "tag", "tags", "merge"), /merge 仅支持/);
});

// === CO-D3 写动作 run() 集成 ===
// 直接 parseAction("...").run(ev, ctx) 跑真实 VaultIndexer + 临时 vault。
// 覆盖 dry-run 闸、apply/set/unset/rename、ifExists 冲突策略、unlink 跳过。

test("CO-D3 Given apply 动作 dryRun Then 不落盘", async () => {
  const dir = mkVault({ "a.md": "---\n---\n# A\n正文\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const before = readFileSync(join(dir, "a.md"), "utf8");
    const r = await parseAction("apply pkm-note").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: true, ifExists: "skip" },
    );
    assert.equal(r.skipped, true);
    assert.equal(r.changed, false);
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), before);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given apply 动作非 dryRun Then 落盘并保留正文", async () => {
  const dir = mkVault({ "a.md": "---\n---\n# A\n正文\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("apply pkm-note").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "skip" },
    );
    assert.equal(r.changed, true);
    const content = readFileSync(join(dir, "a.md"), "utf8");
    assert.match(content, /created:/);
    assert.match(content, /modified:/);
    assert.match(content, /# A/);
    assert.match(content, /正文/);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given set 动作非 dryRun Then 落盘", async () => {
  const dir = mkVault({ "a.md": "---\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("set status=active").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "skip" },
    );
    assert.equal(r.changed, true);
    assert.match(readFileSync(join(dir, "a.md"), "utf8"), /status: active/);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given unset 动作非 dryRun Then 删除键", async () => {
  const dir = mkVault({ "a.md": "---\ndraft: true\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("unset draft").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "skip" },
    );
    assert.equal(r.changed, true);
    assert.doesNotMatch(readFileSync(join(dir, "a.md"), "utf8"), /draft:/);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given rename 冲突且 ifExists=skip Then 跳过不改", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\ntags: y\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("rename tag tags").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "skip" },
    );
    assert.equal(r.changed, false);
    const content = readFileSync(join(dir, "a.md"), "utf8");
    assert.match(content, /tag: x/);
    assert.match(content, /tags: y/);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given rename 冲突且 ifExists=overwrite Then 覆盖目标", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\ntags: y\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("rename tag tags").run(
      { path: "a.md", type: "change" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "overwrite" },
    );
    assert.equal(r.changed, true);
    const content = readFileSync(join(dir, "a.md"), "utf8");
    assert.match(content, /tags: x/);
    assert.doesNotMatch(content, /tag:/);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-D3 Given 写动作遇到 unlink 事件 Then 跳过", async () => {
  const dir = mkVault({ "a.md": "---\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const r = await parseAction("set x=1").run(
      { path: "a.md", type: "unlink" },
      { vaultPath: dir, indexer, dryRun: false, ifExists: "skip" },
    );
    assert.equal(r.skipped, true);
    assert.equal(r.changed, false);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

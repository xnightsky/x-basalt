import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { registerBuiltinOps } from "../src/orchestrator/ops.js";
import { resolve } from "../src/orchestrator/registry.js";
import type { Op, OpContext, Row } from "../src/orchestrator/types.js";

// === 模块级初始化：注册全部内建算子（registerBuiltinOps 不自动执行，测试模块显式调用）===
registerBuiltinOps();

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-opt-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

// === Op-D1 内建算子元信息 ===
// 设计：docs/design/pipeline-op-model.md §3.2 — 每个 Op 名称/写标记/逐行独立性
// rowwise 全部为 true（现有 7 个动作逐行独立，可切批并发）

test("Op-D1 Given 注册后 resolve 无参算子 Then name/write/rowwise 正确", () => {
  const index = resolve("index");
  assert.equal(index.name, "index");
  assert.equal(index.write, false);
  assert.equal(index.rowwise, true);

  const parse = resolve("parse");
  assert.equal(parse.name, "parse");
  assert.equal(parse.write, false);
  assert.equal(parse.rowwise, true);

  const normalize = resolve("normalize");
  assert.equal(normalize.name, "normalize");
  assert.equal(normalize.write, true);
  assert.equal(normalize.rowwise, true);
});

test("Op-D1 Given 注册后 resolve 带参算子 Then name/write/rowwise 正确", () => {
  const apply = resolve("apply pkm-note");
  assert.equal(apply.name, "apply");
  assert.equal(apply.write, true);
  assert.equal(apply.rowwise, true);

  const set = resolve("set status=active");
  assert.equal(set.name, "set");
  assert.equal(set.write, true);
  assert.equal(set.rowwise, true);

  const unset = resolve("unset draft");
  assert.equal(unset.name, "unset");
  assert.equal(unset.write, true);
  assert.equal(unset.rowwise, true);

  const rename = resolve("rename title heading");
  assert.equal(rename.name, "rename");
  assert.equal(rename.write, true);
  assert.equal(rename.rowwise, true);
});

// === Op-D2 parse 只读算子批量顺序 ===
// 3 个文件依次排列，OpOutcome.rows 应保持入参顺序、无失败

test("Op-D2 Given 3 个文件 When parse 算子批跑 Then rows 顺序与入参一致且无 failed", async () => {
  const dir = mkVault({
    "a.md": "# A\n内容\n",
    "b.md": "# B\n内容\n",
    "c.md": "# C\n内容\n",
  });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const parse = resolve("parse") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [
      { path: "a.md", event: "change", fields: {} },
      { path: "b.md", event: "change", fields: {} },
      { path: "c.md", event: "change", fields: {} },
    ];

    const outcome = await parse.run(rows, ctx);

    assert.equal(outcome.failed.length, 0);
    assert.equal(outcome.rows.length, 3);
    assert.equal(outcome.rows[0]!.path, "a.md");
    assert.equal(outcome.rows[1]!.path, "b.md");
    assert.equal(outcome.rows[2]!.path, "c.md");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D3 写算子在 dryRun 下不落盘 ===
// normalize 是写动作（write=true），dryRun 时应跳过落盘文件内容不变

test("Op-D3 Given normalize 算子 dryRun=true When run Then 文件内容不变且 rows 正常通过", async () => {
  const dir = mkVault({ "a.md": "---\ntag: x\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const before = readFileSync(join(dir, "a.md"), "utf8");

    const normalize = resolve("normalize") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [{ path: "a.md", fields: {} }];

    const outcome = await normalize.run(rows, ctx);

    // dryRun 下行仍在 rows（Action 返回 skipped=true 但 Op 不吞行）
    assert.equal(outcome.rows.length, 1);
    assert.equal(outcome.rows[0]!.path, "a.md");
    assert.equal(outcome.failed.length, 0);
    // 文件未被修改
    assert.equal(readFileSync(join(dir, "a.md"), "utf8"), before);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D4 某行失败时隔离 ===
// parse 算子：a.md 正常，nope.md 不存在 → a.md 进 rows、nope.md 进 failed

test("Op-D4 Given 一个正常文件和一个不存在的文件 When parse 算子 Then 正常行进 rows、失败行进 failed", async () => {
  const dir = mkVault({ "a.md": "# A\n内容\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const parse = resolve("parse") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [
      { path: "a.md", fields: {} },
      { path: "nope.md", fields: {} }, // 文件不存在 → 读文件抛错
    ];

    const outcome = await parse.run(rows, ctx);

    // a.md 正常
    assert.equal(outcome.rows.length, 1);
    assert.equal(outcome.rows[0]!.path, "a.md");
    // nope.md 进入 failed
    assert.equal(outcome.failed.length, 1);
    assert.equal(outcome.failed[0]!.path, "nope.md");
    assert.equal(outcome.failed[0]!.op, "parse");
    assert.ok(outcome.failed[0]!.error, "失败原因不应为空");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D5 registerBuiltinOps + resolve 完整链路 ===
// 验证 apply llm-wiki 注册、解析、元信息一条龙可用

test("Op-D5 Given registerBuiltinOps 已调 When resolve('apply llm-wiki') Then 拿到的算子元信息正确", () => {
  const op = resolve("apply llm-wiki");
  assert.equal(op.name, "apply");
  assert.equal(op.write, true);
  assert.equal(op.rowwise, true);
});

// === Op-D7 写算子改文件时 changed[] 含该 path ===
// set 算子 dryRun=false 且文件有变化 → outcome.changed 含路径、outcome.skipped 不含

test("Op-D7 Given 写算子（set）dryRun=false 改了文件 When run Then outcome.changed 含路径", async () => {
  const dir = mkVault({ "a.md": "---\nkey: old\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const set = resolve("set key=new") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: false };
    const rows: Row[] = [{ path: "a.md", fields: {} }];

    const outcome = await set.run(rows, ctx);

    assert.deepEqual(outcome.changed, ["a.md"]);
    assert.equal(outcome.skipped.length, 0);
    assert.equal(outcome.failed.length, 0);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D8 dryRun 下写算子的行进 skipped[] 而不进 changed[] ===
// set 算子 dryRun=true → outcome.skipped 含路径、outcome.changed 为空

test("Op-D8 Given 写算子（set）dryRun=true When run Then outcome.skipped 含路径、changed 为空", async () => {
  const dir = mkVault({ "a.md": "---\nkey: old\n---\nbody\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const set = resolve("set key=new") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [{ path: "a.md", fields: {} }];

    const outcome = await set.run(rows, ctx);

    assert.deepEqual(outcome.skipped, ["a.md"]);
    assert.equal(outcome.changed.length, 0);
    assert.equal(outcome.failed.length, 0);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D9 只读算子（parse）的 changed[] 为空 ===
// parse 不写任何东西 → outcome.changed 恒为空数组

test("Op-D9 Given 只读算子（parse）When run Then outcome.changed 为空", async () => {
  const dir = mkVault({ "a.md": "# A\nOK\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const parse = resolve("parse") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [{ path: "a.md", fields: {} }];

    const outcome = await parse.run(rows, ctx);

    assert.equal(outcome.changed.length, 0);
    assert.equal(outcome.skipped.length, 0);
    assert.equal(outcome.failed.length, 0);
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// === Op-D6 event 缺省时默认 "change" ===
// row.event 未指定时 Op.run 应投影为 ChangeEvent.type = "change"

test("Op-D6 Given row.event 未指定（undefined）When parse 算子 Then 视为 change 正常处理", async () => {
  const dir = mkVault({ "a.md": "# A\nOK\n" });
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath: join(dir, "i.db") });
  try {
    const parse = resolve("parse") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
    const rows: Row[] = [{ path: "a.md", fields: {} }]; // 不设 event

    const outcome = await parse.run(rows, ctx);

    assert.equal(outcome.failed.length, 0);
    assert.equal(outcome.rows.length, 1);
    assert.equal(outcome.rows[0]!.path, "a.md");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

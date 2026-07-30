/**
 * Bases P2b 片二：`.obsidian/types.json` 可选只读显式类型表端到端测试。
 *
 * 建库模式照 tests/base-engine.test.ts：VaultIndexer rebuild 到临时库 → close → BaseEngine 只读查询。
 * 每个场景编号独立 test() 并在注释标号（计划 docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md
 * 「关键取舍」#5-#7；语法 §5.1；设计 §8.2）：
 * - BASE-TYPE-001：合法 types.json → 显式类型优先（date 参与排序/投影；text 抑制推断升级）；
 *   附多根合并同名冲突（warning + 先根优先，暂定）；
 * - BASE-TYPE-002：全部根缺失 types.json → compat info（至多一条）+ 按 YAML 值推断，查询正常；
 * - BASE-TYPE-003：非法 JSON / 顶层无 types map / 未知类型名 → warning + 保守推断，绝不写回；
 * - TYPE-004（暂定，待 oracle）：声明与实际值冲突 → 行级 base/property-type-mismatch warning，
 *   值按运行时类型参与（混合类型照走 compareValues 类型错误，不静默字符串比较）。
 *
 * fixture：tests/fixtures/bases/p2/types/ 下 5 个独立 vault（不动 p1 既有断言）；
 * BASE-TYPE-002 直接复用 p1/vault（无 .obsidian/）。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BaseEngine, type BaseQueryResult } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/bases", import.meta.url));
const p1Vault = join(fixtureRoot, "p1", "vault");
const typedVault = join(fixtureRoot, "p2", "types", "vault-typed");
const typedBVault = join(fixtureRoot, "p2", "types", "vault-typed-b");
const invalidJsonVault = join(fixtureRoot, "p2", "types", "vault-invalid-json");
const noTypesVault = join(fixtureRoot, "p2", "types", "vault-no-types");
const unknownTypeVault = join(fixtureRoot, "p2", "types", "vault-unknown-type");

let tmpDir: string;
let p1Db: string; // p1 vault（无 .obsidian/，BASE-TYPE-002）
let typedDb: string; // vault-typed 单根
let multiTypedDb: string; // vault-typed + vault-typed-b 多根（同名冲突）
let invalidJsonDb: string;
let noTypesDb: string;
let unknownTypeDb: string;
let engine: BaseEngine;

// 各场景 vault 独立建库（fixture 小，rebuild 成本低；互不污染）。
before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-types-"));
  const build = async (name: string, vaultPath: string | string[]): Promise<string> => {
    const dbPath = join(tmpDir, name);
    const idx = new VaultIndexer({ vaultPath, dbPath });
    await idx.rebuild();
    idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开
    return dbPath;
  };
  p1Db = await build("p1.db", p1Vault);
  typedDb = await build("typed.db", typedVault);
  multiTypedDb = await build("multi-typed.db", [typedVault, typedBVault]);
  invalidJsonDb = await build("invalid-json.db", invalidJsonVault);
  noTypesDb = await build("no-types.db", noTypesVault);
  unknownTypeDb = await build("unknown-type.db", unknownTypeVault);
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 结果中的 error 级诊断（主路径断言其为空）。 */
function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** 按 machine-readable reason 过滤诊断。 */
function byReason(r: BaseQueryResult, reason: string) {
  return r.diagnostics.filter((d) => d.reason === reason);
}

// ---------- BASE-TYPE-001：显式类型优先 ----------

// BASE-TYPE-001：声明 date 的属性按日期参与排序与投影（due 两值跨月，字符串序与日期序一致，
// 关键断言在投影形状：date 包装 = 显式升级生效；合法 types.json 不产任何 invalid-schema 诊断）
test("BASE-TYPE-001: 声明 date 的属性按日期排序与投影", () => {
  const r = engine.query({
    basePath: join(typedVault, "views", "typed.base"),
    view: "byDue",
    dbPath: typedDb,
    vaultRoots: [typedVault],
  });
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["TextTask.md", "NumTask.md"], // due 2026-07-01 < 2026-08-01
  );
  assert.deepEqual(r.rows[1]?.["due"], { type: "date", value: "2026-08-01" });
  assert.ok(!r.diagnostics.some((d) => d.rule === "base/invalid-schema"));
});

// BASE-TYPE-001：声明 text 抑制 parseDateLike/parseWikilinkValue 推断升级（显式声明优先）；
// 未声明的对照列 rawdate（同形态日期字符串）仍推断升级为 date——同查询内两列对比即证据
test("BASE-TYPE-001: 声明 text 抑制 date 推断升级", () => {
  const r = engine.query({
    basePath: join(typedVault, "views", "typed.base"),
    view: "versionProj",
    dbPath: typedDb,
    vaultRoots: [typedVault],
  });
  assert.deepEqual(errorsOf(r), []);
  // 无显式 sort → file.path ASC：NumTask.md 在前
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(row["file.name"], "NumTask.md");
  assert.equal(row["version"], "2026-01-01"); // 原样字符串（未升级为 date 包装）
  assert.deepEqual(row["rawdate"], { type: "date", value: "2026-02-02" }); // 对照：推断升级仍在
});

// BASE-TYPE-001 附（计划「关键取舍」#5）：多根逐根合并，同名冲突 → warning + 先根优先（暂定）。
// vault-typed 先根声明 rating=number、vault-typed-b 后根声明 rating=date；
// 先根优先时 BTask 的 rating=7 按 number 处理——filter `rating > 1` 通过且不产声明冲突 warning
test("BASE-TYPE-001: 多根同名冲突 warning + 先根优先（暂定）", () => {
  const r = engine.query({
    basePath: join(typedVault, "views", "typed.base"),
    view: "ratingGt",
    dbPath: multiTypedDb,
    vaultRoots: [typedVault, typedBVault],
  });
  assert.deepEqual(errorsOf(r), []);
  // 冲突 warning：message 含属性名与两个声明
  const conflicts = byReason(r, "types_json_conflict");
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0]?.message ?? "", /"rating"/);
  assert.match(conflicts[0]?.message ?? "", /先根优先/);
  // 先根（number）生效：BTask rating=7 通过 filter；TextTask 的 text rating 仍按 number 声明冲突剔除
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["BTask.md", "NumTask.md"], // 无显式 sort → 命名空间 file.path ASC（vault-typed-b < vault-typed/）
  );
  // 若后根 date 声明生效，BTask 的 number 值会产声明冲突 warning——断言其不存在
  const mismatches = r.diagnostics.filter((d) => d.rule === "base/property-type-mismatch");
  assert.ok(mismatches.every((d) => !d.message.includes("BTask")));
});

// ---------- BASE-TYPE-002：缺失文件 → 推断 + compat info ----------

// BASE-TYPE-002：p1 vault 无 .obsidian/ → 按 YAML 值推断 + 恰好一条 compat info（不刷屏），查询正常
test("BASE-TYPE-002: types 文件缺失 → compat info 至多一条 + 推断不失败", () => {
  const r = engine.query({
    basePath: join(p1Vault, "views", "default.base"),
    dbPath: p1Db,
    vaultRoots: [p1Vault],
  });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 7); // p1 vault 全量 7 篇 .md，行为不回归
  const infos = byReason(r, "types_json_missing");
  assert.equal(infos.length, 1);
  assert.equal(infos[0]?.severity, "info");
  assert.equal(infos[0]?.rule, "base/invalid-schema"); // 复用既有 rule，不新增
});

// ---------- BASE-TYPE-003：非法/未知 → warning + 保守推断，绝不写回 ----------

// BASE-TYPE-003：非法 JSON → warning + 全量回退推断（due 仍按严格日期推断升级）+ 文件内容不变
test("BASE-TYPE-003: 非法 JSON → warning + 回退推断 + 不写回", () => {
  const typesFile = join(invalidJsonVault, ".obsidian", "types.json");
  const beforeContent = readFileSync(typesFile, "utf8");
  const r = engine.query({
    basePath: join(invalidJsonVault, "views", "simple.base"),
    dbPath: invalidJsonDb,
    vaultRoots: [invalidJsonVault],
  });
  assert.deepEqual(errorsOf(r), []);
  const warnings = byReason(r, "types_json_invalid");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.severity, "warning");
  assert.equal(warnings[0]?.rule, "base/invalid-schema");
  // 保守推断：未读入任何声明，due 走既有 parseDateLike 推断升级
  assert.deepEqual(r.rows[0]?.["due"], { type: "date", value: "2026-08-01" });
  // 绝不写回：查询前后文件字节一致
  assert.equal(readFileSync(typesFile, "utf8"), beforeContent);
});

// BASE-TYPE-003：顶层无 types map → warning + 全量回退推断
test("BASE-TYPE-003: 顶层无 types map → warning + 回退推断", () => {
  const r = engine.query({
    basePath: join(noTypesVault, "views", "simple.base"),
    dbPath: noTypesDb,
    vaultRoots: [noTypesVault],
  });
  assert.deepEqual(errorsOf(r), []);
  const warnings = byReason(r, "types_json_no_types_map");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.severity, "warning");
  assert.deepEqual(r.rows[0]?.["due"], { type: "date", value: "2026-08-01" });
});

// BASE-TYPE-003：未知类型名 → 该条目忽略 + warning（不崩）；类型名大小写不敏感收纳
// （"DATE" → date 合法声明，不产 warning；"Score" 不可识别被忽略，rating 无声明）
test("BASE-TYPE-003: 未知类型名忽略 + warning；类型名大小写不敏感", () => {
  const r = engine.query({
    basePath: join(unknownTypeVault, "views", "simple.base"),
    dbPath: unknownTypeDb,
    vaultRoots: [unknownTypeVault],
  });
  assert.deepEqual(errorsOf(r), []);
  const warnings = byReason(r, "types_json_unknown_type");
  assert.equal(warnings.length, 1); // 仅 Score 一条；DATE 大小写收纳为合法 date，不报
  assert.match(warnings[0]?.message ?? "", /"Score"/);
  assert.match(warnings[0]?.message ?? "", /"rating"/);
  // rating 声明被忽略 → number 原样；due 声明（DATE→date）生效
  assert.equal(r.rows[0]?.["rating"], 5);
  assert.deepEqual(r.rows[0]?.["due"], { type: "date", value: "2026-08-01" });
});

// ---------- TYPE-004（暂定，待 oracle）：声明与实际值冲突 ----------

// TYPE-004（暂定，待 oracle）：声明 number、值为 text → 行级 base/property-type-mismatch warning，
// 值按运行时类型继续参与求值（不强制转换）；filter `rating > 1` 对该行产 compareValues 类型错误
// 而非静默字符串比较（类型错误行按不通过处理 → 剔除，不给误导性结果）
test("TYPE-004（暂定待 oracle）: 声明 number 值 text → mismatch warning + 不静默字符串比较", () => {
  const r = engine.query({
    basePath: join(typedVault, "views", "typed.base"),
    view: "ratingGt",
    dbPath: typedDb,
    vaultRoots: [typedVault],
  });
  assert.deepEqual(errorsOf(r), []);
  // TextTask（rating="high"）被剔除：仅 NumTask（rating=5）通过
  assert.equal(r.total, 1);
  assert.equal(r.rows[0]?.["file.name"], "NumTask.md");
  // 声明冲突 warning：message 含声明类型与实际类型 + 行定位（filter 中读取一次 → 恰好一条）
  const declared = r.diagnostics.filter(
    (d) => d.rule === "base/property-type-mismatch" && d.message.includes("声明类型 number"),
  );
  assert.equal(declared.length, 1);
  assert.match(declared[0]?.message ?? "", /实际值类型 string/);
  assert.match(declared[0]?.message ?? "", /TextTask\.md/);
  assert.equal(declared[0]?.severity, "warning");
  // 值按运行时类型（string）参与：compareValues 混合类型照走类型错误，证明没有静默字符串比较
  assert.ok(
    r.diagnostics.some(
      (d) => d.rule === "base/property-type-mismatch" && d.message.includes("不参与有序比较"),
    ),
  );
});

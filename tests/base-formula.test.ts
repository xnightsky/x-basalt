/**
 * Bases 无头引擎 P2a 端到端场景测试：typed formulas 核心（片二）。
 *
 * fixture：tests/fixtures/bases/p1/vault-formula（独立 vault——不并入 p1/vault，
 * 否则新增 .md 会改变 P1 全量行数断言；3 篇 .md + 3 个 .base，设计见各文件头注释）。
 * 建库模式同 tests/base-engine.test.ts：VaultIndexer rebuild 到临时库 → 只读 BaseEngine。
 *
 * 每个场景编号独立 test() 并注释标号（可追溯至
 * docs/testing/2026-07-22-bases-scenario-matrix.md §5/§7）：
 * BASE-FORM-001..006、BASE-SEC-006、BASE-TYPE-005/006（暂定机制半段，待 oracle）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BASE_RULES,
  BaseEngine,
  type BaseQueryOptions,
  type BaseQueryResult,
} from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p1/vault-formula", import.meta.url));

/** .base 文件绝对路径（engine 内部 resolve + 越界检查，测试直接给绝对路径）。 */
function baseFile(name: string): string {
  return join(vaultPath, "views", name);
}

let tmpDir: string;
let dbPath: string;
let engine: BaseEngine;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-formula-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 查询便捷入口。 */
function query(
  base: string,
  view?: string,
  extra?: Partial<Pick<BaseQueryOptions, "limits" | "clock">>,
): BaseQueryResult {
  return engine.query({
    basePath: baseFile(base),
    view,
    dbPath,
    vaultRoots: [vaultPath],
    ...extra,
  });
}

/** 结果中的 error 级诊断（多数主路径断言其为空）。 */
function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** FORM-006 固定时钟（模块级：不捕获闭包变量）。 */
const clockA = () => new Date(Date.UTC(2026, 6, 27, 12, 0, 0));
const clockB = () => new Date(Date.UTC(2026, 6, 28, 12, 0, 0));

/** 指定严重级的诊断列表。 */
function diagsOf(
  r: BaseQueryResult,
  severity: "error" | "warning",
): BaseQueryResult["diagnostics"] {
  return r.diagnostics.filter((d) => d.severity === severity);
}

// ---------- BASE-FORM：typed formulas ----------

// BASE-FORM-001：常量与简单算术公式输出类型/值正确；除零 → 行级错误 + cell null
test("BASE-FORM-001: 常量/算术公式值正确，除零产行级错误", () => {
  const r = query("formulas.base", "constants");
  assert.deepEqual(errorsOf(r), []);
  // 无显式 sort → file.path ASC：Numeric.md / Schedule.md / Task.md。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Numeric.md", "Schedule.md", "Task.md"],
  );
  for (const row of r.rows) {
    assert.equal(row["formula.chain_a"], 42); // 40 + 2
    assert.equal(row["formula.chain_b"], 50); // formula.chain_a + 8
    assert.equal(row["formula.negative"], -3); // -(1 + 2)
  }
  // double_priority = priority * 2：Numeric(3)→6 / Schedule(5)→10 / Task(1)→2。
  assert.deepEqual(
    r.rows.map((row) => row["formula.double_priority"]),
    [6, 10, 2],
  );

  // 除零：1 / 0 → 行级类型错误（warning），cell 置 null，查询不中断。
  const dz = query("formulas.base", "divzero");
  assert.deepEqual(errorsOf(dz), []);
  assert.equal(dz.rows.length, 3);
  for (const row of dz.rows) {
    assert.equal(row["formula.div_zero"], null);
  }
  const warnings = diagsOf(dz, "warning").filter((d) => d.rule === BASE_RULES.propertyTypeMismatch);
  assert.equal(warnings.length, 3); // 每行一条
  assert.match(warnings[0]?.message ?? "", /除零/);
});

// BASE-FORM-002：公式引用 note 属性（due 升级为 Date）与 file 属性（file.ctime 见 FORM-006）
test("BASE-FORM-002: 公式引用 note/file 属性", () => {
  const r = query("formulas.base", "refs");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1);
  const row = r.rows[0] as Record<string, unknown>;
  // due: "2026-07-27" → DateValue（date 精度）；due + 1day → 次日。
  assert.deepEqual(row["formula.due_day"], { type: "date", value: "2026-07-27" });
  assert.deepEqual(row["formula.due_plus"], { type: "date", value: "2026-07-28" });
  // note 属性直接投影同样升级（读取点单点升级，投影与比较同一形态）。
  assert.deepEqual(row["due"], { type: "date", value: "2026-07-27" });
  assert.deepEqual(row["created"], { type: "datetime", value: "2026-07-01T10:30:00.000Z" });
});

// BASE-FORM-003：公式引用另一公式，拓扑序与 YAML 键序无关（fixture 中 chain_b 先于 chain_a 声明）
test("BASE-FORM-003: 公式间引用拓扑排序不依赖 YAML 键序", () => {
  const r = query("formulas.base", "constants");
  assert.deepEqual(errorsOf(r), []);
  // YAML 键序 chain_b 在前、依赖序 chain_a 在前；求值结果不受键序影响。
  assert.equal(r.rows[0]?.["formula.chain_a"], 42);
  assert.equal(r.rows[0]?.["formula.chain_b"], 50);
});

// BASE-FORM-004：公式循环 → base/formula-cycle（error），message 含完整循环链，执行不挂死
test("BASE-FORM-004: 循环依赖产 base/formula-cycle 含完整循环链", () => {
  const r = query("cycle.base");
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  const err = r.diagnostics.find(
    (d) => d.rule === BASE_RULES.formulaCycle && d.severity === "error",
  );
  assert.ok(err !== undefined, "应产 base/formula-cycle error");
  assert.match(err.message, /a → b → a/); // 完整循环链
});

// BASE-FORM-005：公式运行时类型错误 → 行级 warning + cell null，其余行正常
test("BASE-FORM-005: 类型错误公式行级 warning + cell null，其余行正常", () => {
  const r = query("typed-error.base");
  assert.deepEqual(errorsOf(r), []); // 行级错误不升级为 error
  assert.equal(r.total, 3); // 查询不中断
  const byName = new Map(r.rows.map((row) => [row["file.name"], row]));
  // Numeric.md：status 为 number 7 → status + 1 = 8（正常行）。
  assert.equal(byName.get("Numeric.md")?.["formula.bad"], 8);
  // Schedule/Task：status 为字符串 → 类型错误 → cell null。
  assert.equal(byName.get("Schedule.md")?.["formula.bad"], null);
  assert.equal(byName.get("Task.md")?.["formula.bad"], null);
  // 行级 warning 恰好两条（两行类型错误），message 含行 file.path。
  const warnings = diagsOf(r, "warning").filter((d) => d.rule === BASE_RULES.propertyTypeMismatch);
  assert.equal(warnings.length, 2);
  for (const w of warnings) {
    assert.match(w.message, /行：(Schedule|Task)\.md/);
  }
});

// BASE-FORM-006：today()/now() 注入固定 clock——同 clock 两次查询字节一致；不同 clock 结果不同
test("BASE-FORM-006: 固定 clock 两次查询字节一致，不同 clock 结果不同", () => {
  const a1 = query("formulas.base", "clock", { clock: clockA });
  const a2 = query("formulas.base", "clock", { clock: clockA });
  assert.deepEqual(errorsOf(a1), []);
  // 字节稳定口径同 P1：同 DB+Base+clock 连续两次 JSON.stringify 全等。
  assert.equal(JSON.stringify(a1), JSON.stringify(a2));
  const daysA = a1.rows[0]?.["formula.days_open"];
  assert.ok(typeof daysA === "number"); // (now() - file.ctime) / 1day → duration/duration → number
  const b = query("formulas.base", "clock", { clock: clockB });
  const daysB = b.rows[0]?.["formula.days_open"];
  assert.ok(typeof daysB === "number");
  assert.notEqual(daysA, daysB); // 时钟确实被消费
});

// ---------- BASE-SEC：公式依赖图预算 ----------

// BASE-SEC-006：超深/超大公式链 → base/execution-budget，message 含依赖路径
test("BASE-SEC-006: 依赖链超深/节点超产 execution-budget 含依赖路径", () => {
  // 深度维度：fixture 最深链 chain_b → chain_a（深度 2），上限收窄为 1 触发。
  const deep = query("formulas.base", "constants", { limits: { maxFormulaDepth: 1 } });
  assert.deepEqual(deep.rows, []);
  const depthErr = deep.diagnostics.find(
    (d) => d.rule === BASE_RULES.executionBudget && d.severity === "error",
  );
  assert.ok(depthErr !== undefined);
  assert.match(depthErr.message, /依赖路径：chain_b → chain_a/);

  // 节点数维度：8 条公式 > 上限 2。
  const wide = query("formulas.base", "constants", { limits: { maxFormulaNodes: 2 } });
  assert.deepEqual(wide.rows, []);
  const nodeErr = wide.diagnostics.find(
    (d) => d.rule === BASE_RULES.executionBudget && d.severity === "error",
  );
  assert.ok(nodeErr !== undefined);
  assert.match(nodeErr.message, /公式数量 8 超过预算上限 2/);
});

// ---------- BASE-TYPE：暂定机制 e2e 半段（待 oracle） ----------

// BASE-TYPE-005（暂定机制，待 oracle）：日期字符串比较/排序可用（升级为 DateValue 按 epoch）
test("BASE-TYPE-005[待 oracle]: 日期字符串升级后可比较可排序", () => {
  // 排序：due ASC → Numeric(07-01) < Schedule(07-27) < Task(08-10)。
  const sorted = query("formulas.base", "by-due");
  assert.deepEqual(errorsOf(sorted), []);
  assert.deepEqual(
    sorted.rows.map((row) => row["file.name"]),
    ["Numeric.md", "Schedule.md", "Task.md"],
  );
  // 比较：due < "2026-08-01"（字面量对称升级）→ Numeric / Schedule。
  const dueBefore = query("formulas.base", "due-before");
  assert.deepEqual(errorsOf(dueBefore), []);
  assert.deepEqual(
    dueBefore.rows.map((row) => row["file.name"]),
    ["Numeric.md", "Schedule.md"],
  );
});

// BASE-TYPE-006（暂定机制，待 oracle）：frontmatter wikilink 投影为 { type: "link", ... }
test("BASE-TYPE-006[待 oracle]: frontmatter wikilink 投影为 link 包装形状", () => {
  const r = query("formulas.base", "links");
  assert.deepEqual(errorsOf(r), []);
  const byName = new Map(r.rows.map((row) => [row["file.name"], row]));
  assert.deepEqual(byName.get("Schedule.md")?.["related"], { type: "link", path: "alpha" });
  assert.deepEqual(byName.get("Task.md")?.["related"], { type: "link", path: "schedule" });
  assert.equal(byName.get("Numeric.md")?.["related"], null); // 无 related → 缺失列 null
});

// ---------- 公式参与 filter（P2a 接线完整性） ----------

// 公式在 filter 中可引用（formula.double_priority > 5）：Numeric(6)/Schedule(10) 通过，Task(2) 不通过
test("公式在 filter 中求值（FORM-002 延伸）", () => {
  const r = query("formulas.base", "filter-formula");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Numeric.md", "Schedule.md"],
  );
});

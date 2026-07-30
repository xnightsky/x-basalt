/**
 * 读侧 YAML 引擎 → Bases 日期语义的端到端回归（2026-07-27 修复批次）。
 *
 * 锁的是一个**静默错**：不加引号的 frontmatter 日期（`due: 2026-07-27`，Obsidian
 * 自己写日期属性的实际形态）曾被 gray-matter 内置 js-yaml（YAML 1.1 `!!timestamp`）
 * 解析成 JS Date，落库变 `"2026-07-27T00:00:00.000Z"`（含毫秒），超出
 * values.ts `parseDateLike` 的严格 ISO 形态 → 退化为字符串 → 日期比较失效，
 * 但查询仍以退出码 0「成功」（只有行级 warning + cell null）。
 *
 * 因此断言的重点不是「能跑」，而是：加引号与不加引号**产生完全相同的 typed value**，
 * 且全程 0 条 base/property-type-mismatch。根因单元测在 tests/parser.test.ts。
 *
 * fixture：tests/fixtures/bases/p1/vault-dates（独立 vault——vault-formula 与 p1/vault
 * 的用例都断言了固定行数，加 .md 会打破）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_RULES, BaseEngine, type BaseQueryResult } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p1/vault-dates", import.meta.url));

let tmpDir: string;
let dbPath: string;
let engine: BaseEngine;
let result: BaseQueryResult;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-dates-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开
  engine = new BaseEngine();
  result = engine.query({
    basePath: join(vaultPath, "views", "dates.base"),
    dbPath,
    vaultRoots: [vaultPath],
    // 固定 clock：本用例不比较 now()，但保持与其余 base 用例同一确定性纪律。
    clock: () => new Date("2026-07-20T00:00:00.000Z"),
  });
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 按 label 取行（view 已按 label ASC 排序，取值不依赖行序）。 */
function row(label: string): Record<string, unknown> {
  const hit = result.rows.find((r) => r["label"] === label);
  assert.ok(hit !== undefined, `未找到 label=${label} 的行`);
  return hit as Record<string, unknown>;
}

test("不加引号的 YAML 日期与加引号形态产生完全相同的 typed value", () => {
  assert.deepEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.equal(result.total, 2);
  const q = row("quoted");
  const u = row("unquoted");
  // 核心断言：两种写法逐字段全等——写法差异不得造成语义差异。
  assert.deepEqual(u["due"], q["due"]);
  assert.deepEqual(u["at"], q["at"]);
});

test("日期精度正确：YYYY-MM-DD → date、YYYY-MM-DDTHH:mm:ss → datetime", () => {
  const u = row("unquoted");
  // 回归点：若改用「parseDateLike 接受小数秒」的修法，date 会退化成 datetime；
  // 走读侧引擎修根因才能保住 date 精度，故这里锁 type 而不只锁可比较。
  assert.deepEqual(u["due"], { type: "date", value: "2026-07-27" });
  assert.deepEqual(u["at"], { type: "datetime", value: "2026-07-01T10:30:00.000Z" });
});

test("不加引号日期可参与比较与相等，且不产生行级类型错误诊断", () => {
  for (const label of ["quoted", "unquoted"]) {
    const r = row(label);
    // 与日期字面量相等、跨精度有序比较均须得到 boolean，而非 null（null = 求值出错后的塌缩）。
    assert.equal(r['due == "2026-07-27"'], true, `${label}: due 应等于日期字面量`);
    assert.equal(r["at < due"], true, `${label}: at(7-01) 应早于 due(7-27)`);
  }
  // 静默错的判据：旧实现下这里会有 property-type-mismatch warning 而查询仍「成功」。
  assert.deepEqual(
    result.diagnostics.filter((d) => d.rule === BASE_RULES.propertyTypeMismatch),
    [],
    "不得出现任何行级类型错误",
  );
});

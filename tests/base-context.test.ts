/**
 * Bases 显式动态上下文测试（2026-07-28 覆盖率片六，BASE-CTX-001..004；
 * 计划 docs/plans/2026-07-28-bases-functions.md）。
 *
 * 口径（用户 2026-07-28 拍板）：
 * - **CTX-001 做**：显式 `contextFile` 驱动 `this.*`（不给 → `base/dynamic-context-required`）；
 * - **CTX-002/003 不做但报诊断**：Markdown 内嵌 ```base 代码块、`![[View.base#Name]]` embed
 *   在入口形态检查处被拒，消息说清「不做 + 为什么 + 该怎么写」；
 * - **CTX-004 不做**：无隐式环境状态（没有「当前活动文件」这回事）——由「不给 contextFile
 *   即拒绝」这条覆盖。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_RULES, BaseEngine, type BaseQueryResult } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p2/group/vault", import.meta.url));

function baseFile(name: string): string {
  return join(vaultPath, "views", name);
}

let tmpDir: string;
let dbPath: string;
let engine: BaseEngine;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-ctx-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close();
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function query(base: string, view?: string, contextFile?: string): BaseQueryResult {
  return engine.query({
    basePath: baseFile(base),
    view,
    dbPath,
    vaultRoots: [vaultPath],
    ...(contextFile !== undefined ? { contextFile } : {}),
  });
}

function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

function rulesOf(r: BaseQueryResult): string[] {
  return r.diagnostics.map((d) => d.rule);
}

// ---------------------------------------------------------------------------
// BASE-CTX-001：显式 contextFile
// ---------------------------------------------------------------------------

test("BASE-CTX-001: contextFile 驱动 this.* 参与 filter", () => {
  // Alpha 的 status = active；同状态的还有 Beta、Tagger
  const r = query("context.base", "sameStatus", "Alpha.md");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
  // 换一个上下文文件，结果随之改变（这正是 this 的意义）
  const r2 = query("context.base", "sameStatus", "Gamma.md"); // Gamma 的 status = done
  assert.deepEqual(errorsOf(r2), []);
  assert.deepEqual(
    r2.rows.map((row) => row["file.name"]),
    ["Delta.md", "Gamma.md"],
  );
});

test("BASE-CTX-001: this.file.* 与 this.<属性> 两条投影路径", () => {
  const r = query("context.base", "ctxFields", "Gamma.md");
  assert.deepEqual(errorsOf(r), []);
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(row["this.file.name"], "Gamma.md");
  assert.equal(row["this.status"], "done");
  assert.equal(row["this.priority"], 3);
});

test("BASE-CTX-001: contextFile 路径解析口径同 file(path)", () => {
  // 完整路径 / 去扩展名 / bare basename 三种写法等价
  for (const ctx of ["Alpha.md", "Alpha", "alpha"]) {
    const r = query("context.base", "ctxFields", ctx);
    assert.deepEqual(errorsOf(r), [], ctx);
    assert.equal((r.rows[0] as Record<string, unknown>)["this.file.name"], "Alpha.md", ctx);
  }
});

test("BASE-CTX-001: this.* 在公式体内同样可用", () => {
  const r = query("context.base", "viaFormula", "Epsilon.md");
  assert.deepEqual(errorsOf(r), []);
  assert.equal((r.rows[0] as Record<string, unknown>)["formula.ctxOwner"], "paused");
});

test("BASE-CTX-001: 裸 this = 上下文行的 note 对象", () => {
  const r = query("context.base", "bareThis", "Epsilon.md");
  assert.deepEqual(errorsOf(r), []);
  const bare = (r.rows[0] as Record<string, unknown>)["this"] as Record<string, unknown>;
  assert.equal(bare["status"], "paused");
  assert.equal(bare["priority"], 1);
});

// ---------------------------------------------------------------------------
// BASE-CTX-004：没有隐式环境状态 —— 不给 contextFile 一律拒绝
// ---------------------------------------------------------------------------

test("BASE-CTX-004: 不给 contextFile 时 this.* 报 dynamic-context-required，不猜「当前文件」", () => {
  const r = query("context.base", "sameStatus");
  // 行级诊断（warning）：filter 语境该行按不通过 → 结果为空，但查询本身不 error
  assert.ok(rulesOf(r).includes(BASE_RULES.dynamicContextRequired));
  assert.deepEqual(r.rows, []);
  const d = r.diagnostics.find((x) => x.rule === BASE_RULES.dynamicContextRequired);
  assert.match(d?.message ?? "", /contextFile/u);
});

test("BASE-CTX-001: contextFile 给了却解析不到 → error + 空结果，不静默当没给", () => {
  const r = query("context.base", "sameStatus", "完全不存在的文件.md");
  const errors = errorsOf(r);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.startsWith(`${BASE_RULES.dynamicContextRequired}: `));
  assert.match(errors[0] ?? "", /找不到/u);
  assert.equal(r.total, 0);
  assert.deepEqual(r.rows, []);
});

// ---------------------------------------------------------------------------
// BASE-CTX-002 / 003：不做，但必须给说清楚的诊断
// ---------------------------------------------------------------------------

test("BASE-CTX-002: 非 .base 入口（Markdown 内嵌代码块形态）→ unsupported-feature", () => {
  const r = engine.query({
    basePath: join(vaultPath, "Alpha.md"),
    dbPath,
    vaultRoots: [vaultPath],
  });
  const errors = errorsOf(r);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.startsWith(`${BASE_RULES.unsupportedFeature}: `));
  assert.match(errors[0] ?? "", /```base 代码块不做/u);
  assert.match(errors[0] ?? "", /单独存成 \.base 文件/u, "诊断必须给出替代写法");
  assert.deepEqual(r.rows, []);
});

test("BASE-CTX-003: `![[View.base#Name]]` 形态（路径带 # 锚点）→ unsupported-feature + 指向 --view", () => {
  const r = engine.query({
    basePath: `${baseFile("context.base")}#sameStatus`,
    dbPath,
    vaultRoots: [vaultPath],
  });
  const errors = errorsOf(r);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.startsWith(`${BASE_RULES.unsupportedFeature}: `));
  assert.match(errors[0] ?? "", /--view sameStatus/u, "诊断必须给出可直接照抄的替代命令");
  assert.deepEqual(r.rows, []);
});

test("入口形态检查在读文件之前：诊断不被 YAML 解析失败掩盖", () => {
  // 指向一个根本不存在的 .md：仍应给形态诊断，而不是 ENOENT / invalid-yaml
  const r = engine.query({
    basePath: join(vaultPath, "根本不存在.md"),
    dbPath,
    vaultRoots: [vaultPath],
  });
  assert.deepEqual(
    r.diagnostics.map((d) => d.rule),
    [BASE_RULES.unsupportedFeature],
  );
});

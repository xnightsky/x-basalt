import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkVault } from "../../src/links/check.js";
import { runLint } from "../../src/lint/index.js";

// lint 壳 P2 最小面：唯一 links 规则复用 checkVault，产出同构 BasaltDiagnostic。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §3.3/§9。

test("runLint --rules links：与 checkVault 产出同构诊断 + 退出码", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-run-"));
  try {
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "Alpha.md"), "# Alpha");
    writeFileSync(join(root, "notes", "Index.md"), ["[[Alpha]]", "[[Ghost]]"].join("\n"));
    const viaLint = await runLint({ vault: root, rules: ["links"] });
    const viaLinks = await checkVault({ vault: root });
    assert.deepEqual(viaLint.diagnostics, viaLinks);
    assert.equal(viaLint.exitCode, 1); // 有 error 级断链
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLint：rules 省略 → 默认 links", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-def-"));
  try {
    writeFileSync(join(root, "A.md"), "[[Ghost]]");
    const r = await runLint({ vault: root });
    assert.equal(r.diagnostics.length, 1);
    assert.equal(r.diagnostics[0]?.rule, "links/no-broken-link");
    assert.equal(r.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLint：无断链 → 退出码 0", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-ok-"));
  try {
    writeFileSync(join(root, "A.md"), "# A\n没有链接");
    const r = await runLint({ vault: root });
    assert.equal(r.diagnostics.length, 0);
    assert.equal(r.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runLint：未知/未实现规则 → 定向报错（不静默）", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-bad-"));
  try {
    await assert.rejects(() => runLint({ vault: root, rules: ["metadata"] }), /metadata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkMetadata } from "../../src/lint/metadata.js";

// metadata 规则 P3a：内置 profile required 校验，产 BasaltDiagnostic。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.1。

test("checkMetadata: 缺 required 字段 → 报 metadata/required-missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-"));
  try {
    writeFileSync(join(root, "ok.md"), "---\ntype: note\n---\n# ok\n");
    writeFileSync(join(root, "bad.md"), "---\ntitle: X\n---\n# missing type\n");
    const diags = await checkMetadata({ vault: root, profile: "llm-wiki" });
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.file, "bad.md");
    assert.equal(diags[0]?.rule, "metadata/required-missing");
    assert.equal(diags[0]?.target, "type");
    assert.equal(diags[0]?.reason, "required_missing");
    assert.equal(diags[0]?.severity, "error");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: required 齐全 → 空", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-ok-"));
  try {
    writeFileSync(join(root, "a.md"), "---\ntype: note\n---\n# a\n");
    const diags = await checkMetadata({ vault: root, profile: "llm-wiki" });
    assert.equal(diags.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: ignore.paths 过滤整文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-ig-"));
  try {
    mkdirSync(join(root, "legacy"));
    writeFileSync(join(root, "legacy", "old.md"), "---\ntitle: X\n---\n# no type\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "llm-wiki",
      ignore: { paths: ["legacy/**"] },
    });
    assert.equal(diags.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: 未知 profile → 定向报错（即使 vault 为空）", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-bad-"));
  try {
    await assert.rejects(() => checkMetadata({ vault: root, profile: "nope" }), /nope|未知/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

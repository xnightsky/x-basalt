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

// === P3b: 自定义 config profile（enum-invalid + config required + include；design §8.2）===

test("checkMetadata: config profile enum 非法值 → metadata/enum-invalid", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-enum-"));
  try {
    writeFileSync(join(root, "a.md"), "---\ntype: gadget\n---\n# a\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "types",
      profiles: { types: { enums: { type: ["note", "person"] } } },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.rule, "metadata/enum-invalid");
    assert.equal(diags[0]?.target, "type");
    assert.equal(diags[0]?.reason, "enum_invalid");
    assert.equal(diags[0]?.severity, "error");
    assert.match(diags[0]?.message ?? "", /gadget/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: enum 合法值 → 不报", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-enum-ok-"));
  try {
    writeFileSync(join(root, "a.md"), "---\ntype: note\n---\n# a\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "types",
      profiles: { types: { enums: { type: ["note", "person"] } } },
    });
    assert.equal(diags.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: 数组字段 enum 逐元素校验（非法元素才报）", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-enum-arr-"));
  try {
    writeFileSync(join(root, "a.md"), "---\nstatus:\n  - active\n  - bogus\n---\n# a\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "st",
      profiles: { st: { enums: { status: ["active", "done"] } } },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.rule, "metadata/enum-invalid");
    assert.match(diags[0]?.message ?? "", /bogus/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: enum 字段缺失或为空(null) → 跳过 enum（不双报）", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-enum-null-"));
  try {
    writeFileSync(join(root, "absent.md"), "---\ntitle: x\n---\n# no type\n");
    writeFileSync(join(root, "empty.md"), "---\ntype:\n---\n# empty type\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "types",
      profiles: { types: { enums: { type: ["note"] } } },
    });
    assert.equal(diags.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: config profile 的 required（无 extends）", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-cfg-req-"));
  try {
    writeFileSync(join(root, "a.md"), "---\ntitle: x\n---\n# no owner\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "team",
      profiles: { team: { required: ["owner"] } },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.rule, "metadata/required-missing");
    assert.equal(diags[0]?.target, "owner");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkMetadata: include glob 收窄被校验文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "lint-meta-include-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "a.md"), "---\ntitle: x\n---\n# missing type\n");
    writeFileSync(join(root, "top.md"), "---\ntitle: x\n---\n# also missing but excluded\n");
    const diags = await checkMetadata({
      vault: root,
      profile: "docsonly",
      profiles: { docsonly: { extends: "llm-wiki", include: "docs/**" } },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0]?.file, "docs/a.md");
    assert.equal(diags[0]?.rule, "metadata/required-missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

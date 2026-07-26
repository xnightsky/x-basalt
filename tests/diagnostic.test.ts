import assert from "node:assert/strict";
import { test } from "node:test";
import { DIAGNOSTIC_SEVERITIES } from "../src/diagnostic.js";
import type { BasaltDiagnostic, BasaltDiagnosticSeverity } from "../src/diagnostic.js";

// 公共稳定契约 BasaltDiagnostic 的可观察证据（字段冻结 + severity 单一真相源 + reason 已放宽）。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §6。

test("DIAGNOSTIC_SEVERITIES: 严重级取值单一真相源（error/warning/info）", () => {
  assert.deepEqual([...DIAGNOSTIC_SEVERITIES], ["error", "warning", "info"]);
});

test("BasaltDiagnostic: 十字段契约形状（可观察断言）", () => {
  const d: BasaltDiagnostic = {
    file: "notes/Index.md",
    line: 2,
    column: 1,
    rule: "links/no-broken-link",
    severity: "error",
    message: "链接目标不存在：[[Ghost]]",
    target: "[[Ghost]]",
    reason: "not_found",
    suggestions: ["../Ghost.md"],
    fixable: false,
  };
  assert.equal(typeof d.file, "string");
  assert.equal(typeof d.line, "number");
  assert.equal(typeof d.column, "number");
  assert.equal(typeof d.rule, "string");
  assert.equal(typeof d.message, "string");
  assert.equal(typeof d.fixable, "boolean");
  assert.ok(DIAGNOSTIC_SEVERITIES.includes(d.severity));
});

test("BasaltDiagnostic: reason 放宽为通用 string（非 links 专有 union）", () => {
  // P3 metadata 规则会用 links 之外的 reason（如 required_missing）；公共契约必须允许，否则无法共用。
  const d: BasaltDiagnostic = {
    file: "docs/a.md",
    line: 1,
    column: 1,
    rule: "metadata/required-missing",
    severity: "warning",
    message: "缺字段 type",
    reason: "required_missing",
    fixable: false,
  };
  assert.equal(d.reason, "required_missing");
});

test("BasaltDiagnosticSeverity: 类型由 DIAGNOSTIC_SEVERITIES 派生", () => {
  const sevs: BasaltDiagnosticSeverity[] = [...DIAGNOSTIC_SEVERITIES];
  assert.equal(sevs.length, 3);
});

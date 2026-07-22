import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHuman } from "../../src/links/report.js";
import type { BasaltDiagnostic } from "../../src/links/types.js";

test("renderHuman: 空 → 成功文案", () => {
  assert.match(renderHuman([]), /未发现断链/);
});

test("renderHuman: 含定位、消息、建议、汇总", () => {
  const diagnostics: BasaltDiagnostic[] = [
    {
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
    },
  ];
  const out = renderHuman(diagnostics);
  assert.match(out, /notes\/Index\.md:2:1/);
  assert.match(out, /链接目标不存在/);
  assert.match(out, /建议.*Ghost\.md/);
  assert.match(out, /共 1 处断链/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHuman } from "../../src/lint/report.js";

// lint 是通用壳（links + metadata + …），人读汇总须规则中性——不能沿用 links 的「断链」措辞。
// links check 仍用自己的 src/links/report.ts（「断链」在那里准确）。

test("lint renderHuman: 空 → 中性成功文案（非「断链」）", () => {
  const out = renderHuman([]);
  assert.match(out, /未发现问题/);
  assert.doesNotMatch(out, /断链/);
});

test("lint renderHuman: 含定位、消息、中性汇总（非「断链」）", () => {
  const out = renderHuman([
    {
      file: "bad.md",
      line: 1,
      column: 1,
      rule: "metadata/required-missing",
      severity: "error",
      message: "缺 required 字段「type」（profile llm-wiki）",
      target: "type",
      reason: "required_missing",
      fixable: false,
    },
  ]);
  assert.match(out, /bad\.md:1:1/);
  assert.match(out, /缺 required 字段/);
  assert.match(out, /共 1 处问题/);
  assert.doesNotMatch(out, /断链/);
});

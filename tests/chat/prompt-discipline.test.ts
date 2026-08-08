import { test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT } from "../../src/chat/index.js";

// === chat 结果纪律的系统提示回归（task #17，2026-08-08）===
//
// 目的：把「只转写 base/query 返回行、不得顺带点名被排除/limit 外项、读任务勿中途 scan」这些
// 精度纪律固化为可回归的提示契约。它们是从 Bases 精度负例场景（regression/bases-precision-negative）
// 提炼出的**通用**规则——只断言规则存在，不把任何 fixture 文件名/答案写进本测试（防泄题）。
// 注意：这里锁定的是「提示含该纪律」，不是 LLM 行为本身（行为由评估场景做端到端验证）。

const PRECISION_RULES: Array<{ key: string; fragment: string; why: string }> = [
  {
    key: "transcribe-only",
    fragment: "逐条转写原文",
    why: "列举只转写 cli 输出的条目",
  },
  {
    key: "only-matched-rows",
    fragment: "只报命中的",
    why: "不得顺带点名被过滤/limit 外/近似的项",
  },
  {
    key: "no-midtask-scan",
    fragment: "勿中途 scan",
    why: "读任务不要夹带 scan/index（会盖掉查询上下文）",
  },
];

test("SYSTEM_PROMPT 含精度纪律：逐条照抄 / 只报命中 / 勿中途 scan", () => {
  for (const { key, fragment, why } of PRECISION_RULES) {
    assert.ok(
      SYSTEM_PROMPT.includes(fragment),
      `提示应含「${why}」对应的纪律片段「${fragment}」（key=${key}）`,
    );
  }
});

test("SYSTEM_PROMPT 不含任何 fixture 文件名/答案（无泄题）", () => {
  // 来自精度负例场景的 fixture 文件名/词干——绝不能进系统提示，否则评估就泄题了。
  const leaked: string[] = [
    "nova-alpha",
    "nova-beta",
    "kestrel-a",
    "kestrel-c",
    "hawk-01",
    "owl-01",
    "kestrel",
    "hawk-",
    "owl-",
    "nova-",
  ];
  for (const name of leaked) {
    assert.ok(!SYSTEM_PROMPT.includes(name), `系统提示不得包含 fixture 文件名/词干：${name}`);
  }
});

test("SYSTEM_PROMPT 无『被排除项名字』的可疑枚举句式（泛化检查）", () => {
  // 泛化：不依赖具体文件名，检查不应出现的「列举被排除项」诱导句式。
  const antiPatterns = ["供参考，顺带列出", "被排除的有", "没有被选中的"];
  for (const p of antiPatterns) {
    assert.ok(!SYSTEM_PROMPT.includes(p), `提示不应诱导列举被排除项：${p}`);
  }
});

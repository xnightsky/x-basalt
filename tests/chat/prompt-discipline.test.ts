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
    fragment: "内容结果已拿到后勿追加 scan/index",
    why: "内容读取已经成功后不要追加 scan/index",
  },
  {
    key: "no-progress-narration",
    fragment: "不要在工具调用前输出计划、进度或中间路径",
    why: "工具链执行时不把导航文本混进最终答案",
  },
  {
    key: "no-intermediate-files-in-final",
    fragment: "不要点名仅用于导航/取证的中间文件",
    why: "最终答案不混入未被用户要求列出的中间文件",
  },
  {
    key: "strict-row-template",
    fragment: "严格只输出这些数据行，不加标题、前言、解释或代码围栏",
    why: "用户给出逐行格式时不额外生成会污染枚举判定的说明",
  },
  {
    key: "parallel-parse",
    fragment: "在同一轮并行调用 parse",
    why: "高扇出正文取证应并行 parse",
  },
];

test("SYSTEM_PROMPT 含精度纪律：逐条照抄 / 只报命中 / 成功读取后勿追加 scan", () => {
  for (const { key, fragment, why } of PRECISION_RULES) {
    assert.ok(
      SYSTEM_PROMPT.includes(fragment),
      `提示应含「${why}」对应的纪律片段「${fragment}」（key=${key}）`,
    );
  }
});

test("SYSTEM_PROMPT 保留合法 scan 意图并禁止模型覆盖会话 vault/db", () => {
  assert.match(SYSTEM_PROMPT, /索引覆盖\/未索引状态时仍必须用 cli scan/);
  assert.match(SYSTEM_PROMPT, /自动注入当前会话的 vault\/db/);
  assert.match(SYSTEM_PROMPT, /不要传 --vault\/--db/);
  assert.match(SYSTEM_PROMPT, /index\/scan 也不要传 vault 位置参数/);
});

test("SYSTEM_PROMPT 不以排除项路径证明过滤生效", () => {
  assert.match(SYSTEM_PROMPT, /不要为证明过滤生效而复述被排除路径/);
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

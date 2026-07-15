import assert from "node:assert/strict";
import { test } from "node:test";
import { renderEvent } from "../../src/chat/index.js";
import type { LoopEvent } from "../../src/chat/loop.js";

type Profile = "full" | "summary" | "quiet" | "json";

interface Capture {
  stdout: string;
  stderr: string;
}

/** 为每个用例隔离 renderer 状态与输出，避免改写进程级 stdout/stderr。 */
function capture(profile: Profile, events: LoopEvent[]): Capture {
  const output: Capture = { stdout: "", stderr: "" };
  const context = {
    profile,
    answer: "",
    writers: {
      stdout: (text: string) => {
        output.stdout += text;
      },
      stderr: (text: string) => {
        output.stderr += text;
      },
    },
  };
  for (const event of events) renderEvent(event, context);
  return output;
}

test("--quiet：只输出答案与结果限定，工具过程在 stdout/stderr 都不可见", () => {
  const output = capture("quiet", [
    { type: "tool-call", toolName: "search", input: { query: "前端单元测试" } },
    { type: "tool-result", toolName: "search", output: { rows: ["很长的结果预览"] } },
    { type: "tool-error", toolName: "read_note", error: new Error("不应泄漏") },
    { type: "text", text: "这是模型答案。" },
    {
      type: "finish",
      stopReason: "done",
      noRecallNotice: "⚠ 未从 vault 召回，以下为通用知识。",
      recalled: false,
      steps: 2,
    },
  ]);

  assert.equal(output.stdout, "这是模型答案。\n⚠ 未从 vault 召回，以下为通用知识。\n");
  assert.equal(output.stderr, "");
  assert.doesNotMatch(output.stdout, /search|调用|结果预览|完成/);
});

test("非 TTY 摘要：过程只向 stderr 写工具名与短目标，答案只向 stdout 写", () => {
  const output = capture("summary", [
    {
      type: "tool-call",
      toolName: "search",
      input: { query: "前端单元测试", offset: 0, size: 50 },
    },
    {
      type: "tool-result",
      toolName: "search",
      output: { rows: [{ path: "docs/testing.md", content: "x".repeat(300) }] },
    },
    { type: "text", text: "召回后的答案。" },
    { type: "finish", stopReason: "done", recalled: true, steps: 1 },
  ]);

  assert.equal(output.stdout, "召回后的答案。");
  assert.equal(output.stderr, "· search 前端单元测试\n");
  assert.doesNotMatch(output.stderr, /rows|content|↳|完成/);
});

test("--quiet：exhausted 在隐藏过程时仍随答案输出", () => {
  const output = capture("quiet", [
    { type: "text", text: "部分答案" },
    { type: "finish", stopReason: "exhausted", recalled: true, steps: 20 },
  ]);

  assert.match(output.stdout, /^部分答案/);
  assert.match(output.stdout, /已达步数上限、任务可能未完成/);
  assert.equal(output.stderr, "");
  assert.doesNotMatch(output.stdout, /· 完成/);
});

test("--json：结束后只输出一个结构化对象", () => {
  const output = capture("json", [
    { type: "text", text: "结构化" },
    { type: "tool-call", toolName: "read_note", input: { path: "docs/testing.md" } },
    { type: "tool-result", toolName: "read_note", output: "不应输出" },
    { type: "text", text: "答案" },
    {
      type: "finish",
      stopReason: "done",
      recalled: true,
      steps: 3,
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
    },
  ]);

  assert.equal(output.stderr, "");
  assert.deepEqual(JSON.parse(output.stdout), {
    answer: "结构化答案",
    recalled: true,
    stopReason: "done",
    steps: 3,
    usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
  });
  assert.equal(output.stdout.trim().split("\n").length, 1);
});

test("--json：provider 缺少完整 usage 时输出 null，仍保持对象字段稳定", () => {
  const output = capture("json", [
    { type: "text", text: "答案" },
    {
      type: "finish",
      stopReason: "exhausted",
      recalled: false,
      steps: 4,
      usage: { inputTokens: 12 },
    },
  ]);

  assert.deepEqual(JSON.parse(output.stdout), {
    answer: "答案",
    recalled: false,
    stopReason: "exhausted",
    steps: 4,
    usage: null,
  });
});

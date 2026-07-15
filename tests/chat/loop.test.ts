import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonSchema, tool, type ModelMessage } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { runLoop, type LoopEvent } from "../../src/chat/loop.js";

// 无副作用探针工具：被调用即记录，返回固定观察值。
function probeTools(calls: string[]) {
  return {
    echo: tool({
      description: "echo",
      inputSchema: jsonSchema<{ x: string }>({
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
        additionalProperties: false,
      }),
      execute: ({ x }) => {
        calls.push(x);
        return `观察:${x}`;
      },
    }),
  };
}

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0 },
  totalTokens: 0,
} as const;

/**
 * 用 MockLanguageModelV4 按脚本返回 doStream 结果。
 * ai@7.0.6 的 provider-level chunk 形状（V4 spec）：
 * - tool-call:  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(args) }
 * - text-delta: 需先有同 id 的 text-start
 */
function makeMockModel() {
  return new MockLanguageModelV4({
    doStream: [
      // 第一步：调用 echo
      {
        stream: convertArrayToReadableStream([
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "echo",
            input: JSON.stringify({ x: "hi" }),
          },
          { type: "finish", usage: USAGE, finishReason: "tool-calls" },
        ]),
      },
      // 第二步：拿到工具结果后输出文本
      {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "td1" },
          { type: "text-delta", id: "td1", delta: "完成" },
          { type: "text-end", id: "td1" },
          { type: "finish", usage: USAGE, finishReason: "stop" },
        ]),
      },
      // 保险：若 SDK 继续调用第三次，返回空文本使其自然结束。
      {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "td2" },
          { type: "text-delta", id: "td2", delta: "" },
          { type: "text-end", id: "td2" },
          { type: "finish", usage: USAGE, finishReason: "stop" },
        ]),
      },
    ] as unknown[],
  });
}

test("runLoop：模型发 tool-call → 工具执行 → 结果喂回 → 收尾", async () => {
  const calls: string[] = [];
  const events: LoopEvent[] = [];
  const model = makeMockModel();
  const msgs: ModelMessage[] = [{ role: "user", content: "调用 echo" }];
  await runLoop(msgs, {
    model,
    tools: probeTools(calls),
    maxSteps: 5,
    onEvent: (e) => events.push(e),
    // 回归守门：system 必须经 deps.system 传给 streamText 顶层；若误入 messages，
    // ai@7.0.6 的 standardizePrompt 会抛 InvalidPromptError（即此前 dogfood 暴露的 bug）。
    system: "你是操作 Obsidian vault 的助手。",
  });
  assert.deepEqual(calls, ["hi"]);
  assert.ok(events.some((e) => e.type === "tool-call" && e.toolName === "echo"));
  assert.ok(events.some((e) => e.type === "finish"));
  // 回归守门：tool-call 必须带 input、tool-result 必须带 output（此前被丢弃，
  // 导致 chat 里「调用没有 input/output」——本断言锁死可观测性修复）。
  const call = events.find((e) => e.type === "tool-call");
  assert.deepEqual(call?.input, { x: "hi" });
  const result = events.find((e) => e.type === "tool-result");
  assert.equal(result?.toolName, "echo");
  assert.equal(result?.output, "观察:hi");
});

test("runLoop：abortSignal 预先 abort → 不执行工具即返回", async () => {
  const calls: string[] = [];
  const ac = new AbortController();
  ac.abort();
  const model = makeMockModel();
  await runLoop([{ role: "user", content: "x" }], {
    model,
    tools: probeTools(calls),
    maxSteps: 5,
    onEvent: () => {},
    abortSignal: ac.signal,
  }).catch(() => {});
  assert.deepEqual(calls, []);
});

// === 2026-07-15 P1：无 vault 工具调用时如实标注（防止 chat 短路成通用问答被误当"已召回"）===

/** 只产文本、不调任何工具的 mock 模型（模拟"自判不涉及 vault、直接用通用知识作答"）。 */
function makeTextOnlyModel(text: string) {
  return new MockLanguageModelV4({
    doStream: [
      {
        stream: convertArrayToReadableStream([
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: text },
          { type: "text-end", id: "t" },
          { type: "finish", usage: USAGE, finishReason: "stop" },
        ]),
      },
    ] as unknown[],
  });
}

const NOTICE = "⚠ 本次未调用任何 vault 检索工具，以上为模型通用知识、非 vault 召回内容。";

test("P1：产出实质文本却零 vault 工具调用 → finish 事件带如实标注", async () => {
  const events: LoopEvent[] = [];
  await runLoop([{ role: "user", content: "前端单元测试注意事项" }], {
    model: makeTextOnlyModel(
      "前端单元测试要注意：__tests__ 目录约定、jest 配置、testing-library 用法、mock 与快照测试等若干要点。",
    ),
    tools: probeTools([]),
    maxSteps: 5,
    onEvent: (e) => events.push(e),
    recallToolNames: ["echo", "search", "query"],
    noRecallNotice: NOTICE,
  });
  const finish = events.find((e) => e.type === "finish");
  assert.ok(finish, "应有 finish 事件");
  assert.equal(finish?.noRecallNotice, NOTICE, "零 vault 工具 + 实质答复应带如实标注");
});

test("P1：调用了 recall 工具（echo）→ 不加标注", async () => {
  const events: LoopEvent[] = [];
  await runLoop([{ role: "user", content: "调用 echo" }], {
    model: makeMockModel(), // 先调 echo（视作 recall 工具）再产文本
    tools: probeTools([]),
    maxSteps: 5,
    onEvent: (e) => events.push(e),
    recallToolNames: ["echo"],
    noRecallNotice: NOTICE,
  });
  const finish = events.find((e) => e.type === "finish");
  assert.ok(!finish?.noRecallNotice, "调用过 recall 工具不应加标注");
});

test("P1：极短寒暄（阈值内）零工具 → 不加标注（降噪）", async () => {
  const events: LoopEvent[] = [];
  await runLoop([{ role: "user", content: "你好" }], {
    model: makeTextOnlyModel("你好"),
    tools: probeTools([]),
    maxSteps: 5,
    onEvent: (e) => events.push(e),
    recallToolNames: ["search"],
    noRecallNotice: NOTICE,
  });
  const finish = events.find((e) => e.type === "finish");
  assert.ok(!finish?.noRecallNotice, "极短寒暄不应加标注");
});

test("P1：未配置 noRecallNotice → 行为不变、永不加标注", async () => {
  const events: LoopEvent[] = [];
  await runLoop([{ role: "user", content: "前端单元测试注意事项" }], {
    model: makeTextOnlyModel(
      "前端单元测试要注意很多方面，这里给出一段足够长的通用回答用于触发阈值判断逻辑。",
    ),
    tools: probeTools([]),
    maxSteps: 5,
    onEvent: (e) => events.push(e),
    // 不传 recallToolNames / noRecallNotice
  });
  const finish = events.find((e) => e.type === "finish");
  assert.ok(!finish?.noRecallNotice, "未配置标注时不应产出标注");
});

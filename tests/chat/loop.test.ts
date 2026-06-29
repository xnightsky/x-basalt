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
          { type: "tool-call", toolCallId: "tc1", toolName: "echo", input: JSON.stringify({ x: "hi" }) },
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
  });
  assert.deepEqual(calls, ["hi"]);
  assert.ok(events.some((e) => e.type === "tool-call" && e.toolName === "echo"));
  assert.ok(events.some((e) => e.type === "finish"));
});

test("runLoop：abortSignal 预先 abort → 不执行工具即返回", async () => {
  const calls: string[] = [];
  const ac = new AbortController();
  ac.abort();
  const model = makeMockModel();
  await runLoop(
    [{ role: "user", content: "x" }],
    {
      model,
      tools: probeTools(calls),
      maxSteps: 5,
      onEvent: () => {},
      abortSignal: ac.signal,
    },
  ).catch(() => {});
  assert.deepEqual(calls, []);
});

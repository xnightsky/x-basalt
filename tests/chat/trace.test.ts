import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createTracer } from "../../src/chat/trace.js";
import type { LoopEvent } from "../../src/chat/loop.js";

// === chat trace 落盘器测试 ===
//
// 覆盖：session 元信息、字段完整、超长 input 不截断、VAULT_DATA 边界保留、
// 多 turn 记录、不可写路径只警告一次并自动停用。

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "x-basalt-trace-"));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** 按行读取并解析 JSONL（忽略末尾空行）。 */
function readJsonl(path: string): unknown[] {
  const text = readFileSync(path, "utf8").trim();
  if (text === "") return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

test("正常落盘：session 元信息、完整字段、长 input 不截断、VAULT_DATA 边界保留", () => {
  const path = join(tmpRoot, "normal", "trace.jsonl");
  const tracer = createTracer({
    path,
    model: "gpt-4",
    maxSteps: 10,
    db: "/data/index.db",
    vault: "/my/vault",
    version: "0.1.0",
    ts: "2026-07-02T12:00:00.000Z",
  });

  const longInput = "x".repeat(5000);
  const events: LoopEvent[] = [
    { type: "text", text: "hi" },
    { type: "tool-call", toolName: "echo", input: { message: longInput } },
    {
      type: "tool-result",
      toolName: "echo",
      output: "<<VAULT_DATA abc123>>\nsecret content\n<<END_VAULT_DATA abc123>>",
    },
    { type: "finish", stopReason: "done", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
  ];

  for (const e of events) tracer.sink(e, 1);
  tracer.close();

  const lines = readJsonl(path);
  assert.equal(lines.length, 5, "应有 1 行 session + 4 行事件");

  const meta = lines[0] as Record<string, unknown>;
  assert.equal(meta.type, "session");
  assert.equal(meta.ts, "2026-07-02T12:00:00.000Z");
  assert.equal(meta.model, "gpt-4");
  assert.equal(meta.maxSteps, 10);
  assert.equal(meta.db, "/data/index.db");
  assert.equal(meta.vault, "/my/vault");
  assert.equal(meta.version, "0.1.0");

  for (let i = 1; i < lines.length; i++) {
    const rec = lines[i] as Record<string, unknown>;
    assert.equal(rec.turn, 1);
    assert.ok(rec.type, `第 ${i} 行应带 type`);
  }

  const textRec = lines[1] as Record<string, unknown>;
  assert.equal(textRec.type, "text");
  assert.equal(textRec.text, "hi");
  assert.ok(typeof textRec.ts === "string" && textRec.ts.length > 0, "text 行应带 ts");

  const call = lines[2] as Record<string, unknown>;
  assert.equal((call.input as { message: string }).message.length, 5000, "长 input 不应被截断");

  const result = lines[3] as Record<string, unknown>;
  assert.equal(
    result.output,
    "<<VAULT_DATA abc123>>\nsecret content\n<<END_VAULT_DATA abc123>>",
    "VAULT_DATA 边界应原样保留",
  );

  const finish = lines[4] as Record<string, unknown>;
  assert.equal(finish.stopReason, "done");
  assert.deepEqual(finish.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("多 turn：每行事件携带正确 turn", () => {
  const path = join(tmpRoot, "turns.jsonl");
  const tracer = createTracer({ path, maxSteps: 5 });

  tracer.sink({ type: "text", text: "a" }, 1);
  tracer.sink({ type: "finish", stopReason: "done" }, 1);
  tracer.sink({ type: "text", text: "b" }, 2);
  tracer.sink({ type: "finish", stopReason: "exhausted" }, 2);
  tracer.close();

  const lines = readJsonl(path);
  assert.equal(lines.length, 5);
  assert.equal((lines[1] as Record<string, unknown>).turn, 1);
  assert.equal((lines[1] as Record<string, unknown>).type, "text");
  assert.equal((lines[1] as Record<string, unknown>).text, "a");
  assert.equal((lines[2] as Record<string, unknown>).turn, 1);
  assert.equal((lines[2] as Record<string, unknown>).type, "finish");
  assert.equal((lines[3] as Record<string, unknown>).turn, 2);
  assert.equal((lines[3] as Record<string, unknown>).type, "text");
  assert.equal((lines[3] as Record<string, unknown>).text, "b");
  assert.equal((lines[4] as Record<string, unknown>).turn, 2);
  assert.equal((lines[4] as Record<string, unknown>).type, "finish");
});

test("连续 text 分片按 turn 合并，并与非 text 事件保持顺序", () => {
  const path = join(tmpRoot, "merge.jsonl");
  const tracer = createTracer({ path, maxSteps: 5 });

  tracer.sink({ type: "text", text: "索" }, 1);
  tracer.sink({ type: "text", text: "引" }, 1);
  tracer.sink({ type: "text", text: "库" }, 1);
  tracer.sink({ type: "tool-call", toolName: "read", input: { path: "/" } }, 1);
  tracer.sink({ type: "text", text: "结" }, 1);
  tracer.sink({ type: "text", text: "果" }, 1);
  tracer.sink({ type: "finish", stopReason: "done" }, 1);
  tracer.close();

  const lines = readJsonl(path);
  assert.equal(lines.length, 5, "1 session + 2 段合并 text + 1 tool-call + 1 finish");

  assert.equal((lines[1] as Record<string, unknown>).type, "text");
  assert.equal((lines[1] as Record<string, unknown>).text, "索引库");
  assert.equal((lines[1] as Record<string, unknown>).turn, 1);

  assert.equal((lines[2] as Record<string, unknown>).type, "tool-call");
  assert.equal((lines[2] as Record<string, unknown>).toolName, "read");

  assert.equal((lines[3] as Record<string, unknown>).type, "text");
  assert.equal((lines[3] as Record<string, unknown>).text, "结果");
  assert.equal((lines[3] as Record<string, unknown>).turn, 1);

  assert.equal((lines[4] as Record<string, unknown>).type, "finish");
});

test("turn 变化时先冲刷旧 text 缓冲，再开启新缓冲", () => {
  const path = join(tmpRoot, "turn-flush.jsonl");
  const tracer = createTracer({ path, maxSteps: 5 });

  tracer.sink({ type: "text", text: "第" }, 1);
  tracer.sink({ type: "text", text: "一" }, 1);
  tracer.sink({ type: "text", text: "轮" }, 1);
  tracer.sink({ type: "text", text: "第" }, 2);
  tracer.sink({ type: "text", text: "二" }, 2);
  tracer.sink({ type: "text", text: "轮" }, 2);
  tracer.close();

  const lines = readJsonl(path);
  assert.equal(lines.length, 3, "1 session + 2 段按 turn 合并的 text");
  assert.equal((lines[1] as Record<string, unknown>).text, "第一轮");
  assert.equal((lines[1] as Record<string, unknown>).turn, 1);
  assert.equal((lines[2] as Record<string, unknown>).text, "第二轮");
  assert.equal((lines[2] as Record<string, unknown>).turn, 2);
});

test("close 时冲刷末尾未完结的 text 缓冲，避免文本丢失", () => {
  const path = join(tmpRoot, "close-flush.jsonl");
  const tracer = createTracer({ path, maxSteps: 5 });

  tracer.sink({ type: "text", text: "未" }, 1);
  tracer.sink({ type: "text", text: "完" }, 1);
  tracer.sink({ type: "text", text: "结" }, 1);
  tracer.close();

  const lines = readJsonl(path);
  assert.equal(lines.length, 2, "1 session + 1 段合并 text");
  assert.equal((lines[1] as Record<string, unknown>).type, "text");
  assert.equal((lines[1] as Record<string, unknown>).text, "未完结");
  assert.equal((lines[1] as Record<string, unknown>).turn, 1);
});

test("写入失败：不抛错、只警告一次、后续 sink 不再写", () => {
  const badDir = join(tmpRoot, "bad");
  mkdirSync(badDir);
  // 把目录本身当作文件路径，openSync 会失败（EISDIR），模拟不可写目标。
  const path = badDir;

  const warnings: unknown[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const tracer = createTracer({ path, maxSteps: 5 });
    tracer.sink({ type: "text", text: "first" }, 1);
    tracer.sink({ type: "text", text: "second" }, 1);
    tracer.close();

    assert.equal(warnings.length, 1, "应只警告一次");
    const msg = String(warnings[0]);
    assert.match(msg, /trace 落盘失败/);
    assert.match(msg, /自动停用/);
  } finally {
    console.warn = origWarn;
  }
});

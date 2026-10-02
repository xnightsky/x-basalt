// === 自建实现: 写后验收的真实 CLI 接线回归 ===
// 脚本模型只固定调用序列；runLoop、cli 子进程、文件写入和 SQLite 均用真实实现。
// 这些测试不证明模型遵循提示；真实模型对照及原始证据见本轮计划。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { SYSTEM_PROMPT } from "../../src/chat/index.js";
import { runLoop, type LoopEvent } from "../../src/chat/loop.js";
import { makeSafety } from "../../src/chat/safety.js";
import { buildTools } from "../../src/chat/tools.js";
import { VaultIndexer } from "../../src/indexer/index.js";
import { DataviewEngine } from "../../src/query/index.js";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0 },
  totalTokens: 0,
} as const;
const MISSING = 'LIST FROM "inbox" WHERE type = null';
const ALL = 'LIST FROM "inbox"';

function runArgs(dql: string): string[] {
  return ["run", "--pipe", "actions=set type=note", "--pipe", `where=${dql}`, "--json", "--apply"];
}

function scriptedModel(commands: string[][]) {
  const doStream = commands.map((args, index) => ({
    stream: convertArrayToReadableStream([
      {
        type: "tool-call",
        toolCallId: `write-${index}`,
        toolName: "cli",
        input: JSON.stringify({ args }),
      },
      { type: "finish", usage: USAGE, finishReason: "tool-calls" },
    ]),
  }));
  doStream.push({
    stream: convertArrayToReadableStream([{ type: "finish", usage: USAGE, finishReason: "stop" }]),
  });
  return new MockLanguageModelV4({ doStream: doStream as unknown[] });
}

async function fixture(t: TestContext) {
  const vaultPath = mkdtempSync(join(tmpdir(), "xb-write-verification-"));
  t.after(() => rmSync(vaultPath, { recursive: true, force: true }));
  mkdirSync(join(vaultPath, "inbox"));
  writeFileSync(join(vaultPath, "inbox/a.md"), "---\nstatus: draft\n---\n# A\n");
  writeFileSync(join(vaultPath, "inbox/b.md"), "---\ntags: [pending]\n---\n# B\n");
  writeFileSync(join(vaultPath, "outside.md"), "# Outside\n");
  const dbPath = join(vaultPath, "index.db");
  const indexer = new VaultIndexer({ vaultPath, dbPath });
  try {
    await indexer.rebuild();
  } finally {
    indexer.close();
  }
  return { vaultPath, dbPath };
}

function bytes(vaultPath: string): Buffer[] {
  return ["inbox/a.md", "inbox/b.md", "outside.md"].map((name) =>
    readFileSync(join(vaultPath, name)),
  );
}

function output(event: LoopEvent): Record<string, unknown> {
  assert.equal(event.type, "tool-result");
  const text = String(event.output);
  assert.match(text, /^<<VAULT_DATA WV>>\n/);
  return JSON.parse(
    text.replace(/^<<VAULT_DATA WV>>\n/, "").replace(/\n<<END_VAULT_DATA WV>>$/, ""),
  );
}

async function execute(
  ctx: { vaultPath: string; dbPath: string },
  commands: string[][],
  afterResult?: (event: LoopEvent) => void,
) {
  const events: LoopEvent[] = [];
  const result = await runLoop([{ role: "user", content: "按要求执行写入及验收" }], {
    model: scriptedModel(commands),
    tools: buildTools(ctx, makeSafety({ nonce: "WV", maxChars: 30000 })),
    maxSteps: commands.length + 1,
    system: SYSTEM_PROMPT,
    onEvent: (event) => {
      events.push(event);
      if (event.type === "tool-result") afterResult?.(event);
    },
  });
  assert.equal(result.stopReason, "done");
  return { events, messages: result.messages };
}

for (const [id, dql, total, skipped] of [
  ["CHAT-WV-I001", MISSING, 0, 0],
  ["CHAT-WV-I002", ALL, 2, 0],
] as const) {
  test(`${id}：同一 run 真实执行两次，第二次无新增改动且字节稳定（total=${total}）`, async (t) => {
    const ctx = await fixture(t);
    const args = runArgs(dql);
    const initial = bytes(ctx.vaultPath);
    const snapshots: Buffer[][] = [];
    const { events, messages } = await execute(ctx, [["query", MISSING], args, args], () =>
      snapshots.push(bytes(ctx.vaultPath)),
    );
    const results = events.filter((event) => event.type === "tool-result").map(output);
    assert.equal(results[0]?.total, 2);
    assert.equal(results[1]?.dryRun, false);
    assert.equal(results[1]?.changed, 2);
    assert.equal(results[1]?.reindexed, 2);
    assert.deepEqual(results[1]?.failed, []);
    assert.equal(results[2]?.dryRun, false);
    assert.equal(results[2]?.total, total);
    assert.equal(results[2]?.changed, 0);
    assert.equal(results[2]?.skipped, skipped);
    assert.deepEqual(results[2]?.failed, []);
    assert.notDeepEqual(snapshots[1], initial);
    assert.deepEqual(snapshots[2], snapshots[1]);
    assert.deepEqual(bytes(ctx.vaultPath)[2], initial[2], "范围外文件不变");
    const toolMessages = messages
      .filter((message) => message.role === "tool")
      .flatMap((message) => message.content);
    assert.equal(
      toolMessages.filter((part) => part.type === "tool-result" && part.toolCallId === "write-2")
        .length,
      1,
      "第二次 run 有独立回执，不是 query=0",
    );
    assert.equal(events.filter((event) => event.type === "tool-error").length, 0);
  });
}

test("CHAT-WV-I003：显式写后 query 复核只读取，不再写文件，SQLite 已刷新", async (t) => {
  const ctx = await fixture(t);
  const snapshots: Buffer[][] = [];
  const { events } = await execute(
    ctx,
    [["query", MISSING], runArgs(MISSING), ["query", MISSING]],
    () => snapshots.push(bytes(ctx.vaultPath)),
  );
  const results = events.filter((event) => event.type === "tool-result").map(output);
  assert.equal(results[1]?.changed, 2);
  assert.equal(results[2]?.total, 0);
  assert.deepEqual(snapshots[2], snapshots[1]);
  const engine = new DataviewEngine(ctx.dbPath);
  try {
    assert.equal(engine.query('LIST FROM "inbox" WHERE type = "note"').total, 2);
  } finally {
    engine.close();
  }
  assert.equal(
    events.filter(
      (event) =>
        event.type === "tool-call" && (event.input as { args: string[] }).args[0] === "run",
    ).length,
    1,
    "复核序列没有重复写",
  );
});

test("CHAT-WV-I004：索引动作可使 dry-run changed>0，但 Markdown 未写入", async (t) => {
  const ctx = await fixture(t);
  const initial = bytes(ctx.vaultPath);
  const { events } = await execute(ctx, [
    ["run", "--pipe", "actions=index,set type=note", "--pipe", `where=${MISSING}`, "--json"],
  ]);
  const report = output(events.find((event) => event.type === "tool-result")!);
  assert.equal(report.changed, 2);
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.byAction, { index: 2 });
  assert.equal(report.reindexed, 0);
  assert.deepEqual(bytes(ctx.vaultPath), initial);
  const engine = new DataviewEngine(ctx.dbPath);
  try {
    assert.equal(engine.query(MISSING).total, 2);
  } finally {
    engine.close();
  }
});

test("CHAT-WV-I005：第二次命令失败仅有错误回执，不能充当 changed=0", async (t) => {
  const ctx = await fixture(t);
  const { events, messages } = await execute(ctx, [
    runArgs(MISSING),
    ["run", "--pipe", "actions=set type=note", "--pipe", "where=BAD DQL", "--apply", "--json"],
  ]);
  const results = events.filter((event) => event.type === "tool-result");
  assert.equal(results.length, 1);
  assert.equal(output(results[0]!).changed, 2);
  const errors = events.filter((event) => event.type === "tool-error");
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.error), /工具失败/);
  const toolMessages = messages
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content);
  const failed = toolMessages.find(
    (part) => part.type === "tool-result" && part.toolCallId === "write-1",
  );
  assert.ok(failed && failed.type === "tool-result");
  assert.match(failed.output.type, /^error-/);
});

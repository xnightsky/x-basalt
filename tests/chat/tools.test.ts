/**
 * chat 工具面测试（CC-2，计划 2026-08-03-chat-cli-tool.md）。
 *
 * 切 C 后工具面 = { cli, skills_recall, skills_get }，vault 操作全经 cli 子命令。
 * cli 工具自身的 argv 透传/allowlist/注入/超时已在 cli-tool.test.ts 覆盖；
 * 本文件验证装配层：工具名集合、RECALL_TOOL_NAMES 对应、skills 元工具、wrapToolErrors 外壳。
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { buildTools, NO_RECALL_NOTICE, RECALL_TOOL_NAMES, type ToolContext } from "../../src/chat/tools.js";
import { makeSafety } from "../../src/chat/safety.js";
import { VaultIndexer } from "../../src/indexer/index.js";

const safety = makeSafety({ nonce: "T", maxChars: 8000 });

let dir: string;
let dbPath: string;
let file: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "xb-chat-tools-"));
  file = join(dir, "a.md");
  writeFileSync(file, "---\nstatus: draft\n---\n# A\n", "utf8");
  writeFileSync(join(dir, "b.md"), "---\nstatus: done\n---\n# B\n", "utf8");
  dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();
  idx.close();
});

function ctx(): ToolContext {
  return { dbPath, vaultPath: dir };
}

// CC-2a：工具面恰为 3 个（cli + skills 元工具），RECALL_TOOL_NAMES 与之一一对应
test("CC-2a: 工具面 = { cli, skills_recall, skills_get }", () => {
  const tools = buildTools(ctx(), safety);
  assert.deepEqual(Object.keys(tools).toSorted(), ["cli", "skills_get", "skills_recall"]);
  // RECALL_TOOL_NAMES 是 cli 的别名集合（vault 召回判定）：与工具面一一对应
  assert.deepEqual(RECALL_TOOL_NAMES, ["cli"]);
  assert.ok("cli" in tools);
});

// CC-2a：cli 工具 execute 可用（透传 argv，经真实子进程）
test("CC-2a: cli 工具 execute 执行 query 子命令", async () => {
  const tools = buildTools(ctx(), safety);
  const out = await tools.cli.execute!({ args: ["query", "LIST FROM \"\""] }, {} as never);
  assert.match(String(out), /<<VAULT_DATA T>>/);
});

// CC-2a：skills_get 元工具保留（grounding）
test("CC-2a: skills_get 取 core 成功（grounding 元工具）", async () => {
  const tools = buildTools(ctx(), safety);
  const out = await tools.skills_get.execute!({ name: "summary" }, {} as never);
  assert.match(String(out), /summary|x-basalt/i);
});

// CC-2a：skills_recall 元工具保留（模糊召回）
test("CC-2a: skills_recall 按关键字召回", async () => {
  const tools = buildTools(ctx(), safety);
  const out = await tools.skills_recall.execute!({ keyword: "query" }, {} as never);
  assert.ok(String(out).length > 0);
});

// CC-2a：wrapToolErrors 外壳仍在（失败 → 结构化错误）
test("CC-2a: cli 工具失败经 wrapToolErrors → 结构化错误", async () => {
  const tools = buildTools(ctx(), safety);
  await assert.rejects(
    tools.cli.execute!({ args: ["query", "BAD DQL"] }, {} as never),
    /\[工具失败·/,
  );
});

// CC-2：NO_RECALL_NOTICE 文案与 cli 工具名一致
test("CC-2: NO_RECALL_NOTICE 提及 cli（而非旧工具名）", () => {
  assert.match(NO_RECALL_NOTICE, /cli/);
  assert.doesNotMatch(NO_RECALL_NOTICE, /meta_get|pipeline_run/);
});

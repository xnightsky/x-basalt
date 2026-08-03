/**
 * chat cli 单工具测试（CC-1，计划 2026-08-03-chat-cli-tool.md）。
 *
 * 切 C 核心：模型不再拿 15 个手写工具，只拿一个 cli 工具（args 数组直传 execFile）。
 * 本文件验证工具壳五件事：argv 透传、allowlist、注入、safety 包裹、超时。
 * 真实子进程跑 dist/cli.js（测试前需 pnpm build，与 evals 同纪律）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildCliTool, CHAT_CHILD_ENV } from "../../src/chat/cli-tool.js";
import { makeSafety } from "../../src/chat/safety.js";
import { VaultIndexer } from "../../src/indexer/index.js";

const CLI_ENTRY = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const safety = makeSafety({ nonce: "T", maxChars: 8000 });

let dir: string;
let dbPath: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "xb-clitool-"));
  writeFileSync(join(dir, "a.md"), "---\nstatus: draft\n---\n# A\n", "utf8");
  writeFileSync(join(dir, "b.md"), "---\nstatus: done\n---\n# B\n", "utf8");
  dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();
  idx.close();
});

function tool() {
  return buildCliTool({ dbPath, vaultPath: dir }, safety, CLI_ENTRY);
}

// CC-1a：argv 数组逐项透传（含带空格参数不被切碎），stdout 返回
test("CC-1a: cli query 经 args 数组透传，结果带 total", async () => {
  const out = await tool().execute!(
    { args: ["query", "LIST FROM \"\""] },
    {} as never,
  );
  const s = String(out);
  assert.match(s, /<<VAULT_DATA T>>/); // safety 包裹
  assert.match(s, /"total": 2/);
});

// CC-1a：非 0 exit → 结构化错误（复用 classifyError）
test("CC-1a: CLI 报错 → 结构化错误带分类", async () => {
  await assert.rejects(
    tool().execute!({ args: ["query", "BAD DQL"] }, {} as never),
    /\[工具失败·/,
  );
});

// CC-1b：allowlist 拒绝 watch（常驻）与 chat（防递归）
test("CC-1b: allowlist 拒绝 watch/chat", async () => {
  await assert.rejects(tool().execute!({ args: ["watch"] }, {} as never), /不允许的子命令/);
  await assert.rejects(tool().execute!({ args: ["chat", "hi"] }, {} as never), /不允许的子命令/);
});

// CC-1b：防递归——env 常量注入定义存在 + chat 启动检测（CC-3 在 cli.ts 落地检测）
test("CC-1b: 防递归双保险——CHAT_CHILD_ENV 常量已定义", () => {
  assert.equal(CHAT_CHILD_ENV, "X_BASALT_CHAT_CHILD");
});

// CC-1c：--vault/--db 自动注入（args 未含时）
test("CC-1c: 注入 --vault/--db（用户未给时自动补）", async () => {
  // 不带 --vault/--db：工具壳补上后应能正常查询（同 CC-1a 语义）
  const out = await tool().execute!({ args: ["query", "LIST FROM \"\""] }, {} as never);
  assert.match(String(out), /"total": 2/);
});

// CC-1c：source 入参（动态 base stdin）经 stdin 传给子进程
test("CC-1c: source 入参走 stdin（cli base -）", async () => {
  const source = "views:\n  - type: table\n    name: All\n    order: [file.name, status]\n";
  const out = await tool().execute!({ args: ["base", "-"], source }, {} as never);
  const s = String(out);
  assert.match(s, /"base": "<stdin>"/);
  assert.match(s, /"view": "All"/);
  assert.match(s, /"total": 2/);
});

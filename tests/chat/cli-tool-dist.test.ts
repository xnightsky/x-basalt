/**
 * chat cli 工具 dist 形态测试（P1 修复，kimi 评审 2026-08-03）。
 *
 * 生产形态：全局安装的 x-basalt 跑 dist/chat/cli-tool.js，默认入口必须自动解析到
 * dist/cli.js（裸 node 可跑，不依赖 devDependency tsx）。本文件从 dist 加载并验证；
 * dist 不存在（未 build）时跳过——测试矩阵以 src 形态为主（cli-tool.test.ts），
 * 本文件是生产形态的专项回归，需 `pnpm build` 后才真正生效。
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const DIST_CLI_TOOL = fileURLToPath(new URL("../../dist/chat/cli-tool.js", import.meta.url));
const hasDist = existsSync(DIST_CLI_TOOL);

const { buildCliTool } = hasDist ? require("../../dist/chat/cli-tool.js") : { buildCliTool: undefined };
const { makeSafety } = hasDist ? require("../../dist/chat/safety.js") : { makeSafety: undefined };
const { VaultIndexer } = hasDist ? require("../../dist/indexer/index.js") : { VaultIndexer: undefined };

let dir: string;
let dbPath: string;

async function setupVault(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), "xb-cli-dist-"));
  writeFileSync(join(dir, "a.md"), "---\nstatus: draft\n---\n# A\n", "utf8");
  writeFileSync(join(dir, "b.md"), "---\nstatus: done\n---\n# B\n", "utf8");
  dbPath = join(dir, "index.db");
  const idx = new VaultIndexer({ vaultPath: dir, dbPath });
  await idx.rebuild();
  idx.close();
}

test("P1: dist 形态默认入口（不注入 cliEntry）→ 自动解析 dist/cli.js 并可查询", { skip: !hasDist }, async () => {
  await setupVault();
  const safety = makeSafety({ nonce: "T", maxChars: 8000 });
  // 不传 cliEntry：默认入口必须按运行时形态解析（dist/chat/cli-tool.js → ../cli.js）
  const tool = buildCliTool({ dbPath, vaultPath: dir }, safety);
  const out = await tool.execute({ args: ["query", "LIST FROM \"\""] }, {});
  const s = String(out);
  assert.match(s, /<<VAULT_DATA T>>/);
  assert.match(s, /"total": 2/);
  rmSync(dir, { recursive: true, force: true });
});

test("P1: dist 形态 cli base - + source 走 stdin", { skip: !hasDist }, async () => {
  await setupVault();
  const safety = makeSafety({ nonce: "T", maxChars: 8000 });
  const tool = buildCliTool({ dbPath, vaultPath: dir }, safety);
  const out = await tool.execute(
    {
      args: ["base", "-"],
      source: "views:\n  - type: table\n    name: All\n    order: [file.name]\n",
    },
    {},
  );
  assert.match(String(out), /"base": "<stdin>"/);
  assert.match(String(out), /"total": 2/);
  rmSync(dir, { recursive: true, force: true });
});

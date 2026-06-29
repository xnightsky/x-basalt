import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTools, type ToolContext } from "../../src/chat/tools.js";
import { makeSafety } from "../../src/chat/safety.js";

const safety = makeSafety({ nonce: "T", maxChars: 8000 });

let dir: string;
let file: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "xb-chat-"));
  file = join(dir, "a.md");
  writeFileSync(file, "---\nstatus: draft\n---\n# A\n", "utf8");
});

function ctx(): ToolContext {
  return { dbPath: join(dir, "index.db"), vaultPath: dir };
}

test("meta_get：读工具直跑，结果经 safety 包裹", async () => {
  const tools = buildTools(ctx(), safety);
  const out = await tools.meta_get.execute!({ file, key: "status" }, {} as never);
  assert.match(String(out), /<<VAULT_DATA T>>/);
  assert.match(String(out), /draft/);
});

test("meta_set：直接落盘（无确认）", async () => {
  const tools = buildTools(ctx(), safety);
  await tools.meta_set.execute!({ file, key: "status", value: "done" }, {} as never);
  assert.match(readFileSync(file, "utf8"), /status: done/);
});

test("meta_unset：直接落盘删除属性", async () => {
  const tools = buildTools(ctx(), safety);
  await tools.meta_unset.execute!({ file, key: "status" }, {} as never);
  assert.doesNotMatch(readFileSync(file, "utf8"), /status:/);
});

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTools, type ToolContext } from "../../src/chat/tools.js";
import { makeSafety } from "../../src/chat/safety.js";
import { VaultIndexer } from "../../src/indexer/index.js";

const safety = makeSafety({ nonce: "T", maxChars: 8000 });

/** 剥掉 safety 的 <<VAULT_DATA T>> 边界，把工具结果还原为 JSON 对象。 */
function unwrap(out: unknown): Record<string, unknown> {
  const s = String(out)
    .replace(/^<<VAULT_DATA T>>\n/, "")
    .replace(/\n<<END_VAULT_DATA T>>$/, "");
  return JSON.parse(s) as Record<string, unknown>;
}

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

test("scan：counts 永远全 + changes 分页（大量无索引）", async () => {
  const sdir = mkdtempSync(join(tmpdir(), "xb-scan-"));
  for (let i = 0; i < 5; i++) writeFileSync(join(sdir, `n${i}.md`), `# n${i}\n`, "utf8");
  const tools = buildTools({ dbPath: join(sdir, "index.db"), vaultPath: sdir }, safety);
  const json = unwrap(await tools.scan.execute!({ size: 2 }, {} as never));
  const counts = json.counts as Record<string, number>;
  assert.equal(counts.added, 5); // 计数全（不随分页截断）
  assert.equal(json.total, 5);
  assert.equal(json.returned, 2); // 明细分页
  assert.equal((json.changes as unknown[]).length, 2);
  assert.equal(json.hasMore, true);
  assert.equal((json.changes as { kind: string }[])[0]?.kind, "added");
  rmSync(sdir, { recursive: true, force: true });
});

test("query：工具默认分页 size=50，结果带 total", async () => {
  const qdir = mkdtempSync(join(tmpdir(), "xb-q-"));
  for (let i = 0; i < 3; i++) writeFileSync(join(qdir, `q${i}.md`), `# q${i}\n`, "utf8");
  const idx = new VaultIndexer({ vaultPath: qdir, dbPath: join(qdir, "index.db") });
  await idx.rebuild();
  idx.close();
  const tools = buildTools({ dbPath: join(qdir, "index.db"), vaultPath: qdir }, safety);
  const json = unwrap(await tools.query.execute!({ dql: 'LIST FROM ""' }, {} as never));
  assert.equal(json.total, 3);
  assert.equal(json.size, 50);
  assert.equal(json.returned, 3);
  assert.equal(json.hasMore, false);
  rmSync(qdir, { recursive: true, force: true });
});

test("list：工具按 folder 过滤，默认分页 size=50", async () => {
  const ldir = mkdtempSync(join(tmpdir(), "xb-list-"));
  mkdirSync(join(ldir, "Projects"), { recursive: true });
  writeFileSync(join(ldir, "Projects", "a.md"), "# a\n", "utf8");
  writeFileSync(join(ldir, "Projects", "b.md"), "# b\n", "utf8");
  writeFileSync(join(ldir, "root.md"), "# root\n", "utf8");
  const idx = new VaultIndexer({ vaultPath: ldir, dbPath: join(ldir, "index.db") });
  await idx.rebuild();
  idx.close();
  const tools = buildTools({ dbPath: join(ldir, "index.db"), vaultPath: ldir }, safety);
  const json = unwrap(await tools.list.execute!({ folder: "Projects" }, {} as never));
  assert.equal(json.total, 2);
  assert.equal(json.size, 50);
  assert.equal((json.files as unknown[]).length, 2);
  rmSync(ldir, { recursive: true, force: true });
});

test("read_note：返回剥离 frontmatter 的正文", async () => {
  const tools = buildTools(ctx(), safety);
  const json = unwrap(await tools.read_note.execute!({ file }, {} as never));
  assert.match(json.body as string, /# A/);
  assert.doesNotMatch(json.body as string, /status: draft/);
});

test("read_note：按行分页（offset/size + hasMore + totalLines）", async () => {
  const rdir = mkdtempSync(join(tmpdir(), "xb-read-"));
  const rfile = join(rdir, "note.md");
  const lines = Array.from({ length: 5 }, (_, i) => `line${i}`);
  writeFileSync(rfile, `---\nstatus: draft\n---\n${lines.join("\n")}\n`, "utf8");
  const tools = buildTools({ dbPath: join(rdir, "index.db"), vaultPath: rdir }, safety);
  const json = unwrap(await tools.read_note.execute!({ file: rfile, size: 3 }, {} as never));
  assert.equal(json.returned, 3);
  assert.equal(json.hasMore, true);
  assert.match(json.body as string, /line0/);
  assert.doesNotMatch(json.body as string, /line3/);
  rmSync(rdir, { recursive: true, force: true });
});

test("read_note：文件不存在 → 结构化 not-found 错误", async () => {
  const tools = buildTools(ctx(), safety);
  await assert.rejects(
    tools.read_note.execute!({ file: join(dir, "missing.md") }, {} as never),
    /\[工具失败·not-found\]/,
  );
});

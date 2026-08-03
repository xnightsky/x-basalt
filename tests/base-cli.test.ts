import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";

// === Bases CLI 薄出口端到端测试（计划 2026-07-27-bases-cli-export 取舍 #4） ===
//
// subprocess 跑真实 cli.ts（node --import tsx），只验装配层：参数 → BaseEngine.query →
// emit → 退出码。引擎语义由 src/base 自身测试覆盖，此处不重复。
// fixture：tests/fixtures/bases/p1/vault（单根），before 里 rebuild 到临时库。

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// 绝对 URL 解析 tsx loader：不受子进程 cwd 影响（同 cli.test.ts 模式）。
const TSX = import.meta.resolve("tsx");

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p1/vault", import.meta.url));
// .base 一律传绝对路径：规避「相对 cwd 还是相对 vault」的歧义，引擎 resolve 后仍须落 vault 内（SEC-008）。
const defaultBase = join(vaultPath, "views", "default.base");
const namedBase = join(vaultPath, "views", "named.base"); // 含 all / active 两个 view

let tmpDir: string;
let dbPath: string;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-cli-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），子进程只读打开
});
after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 同步跑一次 CLI，返回退出码与输出。input 可选：传入则作为 stdin 管道输入。 */
function run(args: string[], input?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    ...(input !== undefined ? { input } : {}),
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 解析 stdout 为 BaseQueryResult 形态的 JSON（shape 仅取本测试消费字段）。 */
function parseJson(stdout: string): {
  conformance: string;
  view: string;
  columns: string[];
  total: number;
  rows: Record<string, unknown>[];
  diagnostics: { rule: string; severity: string; message: string }[];
} {
  return JSON.parse(stdout) as ReturnType<typeof parseJson>;
}

test("主路径：默认 view 输出稳定 JSON 契约，md-only warning 不影响退出码", () => {
  const r = run(["base", defaultBase, "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.conformance, "bases-markdown-2026-07");
  assert.equal(result.view, "default"); // 缺省取 views[0]（BASE-VIEW-001）
  assert.ok(result.columns.length > 0);
  assert.ok(result.total > 0);
  assert.ok(result.rows.length > 0);
  // md-only 数据集恒发 warning（BASE-DATA-001）：存在但不抬退出码。
  const mdOnly = result.diagnostics.find((d) => d.rule === "base/markdown-only-dataset");
  assert.ok(mdOnly, "diagnostics 应含 base/markdown-only-dataset");
  assert.equal(mdOnly.severity, "warning");
  assert.ok(!result.diagnostics.some((d) => d.severity === "error"));
});

test("--view 指定命名 view：回显实际执行的 view 名", () => {
  const r = run(["base", namedBase, "--view", "active", "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.view, "active");
});

test("view 不存在：exit 1，JSON 含 base/view-not-found 且 rows 为空", () => {
  const r = run(["base", namedBase, "--view", "Nope", "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(
    result.diagnostics.some((d) => d.rule === "base/view-not-found" && d.severity === "error"),
  );
  assert.deepEqual(result.rows, []);
});

test("不存在的 .base：exit 1，诊断含 error", () => {
  const r = run([
    "base",
    join(vaultPath, "views", "no-such.base"),
    "--vault",
    vaultPath,
    "--db",
    dbPath,
  ]);
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(result.diagnostics.some((d) => d.severity === "error"));
});

test(".base 越界（vault 之外）：exit 1，SEC-008 路径防线诊断 error", () => {
  const outside = join(tmpDir, "outside.base");
  const r = run(["base", outside, "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(result.diagnostics.some((d) => d.severity === "error"));
});

test("CLI 层字节稳定：同一命令连跑两次 stdout 全等", () => {
  const args = ["base", defaultBase, "--vault", vaultPath, "--db", dbPath];
  const r1 = run(args);
  const r2 = run(args);
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r1.stdout, r2.stdout);
});

test("--format yaml：输出非 JSON 且含 conformance 字样", () => {
  const r = run(["base", defaultBase, "--vault", vaultPath, "--db", dbPath, "--format", "yaml"]);
  assert.equal(r.status, 0, r.stderr);
  assert.throws(() => JSON.parse(r.stdout), "yaml 输出不应是合法 JSON");
  assert.ok(r.stdout.includes("conformance"));
});

// === P3 片三：--conformance 薄透传（计划 2026-07-27-bases-p3-attachments 条目 13） ===

test("--conformance bases-all-files-2026-07：附件作为行，total = 7 篇 .md + 16 个附件", () => {
  const r = run([
    "base",
    defaultBase,
    "--vault",
    vaultPath,
    "--db",
    dbPath,
    "--conformance",
    "bases-all-files-2026-07",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.conformance, "bases-all-files-2026-07");
  assert.equal(result.total, 23);
  assert.ok(
    result.rows.some((row) => row["file.name"] === "cover.png"),
    "应含附件行 assets/cover.png",
  );
  // all-files 模式附件作为行，不发 md-only 数据集 warning。
  assert.ok(!result.diagnostics.some((d) => d.rule === "base/markdown-only-dataset"));
});

test("缺省 --conformance：markdown 口径，附件不为行（JSON 契约不变）", () => {
  const r = run(["base", defaultBase, "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.conformance, "bases-markdown-2026-07");
  assert.equal(result.total, 7);
  assert.ok(!result.rows.some((row) => row["file.name"] === "cover.png"));
});

test("--conformance 未知 id：exit 1，JSON 含 base/invalid-schema error 且 rows 为空", () => {
  const r = run([
    "base",
    defaultBase,
    "--vault",
    vaultPath,
    "--db",
    dbPath,
    "--conformance",
    "nope",
  ]);
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(
    result.diagnostics.some((d) => d.rule === "base/invalid-schema" && d.severity === "error"),
  );
  assert.deepEqual(result.rows, []);
});

// ---- 片六：--context-file 薄透传（此前只有引擎级测试，CLI 装配层裸奔）----

test("--context-file：this.* 在 CLI 路径上真实生效", () => {
  const r = run([
    "base",
    namedBase,
    "--view",
    "ctx",
    "--vault",
    vaultPath,
    "--db",
    dbPath,
    "--context-file",
    "Beta.md",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.["file.name"], "Alpha.md");
  assert.equal(result.rows[0]?.["this.file.name"], "Beta.md", "this 指向 --context-file 那一篇");
});

test("--context-file 缺省：this.* 报 dynamic-context-required（行级 warning，不影响退出码）", () => {
  const r = run(["base", namedBase, "--view", "ctx", "--vault", vaultPath, "--db", dbPath]);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.ok(
    result.diagnostics.some(
      (d) => d.rule === "base/dynamic-context-required" && d.severity === "warning",
    ),
  );
});

test("--context-file 指向不存在的文件：exit 1 + error 诊断 + rows 为空", () => {
  const r = run([
    "base",
    namedBase,
    "--view",
    "ctx",
    "--vault",
    vaultPath,
    "--db",
    dbPath,
    "--context-file",
    "完全不存在.md",
  ]);
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(
    result.diagnostics.some(
      (d) => d.rule === "base/dynamic-context-required" && d.severity === "error",
    ),
  );
  assert.deepEqual(result.rows, []);
});

// === 动态 base 第一步：CLI stdin 入参（DB-3b，计划 2026-08-03-bases-dynamic-stdin.md） ===
// `-` / `--stdin` 从管道读 .base 定义；与文件模式对同一内容等价，诊断 file=<stdin>。

const defaultBaseSource = readFileSync(defaultBase, "utf8");

function stdinArgs(extra: string[] = []): string[] {
  return ["base", "--stdin", "--vault", vaultPath, "--db", dbPath, ...extra];
}

test("DB-3b: `-` 从 stdin 读 .base 定义，与文件模式等价", () => {
  const viaStdin = run(["base", "-", "--vault", vaultPath, "--db", dbPath], defaultBaseSource);
  assert.equal(viaStdin.status, 0, viaStdin.stderr);
  const viaFile = run(["base", defaultBase, "--vault", vaultPath, "--db", dbPath]);
  const fromStdin = parseJson(viaStdin.stdout);
  const fromFile = parseJson(viaFile.stdout);
  assert.equal(fromStdin.view, fromFile.view);
  assert.deepEqual(fromStdin.columns, fromFile.columns);
  assert.equal(fromStdin.total, fromFile.total);
  assert.deepEqual(fromStdin.rows, fromFile.rows);
  assert.equal(fromStdin.base, "<stdin>");
  assert.equal(fromFile.base, "views/default.base");
  // 诊断结构一致（md-only warning 等），file 字段不同是唯一差异
  assert.deepEqual(
    fromStdin.diagnostics.map((d) => ({ rule: d.rule, severity: d.severity })),
    fromFile.diagnostics.map((d) => ({ rule: d.rule, severity: d.severity })),
  );
});

test("DB-3b: --stdin 与 `-` 等价", () => {
  const viaFlag = run(stdinArgs(), defaultBaseSource);
  const viaDash = run(["base", "-", "--vault", vaultPath, "--db", dbPath], defaultBaseSource);
  assert.equal(viaFlag.status, 0, viaFlag.stderr);
  assert.equal(viaFlag.stdout, viaDash.stdout);
});

test("DB-3b: stdin 非法 YAML → exit 1 + invalid-yaml error（file=<stdin>）", () => {
  const r = run(stdinArgs(), "views: [");
  assert.equal(r.status, 1);
  const result = parseJson(r.stdout);
  assert.ok(
    result.diagnostics.some(
      (d) => d.rule === "base/invalid-yaml" && d.severity === "error" && d.file === "<stdin>",
    ),
  );
  assert.deepEqual(result.rows, []);
});

test("DB-3b: file 与 --stdin 同给 → --stdin 优先（file 传 `-` 是简写，冗余无害）", () => {
  const r = run(stdinArgs([defaultBase]), defaultBaseSource);
  assert.equal(r.status, 0, r.stderr);
  const result = parseJson(r.stdout);
  assert.equal(result.base, "<stdin>");
  assert.ok(result.total > 0);
});

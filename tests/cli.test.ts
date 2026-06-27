import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// === M4.4: CLI 端到端测试 ===
//
// 以 subprocess 跑真实 cli.ts（node --import tsx），覆盖五命令主路径、退出码、flag↔config 优先级链。
// 各层已有单测；此处只验「装配 + 输出 + 退出码 + 配置合并」这层 cli.ts 独有逻辑。

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// 在仓库 cwd 下把 tsx loader 解析成绝对 URL：否则子进程换了 cwd（如临时目录）后
// `--import tsx` 会按子进程 cwd 找不到 tsx 而崩。绝对 URL 不受子进程 cwd 影响。
const TSX = import.meta.resolve("tsx");

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "x-basalt-cli-"));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 同步跑一次 CLI，返回退出码与输出。 */
function run(args: string[], opts: { cwd?: string } = {}): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    cwd: opts.cwd,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 建一个含单文件（frontmatter status + 行内标签）的临时 vault，返回其路径。 */
function makeVault(): string {
  const vault = freshDir();
  writeFileSync(join(vault, "Note.md"), "---\nstatus: active\n---\n# Note\n\n#mytag\n");
  return vault;
}

/** 跨平台终止进程树（watch 是常驻进程，测完须杀干净）。 */
function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
  else {
    try {
      process.kill(pid);
    } catch {
      // 已退出则忽略
    }
  }
}

// 共享索引：建一次 vault + index，供 query 系用例复用，省去重复 subprocess 开销。
let sharedVault: string;
let sharedDb: string;
before(() => {
  sharedVault = makeVault();
  sharedDb = join(freshDir(), "shared.db");
  const r = run(["index", sharedVault, "--db", sharedDb]);
  assert.equal(r.status, 0, `前置 index 应成功，stderr=${r.stderr}`);
});

test("parse 主路径：输出合法 JSON AST（frontmatter + nodes）", () => {
  const vault = makeVault();
  const r = run(["parse", join(vault, "Note.md")]);
  assert.equal(r.status, 0);
  const ast = JSON.parse(r.stdout);
  assert.equal(ast.frontmatter.status, "active");
  assert.ok(Array.isArray(ast.nodes), "应有 nodes 数组");
});

test("parse --format yaml：输出 YAML（非 JSON 起始）", () => {
  const vault = makeVault();
  const r = run(["parse", join(vault, "Note.md"), "--format", "yaml"]);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.trimStart().startsWith("{"), "yaml 输出不应以 { 起始");
  assert.match(r.stdout, /frontmatter:/);
});

test("index 主路径：建库并打印 ✓，退出 0", () => {
  const vault = makeVault();
  const db = join(freshDir(), "i.db");
  const r = run(["index", vault, "--db", db]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /✓ 已索引/);
});

test("scan 主路径：新增文件后增量重索引报告 +1", () => {
  const vault = makeVault();
  const db = join(freshDir(), "scan.db");
  assert.equal(run(["index", vault, "--db", db]).status, 0);
  writeFileSync(join(vault, "New.md"), "# New\n#x\n");
  const r = run(["scan", vault, "--db", db]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+1 新增/);
});

test("scan --json：输出结构化差异报告", () => {
  const vault = makeVault();
  const db = join(freshDir(), "scan.db");
  run(["index", vault, "--db", db]);
  writeFileSync(join(vault, "New.md"), "# New\n");
  const r = run(["scan", vault, "--db", db, "--json"]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).added, ["New.md"]);
});

test("scan --dry-run：报告差异但不写库（再扫仍报 +1）", () => {
  const vault = makeVault();
  const db = join(freshDir(), "scan.db");
  run(["index", vault, "--db", db]);
  writeFileSync(join(vault, "New.md"), "# New\n");
  assert.deepEqual(JSON.parse(run(["scan", vault, "--db", db, "--dry-run", "--json"]).stdout).added, [
    "New.md",
  ]);
  // dry-run 没写库，第二次仍报 New.md 为新增。
  assert.deepEqual(JSON.parse(run(["scan", vault, "--db", db, "--dry-run", "--json"]).stdout).added, [
    "New.md",
  ]);
});

test("query 主路径：经 --db 查共享索引返回命中行", () => {
  const r = run(["query", "LIST WHERE status = 'active'", "--db", sharedDb]);
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.type, "LIST");
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]["file.name"], "Note");
});

test("skill recall / list 主路径：召回内置规范", () => {
  const recall = run(["skill", "recall", "wikilink"]);
  assert.equal(recall.status, 0);
  assert.ok(JSON.parse(recall.stdout).some((s: { name: string }) => s.name === "obsidian-base-spec"));

  const list = run(["skill", "list"]);
  assert.equal(list.status, 0);
  assert.ok(JSON.parse(list.stdout).some((s: { name: string }) => s.name === "obsidian-base-spec"));
});

test("退出码：非法 DQL 经真实库 → 退出 1 且 stderr 打印 ✗", () => {
  const r = run(["query", "LISTE FROM x", "--db", sharedDb]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗/);
});

test("退出码：index 无 <vault> 且无配置 → 退出 1 且提示需要 vault", () => {
  const r = run(["index"], { cwd: freshDir() });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /需要 <vault>/);
});

test("退出码：skill recall 无命中 → 退出 1", () => {
  const r = run(["skill", "recall", "zzz-not-a-trigger-xyz"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未召回/);
});

test("优先级链：config 设 format=yaml 生效，--format json 覆盖", () => {
  const proj = freshDir();
  writeFileSync(join(proj, ".x-basalt.yaml"), "format: yaml\n");
  writeFileSync(join(proj, "A.md"), "---\nstatus: x\n---\n# A\n");
  const file = join(proj, "A.md");

  // 无 flag：用 config 的 yaml。
  const byCfg = run(["parse", file], { cwd: proj });
  assert.equal(byCfg.status, 0);
  assert.ok(!byCfg.stdout.trimStart().startsWith("{"), "应按 config 输出 yaml");

  // 有 flag：覆盖 config。
  const byFlag = run(["parse", file, "--format", "json"], { cwd: proj });
  assert.equal(byFlag.status, 0);
  assert.ok(byFlag.stdout.trimStart().startsWith("{"), "--format json 应覆盖 config");
});

test("优先级链：config 提供 vault+db，index/query 无参也能跑通", () => {
  const proj = freshDir();
  const vault = join(proj, "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "Note.md"), "---\nstatus: active\n---\n# Note\n");
  // 相对路径由各命令在 cwd=proj 下解析。
  writeFileSync(join(proj, ".x-basalt.yaml"), "vault: ./vault\ndb: ./index.db\n");

  const idx = run(["index"], { cwd: proj });
  assert.equal(idx.status, 0, `index(config) 应成功 stderr=${idx.stderr}`);

  const q = run(["query", "LIST"], { cwd: proj });
  assert.equal(q.status, 0, `query(config) 应成功 stderr=${q.stderr}`);
  assert.ok(JSON.parse(q.stdout).rows.length >= 1, "应能经 config.db 查到行");
});

test("watch 主路径：启动后打印已索引并进入监听（随后终止进程树）", async () => {
  const vault = makeVault();
  const db = join(freshDir(), "w.db");
  const child = spawn(process.execPath, ["--import", TSX, CLI, "watch", vault, "--db", db]);
  child.stdout.setEncoding("utf8");
  let out = "";
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20000);
    child.stdout.on("data", (d: string) => {
      out += d;
      if (out.includes("开始监听")) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  if (child.pid) killTree(child.pid);
  assert.ok(ready, `watch 应打印已索引并进入监听，实际 stdout=${out}`);
});

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
function run(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
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

test("X_BASALT_DIR：index 不带 --db 时库落在 $X_BASALT_DIR/index.db", () => {
  const vault = makeVault();
  const base = freshDir();
  const r = run(["index", vault], { env: { X_BASALT_DIR: base } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(base, "index.db")), "库应落在 X_BASALT_DIR/index.db");
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
  assert.deepEqual(
    JSON.parse(run(["scan", vault, "--db", db, "--dry-run", "--json"]).stdout).added,
    ["New.md"],
  );
  // dry-run 没写库，第二次仍报 New.md 为新增。
  assert.deepEqual(
    JSON.parse(run(["scan", vault, "--db", db, "--dry-run", "--json"]).stdout).added,
    ["New.md"],
  );
});

test("query 主路径：经 --db 查共享索引返回命中行", () => {
  const r = run(["query", "LIST WHERE status = 'active'", "--db", sharedDb]);
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.type, "LIST");
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0]["file.name"], "Note");
});

test("skills get / recall / list 主路径：召回内置规范", () => {
  // get 按名取完整（默认 Markdown，含标题）
  const got = run(["skills", "get", "obsidian-base-spec"]);
  assert.equal(got.status, 0);
  assert.match(got.stdout, /# obsidian-base-spec/);

  // recall --json（结构化）
  const recall = run(["skills", "recall", "wikilink", "--json"]);
  assert.equal(recall.status, 0);
  assert.ok(
    JSON.parse(recall.stdout).some((s: { name: string }) => s.name === "obsidian-base-spec"),
  );

  // list --json（结构化）
  const list = run(["skills", "list", "--json"]);
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

test("退出码：skills recall 无命中 → 退出 1", () => {
  const r = run(["skills", "recall", "zzz-not-a-trigger-xyz"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未召回/);
});

test("退出码：skills get 未命中名 → 退出 1", () => {
  const r = run(["skills", "get", "nope-not-a-skill"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /未找到/);
});

test("skills path 打印数据目录（非空）", () => {
  const r = run(["skills", "path"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.trim().length > 0);
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

// === MW1.5 meta 命令组端到端 ===

/** 建一个含 frontmatter 的临时 .md，返回路径。 */
function makeNote(content = "---\ntitle: A\nstatus: draft\n---\n# Note\n\nbody\n"): string {
  const file = join(freshDir(), "Note.md");
  writeFileSync(file, content, "utf8");
  return file;
}

test("meta get：无 key 输出整个 frontmatter；有 key 输出该值", () => {
  const file = makeNote();
  const all = run(["meta", "get", file]);
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout), { title: "A", status: "draft" });

  const one = run(["meta", "get", file, "status"]);
  assert.equal(one.status, 0);
  assert.equal(JSON.parse(one.stdout), "draft");
});

test("meta get --format yaml：输出 YAML", () => {
  const file = makeNote();
  const r = run(["meta", "get", file, "--format", "yaml"]);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.trimStart().startsWith("{"), "yaml 输出不应以 { 起始");
  assert.match(r.stdout, /title: A/);
});

test("meta set：写入属性并落盘、退出 0", () => {
  const file = makeNote();
  const r = run(["meta", "set", file, "status", "active"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ set status/);
  assert.match(readFileSync(file, "utf8"), /status: active/);
});

test("meta set --type number：按类型写入数值", () => {
  const file = makeNote();
  assert.equal(run(["meta", "set", file, "rank", "3", "--type", "number"]).status, 0);
  assert.equal(JSON.parse(run(["meta", "get", file, "rank"]).stdout), 3);
});

test("meta set --type string：强制字符串（证明 --type 真被解析，区别于 auto）", () => {
  const file = makeNote();
  // auto 会把 "3" 推断为 number 3；--type string 必须得到字符串 "3"。
  assert.equal(run(["meta", "set", file, "code", "3", "--type", "string"]).status, 0);
  const got = JSON.parse(run(["meta", "get", file, "code"]).stdout);
  assert.strictEqual(got, "3");
});

test("meta set --dry-run：打印将写入内容但不落盘", () => {
  const file = makeNote();
  const prev = readFileSync(file, "utf8");
  const r = run(["meta", "set", file, "x", "9", "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /x: 9/);
  assert.equal(readFileSync(file, "utf8"), prev, "dry-run 不应改文件");
});

test("meta unset / rename：删除与改名落盘正确", () => {
  const file = makeNote();
  assert.equal(run(["meta", "unset", file, "status"]).status, 0);
  assert.equal(run(["meta", "get", file, "status"]).stdout.trim(), "null");

  assert.equal(run(["meta", "rename", file, "title", "name"]).status, 0);
  assert.equal(JSON.parse(run(["meta", "get", file, "name"]).stdout), "A");
});

test("meta 退出码：rename 到已存在键 → 退出 1 且 ✗", () => {
  const file = makeNote();
  const r = run(["meta", "rename", file, "title", "status"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗.*已存在/);
});

test("meta 退出码：非法 YAML frontmatter 的写操作 → 退出 1、文件不变", () => {
  const file = makeNote("---\nk: [bad\n---\nbody\n");
  const prev = readFileSync(file, "utf8");
  const r = run(["meta", "set", file, "x", "1"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗/);
  assert.equal(readFileSync(file, "utf8"), prev);
});

test("meta normalize：tags 标量化为列表 + 单数键迁移，落盘并报告", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, '---\ntag: "#a #b a"\ntitle: T\n---\n# body\n', "utf8");
  const r = run(["meta", "normalize", file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ normalize/);
  assert.deepEqual(JSON.parse(run(["meta", "get", file, "tags"]).stdout), ["a", "b"]);
  // 单数 tag 已迁走
  assert.equal(run(["meta", "get", file, "tag"]).stdout.trim(), "null");
});

test("meta normalize：已规范文件报告已是规范形态、不写盘", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\ntags:\n  - a\n  - b\n---\n# body\n", "utf8");
  const prev = readFileSync(file, "utf8");
  const r = run(["meta", "normalize", file]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /已是规范形态/);
  assert.equal(readFileSync(file, "utf8"), prev);
});

test("meta normalize --sort-keys：排序顶层键；不传则不排序", () => {
  const mk = () => {
    const f = join(freshDir(), "N.md");
    writeFileSync(f, "---\nb: 1\na: 2\n---\n# body\n", "utf8");
    return f;
  };
  const noSort = mk();
  run(["meta", "normalize", noSort]);
  assert.deepEqual(Object.keys(JSON.parse(run(["meta", "get", noSort]).stdout)), ["b", "a"]);

  const sorted = mk();
  assert.equal(run(["meta", "normalize", sorted, "--sort-keys"]).status, 0);
  assert.deepEqual(Object.keys(JSON.parse(run(["meta", "get", sorted]).stdout)), ["a", "b"]);
});

test("meta normalize --dry-run：打印将写入内容但不落盘", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, '---\ntag: "#x y"\n---\n# body\n', "utf8");
  const prev = readFileSync(file, "utf8");
  const r = run(["meta", "normalize", file, "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /tags:/);
  assert.equal(readFileSync(file, "utf8"), prev, "dry-run 不应改文件");
});

// === MW3.3 meta profile / apply 端到端 ===

test("meta profile list：列出 profile，pkm-note 居首", () => {
  const r = run(["meta", "profile", "list"]);
  assert.equal(r.status, 0, r.stderr);
  const arr = JSON.parse(r.stdout) as { name: string }[];
  assert.equal(arr[0]?.name, "pkm-note");
  assert.ok(arr.some((p) => p.name === "llm-wiki"));
});

test("meta profile show pkm-note：输出规范+模板（含字段与 summary）", () => {
  const r = run(["meta", "profile", "show", "pkm-note"]);
  assert.equal(r.status, 0);
  const p = JSON.parse(r.stdout);
  assert.equal(p.name, "pkm-note");
  assert.ok(p.summary.length > 0);
  assert.ok((p.fields as { key: string }[]).some((f) => f.key === "created"));
});

test("meta apply pkm-note：机械补 created/modified 落盘", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\n---\n# Note\n", "utf8");
  const r = run(["meta", "apply", "pkm-note", file]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /apply pkm-note/);
  assert.match(readFileSync(file, "utf8"), /created:/);
  assert.match(readFileSync(file, "utf8"), /modified:/);
});

test("meta apply --set：消费者一次补语义字段（按类型转）", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\n---\n# Note\n", "utf8");
  const r = run(["meta", "apply", "pkm-note", file, "--set", "tags=a,b", "--set", "status=active"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(run(["meta", "get", file, "tags"]).stdout), ["a", "b"]);
  assert.equal(JSON.parse(run(["meta", "get", file, "status"]).stdout), "active");
});

test("meta apply --set 覆盖：显式值覆盖已有/机械字段", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\ntitle: Old\n---\n# Note\n", "utf8");
  const r = run(["meta", "apply", "llm-wiki", file, "--set", "title=abc", "--set", "type=note"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(run(["meta", "get", file, "title"]).stdout), "abc"); // 覆盖 Old
  assert.equal(JSON.parse(run(["meta", "get", file, "type"]).stdout), "note");
});

test("meta apply --dry-run：不落盘", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\n---\n# Note\n", "utf8");
  const prev = readFileSync(file, "utf8");
  const r = run(["meta", "apply", "pkm-note", file, "--dry-run"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /created:/);
  assert.equal(readFileSync(file, "utf8"), prev);
});

test("meta apply 退出码：未知 profile → 退出 1 且列可用名", () => {
  const file = join(freshDir(), "N.md");
  writeFileSync(file, "---\n---\n# Note\n", "utf8");
  const r = run(["meta", "apply", "nope", file]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗.*pkm-note/s);
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

test("watch 兼容 argv 首参为 --（pnpm run cli -- watch）", async () => {
  const vault = makeVault();
  const db = join(freshDir(), "w-dash.db");
  const child = spawn(process.execPath, ["--import", TSX, CLI, "--", "watch", vault, "--db", db]);
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
  assert.ok(ready, `带 leading -- 的 watch 应正常启动，实际 stdout=${out}`);
});

test("watch --on-change 含空格：未加引号拆参时合并为单条 shell 命令", async () => {
  const vault = makeVault();
  const db = join(freshDir(), "w-onchange.db");
  const onChangeArgs =
    process.platform === "win32"
      ? (["--on-change", "cmd", "/c", "echo", "onchange-ok"] as const)
      : (["--on-change", "echo", "hello", "world"] as const);
  const child = spawn(process.execPath, [
    "--import",
    TSX,
    CLI,
    "watch",
    vault,
    "--db",
    db,
    ...onChangeArgs,
  ]);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let out = "";
  let err = "";
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20000);
    child.stdout.on("data", (d: string) => {
      out += d;
      if (out.includes("开始监听")) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    child.stderr.on("data", (d: string) => {
      err += d;
    });
  });
  if (child.pid) killTree(child.pid);
  assert.ok(ready, `含空格 on-change 应启动监听，stdout=${out} stderr=${err}`);
  assert.doesNotMatch(err + out, /too many arguments/i);
});

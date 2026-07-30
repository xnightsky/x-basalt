/**
 * Bases 无头引擎 P1 端到端场景测试：fixture vault 建库 → BaseEngine.query() 全链路。
 *
 * 建库模式照 tests/query.test.ts：VaultIndexer({ vaultPath, dbPath: 临时路径 }).rebuild()
 * → close（checkpoint WAL）→ new BaseEngine() 只读查询；after 清理 tmp。
 *
 * 每个场景编号独立 test() 并在注释标号（可追溯至
 * docs/testing/2026-07-22-bases-scenario-matrix.md §4/§7/§9）：
 * BASE-VIEW-001..004、BASE-DATA-001..004、BASE-PROP-001/002/003/005、
 * BASE-FILE-001..005、BASE-EXPR-001..005、BASE-RESULT-001..004、
 * BASE-SEC-003/009、空 filter 数组拒绝、字节稳定专项、执行预算。
 *
 * fixture：tests/fixtures/bases/p1/vault（7 篇 .md + 附件 cover.png/note.pdf/standalone.base）
 * 与 vault-b（多根第二根，2 篇 .md）。各 note 的 frontmatter/链接/目录设计见 fixture 文件注释。
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  BASE_RULES,
  BaseEngine,
  type BaseQueryOptions,
  type BaseQueryResult,
} from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/bases/p1", import.meta.url));
const vaultPath = join(fixtureRoot, "vault");
const vaultBPath = join(fixtureRoot, "vault-b");

/** .base 文件绝对路径（engine 内部 resolve + 越界检查，测试直接给绝对路径）。 */
function baseFile(name: string): string {
  return join(vaultPath, "views", name);
}

let tmpDir: string;
let dbPath: string; // 单根（vault）索引库
let multiDbPath: string; // 多根（vault + vault-b）索引库
let engine: BaseEngine;

// 全套用例共享两份索引：先全量 rebuild 到临时库，再以只读引擎查询（同 tests/query.test.ts 模式）。
before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开

  multiDbPath = join(tmpDir, "multi.db");
  const multiIdx = new VaultIndexer({ vaultPath: [vaultPath, vaultBPath], dbPath: multiDbPath });
  await multiIdx.rebuild();
  multiIdx.close();

  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 单根查询便捷入口。 */
function query(
  base: string,
  view?: string,
  extra?: Partial<Pick<BaseQueryOptions, "limits" | "contextFile" | "clock">>,
): BaseQueryResult {
  return engine.query({
    basePath: baseFile(base),
    view,
    dbPath,
    vaultRoots: [vaultPath],
    ...extra,
  });
}

/** 结果中的 error 级诊断（多数主路径断言其为空）。 */
function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** 结果的诊断 rule 列表（按出现顺序）。 */
function rulesOf(r: BaseQueryResult): string[] {
  return r.diagnostics.map((d) => d.rule);
}

// ---------- BASE-VIEW：view 选择 ----------

// BASE-VIEW-001：未指定 view → 选择 views[0]
test("BASE-VIEW-001: 未指定 view 选择 views[0]", () => {
  const r = query("default.base");
  assert.equal(r.view, "default");
  assert.equal(r.conformance, "bases-markdown-2026-07");
  assert.deepEqual(errorsOf(r), []);
});

// BASE-VIEW-002：指定命名 view → 只应用目标 view 配置
test("BASE-VIEW-002: 指定命名 view 只应用目标 view 配置", () => {
  const all = query("named.base", "all");
  assert.equal(all.view, "all");
  assert.equal(all.total, 7); // 无 filter：全量 7 篇 .md
  const active = query("named.base", "active");
  assert.equal(active.view, "active");
  assert.equal(active.total, 4); // status == "active"：Alpha/Gamma/Delta/Epsilon
  assert.deepEqual(
    active.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Gamma.md", "Delta.md", "Epsilon.md"], // 无显式 sort → file.path ASC
  );
});

// BASE-VIEW-003：global filter + view filter 以 AND 合并
test("BASE-VIEW-003: global filter 与 view filter 外层 AND 合并", () => {
  const r = query("merged.base");
  assert.deepEqual(errorsOf(r), []);
  // global status==active（4 行）AND view priority>=2（4 行）→ 3 行（Alpha priority=1 被排除）。
  assert.equal(r.total, 3);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Gamma.md", "Delta.md", "Epsilon.md"],
  );
});

// BASE-VIEW-004：递归 and/or/not 嵌套逻辑结果正确
test("BASE-VIEW-004: 递归 and/or/not 嵌套逻辑", () => {
  const r = query("logic.base");
  assert.deepEqual(errorsOf(r), []);
  // and[or[status==inactive, status==pending], not[type==project]] → 仅 Beta（area/inactive）。
  assert.equal(r.total, 1);
  assert.equal(r.rows[0]?.["file.name"], "Beta.md");
});

// ---------- BASE-DATA：数据集口径 ----------

// BASE-DATA-001：无 filter 的 md-only 执行 → 全部 Markdown + conformance warning
test("BASE-DATA-001: 无 filter 全量返回并附 md-only warning", () => {
  const r = query("default.base");
  assert.equal(r.total, 7);
  assert.equal(r.rows.length, 7);
  const warning = r.diagnostics.find((d) => d.rule === BASE_RULES.markdownOnlyDataset);
  assert.ok(warning !== undefined);
  assert.equal(warning.severity, "warning");
  assert.match(warning.message, /md-only/);
});

// BASE-DATA-002：vault 含 PNG/PDF/.base → 附件不作为行，诊断声明 all-files 差异
test("BASE-DATA-002: 附件（png/pdf/.base）不出现在行中", () => {
  const r = query("default.base");
  for (const row of r.rows) {
    const name = String(row["file.name"]);
    assert.ok(name.endsWith(".md"), `附件不应为行：${name}`);
  }
  const warning = r.diagnostics.find((d) => d.rule === BASE_RULES.markdownOnlyDataset);
  assert.ok(warning !== undefined);
  assert.match(warning.message, /附件.*不作为行/);
});

// BASE-DATA-003：空 vault → total=0、rows=[]，不是错误
test("BASE-DATA-003: 空 vault 返回 total=0 rows=[] 且无错误", async () => {
  const emptyVault = join(tmpDir, "empty-vault");
  mkdirSync(emptyVault, { recursive: true });
  // 在临时空 vault 内放一个最小 .base（写测试 tmp 目录，非 vault fixture）。
  writeFileSync(
    join(emptyVault, "minimal.base"),
    "views:\n  - type: table\n    name: main\n",
    "utf8",
  );
  const emptyDb = join(tmpDir, "empty.db");
  const idx = new VaultIndexer({ vaultPath: emptyVault, dbPath: emptyDb });
  await idx.rebuild();
  idx.close();
  const r = engine.query({
    basePath: join(emptyVault, "minimal.base"),
    dbPath: emptyDb,
    vaultRoots: [emptyVault],
  });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.columns, ["file.name"]); // 缺省投影列
});

// BASE-DATA-004：多根 vault → 命名空间路径、不泄露物理绝对路径
test("BASE-DATA-004: 多根 vault 使用命名空间路径且不泄露绝对路径", () => {
  const r = engine.query({
    basePath: baseFile("default.base"),
    dbPath: multiDbPath,
    vaultRoots: [vaultPath, vaultBPath],
  });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 9); // 7 + 2
  const paths = r.rows.map((row) => String(row["file.name"]));
  // default.base 无 file.path 列，换 nosort.base 取路径列。
  const r2 = engine.query({
    basePath: baseFile("nosort.base"),
    dbPath: multiDbPath,
    vaultRoots: [vaultPath, vaultBPath],
  });
  const relPaths = r2.rows.map((row) => String(row["file.path"]));
  assert.ok(
    relPaths.every((p) => /^vault(-b)?\//.test(p)),
    `命名空间路径：${relPaths.join(",")}`,
  );
  assert.ok(relPaths.includes("vault-b/SecondA.md"));
  assert.ok(relPaths.includes("vault/Alpha.md"));
  assert.equal(paths.length, 9);
  // 结果与诊断序列化后不含任何物理绝对路径（tmpDir 为两份索引与空 vault 的公共前缀）。
  assert.ok(!JSON.stringify(r).includes(tmpDir), "结果不得泄露物理绝对路径");
  assert.ok(!JSON.stringify(r2).includes(tmpDir), "诊断不得泄露物理绝对路径");
});

// ---------- BASE-PROP：属性引用 ----------

// BASE-PROP-001：`status` 与 `note.status` 两种引用同义
test("BASE-PROP-001: 裸属性与 note. 前缀引用同义", () => {
  const bare = query("props.base", "bare");
  const prefixed = query("props.base", "prefixed");
  assert.deepEqual(errorsOf(bare), []);
  assert.deepEqual(errorsOf(prefixed), []);
  assert.deepEqual(
    bare.rows.map((row) => row["file.name"]),
    prefixed.rows.map((row) => row["file.name"]),
  );
  assert.equal(bare.total, 4);
});

// BASE-PROP-002：`note["Review Status"]` 带空格属性可访问
test('BASE-PROP-002: 带空格属性 note["Review Status"] 可过滤与投影', () => {
  const r = query("props.base", "spaced");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1);
  assert.equal(r.rows[0]?.["file.name"], "Alpha.md");
  assert.equal(r.rows[0]?.['note["Review Status"]'], "done");
});

// BASE-PROP-003：Unicode 属性名可解析、读取与排序
test("BASE-PROP-003: Unicode 属性名（状态）可解析、读取与排序", () => {
  const r = query("props.base", "unicode");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1);
  assert.equal(r.rows[0]?.["状态"], "启用");
  assert.deepEqual(r.columns, ["file.name", "状态"]);
});

// BASE-PROP-005：file.properties 返回 frontmatter 对象，不含 file/formula 命名空间
test("BASE-PROP-005: file.properties 返回 frontmatter 对象", () => {
  const r = query("props.base", "props-object");
  assert.deepEqual(errorsOf(r), []);
  const props = r.rows[0]?.["file.properties"];
  assert.ok(typeof props === "object" && props !== null && !Array.isArray(props));
  const obj = props as Record<string, unknown>;
  assert.equal(obj["status"], "active");
  assert.equal(obj["状态"], "启用");
  assert.equal(obj["Review Status"], "done");
  // 命名空间不泄漏：frontmatter 里没有的 file/formula 键不得出现。
  assert.ok(!("file" in obj));
  assert.ok(!("formula" in obj));
  // 输出必须是稳定 JSON 形状（无类实例/无 symbol 键）。
  assert.doesNotThrow(() => JSON.stringify(obj));
});

// BASE-PROP-004（oracle runbook ① · §4.1，Obsidian 1.12.7 实测冻结）：
// `X == null` 的**行集**——MISSING 与 null 合并后，缺失属性的行也命中。
// 这条是行集级差异（静默多/少行），故除 evaluator 单测外再锁一层端到端。
test("BASE-PROP-004(oracle ①): status == null 同时命中显式 null 与属性缺失的行", () => {
  const eq = query("props.base", "eq-null");
  assert.deepEqual(errorsOf(eq), []);
  assert.deepEqual(
    eq.rows.map((row) => row["file.path"]),
    ["Empty.md", "NullProps.md"], // Empty=属性缺失、NullProps=显式 null，二者都命中
  );

  // `!=` 是 `==` 的取反：两个 view 必须恰好互补，不重不漏。
  const ne = query("props.base", "ne-null");
  assert.deepEqual(errorsOf(ne), []);
  assert.deepEqual(
    ne.rows.map((row) => row["file.path"]),
    ["Alpha.md", "Beta.md", "Projects/Gamma.md", "Projects/Sub/Delta.md", "Projects2/Epsilon.md"],
  );
});

// ---------- BASE-FILE：file 字段与方法 ----------

// BASE-FILE-001：path/name/basename/folder/ext/size/ctime/mtime 类型与值正确
test("BASE-FILE-001: file 字段类型与值正确（时间字段与 DB 行一致）", () => {
  const r = query("files.base", "fields");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 1);
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(row["file.path"], "Alpha.md");
  assert.equal(row["file.name"], "Alpha.md");
  assert.equal(row["file.basename"], "Alpha");
  assert.equal(row["file.folder"], ""); // 根目录
  assert.equal(row["file.ext"], ".md");
  assert.ok(typeof row["file.size"] === "number" && row["file.size"] > 0);
  assert.ok(typeof row["file.ctime"] === "number");
  assert.ok(typeof row["file.mtime"] === "number");
  // ctime/mtime/size 与 DB 行一致即确定性（ indexer 写入值原样透传，epoch 毫秒 number）。
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const dbRow = db
      .prepare("SELECT size, ctime, mtime FROM files WHERE path = ?")
      .get("Alpha.md") as { size: number; ctime: number; mtime: number };
    assert.equal(row["file.size"], dbRow.size);
    assert.equal(row["file.ctime"], dbRow.ctime);
    assert.equal(row["file.mtime"], dbRow.mtime);
  } finally {
    db.close();
  }
});

// BASE-FILE-002：inFolder 命中目录本身及子目录，不命中前缀同名目录
test("BASE-FILE-002: file.inFolder 命中子目录、不命中前缀同名目录", () => {
  const r = query("files.base", "infolder");
  assert.deepEqual(errorsOf(r), []);
  // Projects/Gamma.md（目录本身）+ Projects/Sub/Delta.md（子目录）；Projects2/Epsilon.md 不命中。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Gamma.md", "Delta.md"],
  );
});

// BASE-FILE-003：hasTag 精确或嵌套前缀（frontmatter tags + 行内嵌套 tag）
test("BASE-FILE-003: file.hasTag 精确与嵌套前缀命中", () => {
  const exact = query("files.base", "hastag");
  assert.deepEqual(errorsOf(exact), []);
  // Alpha：frontmatter tags:[area] + 行内 #area/x，area 命中两者。
  assert.deepEqual(
    exact.rows.map((row) => row["file.name"]),
    ["Alpha.md"],
  );
  const nested = query("files.base", "hastag-nested");
  assert.deepEqual(
    nested.rows.map((row) => row["file.name"]),
    ["Alpha.md"],
  );
});

// BASE-FILE-004：hasProperty 只判键存在，不把 falsy 值当缺失
test("BASE-FILE-004: file.hasProperty 只判键存在（显式 null 也算存在）", () => {
  const r = query("files.base", "hasproperty");
  assert.deepEqual(errorsOf(r), []);
  // Alpha/Beta/Gamma/Delta/Epsilon 有 status；NullProps 的 status 显式 null 仍命中；Empty 无 status 不命中。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "NullProps.md", "Gamma.md", "Delta.md", "Epsilon.md"],
  );
});

// BASE-FILE-005：hasLink 复用路径感知解析（bare/qualified/embed 分支独立覆盖）
test("BASE-FILE-005: file.hasLink bare/qualified/embed 三分支", () => {
  const bare = query("files.base", "haslink-bare");
  assert.deepEqual(
    bare.rows.map((row) => row["file.name"]),
    ["Alpha.md"], // [[Beta]] bare 分支
  );
  const qualified = query("files.base", "haslink-qualified");
  assert.deepEqual(
    qualified.rows.map((row) => row["file.name"]),
    ["Alpha.md"], // [[Projects/Gamma]] qualified 分支
  );
  const embed = query("files.base", "haslink-embed");
  assert.deepEqual(
    embed.rows.map((row) => row["file.name"]),
    ["Alpha.md"], // ![[assets/cover.png]] embed 计入 outlinks（与 Obsidian 口径一致）
  );
});

// ---------- BASE-EXPR：表达式 e2e ----------

// BASE-EXPR-001：== != < > <= >= 字符串/数字比较真跑在索引数据上
test("BASE-EXPR-001: 比较运算符（数字 >= 与字符串区间）", () => {
  const num = query("exprs.base", "cmp-num");
  assert.deepEqual(errorsOf(num), []);
  // priority >= 2：Beta(2)/Gamma(2)/Delta(3)/Epsilon(2)。
  assert.deepEqual(
    num.rows.map((row) => row["file.name"]),
    ["Beta.md", "Gamma.md", "Delta.md", "Epsilon.md"],
  );
  const str = query("exprs.base", "cmp-str");
  // file.name > "A.md" && < "C.md"：Alpha.md/Beta.md。
  assert.deepEqual(
    str.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md"],
  );
});

// BASE-EXPR-002：! 与 && 及括号优先级
test("BASE-EXPR-002: 一元 ! 与 && 优先级", () => {
  const r = query("exprs.base", "logic-paren");
  assert.deepEqual(errorsOf(r), []);
  // !(status == "active") && type == "area" → 仅 Beta。
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Beta.md"],
  );
});

// BASE-EXPR-003：string contains/startsWith/endsWith/lower/trim 方法
test("BASE-EXPR-003: string 方法 startsWith/endsWith", () => {
  const r = query("exprs.base", "str-methods");
  assert.deepEqual(errorsOf(r), []);
  // status.startsWith("act") && status.endsWith("tive") → 4 篇 active。
  assert.equal(r.total, 4);
});

// BASE-EXPR-004：list contains 成员比较用 typed equality
test("BASE-EXPR-004: list contains（file.tags）typed equality", () => {
  const r = query("exprs.base", "list-ops");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha.md"],
  );
});

// BASE-EXPR-005：if()/list()/number() 全局函数与 lazy 分支
test("BASE-EXPR-005: 全局函数 number/list 与 if lazy 分支", () => {
  const globals = query("exprs.base", "globals");
  assert.deepEqual(errorsOf(globals), []);
  // number("2") == 2 && list(1, 2).contains(2)：与行无关恒 true → 全量 7 行。
  assert.equal(globals.total, 7);

  // if(true, status == "active", priority > "x")：else 分支永不被选择；
  // 若非 lazy，priority(number) > "x"(string) 会对 5 篇有 priority 的笔记产类型错误。
  const lazy = query("exprs.base", "if-lazy");
  assert.equal(lazy.total, 4);
  assert.ok(
    !rulesOf(lazy).includes(BASE_RULES.propertyTypeMismatch),
    "lazy 语义：未选分支不求值（待 oracle，暂定 lazy）",
  );
});

// ---------- BASE-RESULT：投影 / 排序 / limit ----------

// BASE-RESULT-001：order 投影、缺失值列保留为 null
test("BASE-RESULT-001: order 投影与缺失值列 null", () => {
  const r = query("default.base");
  assert.deepEqual(r.columns, ["file.name", "status", 'note["Review Status"]', "missing_prop"]);
  const alpha = r.rows.find((row) => row["file.name"] === "Alpha.md");
  assert.equal(alpha?.["status"], "active");
  assert.equal(alpha?.['note["Review Status"]'], "done");
  assert.equal(alpha?.["missing_prop"], null); // 全行缺失列保留为 null
  const beta = r.rows.find((row) => row["file.name"] === "Beta.md");
  assert.equal(beta?.['note["Review Status"]'], null); // 单行缺失同样 null
});

// BASE-RESULT-002：多键 sort 优先级 + 方向 + 稳定 tie-break
test("BASE-RESULT-002: 多键 sort 优先级、方向与稳定 tie-break", () => {
  // 空值排序位置见下一个用例（oracle runbook ② 冻结：恒排最后、与方向无关）。
  const multi = query("sort.base", "multi");
  assert.deepEqual(errorsOf(multi), []);
  // priority DESC 优先：Delta(3) 在前、Alpha(1) 殿后；同 priority=2 按 file.name ASC：Epsilon < Gamma。
  assert.deepEqual(
    multi.rows.map((row) => [row["file.name"], row["priority"]]),
    [
      ["Delta.md", 3],
      ["Epsilon.md", 2],
      ["Gamma.md", 2],
      ["Alpha.md", 1],
    ],
  );
  const stable = query("sort.base", "stable");
  // 单键 priority ASC：同键（2）按 file.path ASC 兜底 tie-break：Projects/ < Projects2/。
  assert.deepEqual(
    stable.rows.map((row) => row["file.path"]),
    ["Alpha.md", "Projects/Gamma.md", "Projects2/Epsilon.md", "Projects/Sub/Delta.md"],
  );
});

// BASE-RESULT-002（oracle runbook ② · §4.2，Obsidian 1.12.7 实测冻结）：
// null/missing **恒排最后，与 ASC/DESC 无关**。此前实现把方向整体取反（`-c`），
// 空值组的排名差一起被翻转 → DESC 时空值跑到最前，与本仓登记口径和官方双双不符。
test("BASE-RESULT-002(oracle ②): null/missing 在 ASC 与 DESC 下都排最后", () => {
  // status：Alpha/Gamma/Delta/Epsilon = "active"、Beta = "inactive"、
  // NullProps = 显式 null、Empty = 属性缺失。空值两行的相对序由 file.path ASC tie-break 定。
  const asc = query("sort.base", "null-last-asc");
  assert.deepEqual(errorsOf(asc), []);
  assert.deepEqual(
    asc.rows.map((row) => row["file.path"]),
    [
      "Alpha.md",
      "Projects/Gamma.md",
      "Projects/Sub/Delta.md",
      "Projects2/Epsilon.md",
      "Beta.md",
      "Empty.md", // ← missing
      "NullProps.md", // ← 显式 null
    ],
  );

  const desc = query("sort.base", "null-last-desc");
  assert.deepEqual(errorsOf(desc), []);
  assert.deepEqual(
    desc.rows.map((row) => row["file.path"]),
    [
      "Beta.md", // "inactive" > "active"
      "Alpha.md",
      "Projects/Gamma.md",
      "Projects/Sub/Delta.md",
      "Projects2/Epsilon.md",
      "Empty.md", // ← 仍在最后，未被 DESC 翻到最前
      "NullProps.md",
    ],
  );
});

// BASE-RESULT-003：limit=0/1/N/超总量边界（负数在 P0 已拒）
test("BASE-RESULT-003: limit 0/1/N/超总量边界", () => {
  const zero = query("limits.base", "zero");
  assert.deepEqual(errorsOf(zero), []);
  assert.deepEqual(zero.rows, []); // limit=0 → rows=[]
  assert.equal(zero.total, 4); // 但 total 为 filter 后 limit 前行数

  const one = query("limits.base", "one");
  assert.equal(one.rows.length, 1);
  assert.equal(one.total, 4);

  const two = query("limits.base", "two");
  assert.equal(two.rows.length, 2);
  assert.equal(two.total, 4);

  const over = query("limits.base", "over");
  assert.equal(over.rows.length, 4); // limit=999 超总量 → 全量返回
  assert.equal(over.total, 4);
});

// BASE-RESULT-004：无显式 sort → file.path 稳定序 + info 诊断（x-basalt 扩展）
test("BASE-RESULT-004: 无显式 sort 按 file.path ASC 稳定排序并给 info 诊断", () => {
  const r = query("nosort.base");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.path"]),
    [
      "Alpha.md",
      "Beta.md",
      "Empty.md",
      "NullProps.md",
      "Projects/Gamma.md",
      "Projects/Sub/Delta.md",
      "Projects2/Epsilon.md",
    ],
  );
  const info = r.diagnostics.find((d) => d.rule === BASE_RULES.defaultSortTiebreak);
  assert.ok(info !== undefined);
  assert.equal(info.severity, "info");
  assert.match(info.message, /x-basalt 扩展/);
});

// ---------- BASE-SEC：安全对抗 ----------

// BASE-SEC-003：过滤值含 SQL 注入串 → 结果集不扩大、DB 不损坏
test("BASE-SEC-003: SQL 注入串不扩大结果集、不损坏 DB", () => {
  const r = query("sec.base", "injection");
  assert.deepEqual(errorsOf(r), []);
  // 注入串只是普通字符串比较值：无 status 等于它 → 0 行（注入若生效将返回全表）。
  assert.equal(r.total, 0);
  assert.deepEqual(r.rows, []);
  // DB 未损坏：随后正常查询仍返回全量。
  const recheck = query("default.base");
  assert.equal(recheck.total, 7);
});

// BASE-SEC-009：恶意属性名不拼 SQL / 不触原型，仅按缺失处理
test("BASE-SEC-009: 恶意属性名与原型键按缺失处理", () => {
  const evil = query("sec.base", "evil-prop");
  assert.deepEqual(errorsOf(evil), []);
  // note['a"; DROP TABLE files;--']：不存在的属性 → MISSING → 比较为 false → 0 行。
  assert.equal(evil.total, 0);
  const proto = query("sec.base", "proto");
  assert.deepEqual(errorsOf(proto), []);
  // hasProperty("__proto__")：安全白名单键一律视为不存在 → 0 行。
  assert.equal(proto.total, 0);
  // DB 未损坏。
  assert.equal(query("default.base").total, 7);
});

// ---------- 计划拍板项 / 验收门 ----------

// 空 filter 数组（oracle runbook ④ · §4.4，Obsidian 1.12.7 实测冻结）：
// 按空集布尔代数默认值处理——and:[]=真 / or:[]=假 / not:[]=真，不再报 unsupported-feature。
// ⚠️ or:[] 的 0 行与旧的「拒绝返回空」**行数相同但成因不同**：这里必须是无 error 诊断的正常空集。
test("空 filter 数组(oracle ④): and:[]=真 / or:[]=假 / not:[]=真，均无 error", () => {
  const all = [
    "Alpha.md",
    "Beta.md",
    "Empty.md",
    "NullProps.md",
    "Projects/Gamma.md",
    "Projects/Sub/Delta.md",
    "Projects2/Epsilon.md",
  ];

  const and = query("empty-filter.base", "empty-and");
  assert.deepEqual(errorsOf(and), []);
  assert.deepEqual(
    and.rows.map((row) => row["file.path"]),
    all, // and: [] 恒真 → 全量
  );

  const or = query("empty-filter.base", "empty-or");
  assert.deepEqual(errorsOf(or), []); // 关键：空集来自恒假，不是来自拒绝
  assert.deepEqual(or.rows, []);
  assert.equal(or.total, 0);

  const not = query("empty-filter.base", "empty-not");
  assert.deepEqual(errorsOf(not), []);
  assert.deepEqual(
    not.rows.map((row) => row["file.path"]),
    all, // not: [] = NOT(空 or) = 恒真 → 全量
  );

  // 三个 view 都不得再出现 base/unsupported-feature。
  for (const r of [and, or, not]) {
    assert.equal(
      r.diagnostics.find((d) => d.rule === BASE_RULES.unsupportedFeature),
      undefined,
    );
  }
});

// 字节稳定专项（矩阵 §9 P1 门）：同 DB+Base+clock 连续两次 JSON.stringify(query()) 全等
test("字节稳定: 同 DB+Base 连续两次查询 JSON 序列化全等", () => {
  const first = JSON.stringify(query("default.base"));
  const second = JSON.stringify(query("default.base"));
  assert.equal(first, second);
  // 带 sort/filter 的复杂 base 同口径。
  const a = JSON.stringify(query("sort.base", "multi"));
  const b = JSON.stringify(query("sort.base", "multi"));
  assert.equal(a, b);
});

// 执行预算：tiny maxOperations 触发 base/execution-budget + 空结果、不返回部分行
test("执行预算: maxOperations 耗尽转 execution-budget 且不返回部分行", () => {
  const r = query("merged.base", undefined, { limits: { maxOperations: 1 } });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  assert.deepEqual(r.columns, []);
  const err = r.diagnostics.find(
    (d) => d.rule === BASE_RULES.executionBudget && d.severity === "error",
  );
  assert.ok(err !== undefined);
  assert.match(err.message, /预算/);
});

// 执行预算（2026-07-27 review 修复）：maxTotalOperations 跨行累计——单次求值远未触顶也会耗尽。
// 回归点：maxOperations 计数器随每次 evaluateExpression 重置，只有它时最坏总量
// = maxRows × 列数 × maxOperations ≈ 1e11，「预算从未耗尽」但查询已不可用。
test("执行预算: maxTotalOperations 跨行累计耗尽转 execution-budget（单次 maxOperations 不受影响）", () => {
  // 每行 filter 只花个位数操作，单次上限给足；总额只给 3 → 必然在头几行内耗尽。
  const r = query("merged.base", undefined, {
    limits: { maxOperations: 1_000_000, maxTotalOperations: 3 },
  });
  assert.deepEqual(r.rows, []);
  assert.equal(r.total, 0);
  const err = r.diagnostics.find(
    (d) => d.rule === BASE_RULES.executionBudget && d.severity === "error",
  );
  assert.ok(err !== undefined, "跨行累计总额耗尽必须产 execution-budget");
  assert.match(err.message, /累计操作数/);

  // 同一查询在默认总额下正常完成（证明上面的失败来自总额而非其它预算）。
  const ok = query("merged.base");
  assert.deepEqual(
    ok.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assert.ok(ok.total > 0);
});

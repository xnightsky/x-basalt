import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config.js";
import { VaultIndexer } from "../src/indexer/index.js";
import { resolveVaultLayout } from "../src/utils/path.js";

// === 自建实现: vault 多目录（公共祖先 keying）端到端验证 ===
//
// 覆盖：resolveVaultRoots（公共祖先 / 去重 / 剔子根 / 向后兼容）、多根 build 无主键碰撞 + 并集齐全、
//       多根 scan 增量、单根回归（主键不带前缀），以及 config 解析 vault 列表。

const tmpDirs: string[] = [];
function freshDir(prefix = "x-basalt-md-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
function freshDbPath(): string {
  return join(freshDir("x-basalt-mdb-"), "index.db");
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}
function filePaths(dbPath: string): string[] {
  const db = openReadonly(dbPath);
  const rows = db.prepare("SELECT path FROM files ORDER BY path").all() as { path: string }[];
  db.close();
  return rows.map((r) => r.path);
}

// --- resolveVaultLayout 单元 ---

test("resolveVaultLayout：单根 toKey 相对该根（向后兼容，无命名空间前缀）", () => {
  const root = freshDir();
  const layout = resolveVaultLayout(root);
  assert.deepEqual(layout.roots, [root]);
  assert.equal(layout.toKey(join(root, "sub", "a.md")), "sub/a.md");
  assert.equal(layout.toAbs("sub/a.md"), join(root, "sub", "a.md"));
});

test("resolveVaultLayout：多根用目录名作命名空间（不依赖公共祖先）", () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a);
  mkdirSync(b);
  const layout = resolveVaultLayout([a, b]);
  assert.deepEqual(layout.roots.toSorted(), [a, b].toSorted());
  assert.equal(layout.toKey(join(a, "x.md")), "docs/x.md");
  assert.equal(layout.toKey(join(b, "y.md")), "notes/y.md");
  assert.equal(layout.toAbs("docs/x.md"), join(a, "x.md"));
  assert.equal(layout.toAbs("notes/y.md"), join(b, "y.md"));
});

test("resolveVaultLayout：去重 + 剔除被包含的子根（保留更上层根）", () => {
  const parent = freshDir();
  const sub = join(parent, "docs");
  mkdirSync(sub);
  const layout = resolveVaultLayout([parent, sub, parent]);
  assert.deepEqual(layout.roots, [parent]); // sub 被 parent 包含 → 只留 parent
  assert.equal(layout.toKey(join(parent, "docs", "a.md")), "docs/a.md"); // 单根 → 纯相对，无前缀
});

test("resolveVaultLayout：多根目录名（basename）冲突直接报错", () => {
  const a = join(freshDir(), "docs");
  const b = join(freshDir(), "docs"); // 同名 docs、分属不同父 → 命名空间冲突
  mkdirSync(a);
  mkdirSync(b);
  assert.throws(() => resolveVaultLayout([a, b]), /冲突|同名/);
});

test("多根相距很远：主键仍短（按根命名空间，不退化成近乎绝对路径）", () => {
  // 两根分属不同临时父目录 → 公共祖先会一路退到 /tmp 甚至 /；旧「公共祖先」方案会把主键拉成
  // 含随机 tmp 段的长路径，按根命名空间则恒为 `<目录名>/<相对>`，且不泄露绝对前缀。
  const a = join(freshDir(), "docs");
  const b = join(freshDir(), "notes");
  mkdirSync(a);
  mkdirSync(b);
  const layout = resolveVaultLayout([a, b]);
  assert.equal(layout.toKey(join(a, "x.md")), "docs/x.md");
  assert.equal(layout.toKey(join(b, "y.md")), "notes/y.md");
});

// --- 多根 build / scan 行为 ---

test("多根 rebuild：并集齐全 + 主键以公共祖先为基、同名相对路径不碰撞", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a);
  mkdirSync(b);
  // 两根各有同名相对路径 note.md：单根 keying 会撞 UNIQUE，公共祖先 keying 不会。
  writeFileSync(join(a, "note.md"), "# A\n");
  writeFileSync(join(b, "note.md"), "# B\n");
  writeFileSync(join(a, "only-a.md"), "# onlyA\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await idx.rebuild();
  idx.close();

  assert.deepEqual(filePaths(dbPath), ["docs/note.md", "docs/only-a.md", "notes/note.md"]);
});

test("单根 rebuild：主键不带目录前缀（与历史单根一致）", async () => {
  const root = freshDir();
  writeFileSync(join(root, "a.md"), "# A\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "b.md"), "# B\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: root, dbPath });
  await idx.rebuild();
  idx.close();

  assert.deepEqual(filePaths(dbPath), ["a.md", "sub/b.md"]);
});

test("多根 scan：第二根新增文件被识别为相对公共祖先路径", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "x.md"), "# X\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await idx.rebuild();
  writeFileSync(join(b, "y.md"), "# Y\n");
  const report = await idx.scan({});
  idx.close();

  assert.deepEqual(report.added, ["notes/y.md"]);
});

// --- config 解析 vault 列表 ---

/**
 * 把配置内容写进独立基目录，显式经 baseDir 加载并取 vault。
 * 显式传 globalHome（空目录）+ baseDir，绕开运行环境里的 X_BASALT_DIR / 全局 ~/.x-basalt，保持 hermetic
 * （对齐 config.test.ts 的「X_BASALT_DIR 指定基目录」用例写法）。
 */
function loadVaultFromConfig(content: string): string | string[] | undefined {
  const base = freshDir("x-basalt-cfg-");
  writeFileSync(join(base, "config.yaml"), content);
  return loadConfig(freshDir(), freshDir(), base).vault;
}

test("config：vault 支持多目录列表（YAML 数组）", () => {
  assert.deepEqual(loadVaultFromConfig("vault:\n  - ./docs\n  - ./notes\n"), ["./docs", "./notes"]);
});

test("config：vault 列表过滤非字符串项；全非串则整体丢弃", () => {
  assert.deepEqual(loadVaultFromConfig("vault:\n  - ./docs\n  - 123\n"), ["./docs"]);
  assert.equal(loadVaultFromConfig("vault:\n  - 1\n  - 2\n"), undefined);
});

test("config：vault 单字符串仍按原样（向后兼容）", () => {
  assert.equal(loadVaultFromConfig("vault: ./single\n"), "./single");
});

// --- 缺失根 warn-and-skip（对治场景库 scale/doc-migration-count 坐实的缺口）---
// 旧行为：readdir 对不存在目录抛 ENOENT，整条 rebuild/scan 全量失败（见
// docs/plans/2026-07-02-deterministic-eval-gaps.md [冲突提示]）。新行为：跳过缺失根 + warn，
// 其余根照常；全缺才报错。

/** 临时接管 console.warn 收集调用文本，finally 里原样恢复（避免测试间互相污染）。 */
async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const result = await fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

test("多根缺失一个根 When rebuild Then warn 并跳过、其余根照常索引（不再整体 ENOENT 崩）", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const missing = join(parent, "nope");
  mkdirSync(a);
  writeFileSync(join(a, "x.md"), "# X\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, missing], dbPath });
  const { warnings } = await captureWarnings(() => idx.rebuild());
  idx.close();

  assert.deepEqual(filePaths(dbPath), ["docs/x.md"]);
  assert.ok(
    warnings.some((w) => w.includes(missing)),
    `应 warn 缺失根路径，实际: ${warnings.join("|")}`,
  );
});

test("多根缺失一个根 When scan（dry-run） Then warn 并跳过、不抛错、报告只含存在根的差异", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const missing = join(parent, "nope");
  mkdirSync(a);
  writeFileSync(join(a, "x.md"), "# X\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, missing], dbPath });
  const { result: report, warnings } = await captureWarnings(() => idx.scan({ dryRun: true }));
  idx.close();

  assert.deepEqual(report.added, ["docs/x.md"]);
  assert.ok(warnings.some((w) => w.includes(missing)));
});

test("多根全部缺失 When rebuild Then 抛出清晰错误（而非产出空索引）", async () => {
  const parent = freshDir();
  const a = join(parent, "nope1");
  const b = join(parent, "nope2");
  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await assert.rejects(() => idx.rebuild(), /所有 vault 根都不存在/);
  idx.close();
});

test("单根缺失 When rebuild / scan Then 抛出清晰错误（替代裸 ENOENT）", async () => {
  const missing = join(freshDir(), "nope");
  const dbPath = freshDbPath();
  const idxA = new VaultIndexer({ vaultPath: missing, dbPath });
  await assert.rejects(() => idxA.rebuild(), /所有 vault 根都不存在/);
  idxA.close();

  const idxB = new VaultIndexer({ vaultPath: missing, dbPath: freshDbPath() });
  await assert.rejects(() => idxB.scan({ dryRun: true }), /所有 vault 根都不存在/);
  idxB.close();
});

test("此前已索引的根本次不可达 When scan（非 dry-run） Then 其旧记录原样保留、不判 deleted（防误删）", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "x.md"), "# X\n");
  writeFileSync(join(b, "y.md"), "# Y\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await idx.rebuild();
  assert.deepEqual(filePaths(dbPath), ["docs/x.md", "notes/y.md"]);

  // notes 根本次"消失"（模拟未挂载 / 瞬时不可达）：物理删掉该目录。
  rmSync(b, { recursive: true, force: true });
  const { result: report, warnings } = await captureWarnings(() => idx.scan({}));
  idx.close();

  assert.deepEqual(report.deleted, [], "缺失根下的旧记录不应被判 deleted");
  assert.deepEqual(
    filePaths(dbPath),
    ["docs/x.md", "notes/y.md"],
    "库内容应原样保留（未被误判删除清空）",
  );
  assert.ok(warnings.some((w) => w.includes(b)));
});

test("此前已索引的根本次不可达 When rebuild Then 该根旧记录被清（全量重置语义，非缺陷）", async () => {
  const parent = freshDir();
  const a = join(parent, "docs");
  const b = join(parent, "notes");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "x.md"), "# X\n");
  writeFileSync(join(b, "y.md"), "# Y\n");

  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath: [a, b], dbPath });
  await idx.rebuild();

  rmSync(b, { recursive: true, force: true });
  const { warnings } = await captureWarnings(() => idx.rebuild());
  idx.close();

  assert.deepEqual(filePaths(dbPath), ["docs/x.md"], "rebuild 是全量重置：缺失根旧记录不保留");
  assert.ok(warnings.some((w) => w.includes(b)));
});

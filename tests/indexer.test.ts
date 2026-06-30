import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/sample-vault", import.meta.url));

/** 每个用例独立临时库，避免相互污染；统一在 after 清理。 */
const tmpDirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-idx-"));
  tmpDirs.push(dir);
  return join(dir, "index.db");
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 以只读连接打开索引库，断言期专用。 */
function openReadonly(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}

test("VaultIndexer 可实例化", () => {
  const idx = new VaultIndexer({ vaultPath, dbPath: freshDbPath() });
  assert.ok(idx);
  idx.close();
});

test("rebuild 后 files/links/tags/tasks 行数与反向链接正确", async () => {
  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();

  const db = openReadonly(dbPath);
  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;

  // 样例 vault 共 5 个 .md（Index / Alpha / Beta / Concepts / Daily）。
  assert.equal(count("SELECT COUNT(*) c FROM files"), 5);
  // 链接经 parser basename+anchor+embed 去重：5+2+3+3+4 = 17。
  assert.equal(count("SELECT COUNT(*) c FROM links"), 17);
  // 标签 = 行内 + frontmatter：4+4+3+3+3 = 17。
  assert.equal(count("SELECT COUNT(*) c FROM tags"), 17);
  // 任务：Alpha 4 + Beta 2 + Daily 3 = 9。
  assert.equal(count("SELECT COUNT(*) c FROM tasks"), 9);
  // 块定义：Alpha/Beta/Concepts/Daily 各 1 = 4。
  assert.equal(count("SELECT COUNT(*) c FROM blocks"), 4);

  // 反向链接（inlinks）查询期 JOIN：指向 Alpha 的不同源文件 = Index/Beta/Concepts/Daily = 4。
  const inlinksOfAlpha = db
    .prepare(
      `SELECT COUNT(DISTINCT l.source) c
       FROM links l JOIN files f ON f.name_key = l.target_key
       WHERE f.path = ?`,
    )
    .get("Projects/Alpha.md") as { c: number };
  assert.equal(inlinksOfAlpha.c, 4);

  // 正向链接（outlinks）：Index 出链 5 条。
  const outlinksOfIndex = count("SELECT COUNT(*) c FROM links WHERE source = 'Index.md'");
  assert.equal(outlinksOfIndex, 5);

  // frontmatter 与行内 tag 区分：Index 的 moc 同时来自 fm 与行内，各记一行。
  const mocRows = db
    .prepare(
      "SELECT in_frontmatter FROM tags WHERE file_path = 'Index.md' AND tag = 'moc' ORDER BY in_frontmatter",
    )
    .all() as { in_frontmatter: number }[];
  assert.deepEqual(
    mocRows.map((r) => r.in_frontmatter),
    [0, 1],
  );

  // due_date 从 task 文本提取 YYYY-MM-DD。
  const due = db
    .prepare(
      "SELECT due_date FROM tasks WHERE file_path = 'Projects/Alpha.md' AND text LIKE '完成需求评审%'",
    )
    .get() as { due_date: string | null };
  assert.equal(due.due_date, "2026-06-28");

  // 块内容剥离行尾 ^id。
  const block = db
    .prepare(
      "SELECT content FROM blocks WHERE file_path = 'Projects/Alpha.md' AND block_id = 'decision-1'",
    )
    .get() as { content: string };
  assert.equal(block.content, "关键决策记录在此段落，可被块引用。");

  // is_embed 正确：Index 的 embed 出链 2 条（Concepts#核心概念 与 diagram.png）。
  assert.equal(count("SELECT COUNT(*) c FROM links WHERE source = 'Index.md' AND is_embed = 1"), 2);

  db.close();
  idx.close();
});

test("remove 删除单文件记录，update 重新建立（增量幂等）", async () => {
  const dbPath = freshDbPath();
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();

  const db = openReadonly(dbPath);
  const files = (): number => (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  const betaLinks = (): number =>
    (
      db.prepare("SELECT COUNT(*) c FROM links WHERE source = 'Projects/Beta.md'").get() as {
        c: number;
      }
    ).c;

  assert.equal(files(), 5);
  assert.equal(betaLinks(), 3);

  idx.remove("Projects/Beta.md");
  assert.equal(files(), 4);
  assert.equal(betaLinks(), 0);

  // update 读盘上仍存在的 fixture，重新插入，计数复原（验证先删后插不重复累加）。
  await idx.update("Projects/Beta.md");
  assert.equal(files(), 5);
  assert.equal(betaLinks(), 3);

  db.close();
  idx.close();
});

/** 轮询等待异步条件（chokidar awaitWriteFinish + 增量落库有延迟）。 */
async function waitFor(check: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

test("watch 增量：add / change / unlink 实时维护索引（S3.1）", async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), "x-basalt-watch-"));
  tmpDirs.push(vaultDir);
  // db 放 vault 外：避免 watch 监听到索引文件(含 WAL)自身变化 + Windows 文件锁干扰。
  const dbPath = freshDbPath();
  await writeFile(join(vaultDir, "A.md"), "# A\n[[B]]\n#x\n");

  const idx = new VaultIndexer({ vaultPath: vaultDir, dbPath });
  await idx.rebuild();

  // 每次新建只读连接读最新已提交状态（避免 WAL 快照陈旧）。
  const count = (sql: string): number => {
    const rdb = openReadonly(dbPath);
    const c = (rdb.prepare(sql).get() as { c: number }).c;
    rdb.close();
    return c;
  };
  assert.equal(count("SELECT COUNT(*) c FROM files"), 1);

  // 等 chokidar 初始扫描完成（ready）：否则 ignoreInitial 会跳过 ready 前写入的文件。
  let ready = false;
  idx.watch(undefined, () => {
    ready = true;
  });
  assert.ok(await waitFor(() => ready, 3000), "chokidar 应进入 ready");
  try {
    // add：新增 B.md 应被索引。
    await writeFile(join(vaultDir, "B.md"), "# B\n#y\n");
    assert.ok(await waitFor(() => count("SELECT COUNT(*) c FROM files") === 2), "add 应索引 B");

    // change：A.md 增标签 #z，标签数应升到 2。
    await writeFile(join(vaultDir, "A.md"), "# A\n[[B]]\n#x\n#z\n");
    assert.ok(
      await waitFor(() => count("SELECT COUNT(*) c FROM tags WHERE file_path = 'A.md'") >= 2),
      "change 应更新 A 标签",
    );

    // unlink：删 B.md 应移除其索引。
    await rm(join(vaultDir, "B.md"));
    assert.ok(await waitFor(() => count("SELECT COUNT(*) c FROM files") === 1), "unlink 应移除 B");
  } finally {
    idx.close();
  }
});

test("watch 相对 vault 路径：chokidar 回报 cwd 相对路径时不双重拼接", async () => {
  const base = mkdtempSync(join(tmpdir(), "x-basalt-rel-watch-"));
  tmpDirs.push(base);
  const vaultDir = join(base, "vault");
  mkdirSync(vaultDir, { recursive: true });
  await writeFile(join(vaultDir, "A.md"), "# A\n");

  const dbPath = freshDbPath();
  const origCwd = process.cwd();
  try {
    process.chdir(base);
    const idx = new VaultIndexer({ vaultPath: "vault", dbPath });
    await idx.rebuild();

    const count = (sql: string): number => {
      const rdb = openReadonly(dbPath);
      const c = (rdb.prepare(sql).get() as { c: number }).c;
      rdb.close();
      return c;
    };
    assert.equal(count("SELECT COUNT(*) c FROM files"), 1);

    let ready = false;
    idx.watch(undefined, () => {
      ready = true;
    });
    assert.ok(await waitFor(() => ready, 3000), "chokidar 应进入 ready");
    try {
      await writeFile(join(vaultDir, "B.md"), "# B\n");
      assert.ok(
        await waitFor(() => count("SELECT COUNT(*) c FROM files") === 2),
        "相对 vault 下 add 应索引 B（不应 docs/docs 双重拼接）",
      );
    } finally {
      idx.close();
    }
  } finally {
    process.chdir(origCwd);
  }
});

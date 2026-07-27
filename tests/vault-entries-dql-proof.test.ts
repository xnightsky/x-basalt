import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";

// === Bases P3 片三：「DQL 不变」证明（计划 2026-07-27-bases-p3-attachments 条目 11①③） ===
//
// 背景：附件数据集落独立 vault_entries 表（决策 §3），files 表 DDL 与 DQL SQL 语义一律不动，
// 故「DQL 数据集零变化」可机械证明：
//   ① sqlite_master 逐字节锁定既有表 DDL（防漂移锁，本文件新增）；
//   ② DQL 全部既有测试零改动通过（以 git diff 佐证，不写测试）；
//   ③ 回归用例：vault 含附件时 DQL 行数 == 纯 .md 行数（本文件）；
//   ④ indexer 写入分派由 tests/indexer-attachments.test.ts 覆盖（不重复）。
// fixture：tests/fixtures/bases/p1/vault（7 篇 .md + 16 个附件），before 里 rebuild 到临时库。

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p1/vault", import.meta.url));

/**
 * sqlite_master.sql 期望值（防漂移锁）：与 src/indexer/schema.ts 的 DDL 原文一一对应。
 * SQLite 存库时剥掉 IF NOT EXISTS、保留语句内注释与空白，故此处逐字节锁定白名单表
 * （files/links/tags/tasks/blocks/inline_fields/store_config + 新表 vault_entries）。
 * 任何一行漂移（改列、改约束、改注释对齐）都会让本测试失败——files 表 DDL 属硬边界，禁改。
 */
const EXPECTED_TABLE_DDL: Record<string, string> = {
  files: `CREATE TABLE files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL UNIQUE,   -- 相对 Vault 根的 POSIX 路径，含扩展名
  name        TEXT NOT NULL,          -- 文件名（无扩展名），对应 file.name
  name_key    TEXT NOT NULL,          -- name 的小写形式，bare 链接 basename 解析键
  path_key    TEXT NOT NULL,          -- 全路径去扩展名小写（projects/alpha），qualified 链接精确解析键（S3.2）
  extension   TEXT NOT NULL,          -- 扩展名（不含点），对应 file.extension
  folder      TEXT NOT NULL,          -- 父目录（POSIX，根为空串），对应 file.folder
  size        INTEGER NOT NULL,       -- 字节数
  mtime       INTEGER NOT NULL,       -- 修改时间（epoch 毫秒）
  ctime       INTEGER NOT NULL,       -- 创建时间（epoch 毫秒）
  content     TEXT NOT NULL,          -- 原始文件内容
  frontmatter TEXT NOT NULL           -- frontmatter 的 JSON 字符串（json_extract 取标量字段）
)`,
  links: `CREATE TABLE links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,           -- 源文件 path（POSIX）
  target     TEXT NOT NULL,           -- 原始 target 文本（展示用，如 Projects/Alpha 或 assets/x.png）
  target_key TEXT NOT NULL,           -- linkKey(target)：小写无扩展名 basename，bare 链接回退连接键
  target_path_key TEXT,               -- target 含 '/' 时的 path_key，否则 NULL；qualified 链接精确连接键（S3.2）
  alias      TEXT,
  heading    TEXT,
  block_id   TEXT,
  is_embed   INTEGER NOT NULL DEFAULT 0  -- 1 = ![[...]]，计入 outlinks（与 Obsidian 一致）
)`,
  tags: `CREATE TABLE tags (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT NOT NULL,
  tag            TEXT NOT NULL,        -- 不带 # 的标签文本；嵌套保留全名（area/work）
  in_frontmatter INTEGER NOT NULL DEFAULT 0  -- 1 = 来自 frontmatter tags，0 = 行内
)`,
  tasks: `CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  line_number INTEGER NOT NULL,        -- 1-based 正文行号（parser 提供）
  status      TEXT NOT NULL,           -- 方括号内单字符：' ' / x / - / ? ...
  text        TEXT NOT NULL,
  due_date    TEXT                     -- 从 text 提取的 YYYY-MM-DD，无则 NULL
)`,
  blocks: `CREATE TABLE blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  block_id    TEXT NOT NULL,
  content     TEXT NOT NULL,           -- 块锚点所在正文行（去掉行尾 ^id）
  line_number INTEGER NOT NULL,
  UNIQUE(file_path, block_id)
)`,
  inline_fields: `CREATE TABLE inline_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  key         TEXT NOT NULL,        -- 原始 key（trim 后，保留大小写）
  key_norm    TEXT NOT NULL,        -- key 的小写形式，查询连接键
  value       TEXT NOT NULL,        -- 原始值文本（v1 不类型化，见 D2）
  line_number INTEGER NOT NULL      -- 1-based 正文行号（last-wins 后为最后出现行）
)`,
  vault_entries: `CREATE TABLE vault_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  path      TEXT NOT NULL UNIQUE,   -- 与 files.path 同一命名空间（多根 <根目录名>/<相对>）
  name      TEXT NOT NULL,          -- 文件名（无扩展名）
  extension TEXT NOT NULL,          -- 扩展名（不含点，小写归一）
  folder    TEXT NOT NULL,          -- 父目录（POSIX，根为空串），与 files.folder 同口径
  size      INTEGER NOT NULL,
  mtime     INTEGER NOT NULL,       -- 修改时间（epoch 毫秒，与 files 同 floor 口径）
  ctime     INTEGER NOT NULL        -- 创建时间（epoch 毫秒，birthtime 为 0 回退 ctime）
)`,
  store_config: `CREATE TABLE store_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
};

let tmpDir: string;
let dbPath: string;
let engine: DataviewEngine;

// 共享一份索引：rebuild 含附件 vault 到临时库，DDL 快照与 DQL 回归都基于它。
before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-dqlproof-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），断言期只读打开
  engine = new DataviewEngine(dbPath);
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 以只读连接打开索引库，断言期专用。 */
function openReadonly(): Database.Database {
  return new Database(dbPath, { readonly: true });
}

test("证明①：既有表 + vault_entries 的 DDL 与 sqlite_master 逐字节相等（防漂移锁）", () => {
  const db = openReadonly();
  try {
    for (const [name, expected] of Object.entries(EXPECTED_TABLE_DDL)) {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) as { sql: string } | undefined;
      assert.ok(row, `sqlite_master 缺少表 ${name}`);
      assert.equal(row.sql, expected, `表 ${name} 的 DDL 发生漂移`);
    }
  } finally {
    db.close();
  }
});

test("证明③：附件在场时 DQL 全表查询行数 == files 表 .md 行数，结果不含附件 path", () => {
  const db = openReadonly();
  const mdCount = (db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number }).c;
  const attachmentCount = (
    db.prepare("SELECT COUNT(*) c FROM vault_entries").get() as { c: number }
  ).c;
  db.close();
  assert.equal(mdCount, 7);
  // 附件确实在场（16 个）——行数相等不是「vault 本来就没附件」的空集巧合。
  assert.equal(attachmentCount, 16);

  const r = engine.query("TABLE file.path");
  assert.equal(r.type, "TABLE");
  assert.equal(r.rows.length, mdCount, "DQL 行数应等于 files 表 .md 行数");
  for (const row of r.rows) {
    const p = String(row["file.path"]);
    assert.ok(p.endsWith(".md"), `DQL 结果混入附件：${p}`);
  }
});

test("证明③：带 JOIN 的隐式字段查询（file.inlinks）不受 vault_entries 影响", () => {
  // Alpha.md 含 [[Beta]] bare 链接 → Beta 的 inlinks 经 links 表 JOIN 实时计算。
  const r = engine.query("TABLE file.inlinks WHERE file.name = 'Beta'");
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0]?.["file.inlinks"], ["Alpha.md"]);

  // TASK 查询（tasks 表）同样只读既有表：本 vault 无任务行，空结果不崩。
  const t = engine.query("TASK");
  assert.equal(t.type, "TASK");
  assert.deepEqual(t.rows, []);
});

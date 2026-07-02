import type { Database } from "better-sqlite3";

// === 自建实现: SQLite 索引 Schema（禁止假设外部缓存，inlinks/outlinks 查询期 JOIN 计算）===
// 表：files / links / tags / tasks / blocks / inline_fields。
//
// 相对设计文档的列扩展（均为查询/解析必需，故刻意加入并在此说明）：
// - files.name_key：name 的小写无扩展名形式，bare 链接（[[Note]]）按 basename 大小写不敏感解析的连接键（调研 §3.3#1）。
// - files.path_key：全路径去扩展名小写（如 projects/alpha），qualified 链接（[[Dir/Note]]）按路径精确匹配的连接键（S3.2，消除同名异目录串味）。
// - files.folder：由 path 推导的父目录（POSIX，根为空串），支撑 file.folder 与 FROM "folder" 前缀匹配。
// - links.target_key：raw target 的 basename 小写键，bare 链接 inlinks/outlinks 回退连接键（不物化解析结果）。
// - links.target_path_key：raw target 含 '/' 时的 path_key，否则 NULL；qualified 链接的精确连接键（S3.2）。
// - blocks.line_number：块锚点所在正文行号，与 tasks.line_number 对齐，便于回溯定位。

/**
 * 六张业务表 + store_config 的建表 DDL（IF NOT EXISTS，可重复执行）。
 *
 * 隐式字段不建物化视图，查询期路径感知 JOIN（S3.2）：
 *   inlinks  = links WHERE target_path_key = files.path_key（qualified）或 target_key = files.name_key（bare 回退）；
 *   outlinks = links WHERE source = files.path。索引仅为加速这些 JOIN 与过滤。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
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
);
CREATE INDEX IF NOT EXISTS idx_files_name_key ON files(name_key);
CREATE INDEX IF NOT EXISTS idx_files_path_key ON files(path_key);
CREATE INDEX IF NOT EXISTS idx_files_folder   ON files(folder);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,           -- 源文件 path（POSIX）
  target     TEXT NOT NULL,           -- 原始 target 文本（展示用，如 Projects/Alpha 或 assets/x.png）
  target_key TEXT NOT NULL,           -- linkKey(target)：小写无扩展名 basename，bare 链接回退连接键
  target_path_key TEXT,               -- target 含 '/' 时的 path_key，否则 NULL；qualified 链接精确连接键（S3.2）
  alias      TEXT,
  heading    TEXT,
  block_id   TEXT,
  is_embed   INTEGER NOT NULL DEFAULT 0  -- 1 = ![[...]]，计入 outlinks（与 Obsidian 一致）
);
CREATE INDEX IF NOT EXISTS idx_links_source          ON links(source);
CREATE INDEX IF NOT EXISTS idx_links_target_key      ON links(target_key);
CREATE INDEX IF NOT EXISTS idx_links_target_path_key ON links(target_path_key);

CREATE TABLE IF NOT EXISTS tags (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT NOT NULL,
  tag            TEXT NOT NULL,        -- 不带 # 的标签文本；嵌套保留全名（area/work）
  in_frontmatter INTEGER NOT NULL DEFAULT 0  -- 1 = 来自 frontmatter tags，0 = 行内
);
CREATE INDEX IF NOT EXISTS idx_tags_file_path ON tags(file_path);
CREATE INDEX IF NOT EXISTS idx_tags_tag       ON tags(tag);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  line_number INTEGER NOT NULL,        -- 1-based 正文行号（parser 提供）
  status      TEXT NOT NULL,           -- 方括号内单字符：' ' / x / - / ? ...
  text        TEXT NOT NULL,
  due_date    TEXT                     -- 从 text 提取的 YYYY-MM-DD，无则 NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_file_path ON tasks(file_path);

CREATE TABLE IF NOT EXISTS blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  block_id    TEXT NOT NULL,
  content     TEXT NOT NULL,           -- 块锚点所在正文行（去掉行尾 ^id）
  line_number INTEGER NOT NULL,
  UNIQUE(file_path, block_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_file_path ON blocks(file_path);

-- inline fields（Dataview \`key:: value\`，docs/specs/2026-07-02-inline-fields-design.md §6.2）：
-- 仅存 parser 的原始提取文本；查询期与 frontmatter 标量 COALESCE 合并（D1 frontmatter 胜），
-- 无物化视图（硬约束 6）。parser 提取期 last-wins 去重（D3），每 file × key_norm 至多一行。
CREATE TABLE IF NOT EXISTS inline_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  key         TEXT NOT NULL,        -- 原始 key（trim 后，保留大小写）
  key_norm    TEXT NOT NULL,        -- key 的小写形式，查询连接键
  value       TEXT NOT NULL,        -- 原始值文本（v1 不类型化，见 D2）
  line_number INTEGER NOT NULL      -- 1-based 正文行号（last-wins 后为最后出现行）
);
CREATE INDEX IF NOT EXISTS idx_inline_fields_file_path ON inline_fields(file_path);
CREATE INDEX IF NOT EXISTS idx_inline_fields_key_norm  ON inline_fields(key_norm);

-- 通用 KV 配置表：目前仅存 fts_version（FTS5 分词策略版本号，见 indexer/index.ts ensureFts），
-- 抄 qmd 的版本号迁移模式——分词/归一规则升级时递增版本号，靠此判定需重建 files_fts，避免新旧索引混用。
-- files_fts 虚表本身不放在此 DDL：其生命周期完全由 ensureFts 按版本号管理（建/重建/回填），
-- createSchema 是幂等的 IF NOT EXISTS，无法表达"版本不符则先 DROP 再建"，故不适合放这里。
CREATE TABLE IF NOT EXISTS store_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * 在给定数据库连接上建表（若不存在）。
 *
 * @param db - better-sqlite3 Database 实例
 */
export function createSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}

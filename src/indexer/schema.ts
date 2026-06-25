import type { Database } from "better-sqlite3";

// === 自建实现: SQLite 索引 Schema（禁止假设外部缓存，inlinks/outlinks 查询期 JOIN 计算）===
// 表：files / links / tags / tasks / blocks。
//
// 相对设计文档的列扩展（均为查询/解析必需，故刻意加入并在此说明）：
// - files.name_key：name 的小写无扩展名形式，wikilink 按 basename 大小写不敏感解析的连接键（调研 §3.3#1）。
// - files.folder：由 path 推导的父目录（POSIX，根为空串），支撑 file.folder 与 FROM "folder" 前缀匹配。
// - links.target_key：raw target 的 linkKey，inlinks/outlinks 查询期 JOIN 的连接键（不物化解析结果）。
// - blocks.line_number：块锚点所在正文行号，与 tasks.line_number 对齐，便于回溯定位。

/**
 * 五张表的建表 DDL（IF NOT EXISTS，可重复执行）。
 *
 * 隐式字段不建物化视图：inlinks = JOIN links ON target_key = files.name_key；
 * outlinks = JOIN links ON source = files.path。索引仅为加速这些 JOIN 与过滤。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL UNIQUE,   -- 相对 Vault 根的 POSIX 路径，含扩展名
  name        TEXT NOT NULL,          -- 文件名（无扩展名），对应 file.name
  name_key    TEXT NOT NULL,          -- name 的小写形式，链接 basename 解析键
  extension   TEXT NOT NULL,          -- 扩展名（不含点），对应 file.extension
  folder      TEXT NOT NULL,          -- 父目录（POSIX，根为空串），对应 file.folder
  size        INTEGER NOT NULL,       -- 字节数
  mtime       INTEGER NOT NULL,       -- 修改时间（epoch 毫秒）
  ctime       INTEGER NOT NULL,       -- 创建时间（epoch 毫秒）
  content     TEXT NOT NULL,          -- 原始文件内容
  frontmatter TEXT NOT NULL           -- frontmatter 的 JSON 字符串（json_extract 取标量字段）
);
CREATE INDEX IF NOT EXISTS idx_files_name_key ON files(name_key);
CREATE INDEX IF NOT EXISTS idx_files_folder   ON files(folder);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,           -- 源文件 path（POSIX）
  target     TEXT NOT NULL,           -- 原始 target 文本（展示用，如 Projects/Alpha 或 assets/x.png）
  target_key TEXT NOT NULL,           -- linkKey(target)：小写无扩展名 basename，解析连接键
  alias      TEXT,
  heading    TEXT,
  block_id   TEXT,
  is_embed   INTEGER NOT NULL DEFAULT 0  -- 1 = ![[...]]，计入 outlinks（与 Obsidian 一致）
);
CREATE INDEX IF NOT EXISTS idx_links_source     ON links(source);
CREATE INDEX IF NOT EXISTS idx_links_target_key ON links(target_key);

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
`;

/**
 * 在给定数据库连接上建表（若不存在）。
 *
 * @param db - better-sqlite3 Database 实例
 */
export function createSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}

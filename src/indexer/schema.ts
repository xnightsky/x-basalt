// === 自建实现: SQLite 索引 Schema（禁止假设外部缓存，inlinks/outlinks 查询期 JOIN 计算）===
// 表：files / links / tags / tasks / blocks。DDL 在阶段 2 落地。

/**
 * 五张表的建表 DDL（阶段 2 填充完整语句）：
 * - files(id, path, name, extension, size, mtime, ctime, content, frontmatter)
 * - links(id, source, target, alias, heading, block_id, is_embed)
 * - tags(id, file_path, tag, in_frontmatter)
 * - tasks(id, file_path, line_number, status, text, due_date)
 * - blocks(id, file_path, block_id, content, UNIQUE(file_path, block_id))
 */
export const SCHEMA_SQL = "-- 阶段 2 填充建表 DDL";

/**
 * 在给定数据库连接上建表（若不存在）。
 *
 * @param db - better-sqlite3 Database 实例（阶段 2 引入精确类型）
 */
export function createSchema(db: unknown): void {
  void db;
  throw new Error("not implemented: createSchema（阶段 2）");
}

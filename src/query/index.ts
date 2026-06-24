import type { QueryResult } from "./ast.js";

export type { DqlQuery, QueryResult } from "./ast.js";

// === 自建实现: Dataview 子集执行引擎，不依赖 obsidian-dataview 的 Evaluator/Executor ===

/**
 * 查询引擎：DQL → tokenizer → ast → 参数化 SQL → better-sqlite3 → QueryResult。
 * 只读数据库，不直接读取 `.md` 文件（边界见 AGENTS.md）。阶段 3 实现。
 */
export class DataviewEngine {
  constructor(dbPath: string) {
    void dbPath;
  }

  /**
   * 执行一条 DQL，返回 JSON 结果。
   *
   * @param dql - DQL 查询语句
   */
  query(dql: string): QueryResult {
    void dql;
    throw new Error("not implemented: DataviewEngine.query（阶段 3）");
  }

  /** 关闭数据库连接。 */
  close(): void {
    throw new Error("not implemented: DataviewEngine.close（阶段 3）");
  }
}

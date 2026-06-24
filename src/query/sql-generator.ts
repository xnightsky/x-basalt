import type { DqlQuery } from "./ast.js";

// === 自建实现: DQL AST → 参数化 SQL（隐式字段经 links/tags/tasks 表 JOIN 计算，阶段 3）===

/** 编译产物：参数化 SQL 与绑定参数。 */
export interface CompiledSql {
  sql: string;
  params: unknown[];
}

/**
 * 将 DQL AST 编译为参数化 SQL（防注入，全部走占位符绑定）。
 *
 * @param query - 解析后的 DQL 结构
 */
export function generateSql(query: DqlQuery): CompiledSql {
  void query;
  throw new Error("not implemented: generateSql（阶段 3）");
}

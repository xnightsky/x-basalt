/**
 * TASK SQL 分支：任务行 JOIN 文件过滤，不复用文件分组/展开的结果模型。
 * 上游 sql-generator 提供已校验的 WHERE/字段解析器；下游仍交同一 SQLite 引擎。
 * 只组装参数化 SQL，不读取文件/DB；普通 status/due 仍是文件属性。
 */
import type { DqlQuery } from "./ast.js";
import { DqlSyntaxError } from "./errors.js";
import { compileOrderBy, type SortFieldResolver } from "./order-by.js";
import type { CompiledSql } from "./sql-generator.js";

// === Obsidian 规范来源: Dataview TASK 为任务行；本项目只采用明确支持的数据命令子集 ===
// === 自建实现 ===

/**
 * 编译固定任务列，显式 SORT 先于 LIMIT；未指定 SORT 保留原有行序约定。
 * parser 拒绝 GROUP/FLATTEN 并给源偏移，此处再防守手工 AST（无源串，pos=0）。
 * @behavior Given 显式文件级排序 When 执行 Then 按多键排列，平键由 path/源码行兜底。
 * @behavior Given 未支持的 GROUP/FLATTEN When 编译 Then 报错，不返回裸 TASK 伪结果。
 */
export function compileTaskSql(
  query: DqlQuery,
  where: readonly string[],
  params: unknown[],
  resolveField: SortFieldResolver,
): CompiledSql {
  if (query.groupBy !== undefined) throw new DqlSyntaxError("TASK 暂不支持 GROUP BY", 0);
  if (query.flatten !== undefined) throw new DqlSyntaxError("TASK 暂不支持 FLATTEN", 0);
  let sql =
    'SELECT k.text AS "task.text", k.status AS "task.status", ' +
    'k.due_date AS "task.due", f.path AS "file.path" ' +
    "FROM tasks k JOIN files f ON k.file_path = f.path";
  if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
  const ordering = compileOrderBy(query.sort, (field) => {
    // completed 已在 WHERE 保留为任务状态；不能在 SORT 偷偷改读同名笔记属性。
    if (field === "completed")
      throw new DqlSyntaxError("TASK 的 completed 仅支持 WHERE，暂不支持任务级 SORT", 0);
    return resolveField(field);
  });
  // 任务行必须稳定定位到同文件的源码顺序；不以自增 id 作为跨重建稳定语义。
  if (ordering !== "") sql += `${ordering}, f.path ASC, k.line_number ASC`;
  if (query.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }
  return {
    sql,
    params,
    columns: [
      { name: "task.text", json: false },
      { name: "task.status", json: false },
      { name: "task.due", json: false },
      { name: "file.path", json: false },
    ],
    type: "TASK",
  };
}

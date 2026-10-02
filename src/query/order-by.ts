import type { DqlQuery } from "./ast.js";
import { DqlSyntaxError } from "./errors.js";

// === 自建实现: 查询类型共用标量排序校验，不接受用户拼接 SQL 表达式 ===

/** 字段解析器只返回已校验的 SQL 表达式；json 聚合列不能作为排序键。 */
export type SortFieldResolver = (field: string) => { expr: string; json: boolean };

/**
 * 编译文件级多键 ORDER BY；无键返回空串，TASK 另加任务行稳定 tie-break。
 * 字段安全由 resolveField 的既有白名单保证，方向仍做运行期校验以拒绝危险手工 AST。
 * @behavior Given 聚合/未知字段或非法方向 When 编译 Then 抛 DqlSyntaxError，不退化为无排序。
 */
export function compileOrderBy(sort: DqlQuery["sort"], resolveField: SortFieldResolver): string {
  if (sort === undefined || sort.length === 0) return "";
  const keys = sort.map(({ field, dir }) => {
    if (dir !== "ASC" && dir !== "DESC") throw new DqlSyntaxError("SORT 方向仅支持 ASC/DESC", 0);
    const { expr, json } = resolveField(field);
    if (json) throw new DqlSyntaxError(`不能对聚合列排序: ${field}`, 0);
    return `${expr} ${dir}`;
  });
  return ` ORDER BY ${keys.join(", ")}`;
}

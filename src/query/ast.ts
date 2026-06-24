// === 自建实现: DQL 子集 AST 类型（不依赖 obsidian-dataview）===

/** 查询类型。 */
export type QueryType = "LIST" | "TABLE";

/** 比较操作符。 */
export type CompareOp = "=" | "!=" | "<" | ">" | "<=" | ">=";

/** 字符串函数。 */
export type StringFn = "contains" | "icontains" | "startswith" | "endswith";

/** FROM 来源（MVP 单一来源）。 */
export type DqlSource =
  | { kind: "folder"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "link"; value: string };

/** WHERE 条件表达式（递归）。 */
export type WhereExpr =
  | { kind: "and" | "or"; left: WhereExpr; right: WhereExpr }
  | { kind: "not"; expr: WhereExpr }
  | { kind: "compare"; field: string; op: CompareOp; value: string | number }
  | { kind: "call"; fn: StringFn | "regexmatch"; field: string; arg: string };

/** 一条 DQL 查询的结构化表示。 */
export interface DqlQuery {
  type: QueryType;
  /** TABLE 的列；LIST 时为空数组 */
  fields: string[];
  from?: DqlSource;
  where?: WhereExpr;
  sort?: { field: string; dir: "ASC" | "DESC" };
  limit?: number;
}

/** 查询结果 JSON 形态。 */
export interface QueryResult {
  type: QueryType;
  columns: string[];
  rows: Record<string, unknown>[];
}

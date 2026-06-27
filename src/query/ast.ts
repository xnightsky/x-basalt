// === 自建实现: DQL 子集 AST 类型（不依赖 obsidian-dataview）===
// 解析由 parser.ts（chevrotain）产出本文件的 DqlQuery；执行由 sql-generator.ts 编译为参数化 SQL。

/** 查询类型。TASK 返回任务行（S2.21 实现解析与执行）。 */
export type QueryType = "LIST" | "TABLE" | "TASK";

/** 比较操作符。 */
export type CompareOp = "=" | "!=" | "<" | ">" | "<=" | ">=";

/** 字符串谓词函数（返回布尔，直接作 WHERE 条件）。 */
export type StringFn = "contains" | "icontains" | "startswith" | "endswith";

/** 内置标量函数（包裹比较左操作数，返回值参与比较）。 */
export type ScalarFn = "lower" | "upper" | "length" | "round";

/** FROM 来源（单一来源）。 */
export type DqlSource =
  | { kind: "folder"; value: string }
  | { kind: "tag"; value: string }
  | { kind: "link"; value: string };

/** WHERE 条件表达式（递归）。 */
export type WhereExpr =
  | { kind: "and" | "or"; left: WhereExpr; right: WhereExpr }
  | { kind: "not"; expr: WhereExpr }
  | { kind: "compare"; field: string; fn?: ScalarFn; op: CompareOp; value: string | number }
  | { kind: "isnull"; field: string; negated: boolean }
  | { kind: "call"; fn: StringFn | "regexmatch"; field: string; arg: string };

/** 一条 DQL 查询的结构化表示。 */
export interface DqlQuery {
  type: QueryType;
  /** TABLE 的列；LIST/TASK 时为空数组 */
  fields: string[];
  from?: DqlSource;
  where?: WhereExpr;
  /** 多键排序：按数组顺序生成 ORDER BY；undefined/空表示不排序。 */
  sort?: { field: string; dir: "ASC" | "DESC" }[];
  /** GROUP BY 分组表达式（S2.18 实现）。 */
  groupBy?: { expr: string };
  /** FLATTEN 数组字段展开为多行（S2.19 实现）。 */
  flatten?: { field: string };
  /** WITHOUT ID 列控制：隐藏默认 id/file.link 列（S2.20 实现）。 */
  withoutId?: boolean;
  limit?: number;
}

/** 查询结果 JSON 形态。 */
export interface QueryResult {
  type: QueryType;
  columns: string[];
  rows: Record<string, unknown>[];
}

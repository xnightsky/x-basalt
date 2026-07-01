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

/**
 * WHERE 条件表达式（递归 ADT）：
 * - `and`/`or`：二元逻辑组合；`not`：一元取反（`NOT expr` 或 `!expr`）。
 * - `truthy`：裸字段真值判断 `WHERE field`，对标官方 Dataview `Values.isTruthy()`（null/0/""/[]/{}/false 皆 falsy）；
 *   `!field` 即 `not(truthy field)`。与 `isnull` 语义不同：`field != null` 把 `0`/`""` 视为「有」，而 `truthy` 视为 falsy。
 * - `compare`：`field op value`，`fn` 为可选标量函数（lower/upper/length/round）包裹字段后再比较。
 * - `isnull`：`field = null`（`negated=false` → IS NULL）/ `!= null`（`negated=true` → IS NOT NULL）——显式 null 比较，非真值判断。
 * - `call`：字符串谓词函数（contains/icontains/startswith/endswith/regexmatch），直接产出布尔条件。
 */
export type WhereExpr =
  | { kind: "and" | "or"; left: WhereExpr; right: WhereExpr }
  | { kind: "not"; expr: WhereExpr }
  | { kind: "truthy"; field: string }
  | {
      kind: "compare";
      field: string;
      fn?: ScalarFn;
      op: CompareOp;
      value: string | number | boolean;
    }
  | { kind: "isnull"; field: string; negated: boolean }
  | { kind: "call"; fn: StringFn | "regexmatch"; field: string; arg: string };

/** 一条 DQL 查询的结构化表示。 */
export interface DqlQuery {
  type: QueryType;
  /** TABLE 的列；LIST/TASK 时为空数组 */
  fields: string[];
  /** 无 FROM 子句时匹配整个 Vault（不加来源过滤）。 */
  from?: DqlSource;
  /** 无 WHERE 子句时不附加行过滤条件。 */
  where?: WhereExpr;
  /** 多键排序：按数组顺序生成 ORDER BY；undefined/空表示不排序。 */
  sort?: { field: string; dir: "ASC" | "DESC" }[];
  /** GROUP BY 分组表达式（S2.18 实现）。 */
  groupBy?: { expr: string };
  /** FLATTEN 数组字段展开为多行（S2.19 实现）。 */
  flatten?: { field: string };
  /** WITHOUT ID 列控制：隐藏默认 id/file.link 列（S2.20 实现）。 */
  withoutId?: boolean;
  /** 无 LIMIT 时不截断结果；负数在 parser 层报错（parseDql 前置校验）。 */
  limit?: number;
}

/**
 * 查询结果 JSON 形态。
 *
 * 分页元信息（total/offset/size/returned/hasMore）置于 rows 之前，
 * 即便结果被下游兜底截断，"总量/是否还有"也优先可见——数总量看 total，无需翻页枚举。
 */
export interface QueryResult {
  type: QueryType;
  columns: string[];
  /** 命中总数（整个查询的行数，独立 COUNT，不随分页变化）。 */
  total: number;
  /** 本页起始偏移（默认 0）。 */
  offset: number;
  /** 本页请求的页大小；undefined = 不分页（返回全部）。 */
  size?: number;
  /** 本页实际返回行数（= rows.length）。 */
  returned: number;
  /** 是否还有更多行（offset + returned < total）。翻页：offset += size。 */
  hasMore: boolean;
  rows: Record<string, unknown>[];
}

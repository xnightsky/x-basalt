import { linkKey } from "../utils/path.js";
import type { CompareOp, DqlQuery, QueryType, WhereExpr } from "./ast.js";

// === 自建实现: DQL AST → 参数化 SQL（隐式字段经 links/tags/tasks 表 JOIN 实时计算）===
//
// 上游：DataviewEngine.query；下游：产出 sql + params 交 better-sqlite3 prepare/all。
// 不变量：所有用户输入一律走占位符 `?` 绑定，禁止字符串拼接（防注入）。
//        唯一内联的是 frontmatter 字段名，且先以 /^[A-Za-z0-9_]+$/ 白名单校验。

/** 列规格：name 是结果列名（= 字段名），json 标记该列为聚合 JSON 数组（执行后需 JSON.parse）。 */
export interface ColumnSpec {
  name: string;
  json: boolean;
}

/** 编译产物：参数化 SQL、绑定参数、列规格与查询类型。 */
export interface CompiledSql {
  sql: string;
  params: unknown[];
  columns: ColumnSpec[];
  type: QueryType;
}

/** files 表直接列字段映射。 */
const FILE_COLUMNS: Record<string, string> = {
  "file.name": "f.name",
  "file.path": "f.path",
  "file.folder": "f.folder",
  "file.extension": "f.extension",
  "file.size": "f.size",
  "file.mtime": "f.mtime",
  "file.ctime": "f.ctime",
};

/** 把 [[link]] / 含锚点/别名的链接文本归约为可用于 target_key 匹配的基名。 */
function stripLink(s: string): string {
  let v = s.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const hash = v.indexOf("#");
  if (hash !== -1) v = v.slice(0, hash);
  const pipe = v.indexOf("|");
  if (pipe !== -1) v = v.slice(0, pipe);
  return v.trim();
}

/**
 * 字段 → SQL 表达式 + 是否为 JSON 聚合列。
 *
 * 隐式字段（tags/inlinks/outlinks/tasks）用相关子查询聚合，对应硬约束「查询期 JOIN 实时计算」。
 *
 * @param field - DQL 字段名（file.* 或 frontmatter 标量）
 * @throws Error 非目标字段（如 file.day）或非法 frontmatter 字段名
 */
function fieldToSql(field: string): { expr: string; json: boolean } {
  const direct = FILE_COLUMNS[field];
  if (direct !== undefined) return { expr: direct, json: false };

  switch (field) {
    case "file.tags":
      return {
        expr: "(SELECT json_group_array(DISTINCT t.tag) FROM tags t WHERE t.file_path = f.path)",
        json: true,
      };
    case "file.inlinks":
      // 反向链接：其他文件的 target_key 命中本文件 name_key（basename 解析，调研 §3.3#1）。
      // DISTINCT：同一源文件多次链接本文件只列一次（如 [[A]] 与 [[A#^id]] 同指 A）。
      return {
        expr: "(SELECT json_group_array(DISTINCT l.source) FROM links l WHERE l.target_key = f.name_key)",
        json: true,
      };
    case "file.outlinks":
      // 正向链接（含 embed）：本文件作为 source 的全部链接 target（按 target 去重）。
      return {
        expr: "(SELECT json_group_array(DISTINCT l.target) FROM links l WHERE l.source = f.path)",
        json: true,
      };
    case "file.tasks":
      return {
        expr: "(SELECT json_group_array(json_object('status', k.status, 'text', k.text, 'due', k.due_date)) FROM tasks k WHERE k.file_path = f.path)",
        json: true,
      };
    default:
      // frontmatter 标量：仅允许安全字符后内联进 json path（已白名单校验，无注入）。
      if (!/^[A-Za-z0-9_]+$/.test(field)) {
        throw new Error(`不支持的查询字段: ${field}`);
      }
      return { expr: `json_extract(f.frontmatter, '$.${field}')`, json: false };
  }
}

/** SQL 列别名：字段名含点，统一双引号包裹，结果行 key 即字段名。 */
function quoteAlias(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** 编译 WHERE 表达式为 SQL 片段 + 参数。 */
function compileWhere(expr: WhereExpr): { sql: string; params: unknown[] } {
  switch (expr.kind) {
    case "and": {
      const l = compileWhere(expr.left);
      const r = compileWhere(expr.right);
      return { sql: `(${l.sql} AND ${r.sql})`, params: [...l.params, ...r.params] };
    }
    case "or": {
      const l = compileWhere(expr.left);
      const r = compileWhere(expr.right);
      return { sql: `(${l.sql} OR ${r.sql})`, params: [...l.params, ...r.params] };
    }
    case "not": {
      const e = compileWhere(expr.expr);
      return { sql: `(NOT ${e.sql})`, params: e.params };
    }
    case "compare": {
      const { expr: fe } = fieldToSql(expr.field);
      // op 取值受 CompareOp 类型约束（= != < > <= >=），均为合法 SQL 比较符。
      return { sql: `(${fe} ${expr.op as CompareOp} ?)`, params: [expr.value] };
    }
    case "call":
      return compileCall(expr);
  }
}

/** 编译函数调用（contains/icontains/startswith/endswith/regexmatch）。 */
function compileCall(expr: Extract<WhereExpr, { kind: "call" }>): {
  sql: string;
  params: unknown[];
} {
  const { fn, field, arg } = expr;

  if (fn === "regexmatch") {
    const { expr: fe } = fieldToSql(field);
    // REGEXP 由执行层注册的自定义函数支撑。
    return { sql: `(${fe} REGEXP ?)`, params: [arg] };
  }

  if (fn === "contains" || fn === "icontains") {
    if (field === "file.tags") {
      // 标签 contains 走前缀语义：area 命中 area 与 area/work（与 FROM #tag 一致）。
      const tag = arg.replace(/^#/, "");
      return {
        sql: "EXISTS (SELECT 1 FROM tags t WHERE t.file_path = f.path AND (t.tag = ? OR t.tag LIKE ?))",
        params: [tag, `${tag}/%`],
      };
    }
    if (field === "file.outlinks") {
      return {
        sql: "EXISTS (SELECT 1 FROM links l WHERE l.source = f.path AND l.target_key = ?)",
        params: [linkKey(stripLink(arg))],
      };
    }
    if (field === "file.inlinks") {
      return {
        sql: "EXISTS (SELECT 1 FROM links l WHERE l.target_key = f.name_key AND l.source IN (SELECT path FROM files WHERE name_key = ?))",
        params: [linkKey(stripLink(arg))],
      };
    }
    const { expr: fe } = fieldToSql(field);
    if (fn === "icontains") return { sql: `(LOWER(${fe}) LIKE LOWER(?))`, params: [`%${arg}%`] };
    return { sql: `(${fe} LIKE ?)`, params: [`%${arg}%`] };
  }

  const { expr: fe } = fieldToSql(field);
  if (fn === "startswith") return { sql: `(${fe} LIKE ?)`, params: [`${arg}%`] };
  if (fn === "endswith") return { sql: `(${fe} LIKE ?)`, params: [`%${arg}`] };
  throw new Error(`不支持的函数: ${fn as string}`);
}

/**
 * 将 DQL AST 编译为参数化 SQL（防注入，全部走占位符绑定）。
 *
 * @param query - 解析后的 DQL 结构
 */
export function generateSql(query: DqlQuery): CompiledSql {
  const whereSql: string[] = [];
  const params: unknown[] = [];

  // FROM：折叠为 WHERE 上的存在性/前缀约束。
  if (query.from) {
    if (query.from.kind === "tag") {
      whereSql.push(
        "EXISTS (SELECT 1 FROM tags t WHERE t.file_path = f.path AND (t.tag = ? OR t.tag LIKE ?))",
      );
      params.push(query.from.value, `${query.from.value}/%`);
    } else if (query.from.kind === "folder") {
      // 含子文件夹：folder = X 或 X/ 前缀。
      whereSql.push("(f.folder = ? OR f.folder LIKE ?)");
      params.push(query.from.value, `${query.from.value}/%`);
    } else {
      // FROM [[link]]：指向该 note 的反向链接集合（§3.3#5）。
      whereSql.push("EXISTS (SELECT 1 FROM links l WHERE l.source = f.path AND l.target_key = ?)");
      params.push(linkKey(stripLink(query.from.value)));
    }
  }

  if (query.where) {
    const w = compileWhere(query.where);
    whereSql.push(w.sql);
    params.push(...w.params);
  }

  // SELECT 列：LIST 固定 file.name/file.path；TABLE 以 file.name 起头再接请求字段。
  const columns: ColumnSpec[] = [];
  const selectParts: string[] = [];
  const addCol = (name: string): void => {
    const { expr, json } = fieldToSql(name);
    columns.push({ name, json });
    selectParts.push(`${expr} AS ${quoteAlias(name)}`);
  };
  if (query.type === "LIST") {
    addCol("file.name");
    addCol("file.path");
  } else {
    addCol("file.name");
    for (const f of query.fields) addCol(f);
  }

  let sql = `SELECT ${selectParts.join(", ")} FROM files f`;
  if (whereSql.length) sql += ` WHERE ${whereSql.join(" AND ")}`;
  if (query.sort) {
    const { expr } = fieldToSql(query.sort.field);
    sql += ` ORDER BY ${expr} ${query.sort.dir}`;
  }
  if (query.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }

  return { sql, params, columns, type: query.type };
}

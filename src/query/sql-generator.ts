import { linkKey, pathKey } from "../utils/path.js";
import type { CompareOp, DqlQuery, QueryType, ScalarFn, WhereExpr } from "./ast.js";
import { DqlSyntaxError } from "./errors.js";

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

/** 把 [[link]] / 含锚点/别名的链接文本归约为 target 主体（去 [[ ]]、锚点 #、别名 |）。 */
function stripLink(s: string): string {
  let v = s.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const hash = v.indexOf("#");
  if (hash !== -1) v = v.slice(0, hash);
  const pipe = v.indexOf("|");
  if (pipe !== -1) v = v.slice(0, pipe);
  return v.trim();
}

/**
 * 链接 target 文本 → 对 links 行 target 的匹配条件（S3.2 路径感知）：
 * 含 `/` 按 `target_path_key` 精确，否则按 `target_key` basename 回退。
 * 用于 `FROM [[link]]` 与 `contains(file.outlinks, "...")`。
 */
function linkTextMatch(text: string, alias: string): { sql: string; params: unknown[] } {
  const t = stripLink(text);
  if (t.includes("/")) return { sql: `${alias}.target_path_key = ?`, params: [pathKey(t)] };
  return { sql: `${alias}.target_key = ?`, params: [linkKey(t)] };
}

/**
 * links 行 l 是否指向文件 f：qualified 链接（target 含 `/`）按 path_key 精确，
 * bare 链接按 name_key basename 回退。S3.2 消除同名异目录串味。
 */
const INLINK_MATCH =
  "(l.target_path_key = f.path_key OR (l.target_path_key IS NULL AND l.target_key = f.name_key))";

/**
 * 字段 → SQL 表达式 + 是否为 JSON 聚合列。
 *
 * 隐式字段（tags/inlinks/outlinks/tasks）用相关子查询聚合，对应硬约束「查询期 JOIN 实时计算」。
 *
 * @param field - DQL 字段名（file.* 或 frontmatter 标量）
 * @throws {DqlSyntaxError} 非目标字段（如 file.day）或非法 frontmatter 字段名
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
      // 反向链接：路径感知 JOIN（S3.2），qualified 按 path_key 精确、bare 按 name_key 回退。
      // DISTINCT：同一源文件多次链接本文件只列一次（如 [[A]] 与 [[A#^id]] 同指 A）。
      return {
        expr: `(SELECT json_group_array(DISTINCT l.source) FROM links l WHERE ${INLINK_MATCH})`,
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
        // S2.12：未知字段抛带位置的 DqlSyntaxError（pos 0：sql-gen 层无 token 偏移）。
        throw new DqlSyntaxError(`不支持的查询字段: ${field}`, 0);
      }
      return { expr: `json_extract(f.frontmatter, '$.${field}')`, json: false };
  }
}

/** SQL 列别名：字段名含点，统一双引号包裹，结果行 key 即字段名。 */
function quoteAlias(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** S2.17：内置标量函数 → SQL（length 对数组字段用 json_array_length，标量用 LENGTH）。 */
function scalarFnSql(fn: ScalarFn, fe: string, json: boolean): string {
  switch (fn) {
    case "lower":
      return `LOWER(${fe})`;
    case "upper":
      return `UPPER(${fe})`;
    case "length":
      return json ? `json_array_length(${fe})` : `LENGTH(${fe})`;
    case "round":
      return `ROUND(${fe})`;
  }
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
      const { expr: fe, json } = fieldToSql(expr.field);
      // S2.17：可选标量函数包裹左操作数（lower/upper/length/round）。
      const lhs = expr.fn ? scalarFnSql(expr.fn, fe, json) : fe;
      // op 取值受 CompareOp 类型约束（= != < > <= >=），均为合法 SQL 比较符。
      return { sql: `(${lhs} ${expr.op as CompareOp} ?)`, params: [expr.value] };
    }
    case "isnull": {
      // S2.15：= null → IS NULL；!= null → IS NOT NULL（null 不参数化）。
      const { expr: fe } = fieldToSql(expr.field);
      return { sql: `(${fe} IS ${expr.negated ? "NOT " : ""}NULL)`, params: [] };
    }
    case "call":
      return compileCall(expr);
  }
}

/** 转义 LIKE 通配符（`%` `_` 与转义符 `\` 自身），配合 ` ESCAPE '\'` 子句做字面匹配（S2.9）。 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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
      // S2.10：icontains 对标签大小写不敏感；contains 保持精确（前缀）匹配。
      if (fn === "icontains") {
        return {
          sql: "EXISTS (SELECT 1 FROM tags t WHERE t.file_path = f.path AND (LOWER(t.tag) = LOWER(?) OR LOWER(t.tag) LIKE LOWER(?)))",
          params: [tag, `${tag}/%`],
        };
      }
      return {
        sql: "EXISTS (SELECT 1 FROM tags t WHERE t.file_path = f.path AND (t.tag = ? OR t.tag LIKE ?))",
        params: [tag, `${tag}/%`],
      };
    }
    if (field === "file.outlinks") {
      // 路径感知（S3.2）：arg 含 '/' 按 path_key 精确，否则 basename 回退。
      const m = linkTextMatch(arg, "l");
      return {
        sql: `EXISTS (SELECT 1 FROM links l WHERE l.source = f.path AND ${m.sql})`,
        params: m.params,
      };
    }
    if (field === "file.inlinks") {
      // 路径感知（S3.2）：本文件被指向用 INLINK_MATCH；源文件按 arg 精确(path_key)/回退(name_key)识别。
      const t = stripLink(arg);
      const srcCol = t.includes("/") ? "path_key" : "name_key";
      const srcParam = t.includes("/") ? pathKey(t) : linkKey(t);
      return {
        sql: `EXISTS (SELECT 1 FROM links l WHERE ${INLINK_MATCH} AND l.source IN (SELECT path FROM files WHERE ${srcCol} = ?))`,
        params: [srcParam],
      };
    }
    const { expr: fe } = fieldToSql(field);
    const like = escapeLike(arg);
    if (fn === "icontains") {
      return { sql: `(LOWER(${fe}) LIKE LOWER(?) ESCAPE '\\')`, params: [`%${like}%`] };
    }
    return { sql: `(${fe} LIKE ? ESCAPE '\\')`, params: [`%${like}%`] };
  }

  const { expr: fe } = fieldToSql(field);
  if (fn === "startswith") {
    return { sql: `(${fe} LIKE ? ESCAPE '\\')`, params: [`${escapeLike(arg)}%`] };
  }
  if (fn === "endswith") return { sql: `(${fe} LIKE ? ESCAPE '\\')`, params: [`%${escapeLike(arg)}`] };
  throw new Error(`不支持的函数: ${fn as string}`);
}

/**
 * 将 DQL AST 编译为参数化 SQL（防注入，全部走占位符绑定）。
 *
 * @param query - 解析后的 DQL 结构
 *
 * @behavior
 * Given 任意携带用户输入值的查询
 * When 编译
 * Then 用户输入一律绑定到 ? 占位符，仅白名单校验过的 frontmatter 字段名内联（无注入面）
 *
 * @behavior
 * Given FROM #a（或 contains(file.tags,"a")）
 * When 编译
 * Then 生成前缀匹配，命中 #a 与嵌套 #a/b
 *
 * @behavior
 * Given SORT 落在聚合 JSON 列、FLATTEN 用于非数组字段、或引用未知字段
 * When 编译
 * Then 抛出 DqlSyntaxError，而非产出无意义顺序或静默忽略
 *
 * @behavior
 * Given TABLE 默认起头的 file.name 与显式字段重复
 * When 编译
 * Then SELECT 列按字段名去重，不产出重复列
 *
 * @behavior
 * Given qualified 链接 [[Dir/Note]]（inlinks / outlinks / FROM [[..]]）
 * When 编译
 * Then 按 path_key 精确匹配，不串到同名异目录文件；bare [[Note]] 才按 basename name_key 回退（S3.2）
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
      // FROM [[link]]：指向该 note 的反向链接集合（§3.3#5），路径感知（S3.2）。
      const m = linkTextMatch(query.from.value, "l");
      whereSql.push(`EXISTS (SELECT 1 FROM links l WHERE l.source = f.path AND ${m.sql})`);
      params.push(...m.params);
    }
  }

  if (query.where) {
    const w = compileWhere(query.where);
    whereSql.push(w.sql);
    params.push(...w.params);
  }

  // S2.21 TASK：行=任务（tasks JOIN files），FROM/WHERE 复用文件级过滤。task 字段级过滤为后续。
  if (query.type === "TASK") {
    let tsql =
      `SELECT k.text AS ${quoteAlias("task.text")}, k.status AS ${quoteAlias("task.status")}, ` +
      `k.due_date AS ${quoteAlias("task.due")}, f.path AS ${quoteAlias("file.path")} ` +
      "FROM tasks k JOIN files f ON k.file_path = f.path";
    if (whereSql.length) tsql += ` WHERE ${whereSql.join(" AND ")}`;
    if (query.limit !== undefined) {
      tsql += " LIMIT ?";
      params.push(query.limit);
    }
    const taskCols: ColumnSpec[] = [
      { name: "task.text", json: false },
      { name: "task.status", json: false },
      { name: "task.due", json: false },
      { name: "file.path", json: false },
    ];
    return { sql: tsql, params, columns: taskCols, type: "TASK" };
  }

  // SELECT 列：LIST 固定 file.name/file.path；TABLE 以 file.name 起头再接请求字段。
  const columns: ColumnSpec[] = [];
  const selectParts: string[] = [];
  const seen = new Set<string>();
  const addCol = (name: string): void => {
    // S2.11：列去重——TABLE 默认起头 file.name 与显式字段、重复字段不产生重复列。
    if (seen.has(name)) return;
    seen.add(name);
    const { expr, json } = fieldToSql(name);
    columns.push({ name, json });
    selectParts.push(`${expr} AS ${quoteAlias(name)}`);
  };

  // S2.19 FLATTEN：FROM 追加 json_each 交叉展开数组字段为多行（每元素一行）。
  let fromClause = "FROM files f";
  if (query.flatten) {
    const { expr: fexpr, json } = fieldToSql(query.flatten.field);
    if (!json) throw new DqlSyntaxError(`FLATTEN 仅适用于数组字段: ${query.flatten.field}`, 0);
    fromClause += `, json_each(${fexpr}) AS _flat`;
  }

  // S2.18 GROUP BY：分组键 + 该组文件聚合(rows)；否则常规 LIST/TABLE 列（含 S2.20 WITHOUT ID）。
  let groupBySql = "";
  if (query.groupBy) {
    const { expr: gexpr } = fieldToSql(query.groupBy.expr);
    columns.push({ name: query.groupBy.expr, json: false });
    selectParts.push(`${gexpr} AS ${quoteAlias(query.groupBy.expr)}`);
    columns.push({ name: "rows", json: true });
    selectParts.push(`json_group_array(DISTINCT f.path) AS ${quoteAlias("rows")}`);
    groupBySql = ` GROUP BY ${gexpr}`;
  } else {
    if (query.type === "LIST") {
      if (!query.withoutId) addCol("file.name");
      addCol("file.path");
    } else {
      if (!query.withoutId) addCol("file.name");
      for (const f of query.fields) addCol(f);
    }
    // FLATTEN 展开值作为该字段的单值列（覆盖原聚合语义，每行一个元素）。
    if (query.flatten) {
      columns.push({ name: query.flatten.field, json: false });
      selectParts.push(`_flat.value AS ${quoteAlias(query.flatten.field)}`);
    }
  }

  let sql = `SELECT ${selectParts.join(", ")} ${fromClause}`;
  if (whereSql.length) sql += ` WHERE ${whereSql.join(" AND ")}`;
  sql += groupBySql;
  // 多键排序：按 AST 数组顺序拼 ORDER BY（现解析仅产单键，结构已支持多键，见 S2.14）。
  if (query.sort && query.sort.length > 0) {
    const orderBy = query.sort
      .map((s) => {
        const { expr, json } = fieldToSql(s.field);
        // S2.13：聚合 JSON 列（tags/inlinks/outlinks/tasks）不可排序，报错而非产出无意义顺序。
        if (json) throw new DqlSyntaxError(`不能对聚合列排序: ${s.field}`, 0);
        return `${expr} ${s.dir}`;
      })
      .join(", ");
    sql += ` ORDER BY ${orderBy}`;
  }
  if (query.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }

  return { sql, params, columns, type: query.type };
}

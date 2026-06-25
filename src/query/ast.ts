import { DqlSyntaxError, type Token } from "./tokenizer.js";

// === 自建实现: DQL 子集 AST 类型 + 递归下降 parser（不依赖 obsidian-dataview）===

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

// === 自建实现: tokens → DqlQuery 递归下降解析 ===

/** 子句关键字：TABLE 字段列表读取在此停止。 */
const CLAUSE_KW = new Set(["FROM", "WHERE", "SORT", "LIMIT"]);
/** WHERE 中可用的函数名（小写比较）。 */
const FUNCTIONS = new Set(["contains", "icontains", "startswith", "endswith", "regexmatch"]);

/** token 是否为某关键字（大小写不敏感的 word）。 */
function isKeyword(t: Token, kw: string): boolean {
  return t.kind === "word" && t.value.toUpperCase() === kw;
}

/** 函数参数 token → 字符串：标签保留 #（由 sql-generator 决定剥离），数字按原文。 */
function argToString(t: Token): string {
  switch (t.kind) {
    case "string":
    case "link":
      return t.value;
    case "tag":
      return `#${t.value}`;
    case "number":
      return t.value;
    default:
      throw new DqlSyntaxError("函数参数须为字符串/链接/标签/数字", t.pos);
  }
}

/** 比较值 token → string | number。 */
function tokenToCompareValue(t: Token): string | number {
  if (t.kind === "number") return Number(t.value);
  if (t.kind === "string" || t.kind === "link") return t.value;
  if (t.kind === "tag") return t.value;
  throw new DqlSyntaxError("比较值须为字符串/数字/链接/标签", t.pos);
}

/**
 * 把 token 流解析为结构化 DqlQuery。
 *
 * 文法（严格子集，超出即报错而非静默）：
 *   (LIST | TABLE field, ...) [FROM (#tag | [[link]] | "folder")] [WHERE expr]
 *   [SORT field (ASC|DESC)?] [LIMIT number]
 * WHERE 优先级：OR < AND < NOT < primary（比较 / 函数调用 / 括号）。
 *
 * @param tokens - tokenize 产出的 token 流
 * @throws DqlSyntaxError 不符合子集文法时（带位置）
 */
export function parseQuery(tokens: Token[]): DqlQuery {
  // tokenize 保证末尾为 eof；EOF 作为越界回退，省去非空断言。
  const EOF: Token = tokens[tokens.length - 1] ?? { kind: "eof", value: "", pos: 0 };
  let pos = 0;

  const peek = (k = 0): Token => tokens[pos + k] ?? EOF;
  const next = (): Token => {
    const t = peek();
    pos++;
    return t;
  };

  // ---- 头部：LIST | TABLE [fields] ----
  const head = next();
  const headUpper = head.value.toUpperCase();
  if (head.kind !== "word" || (headUpper !== "LIST" && headUpper !== "TABLE")) {
    throw new DqlSyntaxError("查询须以 LIST 或 TABLE 开头", head.pos);
  }
  const type: QueryType = headUpper === "TABLE" ? "TABLE" : "LIST";

  const fields: string[] = [];
  const readFieldName = (): string => {
    const t = next();
    if (t.kind !== "word") throw new DqlSyntaxError("期望字段名", t.pos);
    return t.value;
  };
  if (type === "TABLE") {
    const first = peek();
    // 若 TABLE 后直接是子句关键字（如 TABLE FROM ...），则无显式字段。
    if (first.kind === "word" && !CLAUSE_KW.has(first.value.toUpperCase())) {
      fields.push(readFieldName());
      while (peek().kind === "comma") {
        next();
        fields.push(readFieldName());
      }
    }
  }

  // ---- FROM ----
  let from: DqlSource | undefined;
  if (isKeyword(peek(), "FROM")) {
    next();
    const src = next();
    if (src.kind === "tag") from = { kind: "tag", value: src.value };
    else if (src.kind === "link") from = { kind: "link", value: src.value };
    else if (src.kind === "string") from = { kind: "folder", value: src.value };
    else throw new DqlSyntaxError('FROM 须接 #tag、[[link]] 或 "folder"', src.pos);
  }

  // ---- WHERE ----
  const parsePrimary = (): WhereExpr => {
    const t = peek();
    if (t.kind === "lparen") {
      next();
      const e = parseOr();
      if (peek().kind !== "rparen") throw new DqlSyntaxError("缺少右括号 )", peek().pos);
      next();
      return e;
    }
    if (t.kind === "word") {
      // 函数调用：fn( field , arg )
      if (FUNCTIONS.has(t.value.toLowerCase()) && peek(1).kind === "lparen") {
        const fnName = next().value.toLowerCase();
        next(); // (
        const fieldTok = next();
        if (fieldTok.kind !== "word") {
          throw new DqlSyntaxError("函数第一个参数须为字段名", fieldTok.pos);
        }
        if (peek().kind !== "comma") throw new DqlSyntaxError("函数参数以逗号分隔", peek().pos);
        next();
        const arg = argToString(next());
        if (peek().kind !== "rparen") throw new DqlSyntaxError("缺少右括号 )", peek().pos);
        next();
        return {
          kind: "call",
          fn: fnName as Extract<WhereExpr, { kind: "call" }>["fn"],
          field: fieldTok.value,
          arg,
        };
      }
      // 比较：field op value
      const field = next().value;
      const opTok = next();
      if (opTok.kind !== "op") throw new DqlSyntaxError("条件须为比较或函数调用", opTok.pos);
      const value = tokenToCompareValue(next());
      return { kind: "compare", field, op: opTok.value as CompareOp, value };
    }
    throw new DqlSyntaxError("无法解析的条件", t.pos);
  };
  const parseNot = (): WhereExpr => {
    if (isKeyword(peek(), "NOT")) {
      next();
      return { kind: "not", expr: parseNot() };
    }
    return parsePrimary();
  };
  function parseAnd(): WhereExpr {
    let left = parseNot();
    while (isKeyword(peek(), "AND")) {
      next();
      left = { kind: "and", left, right: parseNot() };
    }
    return left;
  }
  function parseOr(): WhereExpr {
    let left = parseAnd();
    while (isKeyword(peek(), "OR")) {
      next();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  }

  let where: WhereExpr | undefined;
  if (isKeyword(peek(), "WHERE")) {
    next();
    where = parseOr();
  }

  // ---- SORT field (ASC|DESC)? ----
  let sort: DqlQuery["sort"];
  if (isKeyword(peek(), "SORT")) {
    next();
    const f = next();
    if (f.kind !== "word") throw new DqlSyntaxError("SORT 须接字段名", f.pos);
    let dir: "ASC" | "DESC" = "ASC";
    if (isKeyword(peek(), "ASC")) next();
    else if (isKeyword(peek(), "DESC")) {
      next();
      dir = "DESC";
    }
    sort = { field: f.value, dir };
  }

  // ---- LIMIT number ----
  let limit: number | undefined;
  if (isKeyword(peek(), "LIMIT")) {
    next();
    const num = next();
    if (num.kind !== "number") throw new DqlSyntaxError("LIMIT 须接数字", num.pos);
    limit = Number.parseInt(num.value, 10);
  }

  if (peek().kind !== "eof") {
    throw new DqlSyntaxError(`意外的 token "${peek().value}"`, peek().pos);
  }

  return { type, fields, from, where, sort, limit };
}

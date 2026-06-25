// === 自建实现: DQL 词法分析（手写 tokenizer，不依赖 obsidian-dataview）===
//
// 上游：DataviewEngine.query；下游：产出 Token[] 交 ast.parseQuery。
// 用 charAt 取字符（越界返回 ""），既避开 noUncheckedIndexedAccess 的 undefined，也免去非空断言。

/** 词法单元种类。word 涵盖关键字与字段名（由 parser 据上下文区分大小写不敏感关键字）。 */
export type TokenKind =
  | "word"
  | "string"
  | "number"
  | "op"
  | "tag"
  | "link"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

/** 词法单元。 */
export interface Token {
  kind: TokenKind;
  value: string;
  /** 在源串中的起始偏移，用于报错定位 */
  pos: number;
}

/** DQL 语法/词法错误，携带源串位置以便定位（设计 §5）。 */
export class DqlSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`DQL 语法错误 (位置 ${pos}): ${message}`);
    this.name = "DqlSyntaxError";
    this.pos = pos;
  }
}

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isWordStart = (c: string): boolean => /[A-Za-z_]/.test(c);
// 字段名允许点（file.name）与连字符；关键字/函数名是其子集。
const isWordChar = (c: string): boolean => /[A-Za-z0-9_.-]/.test(c);
// === Obsidian 规范来源: 标签体取 Unicode 字母/数字/下划线/连字符/斜杠（嵌套）===
const isTagChar = (c: string): boolean => /[\p{L}\p{N}_/-]/u.test(c);

/**
 * 将 DQL 字符串切分为 token 流（以 eof 结尾）。
 *
 * @param dql - 原始 DQL 查询语句
 * @throws DqlSyntaxError 遇到未闭合字符串 / [[ / 空标签 / 非法字符
 */
export function tokenize(dql: string): Token[] {
  const tokens: Token[] = [];
  const n = dql.length;
  let i = 0;

  while (i < n) {
    const c = dql.charAt(i);

    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen", value: c, pos: i++ });
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen", value: c, pos: i++ });
      continue;
    }
    if (c === ",") {
      tokens.push({ kind: "comma", value: c, pos: i++ });
      continue;
    }

    // [[link]]：取内部原文（含可能的 #anchor / |alias，由 sql-generator 再行剥离）。
    if (c === "[" && dql.charAt(i + 1) === "[") {
      const end = dql.indexOf("]]", i + 2);
      if (end === -1) throw new DqlSyntaxError("未闭合的 [[", i);
      tokens.push({ kind: "link", value: dql.slice(i + 2, end).trim(), pos: i });
      i = end + 2;
      continue;
    }

    // 字符串字面量：支持单/双引号，反斜杠转义下一字符。
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = "";
      while (j < n && dql.charAt(j) !== c) {
        if (dql.charAt(j) === "\\" && j + 1 < n) {
          buf += dql.charAt(j + 1);
          j += 2;
          continue;
        }
        buf += dql.charAt(j);
        j++;
      }
      if (j >= n) throw new DqlSyntaxError("未闭合的字符串", i);
      tokens.push({ kind: "string", value: buf, pos: i });
      i = j + 1;
      continue;
    }

    // #tag：标签体不含 #，至少一个字符。
    if (c === "#") {
      let j = i + 1;
      while (j < n && isTagChar(dql.charAt(j))) j++;
      if (j === i + 1) throw new DqlSyntaxError("空标签 #", i);
      tokens.push({ kind: "tag", value: dql.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }

    // 数字（允许前导负号，DQL 子集无减法运算，- 仅作符号）。
    if (isDigit(c) || (c === "-" && isDigit(dql.charAt(i + 1)))) {
      let j = c === "-" ? i + 1 : i;
      while (j < n && isDigit(dql.charAt(j))) j++;
      if (dql.charAt(j) === ".") {
        j++;
        while (j < n && isDigit(dql.charAt(j))) j++;
      }
      tokens.push({ kind: "number", value: dql.slice(i, j), pos: i });
      i = j;
      continue;
    }

    // 比较操作符：= != < <= > >=。
    if (c === "=") {
      tokens.push({ kind: "op", value: "=", pos: i++ });
      continue;
    }
    if (c === "!") {
      if (dql.charAt(i + 1) === "=") {
        tokens.push({ kind: "op", value: "!=", pos: i });
        i += 2;
        continue;
      }
      throw new DqlSyntaxError("意外的 '!'（应为 '!='）", i);
    }
    if (c === "<" || c === ">") {
      if (dql.charAt(i + 1) === "=") {
        tokens.push({ kind: "op", value: `${c}=`, pos: i });
        i += 2;
        continue;
      }
      tokens.push({ kind: "op", value: c, pos: i++ });
      continue;
    }

    // 标识符 / 关键字 / 函数名 / 字段路径。
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordChar(dql.charAt(j))) j++;
      tokens.push({ kind: "word", value: dql.slice(i, j), pos: i });
      i = j;
      continue;
    }

    throw new DqlSyntaxError(`意外字符 '${c}'`, i);
  }

  tokens.push({ kind: "eof", value: "", pos: n });
  return tokens;
}

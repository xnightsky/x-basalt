import { EmbeddedActionsParser, type IToken } from "chevrotain";
import type {
  CompareOp,
  DqlQuery,
  DqlSource,
  QueryType,
  ScalarFn,
  StringFn,
  WhereExpr,
} from "./ast.js";
import { DqlSyntaxError } from "./errors.js";
import {
  allTokens,
  And,
  Asc,
  By,
  Comma,
  Desc,
  DqlLexer,
  Flatten,
  From,
  Group,
  Id,
  Identifier,
  Limit,
  List,
  LParen,
  Not,
  Null,
  NumberLiteral,
  Op,
  Or,
  Regexp,
  RParen,
  Sort,
  StringLiteral,
  Table,
  Tag,
  Task,
  Where,
  WikiLink,
  Without,
} from "./tokens.js";

// === 自建实现: DQL parser（chevrotain EmbeddedActionsParser，产出 ast.ts 的 DqlQuery）===
//
// 上游：DataviewEngine.query（query/index.ts）；下游：DqlQuery 交 sql-generator。替代手写 ast.parseQuery（S2.8 端到端切换）。
// WHERE 优先级：OR < AND < NOT < primary（比较 / 函数调用 / 括号），与旧实现一致。
// 子句文法（固定顺序，超出报错）：
//   (LIST | TABLE field,... | TASK) (WITHOUT ID)? (FROM src)? (WHERE expr)?
//   (GROUP BY field)? (FLATTEN field)? (SORT key,...)? (LIMIT n)?

/**
 * 去引号并解码反斜杠转义（`\X → X`，与 Obsidian / 旧手写 tokenizer 一致）。
 * chevrotain 的 StringLiteral image 为原文（含未解码转义），故在此解码 `\"` `\\` 等。
 */
const unquote = (s: string): string => s.slice(1, -1).replace(/\\(.)/g, "$1");
/** `[[inner]]` → `inner`（含锚点/别名原文，由 sql-generator 再剥离）。 */
const stripWiki = (s: string): string => s.slice(2, -2).trim();

/** 内置字符串谓词函数名集合（小写）。 */
const STRING_FNS = new Set<string>(["contains", "icontains", "startswith", "endswith"]);

/** 内置标量函数名集合（S2.17：包裹比较左操作数）。 */
const SCALAR_FNS = new Set<string>(["lower", "upper", "length", "round"]);

/** 合法比较符集合（运行期校验 scalar 函数后的操作符）。 */
const COMPARE_OPS = new Set<string>(["=", "!=", "<", ">", "<=", ">="]);

/** S2.17：date(today)/date(now) 求值为 ISO 串（today=日期，now=日期时间）。 */
function evalDateFn(fn: string, arg: string): string {
  if (fn.toLowerCase() !== "date") {
    throw new DqlSyntaxError(`不支持的值函数: ${fn}`, 0);
  }
  const a = arg.toLowerCase();
  const now = new Date();
  if (a === "today") return now.toISOString().slice(0, 10);
  if (a === "now") return now.toISOString();
  throw new DqlSyntaxError("date() 仅支持 today / now", 0);
}

class DqlChevParser extends EmbeddedActionsParser {
  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  /** 顶层：一条 DQL → DqlQuery。 */
  query = this.RULE("query", (): DqlQuery => {
    let type: QueryType = "LIST";
    const fields: string[] = [];
    this.OR([
      {
        ALT: () => {
          this.CONSUME(List);
        },
      },
      {
        ALT: () => {
          this.CONSUME(Table);
          type = "TABLE";
        },
      },
      {
        ALT: () => {
          this.CONSUME(Task);
          type = "TASK";
        },
      },
    ]);

    let withoutId: boolean | undefined;
    this.OPTION(() => {
      this.CONSUME(Without);
      this.CONSUME(Id);
      withoutId = true;
    });

    // 字段列表：仅 TABLE 有意义；位于 WITHOUT ID 之后（对齐 Dataview `TABLE WITHOUT ID f1, f2`）。
    // 支持 length(rows) / count() 等 GROUP BY 聚合列表达式。
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => fields.push(this.SUBRULE(this.tableField)),
    });

    let from: DqlSource | undefined;
    this.OPTION1(() => {
      this.CONSUME(From);
      from = this.SUBRULE(this.source);
    });

    let where: WhereExpr | undefined;
    this.OPTION2(() => {
      this.CONSUME(Where);
      where = this.SUBRULE(this.orExpr);
    });

    let groupBy: DqlQuery["groupBy"];
    this.OPTION3(() => {
      this.CONSUME(Group);
      this.CONSUME(By);
      // 数字后缀避让：MANY_SEP 用 CONSUME(Identifier)、FLATTEN 用 CONSUME1，此处 CONSUME2。
      groupBy = { expr: this.CONSUME2(Identifier).image };
    });

    let flatten: DqlQuery["flatten"];
    this.OPTION4(() => {
      this.CONSUME(Flatten);
      flatten = { field: this.CONSUME1(Identifier).image };
    });

    let sort: DqlQuery["sort"];
    this.OPTION5(() => {
      this.CONSUME(Sort);
      sort = this.SUBRULE(this.sortKeys);
    });

    let limit: number | undefined;
    this.OPTION6(() => {
      this.CONSUME(Limit);
      const numTok = this.CONSUME(NumberLiteral);
      // S2.13：LIMIT 负数报错（ACTION 避开 self-analysis 录制；带 token 位置）。
      limit = this.ACTION((): number => {
        const n = Number.parseInt(numTok.image, 10);
        if (n < 0) throw new DqlSyntaxError("LIMIT 不能为负数", numTok.startOffset);
        return n;
      });
    });

    return this.ACTION((): DqlQuery => {
      // LIST/TASK 不接字段列表（与旧实现等价：多余 token 报错）。ACTION 避开 self-analysis 录制。
      if (type !== "TABLE" && fields.length > 0) {
        throw new DqlSyntaxError(`仅 TABLE 支持字段列表，${type} 不接字段`, 0);
      }
      return { type, fields, from, where, groupBy, flatten, withoutId, sort, limit };
    });
  });

  /** TABLE 列：普通字段名，或 GROUP BY 聚合表达式 length(rows) / count()。 */
  tableField = this.RULE("tableField", (): string => {
    return this.OR<string>([
      {
        ALT: () => {
          const fnTok = this.CONSUME(Identifier);
          this.CONSUME(LParen);
          const argTok = this.OPTION(() => this.CONSUME1(Identifier));
          this.CONSUME(RParen);
          return this.ACTION((): string => {
            const fn = fnTok.image.toLowerCase();
            if (fn === "count" && argTok === undefined) return "count()";
            if (argTok === undefined) {
              throw new DqlSyntaxError(`${fnTok.image}() 需要参数`, fnTok.startOffset);
            }
            return `${fn}(${argTok.image.toLowerCase()})`;
          });
        },
      },
      { ALT: () => this.CONSUME2(Identifier).image },
    ]);
  });

  /** FROM 来源：#tag / "folder" / [[link]]。 */
  source = this.RULE("source", (): DqlSource => {
    return this.OR<DqlSource>([
      // 标签体不含 #（与 sql-generator 的 tag 列对齐）。
      { ALT: () => ({ kind: "tag", value: this.CONSUME(Tag).image.slice(1) }) },
      { ALT: () => ({ kind: "folder", value: unquote(this.CONSUME(StringLiteral).image) }) },
      { ALT: () => ({ kind: "link", value: stripWiki(this.CONSUME(WikiLink).image) }) },
    ]);
  });

  orExpr = this.RULE("orExpr", (): WhereExpr => {
    let left = this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(Or);
      const right = this.SUBRULE1(this.andExpr);
      left = { kind: "or", left, right };
    });
    return left;
  });

  andExpr = this.RULE("andExpr", (): WhereExpr => {
    let left = this.SUBRULE(this.notExpr);
    this.MANY(() => {
      this.CONSUME(And);
      const right = this.SUBRULE1(this.notExpr);
      left = { kind: "and", left, right };
    });
    return left;
  });

  notExpr = this.RULE("notExpr", (): WhereExpr => {
    let neg = false;
    this.OPTION(() => {
      this.CONSUME(Not);
      neg = true;
    });
    const inner = this.SUBRULE(this.primary);
    return neg ? { kind: "not", expr: inner } : inner;
  });

  primary = this.RULE("primary", (): WhereExpr => {
    return this.OR<WhereExpr>([
      {
        ALT: () => {
          this.CONSUME(LParen);
          const e = this.SUBRULE(this.orExpr);
          this.CONSUME(RParen);
          return e;
        },
      },
      {
        // Identifier 开头：函数调用 fn(field, arg) 或比较 field op value。
        ALT: () => {
          const headTok = this.CONSUME(Identifier);
          return this.OR1<WhereExpr>([
            {
              ALT: () => {
                // head(field [, arg])：谓词函数(2参)或 scalar 函数(1参)后跟比较。
                this.CONSUME1(LParen);
                const fieldTok = this.CONSUME1(Identifier);
                let predArg: string | undefined;
                this.OPTION(() => {
                  this.CONSUME(Comma);
                  predArg = this.SUBRULE(this.callArg);
                });
                this.CONSUME1(RParen);
                // scalar 函数 fn(field) 后跟 op value（谓词函数无）。
                let scalarOp: string | undefined;
                let scalarVal: string | number | undefined;
                this.OPTION1(() => {
                  scalarOp = this.CONSUME1(Op).image;
                  scalarVal = this.SUBRULE1(this.compareValue);
                });
                // ACTION 包裹：self-analysis 录制阶段不执行，仅实际解析时跑。
                return this.ACTION((): WhereExpr => {
                  const fn = headTok.image.toLowerCase();
                  if (SCALAR_FNS.has(fn)) {
                    if (predArg !== undefined) {
                      throw new DqlSyntaxError(
                        `${headTok.image}() 仅接一个参数`,
                        headTok.startOffset,
                      );
                    }
                    if (
                      scalarOp === undefined ||
                      scalarVal === undefined ||
                      !COMPARE_OPS.has(scalarOp)
                    ) {
                      throw new DqlSyntaxError(
                        `${headTok.image}(x) 须用于比较，如 length(x) > 0`,
                        headTok.startOffset,
                      );
                    }
                    return {
                      kind: "compare",
                      field: fieldTok.image,
                      fn: fn as ScalarFn,
                      op: scalarOp as CompareOp,
                      value: scalarVal,
                    };
                  }
                  // 谓词函数（contains 家族 / regexmatch）：须两参、不接尾随比较。
                  if (fn !== "regexmatch" && !STRING_FNS.has(fn)) {
                    throw new DqlSyntaxError(`不支持的函数: ${headTok.image}`, headTok.startOffset);
                  }
                  if (predArg === undefined) {
                    throw new DqlSyntaxError(`${headTok.image}() 须两个参数`, headTok.startOffset);
                  }
                  if (scalarOp !== undefined) {
                    throw new DqlSyntaxError(
                      `${headTok.image}() 是谓词，不能再接比较`,
                      headTok.startOffset,
                    );
                  }
                  return {
                    kind: "call",
                    fn: fn as StringFn | "regexmatch",
                    field: fieldTok.image,
                    arg: predArg,
                  };
                });
              },
            },
            {
              ALT: () => {
                return this.OR2<WhereExpr>([
                  {
                    // field REGEXP "pattern" → regexmatch(field, pattern)（Dataview 中缀语法）。
                    ALT: () => {
                      this.CONSUME(Regexp);
                      const arg = this.SUBRULE2(this.callArg);
                      return {
                        kind: "call",
                        fn: "regexmatch",
                        field: headTok.image,
                        arg,
                      };
                    },
                  },
                  {
                    ALT: () => {
                      const opTok = this.CONSUME(Op);
                      return this.OR3<WhereExpr>([
                        {
                          // field = null / != null → isnull（S2.15）。
                          ALT: () => {
                            this.CONSUME(Null);
                            return this.ACTION((): WhereExpr => {
                              const op = opTok.image;
                              if (op !== "=" && op !== "!=") {
                                throw new DqlSyntaxError(
                                  "null 仅支持 = / != 比较",
                                  opTok.startOffset,
                                );
                              }
                              return {
                                kind: "isnull",
                                field: headTok.image,
                                negated: op === "!=",
                              };
                            });
                          },
                        },
                        {
                          ALT: () => {
                            const value = this.SUBRULE(this.compareValue);
                            return this.ACTION(
                              (): WhereExpr => ({
                                kind: "compare",
                                field: headTok.image,
                                op: opTok.image as CompareOp,
                                value,
                              }),
                            );
                          },
                        },
                      ]);
                    },
                  },
                ]);
              },
            },
          ]);
        },
      },
    ]);
  });

  /** 函数实参：字符串→字面值；标签→含 #（与旧 argToString 对齐）；链接→内部；数字→原文。 */
  callArg = this.RULE("callArg", (): string => {
    return this.OR<string>([
      { ALT: () => unquote(this.CONSUME(StringLiteral).image) },
      { ALT: () => this.CONSUME(Tag).image },
      { ALT: () => stripWiki(this.CONSUME(WikiLink).image) },
      { ALT: () => this.CONSUME(NumberLiteral).image },
    ]);
  });

  /** 比较值：数字→number；字符串→字面值；标签→标签体(不含#)；链接→内部；date(today/now)→ISO 串。 */
  compareValue = this.RULE("compareValue", (): string | number => {
    return this.OR<string | number>([
      { ALT: () => Number(this.CONSUME(NumberLiteral).image) },
      { ALT: () => unquote(this.CONSUME(StringLiteral).image) },
      { ALT: () => this.CONSUME(Tag).image.slice(1) },
      { ALT: () => stripWiki(this.CONSUME(WikiLink).image) },
      {
        // date(today) / date(now)（S2.17）。
        ALT: () => {
          const fnTok = this.CONSUME(Identifier);
          this.CONSUME(LParen);
          const argTok = this.CONSUME1(Identifier);
          this.CONSUME(RParen);
          return this.ACTION((): string => evalDateFn(fnTok.image, argTok.image));
        },
      },
    ]);
  });

  sortKeys = this.RULE("sortKeys", (): NonNullable<DqlQuery["sort"]> => {
    const keys: NonNullable<DqlQuery["sort"]> = [];
    keys.push(this.SUBRULE(this.sortKey));
    this.MANY(() => {
      this.CONSUME(Comma);
      keys.push(this.SUBRULE1(this.sortKey));
    });
    return keys;
  });

  sortKey = this.RULE("sortKey", (): { field: string; dir: "ASC" | "DESC" } => {
    const field = this.CONSUME(Identifier).image;
    let dir: "ASC" | "DESC" = "ASC";
    this.OPTION(() =>
      this.OR([
        { ALT: () => this.CONSUME(Asc) },
        {
          ALT: () => {
            this.CONSUME(Desc);
            dir = "DESC";
          },
        },
      ]),
    );
    return { field, dir };
  });
}

const parser = new DqlChevParser();

/**
 * 解析一条 DQL 为 DqlQuery（词法 + 语法均带位置报错）。
 *
 * @param dql - 原始 DQL 查询语句
 * @throws DqlSyntaxError 词法/语法不符合子集（携带源串位置）
 *
 * @behavior
 * Given 一条落在冻结子集内的查询（LIST/TABLE/TASK + 各子句）
 * When 解析
 * Then 产出结构化 DqlQuery，子句顺序固定、WHERE 按 OR<AND<NOT<primary 建树
 *
 * @behavior
 * Given 查询含子集外语法、未知函数、或词法非法字符
 * When 解析
 * Then 抛出携带源串位置的 DqlSyntaxError，而非静默修正或返回空结果
 */
export function parseDql(dql: string): DqlQuery {
  const lex = DqlLexer.tokenize(dql);
  if (lex.errors.length > 0) {
    const e = lex.errors[0]!;
    throw new DqlSyntaxError(e.message, e.offset);
  }
  parser.input = lex.tokens;
  const ast = parser.query();
  if (parser.errors.length > 0) {
    const e = parser.errors[0]!;
    const tok = (e as { token?: IToken }).token;
    throw new DqlSyntaxError(e.message, tok?.startOffset ?? 0);
  }
  return ast;
}

/**
 * base 模块表达式 parser：Chevrotain EmbeddedActionsParser，产出 types.ts 的 BaseExpr AST（P1 文法层）。
 *
 * 与 DQL parser（src/query/parser.ts）完全独立的两套 token/AST：Bases 用 `==`/`&&`/`||`/`!`
 * （DQL 用 `=`/`AND`/`OR`/`NOT`），仅借鉴其 Chevrotain 惯用法（ACTION 避开 self-analysis
 * 录制、错误收集在 parser.errors、字符串转义在 parser 层解码），不 import / 复用任何
 * DQL token 或 AST（计划「关键取舍」#3）。
 *
 * 优先级（低 → 高，设计 §7.3 + P2a 计划「关键取舍」#1 延伸）：
 * `||` → `&&` → `== !=` → `< > <= >=` → `+ -` → `* /` → 一元 `!` / `-`
 * → postfix（成员/索引/调用）→ primary（字面量/duration/括号/list/根引用/全局函数调用）。
 * P2a 增量：算术 `+ - * /`（`* /` 高于 `+ -`，均高于比较）与一元 `-`（与 `!` 同级），
 * 即新层级插在单比较与一元之间；duration 字面量为 primary 级（词法层已是单 token）。
 *
 * 上游：P1 planner 逐条解析 BaseFilter.expr 原始字符串（本任务只交付文法层）。
 * 下游：P1 evaluator 消费 BaseExpr；诊断 rule 复用 errors.ts 的 BASE_RULES。
 * 语法真相源：docs/design/bases-syntax.md §4；预算语义：计划「关键取舍」#9。
 */

import { EmbeddedActionsParser, EOF, type IToken } from "chevrotain";
import { BASE_RULES } from "./errors.js";
import { BASE_FUNCTION_NAMES } from "./expressions.js";
import {
  allTokens,
  AndAnd,
  Bang,
  BaseExpressionLexer,
  Comma,
  Dot,
  DurationLiteral,
  EqEq,
  False,
  File,
  Formula,
  Gt,
  Gte,
  Identifier,
  LBracket,
  LParen,
  Lt,
  Lte,
  Minus,
  Note,
  NotEq,
  Null,
  NumberLiteral,
  OrOr,
  Plus,
  RBracket,
  RParen,
  Slash,
  Star,
  StringLiteral,
  This,
  True,
} from "./tokens.js";
import type { BaseDurationUnit, BaseExpr } from "./types.js";

// === 自建实现 ===

/**
 * 嵌套深度硬上限（括号/调用实参/list 每深入一层计一）。
 *
 * 独立于 maxNodes 单列的原因：括号不产 AST 节点，节点预算挡不住 `((((…))))` 深递归；
 * 而本 parser 每层嵌套叠加约 8 层规则递归（expression→orExpr→…→primary），chevrotain
 * 每级 SUBRULE 再叠数帧——实测（node 24，.tmp 探针）括号嵌套约 180 层即 RangeError。
 * 取 128 留约 30% 栈余量：真实 filter 嵌套远低于此，超限报 `base/execution-budget` 而非栈溢出。
 */
const MAX_NESTING_DEPTH = 128;

/** 表达式解析单条错误（rule 三选一；offset 为表达式内 UTF-16 code unit offset，0-based）。 */
export interface BaseExpressionParseError {
  offset: number;
  rule:
    | typeof BASE_RULES.expressionSyntax
    | typeof BASE_RULES.unknownFunction
    | typeof BASE_RULES.executionBudget;
  message: string;
  /** 触发目标（如未知函数名）。 */
  target?: string;
}

/**
 * 表达式解析结果。不 throw：词法/语法/预算/未知函数错误一律经 errors 返回。
 * errors 非空时不返回 expr（半截 AST 不交给 evaluator，避免把错误表达式当合法执行）。
 */
export interface BaseExpressionParseResult {
  expr?: BaseExpr;
  errors: BaseExpressionParseError[];
}

/**
 * 预算耗尽内部信号（节点数或嵌套深度超限）。经 throw 中断解析——chevrotain 的错误
 * 收集机制无法表达「立即停止」，自抛后在入口捕获转 execution-budget 诊断。
 */
class BaseBudgetError extends Error {
  constructor(
    readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 去引号并解码反斜杠转义。支持 `\"` `\\` `\'` `\n` `\t`（语法真相源 §4.3）；
 * 其余 `\X` 取 X 本身（与 Obsidian / DQL 侧 unquote 口径一致：未知转义不报错、不吞字符）。
 * chevrotain 的 StringLiteral image 为原文（含未解码转义），故在此解码。
 */
function decodeString(image: string): string {
  return image.slice(1, -1).replace(/\\(.)/gs, (_m, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    return ch;
  });
}

type BinaryOp = Extract<BaseExpr, { kind: "binary" }>["op"];

/**
 * 拆 duration token image（如 `1.5hours`）为数值与单位。
 * 单位归一为单数枚举：词法层保证 unit ∈ 官方单位表（单/复数），复数仅多一个词尾 `s`，剥掉即可。
 */
function decodeDuration(image: string): { amount: number; unit: BaseDurationUnit } {
  const m = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(image);
  // 词法层已保证形态，exec 失败即实现 bug，不静默兜底。
  if (m === null) throw new Error(`duration token 形态异常：${image}`);
  const rawUnit = m[2] as string;
  const unit = (rawUnit.endsWith("s") ? rawUnit.slice(0, -1) : rawUnit) as BaseDurationUnit;
  return { amount: Number(m[1]), unit };
}

class BaseExprChevParser extends EmbeddedActionsParser {
  /** 以下四个字段由入口在每次解析前重置（parser 实例模块级复用，与 DQL 侧同款）。 */
  private nodeCount = 0;
  private depth = 0;
  private maxNodes = 0;
  private depthLimit = 0;
  /** 未知函数发现（语法合法、名字不在白名单）：收集后继续解析，一次报全。 */
  private unknownFunctions: BaseExpressionParseError[] = [];

  constructor() {
    super(allTokens);
    this.performSelfAnalysis();
  }

  /** 入口重置解析侧状态（chevrotain 自身状态由 `parser.input =` 重置）。 */
  resetState(maxNodes: number): void {
    this.nodeCount = 0;
    this.depth = 0;
    this.maxNodes = maxNodes;
    // 深度上限随节点预算缩窄（更紧的预算理应更早拒），同时不超过栈安全常数。
    this.depthLimit = Math.min(maxNodes, MAX_NESTING_DEPTH);
    this.unknownFunctions = [];
  }

  /** 预算外发现的只读视图（入口在解析后取走）。 */
  getUnknownFunctions(): BaseExpressionParseError[] {
    return this.unknownFunctions;
  }

  /** AST 节点计数 + 预算检查（每产一个节点扣一，超限立即中断解析）。 */
  private spendNode(offset: number): void {
    this.nodeCount += 1;
    if (this.nodeCount > this.maxNodes) {
      throw new BaseBudgetError(
        offset,
        `表达式 AST 节点数超过预算上限 ${this.maxNodes}（防资源耗尽）`,
      );
    }
  }

  /** 进入一层嵌套（括号 / 调用实参 / list 字面量）；超限立即中断解析（防栈溢出）。 */
  private enterDepth(offset: number): void {
    this.depth += 1;
    if (this.depth > this.depthLimit) {
      throw new BaseBudgetError(offset, `表达式嵌套深度超过上限 ${this.depthLimit}（防栈溢出）`);
    }
  }

  private exitDepth(): void {
    this.depth -= 1;
  }

  /**
   * 函数/方法调用名白名单核对（BASE-SEC-002：任意标识符调用在文法层拒绝）。
   * 名字集合单一真相源 = expressions.ts 的 BASE_FUNCTION_NAMES（含旧 snake_case
   * 如 `contains_all` 也报 unknown-function，不静默迁移，语法真相源 §8）。
   */
  private checkFunctionName(nameTok: IToken): void {
    if (!BASE_FUNCTION_NAMES.has(nameTok.image)) {
      this.unknownFunctions.push({
        offset: nameTok.startOffset,
        rule: BASE_RULES.unknownFunction,
        target: nameTok.image,
        message: `未知函数 "${nameTok.image}"（不在 Bases 函数白名单内，见 bases-syntax §4.4）`,
      });
    }
  }

  private literal(tok: IToken, value: null | boolean | number | string): BaseExpr {
    this.spendNode(tok.startOffset);
    return { kind: "literal", offset: tok.startOffset, value };
  }

  private binary(op: BinaryOp, left: BaseExpr, right: BaseExpr): BaseExpr {
    this.spendNode(left.offset);
    return { kind: "binary", op, offset: left.offset, left, right };
  }

  /** 顶层入口：一条表达式 + EOF（多余 token 报错，不允许半截表达式静默截断）。 */
  top = this.RULE("top", (): BaseExpr => {
    const e = this.SUBRULE(this.expression);
    this.CONSUME(EOF);
    return e;
  });

  expression = this.RULE("expression", (): BaseExpr => this.SUBRULE(this.orExpr));

  orExpr = this.RULE("orExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(OrOr);
      const right = this.SUBRULE1(this.andExpr);
      left = this.ACTION(() => this.binary("||", left, right));
    });
    return left;
  });

  andExpr = this.RULE("andExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.eqExpr);
    this.MANY(() => {
      this.CONSUME(AndAnd);
      const right = this.SUBRULE1(this.eqExpr);
      left = this.ACTION(() => this.binary("&&", left, right));
    });
    return left;
  });

  eqExpr = this.RULE("eqExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.relExpr);
    this.MANY(() => {
      const opTok = this.OR([
        { ALT: () => this.CONSUME(EqEq) },
        { ALT: () => this.CONSUME(NotEq) },
      ]);
      const right = this.SUBRULE1(this.relExpr);
      left = this.ACTION(() => this.binary(opTok.image as BinaryOp, left, right));
    });
    return left;
  });

  relExpr = this.RULE("relExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.addExpr);
    this.MANY(() => {
      const opTok = this.OR([
        { ALT: () => this.CONSUME(Lte) },
        { ALT: () => this.CONSUME(Gte) },
        { ALT: () => this.CONSUME(Lt) },
        { ALT: () => this.CONSUME(Gt) },
      ]);
      const right = this.SUBRULE1(this.addExpr);
      left = this.ACTION(() => this.binary(opTok.image as BinaryOp, left, right));
    });
    return left;
  });

  /** 加减层（P2a）：`+ -`，左结合；操作数为乘除层。 */
  addExpr = this.RULE("addExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.mulExpr);
    this.MANY(() => {
      const opTok = this.OR([
        { ALT: () => this.CONSUME(Plus) },
        { ALT: () => this.CONSUME(Minus) },
      ]);
      const right = this.SUBRULE1(this.mulExpr);
      left = this.ACTION(() => this.binary(opTok.image as BinaryOp, left, right));
    });
    return left;
  });

  /** 乘除层（P2a）：`* /`，左结合，高于加减；操作数为一元层。 */
  mulExpr = this.RULE("mulExpr", (): BaseExpr => {
    let left = this.SUBRULE(this.unaryExpr);
    this.MANY(() => {
      const opTok = this.OR([
        { ALT: () => this.CONSUME(Star) },
        { ALT: () => this.CONSUME(Slash) },
      ]);
      const right = this.SUBRULE1(this.unaryExpr);
      left = this.ACTION(() => this.binary(opTok.image as BinaryOp, left, right));
    });
    return left;
  });

  unaryExpr = this.RULE("unaryExpr", (): BaseExpr => {
    return this.OR<BaseExpr>([
      {
        ALT: () => {
          const bang = this.CONSUME(Bang);
          const arg = this.SUBRULE(this.unaryExpr);
          return this.ACTION((): BaseExpr => {
            this.spendNode(bang.startOffset);
            return { kind: "not", offset: bang.startOffset, arg };
          });
        },
      },
      {
        // 一元取负（P2a）：与 `!` 同级、可叠合（`--a`、`-!a` 均可解析，语义由求值层把关）。
        ALT: () => {
          const minus = this.CONSUME(Minus);
          const arg = this.SUBRULE1(this.unaryExpr);
          return this.ACTION((): BaseExpr => {
            this.spendNode(minus.startOffset);
            return { kind: "neg", offset: minus.startOffset, arg };
          });
        },
      },
      { ALT: () => this.SUBRULE2(this.postfixExpr) },
    ]);
  });

  /**
   * postfix：`.name`（member）/ `.name(args)`（方法调用）/ `[expr]`（索引），左结合链式。
   * 只认 `.name(args)` 的静态方法名；`target(expr)` 动态调用不在文法内（设计 §7.2）。
   */
  postfixExpr = this.RULE("postfixExpr", (): BaseExpr => {
    let target = this.SUBRULE(this.primary);
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            const dot = this.CONSUME(Dot);
            const nameTok = this.SUBRULE1(this.memberName);
            let args: BaseExpr[] | undefined;
            this.OPTION(() => {
              this.CONSUME(LParen);
              this.ACTION(() => this.enterDepth(nameTok.startOffset));
              args = this.SUBRULE2(this.callArgs);
              this.CONSUME(RParen);
              this.ACTION(() => this.exitDepth());
            });
            target = this.ACTION((): BaseExpr => {
              this.spendNode(nameTok.startOffset);
              if (args === undefined) {
                return { kind: "member", offset: dot.startOffset, target, name: nameTok.image };
              }
              this.checkFunctionName(nameTok);
              return {
                kind: "call",
                offset: nameTok.startOffset,
                name: nameTok.image,
                receiver: target,
                args,
              };
            });
          },
        },
        {
          ALT: () => {
            const br = this.CONSUME(LBracket);
            this.ACTION(() => this.enterDepth(br.startOffset));
            const index = this.SUBRULE3(this.expression);
            this.CONSUME(RBracket);
            this.ACTION(() => this.exitDepth());
            target = this.ACTION((): BaseExpr => {
              this.spendNode(br.startOffset);
              return { kind: "index", offset: br.startOffset, target, index };
            });
          },
        },
      ]);
    });
    return target;
  });

  primary = this.RULE("primary", (): BaseExpr => {
    return this.OR<BaseExpr>([
      {
        ALT: () => {
          const t = this.CONSUME(Null);
          return this.ACTION(() => this.literal(t, null));
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(True);
          return this.ACTION(() => this.literal(t, true));
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(False);
          return this.ACTION(() => this.literal(t, false));
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(NumberLiteral);
          return this.ACTION(() => this.literal(t, Number(t.image)));
        },
      },
      {
        // duration 字面量（P2a）：词法层单 token，这里只拆数值/单位并归一单数枚举。
        ALT: () => {
          const t = this.CONSUME(DurationLiteral);
          return this.ACTION((): BaseExpr => {
            this.spendNode(t.startOffset);
            const { amount, unit } = decodeDuration(t.image);
            return { kind: "duration", offset: t.startOffset, amount, unit };
          });
        },
      },
      {
        ALT: () => {
          const t = this.CONSUME(StringLiteral);
          return this.ACTION(() => this.literal(t, decodeString(t.image)));
        },
      },
      { ALT: () => this.SUBRULE(this.listLiteral) },
      { ALT: () => this.SUBRULE1(this.parenExpr) },
      { ALT: () => this.SUBRULE2(this.rootRef) },
      { ALT: () => this.SUBRULE3(this.identifierPrimary) },
    ]);
  });

  listLiteral = this.RULE("listLiteral", (): BaseExpr => {
    const open = this.CONSUME(LBracket);
    this.ACTION(() => this.enterDepth(open.startOffset));
    const items: BaseExpr[] = [];
    this.OPTION(() => {
      items.push(this.SUBRULE(this.expression));
      this.MANY(() => {
        this.CONSUME(Comma);
        items.push(this.SUBRULE1(this.expression));
      });
    });
    this.CONSUME(RBracket);
    this.ACTION(() => this.exitDepth());
    return this.ACTION((): BaseExpr => {
      this.spendNode(open.startOffset);
      return { kind: "list", offset: open.startOffset, items };
    });
  });

  /** 括号分组：不产 AST 节点（只改优先级），但计嵌套深度（防 `((((…))))` 栈溢出）。 */
  parenExpr = this.RULE("parenExpr", (): BaseExpr => {
    const open = this.CONSUME(LParen);
    this.ACTION(() => this.enterDepth(open.startOffset));
    const inner = this.SUBRULE(this.expression);
    this.CONSUME(RParen);
    this.ACTION(() => this.exitDepth());
    return inner;
  });

  /**
   * 根引用：`note` / `file` / `formula` / `this`，可选首段 `.name` 或 `["名字"]` 归入
   * property.path（语法真相源 §4.1）。更深段落与后续调用由 postfix 生成 member/index/call。
   *
   * 2026-07-28 覆盖率片三增量：根 token 后直接跟 `(` 视为**全局函数调用**，使 `file("a.md")`
   * 可解析——`file` 是关键字 token，不走 identifierPrimary 那条调用分支，不在此处开口子就
   * 只能得到「Expecting EOF but found '('」这种与用户意图无关的语法错误。
   * `note(` / `formula(` / `this(` 同样进入该分支，但名字不在白名单内 → `base/unknown-function`
   * （与任意未知标识符调用同一口径，不额外造一条诊断）。
   */
  rootRef = this.RULE("rootRef", (): BaseExpr => {
    const rootTok = this.OR([
      { ALT: () => this.CONSUME(Note) },
      { ALT: () => this.CONSUME(File) },
      { ALT: () => this.CONSUME(Formula) },
      { ALT: () => this.CONSUME(This) },
    ]);
    // ⚠ 本规则必须**单出口**：chevrotain 的语法录制阶段会真的执行 OPTION 的 DEF，
    // 若在此处按 callArgs 提前 return，后半段（属性路径 OPTION）就永远不会被录进语法，
    // 运行期报「Cannot read properties of undefined (reading 'call')」——曾实测踩到。
    let callArgs: BaseExpr[] | undefined;
    this.OPTION2({
      GATE: () => this.LA(1).tokenType === LParen,
      DEF: () => {
        this.CONSUME(LParen);
        this.ACTION(() => this.enterDepth(rootTok.startOffset));
        callArgs = this.SUBRULE(this.callArgs);
        this.CONSUME(RParen);
        this.ACTION(() => this.exitDepth());
      },
    });
    let firstSeg: string | undefined;
    this.OPTION({
      // GATE 两件事：
      // ① 已消费调用实参时不得再吞属性路径——`file("a").path` 的 `.path` 归 postfix 的
      //    member 分支，否则会被误并进根引用的 property.path；
      // ② `.name(` 形态是方法调用（如 `file.hasTag("area")` 的 hasTag），不得吞进属性路径，
      //    留给 postfix 生成 call(receiver=property(file,[]))。此处 LA(1)=`.`、LA(3)=`(`。
      GATE: () =>
        callArgs === undefined &&
        !(this.LA(1).tokenType === Dot && this.LA(3).tokenType === LParen),
      DEF: () => {
        this.OR1([
          {
            ALT: () => {
              this.CONSUME(Dot);
              const nameTok = this.SUBRULE(this.memberName);
              this.ACTION(() => {
                firstSeg = nameTok.image;
              });
            },
          },
          {
            ALT: () => {
              this.CONSUME(LBracket);
              const s = this.CONSUME(StringLiteral);
              this.CONSUME(RBracket);
              this.ACTION(() => {
                firstSeg = decodeString(s.image);
              });
            },
          },
        ]);
      },
    });
    return this.ACTION((): BaseExpr => {
      this.spendNode(rootTok.startOffset);
      if (callArgs !== undefined) {
        this.checkFunctionName(rootTok);
        return {
          kind: "call",
          offset: rootTok.startOffset,
          name: rootTok.image,
          receiver: null,
          args: callArgs,
        };
      }
      return {
        kind: "property",
        offset: rootTok.startOffset,
        base: rootTok.image as "note" | "file" | "formula" | "this",
        path: firstSeg === undefined ? [] : [firstSeg],
      };
    });
  });

  /**
   * 标识符 primary：后随 `(` → 全局函数调用（白名单核对）；否则为 note property 简写
   * （裸 `status` → base "note"，语法真相源 §4.1）。
   */
  identifierPrimary = this.RULE("identifierPrimary", (): BaseExpr => {
    const nameTok = this.CONSUME(Identifier);
    let args: BaseExpr[] | undefined;
    this.OPTION(() => {
      this.CONSUME(LParen);
      this.ACTION(() => this.enterDepth(nameTok.startOffset));
      args = this.SUBRULE(this.callArgs);
      this.CONSUME(RParen);
      this.ACTION(() => this.exitDepth());
    });
    return this.ACTION((): BaseExpr => {
      this.spendNode(nameTok.startOffset);
      if (args === undefined) {
        return {
          kind: "property",
          offset: nameTok.startOffset,
          base: "note",
          path: [nameTok.image],
        };
      }
      this.checkFunctionName(nameTok);
      return {
        kind: "call",
        offset: nameTok.startOffset,
        name: nameTok.image,
        receiver: null,
        args,
      };
    });
  });

  /** 调用实参列表（可空）：`()` / `(a)` / `(a, b, …)`；不允许尾逗号。 */
  callArgs = this.RULE("callArgs", (): BaseExpr[] => {
    const args: BaseExpr[] = [];
    this.OPTION(() => {
      args.push(this.SUBRULE(this.expression));
      this.MANY(() => {
        this.CONSUME(Comma);
        args.push(this.SUBRULE1(this.expression));
      });
    });
    return args;
  });

  /**
   * 点号后的成员名：允许关键字（`note.true`、`file.note` 等）。
   * 词法层关键字先于 Identifier 匹配，文法层须显式回收，否则这些合法属性名被误判语法错误。
   */
  memberName = this.RULE("memberName", (): IToken => {
    return this.OR<IToken>([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(Note) },
      { ALT: () => this.CONSUME(File) },
      { ALT: () => this.CONSUME(Formula) },
      { ALT: () => this.CONSUME(This) },
      { ALT: () => this.CONSUME(Null) },
      { ALT: () => this.CONSUME(True) },
      { ALT: () => this.CONSUME(False) },
    ]);
  });
}

const parser = new BaseExprChevParser();

/** chevrotain 语法错误的 token 定位：EOF 等合成 token 的 startOffset 可能为 NaN。 */
function errorOffset(e: unknown): number {
  const tok = (e as { token?: IToken }).token;
  const off = tok?.startOffset;
  // 无法精确定位时给 0（如实降级，不伪造位置）。
  return typeof off === "number" && !Number.isNaN(off) ? off : 0;
}

/**
 * 解析一条 Bases 表达式为 BaseExpr AST（不 throw；错误一律经 errors 返回）。
 *
 * @param exprSource - filter 表达式原始字符串（只扫表达式本身，不感知 YAML/文件；
 *   完整文件位置由调用方叠加 YAML scalar 起点换算，同 P0 浅扫描口径）
 * @param maxNodes - AST 节点数上限（{@link BaseExecutionLimits.maxExpressionNodes}）；
 *   嵌套深度上限同步取 min(maxNodes, 256)
 * @returns errors 为空时 expr 必存在；errors 非空时不返回 expr
 *
 * @behavior
 * Given 落在文法子集内的表达式（字面量/属性引用/运算符/白名单调用/list/括号）
 * When parseBaseExpression
 * Then 产出带 offset 的 BaseExpr，优先级符合设计 §7.3
 *
 * @behavior
 * Given 白名单外调用名（含旧 snake_case 如 contains_all）
 * When parseBaseExpression
 * Then 产出 base/unknown-function（offset 指向名字起点，target=名字），不静默迁移
 *
 * @behavior
 * Given 词法/语法非法（未闭合字符串、缺右操作数、多余 token）
 * When parseBaseExpression
 * Then 产出 base/expression-syntax（offset 尽量指向出错 token，无法定位时给 0）
 *
 * @behavior
 * Given AST 节点数超 maxNodes 或嵌套深度超 min(maxNodes, 256)
 * When parseBaseExpression
 * Then 产出 base/execution-budget 并停止解析，不栈溢出、不返回半截 AST
 */
export function parseBaseExpression(
  exprSource: string,
  maxNodes: number,
): BaseExpressionParseResult {
  const errors: BaseExpressionParseError[] = [];

  const lex = BaseExpressionLexer.tokenize(exprSource);
  for (const e of lex.errors) {
    // 词法错误（如未闭合字符串：StringLiteral 整体失配，落在引号位置报 unexpected character）。
    errors.push({
      offset: typeof e.offset === "number" && !Number.isNaN(e.offset) ? e.offset : 0,
      rule: BASE_RULES.expressionSyntax,
      message: `表达式词法错误：${e.message}`,
    });
  }
  if (errors.length > 0) return { errors };

  parser.resetState(maxNodes);
  parser.input = lex.tokens;

  let expr: BaseExpr | undefined;
  try {
    expr = parser.top();
  } catch (e) {
    if (e instanceof BaseBudgetError) {
      // 预算耗尽：连同已收集的未知函数发现一并返回，不返回半截 AST。
      return {
        errors: [
          ...parser.getUnknownFunctions(),
          { offset: e.offset, rule: BASE_RULES.executionBudget, message: e.message },
        ],
      };
    }
    throw e; // 非预算异常属于实现 bug，不吞
  }

  // chevrotain（v12，recovery 默认关闭）语法错误不抛出：收集在 parser.errors，规则返回 undefined。
  for (const e of parser.errors) {
    errors.push({
      offset: errorOffset(e),
      rule: BASE_RULES.expressionSyntax,
      message: `表达式语法错误：${e.message}`,
    });
  }
  // 未知函数不影响语法合法性，已随解析全程收集，一并报出。
  errors.push(...parser.getUnknownFunctions());

  if (errors.length > 0) return { errors };
  return { expr, errors: [] };
}

/**
 * base 模块表达式词法：Chevrotain token 定义 + Lexer（P1 文法层）。
 *
 * 与 DQL 词法（src/query/tokens.ts）完全独立的两套 token：Bases 用 `==`/`&&`/`||`/`!`
 * （DQL 用 `=`/`AND`/`OR`/`NOT`），仅借鉴其 Chevrotain 惯用法，不 import / 复用任何
 * DQL token（计划「关键取舍」#3）。regex、Link/File 构造字面量不在文法内（设计 §7.2）；
 * P2a 增量：算术 `+ - * /`、一元 `-`、duration 字面量（P2a 计划「关键取舍」#1）。
 *
 * 上游：src/base/parser.ts 消费 allTokens / BaseExpressionLexer。
 * 下游：产出 IToken[] 交 parser；token 的 startOffset 即表达式内 UTF-16 offset（诊断定位用）。
 * 语法真相源：docs/design/bases-syntax.md §4。
 */

import { createToken, Lexer } from "chevrotain";

// === Obsidian 规范来源: Bases 表达式标识符取 Unicode 字母或 `_` 开头、后续可含 Unicode 字母/数字/`_` ===
// （Unicode 属性名场景 BASE-PROP-003，与 P0 浅扫描 src/base/expressions.ts 的 IDENT_START/IDENT_PART 口径一致。）
// chevrotain 对带 u flag 的 \p{} 正则 pattern 在首字符优化阶段失配（DQL 侧 spike + S2.3 实测），
// 故用自定义匹配函数 + sticky 正则手动扫描，绕开该限制。
const IDENT_BODY = /[\p{L}_][\p{L}\p{N}_]*/uy;
const matchIdentifier = (text: string, startOffset: number): [string] | null => {
  IDENT_BODY.lastIndex = startOffset;
  const m = IDENT_BODY.exec(text);
  // sticky 保证从 startOffset 起连续匹配；m.index 必为 startOffset，否则不是标识符起点。
  if (m === null || m.index !== startOffset) return null;
  return [m[0]];
};

/** 标识符：属性名（`status`、`状态`）与函数/方法名（`if`、`contains`）；函数性由 parser 据后随 `(` 判定。 */
export const Identifier = createToken({
  name: "Identifier",
  pattern: matchIdentifier,
  line_breaks: false,
});

// === Obsidian 规范来源: Bases 字面量关键字 null/true/false 与根引用关键字 note/file/formula/this ===
// 均为小写精确匹配（Bases 关键字大小写敏感，与 DQL 大小写不敏感关键字不同——两套词法独立）。
// longer_alt 回退到 Identifier，避免吞掉以关键字为前缀的标识符（如 `nullable`、`notebook`
// 不应被识别为 Null/Note）。allTokens 中关键字须在 Identifier 之前，回退才生效。
const keyword = (name: string, word: string) =>
  createToken({ name, pattern: new RegExp(word), longer_alt: Identifier });

/** `null` 字面量关键字。 */
export const Null = keyword("Null", "null");
/** `true` 布尔字面量关键字。 */
export const True = keyword("True", "true");
/** `false` 布尔字面量关键字。 */
export const False = keyword("False", "false");
/** `note` 根引用关键字（note property 显式形态 `note.status` / `note["…"]`）。 */
export const Note = keyword("Note", "note");
/** `file` 根引用关键字（file property，如 `file.name`）。 */
export const File = keyword("File", "file");
/** `formula` 根引用关键字（P1 语法接受、evaluator 拒绝，计划「关键取舍」#4）。 */
export const Formula = keyword("Formula", "formula");
/** `this` 根引用关键字（动态上下文，P1 语法接受、evaluator 拒绝）。 */
export const This = keyword("This", "this");

/** 字符串字面量：单/双引号，反斜杠转义下一字符；转义解码（`\n` `\t` 等）在 parser 层。 */
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});

/** 数字字面量：整数 / 小数；无负号（负号是一元 `-` 运算，P2a 起在 parser 层）、无科学计数法（设计 §7.1 子集）。 */
export const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /\d+(?:\.\d+)?/ });

// === Obsidian 规范来源: Bases duration 字面量单位表（语法真相源 §4.3，对齐官方 duration 单位：
// millisecond/second/minute/hour/day/week/month/year，单复数形态均可）===
// <number><unit> 词法层单 token（如 `1day`、`1.5hours`），P2a 计划「关键取舍」#1。
// 自定义匹配函数（同 Identifier 的理由：绕开 chevrotain 首字符优化限制，且需检查后随字符）。
const DURATION_BODY =
  /\d+(?:\.\d+)?(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?|months?|years?)/uy;
const IDENT_PART_CHAR = /[\p{L}\p{N}_]/u;
const matchDuration = (text: string, startOffset: number): [string] | null => {
  DURATION_BODY.lastIndex = startOffset;
  const m = DURATION_BODY.exec(text);
  if (m === null || m.index !== startOffset) return null;
  // 单位后紧跟标识符字符（如 `1dayfoo`）不视为 duration 字面量：整串退回 Number+Identifier
  // 分支，最终在 parser 层报语法错误，而不是静默截成 `1day` + `foo` 两个 token。
  const next = text[startOffset + m[0].length];
  if (next !== undefined && IDENT_PART_CHAR.test(next)) return null;
  return [m[0]];
};

/**
 * duration 字面量：`<number><unit>`（如 `1day`、`2weeks`、`1.5hours`）。
 * 必须在 allTokens 中先于 NumberLiteral——chevrotain 按声明顺序取首个匹配，
 * 否则 `1day` 会被截成数字 `1` + 标识符 `day`。
 */
export const DurationLiteral = createToken({
  name: "DurationLiteral",
  pattern: matchDuration,
  line_breaks: false,
});

// === Obsidian 规范来源: Bases 运算符 `&&` `||` `==` `!=` `<` `>` `<=` `>=` `!`（语法真相源 §4.3）===
// 多字符运算符须在 allTokens 中先于其单字符前缀（`!=` 先于 `!`、`<=` 先于 `<`），
// 否则 `!=` 会被截断成 `!` + `=`。
/** 逻辑与 `&&`。 */
export const AndAnd = createToken({ name: "AndAnd", pattern: /&&/ });
/** 逻辑或 `||`。 */
export const OrOr = createToken({ name: "OrOr", pattern: /\|\|/ });
/** 相等 `==`（注意：Bases 无单 `=`，DQL 的 `=` 在本文法是词法错误）。 */
export const EqEq = createToken({ name: "EqEq", pattern: /==/ });
/** 不等 `!=`。 */
export const NotEq = createToken({ name: "NotEq", pattern: /!=/ });
/** 小于等于 `<=`。 */
export const Lte = createToken({ name: "Lte", pattern: /<=/ });
/** 大于等于 `>=`。 */
export const Gte = createToken({ name: "Gte", pattern: />=/ });
/** 小于 `<`。 */
export const Lt = createToken({ name: "Lt", pattern: /</ });
/** 大于 `>`。 */
export const Gt = createToken({ name: "Gt", pattern: />/ });
/** 一元真值取反 `!`（`!=` 由 NotEq 先吃，孤立 `!` 才落到本 token）。 */
export const Bang = createToken({ name: "Bang", pattern: /!/ });

// === Obsidian 规范来源: Bases 算术运算符 `+` `-` `*` `/`（语法真相源 §4.3，P2a 增量）===
/** 加 `+`（number 四则 / date|datetime + duration / duration + duration，语义在 values.ts）。 */
export const Plus = createToken({ name: "Plus", pattern: /\+/ });
/** 减 `-`（二元减与一元取负共用本 token，parser 层按位置区分）。 */
export const Minus = createToken({ name: "Minus", pattern: /-/ });
/** 乘 `*`。 */
export const Star = createToken({ name: "Star", pattern: /\*/ });
/** 除 `/`。 */
export const Slash = createToken({ name: "Slash", pattern: /\// });

/** 左圆括号：分组与调用实参列表。 */
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
/** 右圆括号，与 LParen 配对闭合。 */
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
/** 左方括号：list 字面量与 `["属性名"]` / `[index]` 访问。 */
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
/** 右方括号，与 LBracket 配对闭合。 */
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
/** 逗号：list 元素与调用实参分隔。 */
export const Comma = createToken({ name: "Comma", pattern: /,/ });
/** 点：成员访问 / 方法调用 / 根引用首段。 */
export const Dot = createToken({ name: "Dot", pattern: /\./ });

/** 空白 token（匹配后跳过不入 token 流）。 */
export const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /\s+/, group: Lexer.SKIPPED });

/**
 * Chevrotain Lexer 的有序 token 列表（顺序即优先级，不可随意调整）：
 * 空白先跳过；关键字须在 Identifier 前（longer_alt 回退生效的前提）；
 * 多字符运算符先得其单字符前缀；Identifier 兜底放最后。顺序是词法正确性的结构保证。
 */
export const allTokens = [
  WhiteSpace,
  Null,
  True,
  False,
  Note,
  File,
  Formula,
  This,
  StringLiteral,
  DurationLiteral, // 必须先于 NumberLiteral（chevrotain 取首个匹配，`1day` 不可截成 1 + day）
  NumberLiteral,
  AndAnd,
  OrOr,
  EqEq,
  NotEq,
  Lte,
  Gte,
  Lt,
  Gt,
  Bang,
  Plus,
  Minus,
  Star,
  Slash,
  LParen,
  RParen,
  LBracket,
  RBracket,
  Comma,
  Dot,
  Identifier,
];

/** 全程位置追踪，token 的 startOffset 供诊断定位（表达式内 UTF-16 offset）。 */
export const BaseExpressionLexer = new Lexer(allTokens, { positionTracking: "full" });

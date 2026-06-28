import { createToken, Lexer, type ILexingResult } from "chevrotain";

// === 自建实现: DQL 词法（chevrotain lexer，替代手写 tokenizer，不依赖 obsidian-dataview）===
//
// 上游：DqlParser（S2.4+）；下游：产出 IToken[] 交 parser。
// 关键字大小写不敏感，用 longer_alt: Identifier 回退，避免吞掉以关键字为前缀的标识符
// （如 "listing" 不应被识别为 List）。多词关键字（GROUP BY / WITHOUT ID）拆为两 token，组合在 parser 层。

/** 标识符：字段路径（file.tags）与函数名（contains/date）。函数性由 parser 据后随 `(` 判定。 */
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[A-Za-z_][A-Za-z0-9_.]*/,
});

/** 关键字工厂：大小写不敏感 + longer_alt 回退到 Identifier。 */
const keyword = (name: string, word: string) =>
  createToken({ name, pattern: new RegExp(word, "i"), longer_alt: Identifier });

/** `null` 字面量关键字 token（用于 `= null` / `!= null`）；须在 Identifier 前定义，否则被 longer_alt 回退吞掉。 */
export const Null = keyword("Null", "null");
/** `LIST` 查询类型关键字。 */
export const List = keyword("List", "list");
/** `TABLE` 查询类型关键字（后接字段列表）。 */
export const Table = keyword("Table", "table");
/** `TASK` 查询类型关键字（返回任务行而非文件行）。 */
export const Task = keyword("Task", "task");
/** `FROM` 子句关键字。 */
export const From = keyword("From", "from");
/** `WHERE` 子句关键字。 */
export const Where = keyword("Where", "where");
/** `AND` 逻辑操作符关键字。 */
export const And = keyword("And", "and");
/** `OR` 逻辑操作符关键字。 */
export const Or = keyword("Or", "or");
/** `NOT` 逻辑取反关键字。 */
export const Not = keyword("Not", "not");
/** `SORT` 子句关键字（支持多键排序）。 */
export const Sort = keyword("Sort", "sort");
/** `ASC` 升序方向关键字（省略时默认升序）。 */
export const Asc = keyword("Asc", "asc");
/** `DESC` 降序方向关键字。 */
export const Desc = keyword("Desc", "desc");
/** `LIMIT` 子句关键字（结果行数上限，负数在 parser 层报错）。 */
export const Limit = keyword("Limit", "limit");
/** `GROUP` 关键字，与 `By` 组合为 `GROUP BY` 子句。 */
export const Group = keyword("Group", "group");
/** `BY` 关键字，与 `Group` 组合为 `GROUP BY`；单独出现无意义。 */
export const By = keyword("By", "by");
/** `FLATTEN` 子句关键字（将数组字段展开为多行）。 */
export const Flatten = keyword("Flatten", "flatten");
/** `WITHOUT` 关键字，与 `Id` 组合为 `WITHOUT ID`。 */
export const Without = keyword("Without", "without");
/** `ID` 关键字，与 `Without` 组合为 `WITHOUT ID`（隐藏默认 file.link 列）。 */
export const Id = keyword("Id", "id");

// === Obsidian 规范来源: 标签体取 Unicode 字母/数字/下划线/连字符/斜杠（嵌套）===
// chevrotain 对带 u flag 的 \p{} unicode pattern 在首字符优化阶段失配（spike + S2.3 实测），
// 故用自定义匹配函数 + sticky 正则手动从 '#' 后扫描标签体，绕开该限制。start_chars_hint 提供优化提示。
const TAG_BODY = /[\p{L}\p{N}_/-]+/uy;
const matchTag = (text: string, startOffset: number): [string] | null => {
  if (text[startOffset] !== "#") return null;
  TAG_BODY.lastIndex = startOffset + 1;
  const m = TAG_BODY.exec(text);
  // sticky 保证从 startOffset+1 起连续匹配；m.index 必为 startOffset+1，否则视为空标签。
  if (m === null || m.index !== startOffset + 1) return null;
  return [text.slice(startOffset, startOffset + 1 + m[0].length)];
};
/**
 * `#tag` token（含嵌套标签如 `#项目/子项`）：使用 `matchTag` 自定义函数，
 * 绕开 chevrotain 对 Unicode `\p{}` 首字符优化的 sticky 失配限制
 * （详见上方 Obsidian 规范来源注释）。
 */
export const Tag = createToken({
  name: "Tag",
  pattern: matchTag,
  start_chars_hint: ["#"],
  line_breaks: false,
});

/** `[[link]]`：取整段原文（含锚点/别名），由 sql-generator 再行剥离。内部不含 `]`。 */
export const WikiLink = createToken({ name: "WikiLink", pattern: /\[\[[^\]]*\]\]/ });

/** 字符串字面量：单/双引号，反斜杠转义下一字符。 */
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
});

/** 数字：整数 / 负数 / 小数（DQL 子集无减法运算，前导 `-` 仅作符号）。 */
export const NumberLiteral = createToken({ name: "NumberLiteral", pattern: /-?\d+(?:\.\d+)?/ });

/** 比较操作符：多字符（!= <= >=）在正则交替中先于单字符，避免被截断。 */
export const Op = createToken({ name: "Op", pattern: /!=|<=|>=|=|<|>/ });

/** 左括号 token，用于分组条件与函数调用。 */
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
/** 右括号 token，与 LParen 配对闭合。 */
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
/** 逗号 token，分隔 TABLE 字段列表与多键 SORT 排序键。 */
export const Comma = createToken({ name: "Comma", pattern: /,/ });
/** 空白 token（匹配后跳过不入 token 流）。 */
export const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /\s+/, group: Lexer.SKIPPED });

/**
 * chevrotain Lexer 的有序 token 列表（顺序即优先级，不可随意调整）：
 * 空白先跳过；关键字（含 Null）须在 Identifier 前，确保 longer_alt 回退生效；
 * Identifier 兜底放最后。顺序是 DQL 词法正确性的结构保证。
 */
export const allTokens = [
  WhiteSpace,
  List, Table, Task, From, Where, And, Or, Not, Sort, Asc, Desc, Limit,
  Group, By, Flatten, Without, Id, Null,
  Tag, WikiLink, StringLiteral, NumberLiteral, Op, LParen, RParen, Comma,
  Identifier,
];

/** 全程位置追踪，便于把词法错误定位到 offset/line/column。 */
export const DqlLexer = new Lexer(allTokens, { positionTracking: "full" });

/**
 * 词法分析：把 DQL 串切为 token 流。
 *
 * @param dql - 原始 DQL 查询语句
 * @returns chevrotain 词法结果（tokens + errors，errors 携带 offset/line/column）
 *
 * @behavior
 * Given 以关键字为前缀的标识符（如 "listing"、"forms"）
 * When 词法切分
 * Then 整体回退为 Identifier，不被吞成 List/From 关键字（longer_alt）
 *
 * @behavior
 * Given 含 Unicode 字母的嵌套标签（如 #项目/进行中）
 * When 词法切分
 * Then 完整识别为单个 Tag 记号（自定义匹配绕开 \p{} 首字符优化失配）
 *
 * @behavior
 * Given 串中出现子集外的非法字符或未闭合字符串
 * When 词法切分
 * Then 结果 errors 非空，每条携带 offset/line/column 供定位
 */
export function tokenizeDql(dql: string): ILexingResult {
  return DqlLexer.tokenize(dql);
}

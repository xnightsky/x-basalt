/**
 * base 模块表达式浅扫描：手写最小 tokenizer，只做「函数调用名白名单核对 + tokenizer 失败检测」。
 *
 * P0 不建完整表达式文法（Chevrotain parser / AST / evaluator 属 P1，见设计 §7）。
 * 本文件只做两件事（计划「关键取舍」#1 拍板）：
 *   1. 收集 `标识符(` 形态的调用名与其 UTF-16 offset，对照设计 §9 白名单名字集合；
 *      未知名（含旧版 snake_case 如 `contains_all`）→ `base/unknown-function`。
 *   2. tokenizer 自身失败（如未闭合字符串）→ `base/expression-syntax`。
 * 字符串字面量内容被跳过（其内 `foo(` 不误报）；括号配平、运算符文法留给 P1 parser。
 *
 * 上游：src/base/document.ts 对每个 filter 表达式字符串调用。
 * 下游：P1 函数注册表落地后复用 {@link BASE_FUNCTION_NAMES} 同一名单，避免两处漂移。
 */

import { BASE_RULES } from "./errors.js";

// === Obsidian 规范来源: Bases 表达式函数白名单名字集合（设计 §9，对齐官方 Bases 函数清单）===
// 单一真相源：P1 functions.ts 注册表必须复用本集合，不得另抄一份。
/** 设计 §9 白名单函数/方法名集合（P0 只核对名字，不核对 receiver 类型与参数个数）。 */
export const BASE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  // global
  "if",
  "list",
  "number",
  // any
  "isTruthy",
  "isType",
  "toString",
  // string / list
  "contains",
  "containsAll",
  "containsAny",
  "startsWith",
  "endsWith",
  "lower",
  "trim",
  // list / object
  "isEmpty",
  "keys",
  "values",
  // file
  "hasTag",
  "inFolder",
  "hasLink",
  "hasProperty",
  // time（P2a 增量：today/now 从 ctx 注入 clock 读时，测试必须注入固定 clock——FORM-006）
  "today",
  "now",
  // list 高阶方法（P2b 片一，BASE-LIST-001）：receiver=list。
  // 注意：`sort` 是 list 方法名，与 view 的 sort 配置（BaseViewSort）无关，两处不共享语义。
  "filter",
  "map",
  "reduce",
  "flat",
  "sort",
  "unique",
  "join",
  // list 聚合 / number 舍入（P2b 片三，BASE-SUM-001 / SUM-002）：
  // 官方自定义汇总示例 `values.mean().round(3)` 必需；mean receiver=list，round receiver=number。
  "mean",
  "round",
]);

// === 自建实现: 最小 tokenizer（P0 浅扫描，非完整文法）===

/** 浅扫描发现：rule + 表达式内 UTF-16 offset（由 document.ts 换算为完整文件行列）。 */
export interface ExpressionScanFinding {
  rule:
    | typeof BASE_RULES.unknownFunction
    | typeof BASE_RULES.expressionSyntax
    | typeof BASE_RULES.executionBudget;
  /** 表达式内 UTF-16 code unit offset（0-based；完整文件位置 = YAML scalar 起点 + 本 offset）。 */
  offset: number;
  /** 触发目标（如未知函数名）。 */
  target?: string;
  message: string;
}

// 标识符允许 Unicode 字母（Unicode 属性名场景 BASE-PROP-003）；数字/下划线可出现在后续位。
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;
const DIGIT = /[0-9]/;
const WHITESPACE = /\s/;

/**
 * 浅扫描一个表达式字符串：核对函数调用名白名单、检测 tokenizer 失败、扣 token 预算。
 *
 * 只扫表达式本身，不感知 YAML/文件；位置一律以表达式内 UTF-16 offset 返回，
 * 由调用方（document.ts）叠加 YAML scalar 起点换算完整文件行列（设计 §11 位置规则）。
 *
 * @param expr - filter 表达式原始字符串
 * @param maxTokens - token 数上限（{@link BaseDocumentLimits.maxExpressionNodes}）
 * @returns 扫描发现列表；token 预算耗尽后立即停止扫描
 *
 * @behavior
 * Given 表达式含白名单外调用名（含旧版 snake_case 如 contains_all）
 * When scanExpression
 * Then 产出 base/unknown-function（offset 指向函数名起点），不静默迁移
 *
 * @behavior
 * Given 字符串字面量内含 `foo(` 形态文本
 * When scanExpression
 * Then 不产生 unknown-function（tokenizer 跳过字符串内容）
 *
 * @behavior
 * Given 未闭合的字符串字面量
 * When scanExpression
 * Then 产出 base/expression-syntax（offset 指向字符串起点）
 *
 * @behavior
 * Given token 数超过 maxTokens
 * When scanExpression
 * Then 产出 base/execution-budget 并停止扫描，不返回部分扫描结果冒充成功
 */
export function scanExpression(expr: string, maxTokens: number): ExpressionScanFinding[] {
  const findings: ExpressionScanFinding[] = [];
  let tokens = 0;
  let i = 0;

  // token 计数与预算检查合一：任何一类 token 产出前先扣预算。
  const spendToken = (offset: number): boolean => {
    tokens += 1;
    if (tokens > maxTokens) {
      findings.push({
        rule: BASE_RULES.executionBudget,
        offset,
        message: `表达式 token 数超过预算上限 ${maxTokens}（防资源耗尽）`,
      });
      return false;
    }
    return true;
  };

  while (i < expr.length) {
    const ch = expr[i] as string;

    if (WHITESPACE.test(ch)) {
      i += 1;
      continue;
    }

    // 字符串字面量：整段作为一个 token 跳过内容（内部 `foo(` 不误报）。
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      let closed = false;
      while (i < expr.length) {
        if (expr[i] === "\\") {
          i += 2; // 跳过转义对（如 \" \\），不细究转义合法性（P1 parser 职责）
          continue;
        }
        if (expr[i] === ch) {
          closed = true;
          i += 1;
          break;
        }
        i += 1;
      }
      if (!closed) {
        findings.push({
          rule: BASE_RULES.expressionSyntax,
          offset: start,
          message: "字符串字面量未闭合",
        });
        return findings; // tokenizer 失败即终止：后续 token 流已不可信
      }
      if (!spendToken(start)) return findings;
      continue;
    }

    if (DIGIT.test(ch)) {
      const start = i;
      while (i < expr.length && (DIGIT.test(expr[i] as string) || expr[i] === ".")) i += 1;
      if (!spendToken(start)) return findings;
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      while (i < expr.length && IDENT_PART.test(expr[i] as string)) i += 1;
      const name = expr.slice(start, i);
      if (!spendToken(start)) return findings;
      // `标识符(`（允许中间空白）视为函数/方法调用，名字必须在白名单集合内。
      let j = i;
      while (j < expr.length && WHITESPACE.test(expr[j] as string)) j += 1;
      if (expr[j] === "(" && !BASE_FUNCTION_NAMES.has(name)) {
        findings.push({
          rule: BASE_RULES.unknownFunction,
          offset: start,
          target: name,
          message: `未知函数 "${name}"（不在 Bases 白名单内）`,
        });
      }
      continue;
    }

    // 其余字符一律按单字符运算符/括号 token 处理（P0 不区分 == / && 等多字符运算符）。
    if (!spendToken(i)) return findings;
    i += 1;
  }

  return findings;
}

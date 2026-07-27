/**
 * base 模块公共出口（P0 文档层 + P1 表达式文法层 + P1 求值层 + P1 执行引擎）。
 *
 * P0：文档/schema/诊断 API（loadBaseDocument / selectView / 类型 / rule 常量 / 表达式浅扫描）；
 * P1 文法层：BaseExpr AST + parseBaseExpression（tokens.ts / parser.ts）；
 * P1 求值层：运行时值语义（values.ts）+ 函数白名单注册表（functions.ts）+ 预算解释器（evaluator.ts）；
 * P1 执行引擎：SQLite → BaseRow（source.ts）+ view/filter 编译计划（planner.ts）+ BaseEngine（engine.ts）；
 * P2b 片二：`.obsidian/types.json` 可选只读显式类型表（typeschema.ts，BASE-TYPE-001..003）；
 * P2b 片三：view groupBy 分组 + view/顶层 summaries 汇总（summaries.ts 内置 15 名，
 * BASE-GROUP-001 / BASE-SUM-001；GROUP-002 / SUM-002 暂定待 oracle）；
 * P3 片二：all-files 数据集（source.ts files ∪ vault_entries 内存合并，旧库降级 md-only）
 * + engine conformance 开关（bases-markdown-2026-07 / bases-all-files-2026-07）；
 * 无 CLI（P1 不加命令，薄出口属后续计划）。
 */

export type { BasaltDiagnostic } from "../diagnostic.js";
export { BASE_RULES, baseDiagnostic, type BaseRuleId } from "./errors.js";
export {
  loadBaseDocument,
  selectView,
  type LoadBaseDocumentOptions,
  type SelectViewResult,
} from "./document.js";
export { BASE_FUNCTION_NAMES, scanExpression, type ExpressionScanFinding } from "./expressions.js";
export {
  parseBaseExpression,
  type BaseExpressionParseError,
  type BaseExpressionParseResult,
} from "./parser.js";
export {
  DEFAULT_BASE_DOCUMENT_LIMITS,
  DEFAULT_BASE_EXECUTION_LIMITS,
  type BaseDocument,
  type BaseDocumentLimits,
  type BaseDurationUnit,
  type BaseExecutionLimits,
  type BaseExpr,
  type BaseFilter,
  type BaseFormulaDef,
  type BaseView,
  type BaseViewGroupBy,
  type BaseViewSort,
  type SourceSpan,
} from "./types.js";
export {
  MISSING,
  BaseBudgetError,
  BaseTypeError,
  arithAdd,
  arithDiv,
  arithMul,
  arithNeg,
  arithSub,
  compareValues,
  createDateValue,
  createDurationValue,
  createFileValue,
  createLinkValue,
  isDateValue,
  isDurationValue,
  isFileValue,
  isLinkValue,
  parseDateLike,
  parseWikilinkValue,
  safeGetOwn,
  sortKeyCompare,
  toOutputValue,
  truthy,
  typedEqual,
  typeNameOf,
  wrapValue,
  type BaseDateValue,
  type BaseDurationValue,
  type BaseFileValue,
  type BaseLinkValue,
  type BaseTypedOutputValue,
  type BaseValue,
  type BaseValueObject,
  type SafeGetOwnResult,
} from "./values.js";
export {
  BASE_FUNCTION_REGISTRY,
  lookupBaseFunction,
  type BaseFunctionContext,
  type BaseFunctionEntry,
  type BaseFunctionReceiver,
} from "./functions.js";
export {
  evaluateExpression,
  isBaseBudgetError,
  type BaseRow,
  type BaseRowErrorInfo,
  type EvalContext,
} from "./evaluator.js";
export {
  hasVaultEntriesTable,
  readBaseRows,
  type BaseDataset,
  type BaseSourceIssue,
  type ReadBaseRowsOptions,
} from "./source.js";
export { loadBaseTypeSchema, type BaseTypeSchema } from "./typeschema.js";
export {
  planBaseQuery,
  spanPlusOffset,
  type BaseQueryPlan,
  type CompiledCustomSummary,
  type CompiledFilter,
  type CompiledFormula,
  type CompiledGroupBy,
  type CompiledSort,
  type CompiledSummaryRef,
} from "./planner.js";
export {
  BUILTIN_SUMMARIES,
  runBuiltinSummary,
  type BuiltinSummaryDef,
  type BuiltinSummaryInput,
} from "./summaries.js";
export {
  BaseEngine,
  toBaseOutputValue,
  type BaseConformance,
  type BaseOutputValue,
  type BaseQueryOptions,
  type BaseQueryResult,
} from "./engine.js";

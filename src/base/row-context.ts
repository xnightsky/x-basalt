/**
 * 行求值上下文装配：公式与 filter/sort/投影共用解析器、时钟、类型表和查询预算。
 * 上游 engine 提供已解析的数据集/contextFile；下游 evaluator 按需读取公式。
 * 每次查询独立缓存，不读文件/DB；自定义汇总的 values 语境不使用此装配器。
 */
import {
  evaluateExpression,
  type BaseRow,
  type BaseRowErrorInfo,
  type EvalContext,
} from "./evaluator.js";
import type { CompiledFormula } from "./planner.js";
import { MISSING, type BaseValue } from "./values.js";

// === 自建实现 ===

type RowContext = Omit<EvalContext, "formulas" | "onRowError" | "summaryValues">;
type FormulaErrorHandler = (
  definition: CompiledFormula,
  row: BaseRow,
  info: BaseRowErrorInfo,
) => void;

function formulaAccessor(
  row: BaseRow,
  definitions: Record<string, CompiledFormula>,
  context: RowContext,
  onError: FormulaErrorHandler,
): NonNullable<EvalContext["formulas"]> {
  const cache = new Map<string, BaseValue>();
  const accessor: NonNullable<EvalContext["formulas"]> = {
    get: (name) => {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const definition = definitions[name];
      // planner 已拒绝未知引用和依赖环；这里只兜底未定义名称，不另建依赖求值规则。
      if (definition === undefined) return MISSING;
      const value = evaluateExpression(definition.ast, row, {
        ...context,
        formulas: accessor,
        onRowError: (info) => onError(definition, row, info),
      });
      cache.set(name, value);
      return value;
    },
  };
  return accessor;
}

/**
 * 建立本次查询的行上下文工厂，公式按行/名称缓存且只在引用时求值。
 * engine 保证 definitions 已经 planner 循环/深度校验，context 只含本次数据集依赖。
 * @behavior Given 多个行语境引用同一公式 When 求值 Then 每行只计算一次，错误定位到公式源。
 * @behavior Given 公式关联读取 When 求值 Then 与普通行表达式共用 resolveFile 和预算，不扩张数据集。
 */
export function createRowEvalContext(
  definitions: Record<string, CompiledFormula>,
  context: RowContext,
  onFormulaError: FormulaErrorHandler,
): (row: BaseRow, onRowError: (info: BaseRowErrorInfo) => void) => EvalContext {
  const hasFormulas = Object.keys(definitions).length > 0;
  const accessors = new WeakMap<BaseRow, NonNullable<EvalContext["formulas"]>>();
  return (row, onRowError) => {
    let formulas = accessors.get(row);
    if (hasFormulas && formulas === undefined) {
      formulas = formulaAccessor(row, definitions, context, onFormulaError);
      accessors.set(row, formulas);
    }
    return { ...context, ...(formulas !== undefined ? { formulas } : {}), onRowError };
  };
}

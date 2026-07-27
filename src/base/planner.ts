/**
 * base 模块 P1 planner：view 选择 + global/view filter 外层 AND 合并 + 表达式编译计划。
 *
 * 输入 P0 文档层的 {@link BaseDocument}（filter 仍是原始字符串），输出可执行计划：
 * filter/order/sort 的全部表达式字符串经 parseBaseExpression 编译为 AST（带缓存），
 * 解析失败产 error 诊断——engine 对任何 error 级诊断拒绝执行（返回空结果）。
 *
 * 空 filter 数组（`and: []` / `or: []` / `not: []`）语义待官方 oracle 冻结，
 * P1 遍历合并后 filter 树遇空数组直接产 `base/unsupported-feature`（error），不猜语义。
 *
 * P2a 增量：formulas 段编译 + 依赖图（拓扑排序与 YAML 键序无关；循环 → base/formula-cycle；
 * 节点数/深度预算 SEC-006；filter/order/sort 中的 formula.* 引用名一并核验）。
 *
 * P2b 片三增量：view groupBy 分组键编译；view summaries 名字核验（内置 15 名 / 顶层自定义名，
 * 未知名 → base/unknown-function）+ 目标列编译；顶层自定义 summaries 表达式编译
 * （SUM-002 暂定，隐式 values 作用域在 engine 求值）。
 *
 * 位置换算口径：诊断位置 = BaseFilter.span（YAML scalar 起点）+ 表达式内 UTF-16 offset
 * （首行加列偏移，多行按 `\n` 折算行/列）。两点近似如实声明（沿用 P0 同口径声明传统）：
 *   1. 引号包裹的 scalar 其 span 指向引号本身（P0 浅扫描有源文本可 +1 修正，planner 只持
 *      BaseDocument 无源文本），带引号表达式列号可能偏小 1；
 *   2. YAML 块标量折叠语义下，列号指向源文本物理位置而非折叠后逻辑位置。
 *
 * 上游：src/base/document.ts（selectView）、src/base/parser.ts（parseBaseExpression）。
 * 下游：P1 engine.ts 消费计划做 filter/sort/投影求值。
 * 设计真相源：docs/design/bases-engine.md §5/§6/§11；
 * 计划：docs/history/plans/2026-07-26-bases-p1-markdown-query.md「关键取舍」#2。
 */

import type { BasaltDiagnostic } from "../diagnostic.js";
import { selectView } from "./document.js";
import { BASE_RULES, baseDiagnostic } from "./errors.js";
import {
  parseBaseExpression,
  type BaseExpressionParseError,
  type BaseExpressionParseResult,
} from "./parser.js";
import { BUILTIN_SUMMARIES } from "./summaries.js";
import type {
  BaseDocument,
  BaseExecutionLimits,
  BaseExpr,
  BaseFilter,
  BaseView,
  SourceSpan,
} from "./types.js";

// === 自建实现 ===

/**
 * 编译后的 filter 树：expr 叶子挂 AST（求值用）与原始字符串/位置（行级诊断换算用）。
 * children 空数组在 planner 已被拒绝，故求值侧不表达空数组语义。
 */
export type CompiledFilter =
  | { kind: "expr"; ast: BaseExpr; source: string; span: SourceSpan }
  | { kind: "and" | "or" | "not"; children: CompiledFilter[]; span: SourceSpan };

/** 编译后的 sort 项：原文 property 字符串 + 方向 + AST。 */
export interface CompiledSort {
  property: string;
  direction: "ASC" | "DESC";
  ast: BaseExpr;
}

/** 编译后的单条公式（P2a）：AST 供 engine 逐行求值，source/span 供行级诊断位置换算。 */
export interface CompiledFormula {
  name: string;
  ast: BaseExpr;
  source: string;
  span: SourceSpan;
}

/** 编译后的 groupBy 配置（P2b 片三）：原文 property 字符串 + 方向 + 分组键表达式 AST。 */
export interface CompiledGroupBy {
  property: string;
  direction: "ASC" | "DESC";
  ast: BaseExpr;
}

/**
 * 编译后的 view summaries 单条（P2b 片三）：property-ref 原文（结果 key）+ 汇总名
 * （内置 15 名或顶层自定义名，合法性 planner 已核验）+ 目标列表达式 AST。
 */
export interface CompiledSummaryRef {
  property: string;
  name: string;
  ast: BaseExpr;
}

/** 编译后的顶层自定义汇总（P2b 片三，SUM-002 暂定）：AST 供 engine 在 values 作用域求值。 */
export interface CompiledCustomSummary {
  name: string;
  ast: BaseExpr;
  source: string;
  span: SourceSpan;
}

/** planBaseQuery 输出：view 缺失（view-not-found）时 view 为 undefined 且 diagnostics 含 error。 */
export interface BaseQueryPlan {
  view?: BaseView;
  /** 投影列原文数组（= view.order；缺省 ["file.name"]，计划「关键取舍」#11）。 */
  columns: string[];
  /** 与 columns 一一对应的投影表达式 AST（任一列解析失败时为空数组，由 error 诊断表达）。 */
  columnExprs: BaseExpr[];
  /** global filters 与 view.filters 外层 AND 合并并编译后的 filter（无 filter 时 undefined）。 */
  filter?: CompiledFilter;
  /** 编译后的 sort 项（保持 view.sort 声明顺序）。 */
  sort: CompiledSort[];
  /** 编译后的公式（P2a；无 formulas 段或编译失败时为空对象）。 */
  formulas: Record<string, CompiledFormula>;
  /** 公式拓扑序（被依赖者在前，P2a FORM-003：与 YAML 键序无关；循环/失败时为空数组）。 */
  formulaOrder: string[];
  /** 编译后的 groupBy（P2b 片三；view 未配置或编译失败时为 undefined）。 */
  groupBy?: CompiledGroupBy;
  /** 编译后的 view summaries（P2b 片三；保持 YAML 声明顺序，保证结果 key 序字节稳定）。 */
  summaries: CompiledSummaryRef[];
  /** 编译后的顶层自定义汇总（P2b 片三，SUM-002 暂定；无顶层 summaries 段时为空对象）。 */
  customSummaries: Record<string, CompiledCustomSummary>;
  limit?: number;
  diagnostics: BasaltDiagnostic[];
}

/** 默认投影列（view.order 缺失时，计划「关键取舍」#11 拍板）。 */
const DEFAULT_COLUMNS: readonly string[] = ["file.name"];

/**
 * 表达式解析缓存：key = `${maxNodes} ${expr}`（节点预算影响解析结果，必须入 key）。
 * 同一 .base 的 filter/order/sort 常重复引用同名属性（如多处 `status`），缓存避免重复解析；
 * 结果按需只读（AST/errors 调用方不修改），跨查询共享安全。
 */
const EXPR_PARSE_CACHE = new Map<string, BaseExpressionParseResult>();

/**
 * 缓存条目上限（LRU，超限淘汰最久未用）。
 *
 * 必须有界：key 含表达式原文，长驻进程（chat REPL / 未来 watch）里查询过的每条不同表达式
 * 都会留一份 AST，无淘汰则内存随会话累计的 .base 数量单调增长。512 远超单个 .base 的
 * 表达式数（filter + order + sort + formulas + summaries 通常 < 50），热路径不会被穿透。
 */
const EXPR_PARSE_CACHE_MAX = 512;

/** 带缓存解析一条表达式字符串（节点预算上限随调用方 limits）。 */
function parseCached(expr: string, maxNodes: number): BaseExpressionParseResult {
  const key = `${maxNodes} ${expr}`;
  const hit = EXPR_PARSE_CACHE.get(key);
  if (hit !== undefined) {
    // 命中即挪到队尾：Map 保插入序，delete+set 把它变成「最近使用」，
    // 否则常用表达式会被一串一次性表达式挤出去（退化成 FIFO）。
    EXPR_PARSE_CACHE.delete(key);
    EXPR_PARSE_CACHE.set(key, hit);
    return hit;
  }
  const result = parseBaseExpression(expr, maxNodes);
  EXPR_PARSE_CACHE.set(key, result);
  if (EXPR_PARSE_CACHE.size > EXPR_PARSE_CACHE_MAX) {
    const oldest = EXPR_PARSE_CACHE.keys().next();
    if (!oldest.done) EXPR_PARSE_CACHE.delete(oldest.value);
  }
  return result;
}

/**
 * BaseFilter.span + 表达式内 UTF-16 offset → 完整文件位置（设计 §11 位置规则）。
 * 首行加列偏移；多行按 `\n` 折算（行 += 换行数，列 = 末行内 offset + 1）。
 * 近似声明见模块头（引号 scalar 列偏小 1、块标量物理列）。
 */
export function spanPlusOffset(span: SourceSpan, source: string, offset: number): SourceSpan {
  let line = span.line;
  let lineStart = 0; // 当前行在表达式内的起始 offset
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return line === span.line
    ? { line, column: span.column + offset }
    : { line, column: offset - lineStart + 1 };
}

/**
 * 选择 view 并编译执行计划（不 throw，问题一律经 diagnostics 返回）。
 *
 * 合并口径（设计 §6）：global `doc.filters` 与 view.filters 都存在时构造
 * `{ kind: "and", children: [global, view] }`（span 取 view filter 的）；单存在直接用。
 *
 * order/sort 的 property 字符串同经 parseBaseExpression 校验编译（解析失败 → error 诊断）；
 * P0 未记录 order/sort 逐项位置，其诊断锚定 view.span（近似，注释声明）。
 *
 * @param doc - P0 文档层产物（其自身诊断不在此重复聚合，由 engine 先行合并）
 * @param viewName - 指定 view 名；undefined 取 views[0]（BASE-VIEW-001）
 * @param limits - 执行预算（本层消费 maxExpressionNodes）
 */
export function planBaseQuery(
  doc: BaseDocument,
  viewName: string | undefined,
  limits: BaseExecutionLimits,
): BaseQueryPlan {
  const diagnostics: BasaltDiagnostic[] = [];
  const { view, diagnostics: viewDiags } = selectView(doc, viewName);
  diagnostics.push(...viewDiags);
  const plan: BaseQueryPlan = {
    view,
    columns: [],
    columnExprs: [],
    sort: [],
    formulas: {},
    formulaOrder: [],
    summaries: [],
    customSummaries: {},
    diagnostics,
  };
  if (view === undefined) return plan;
  if (view.limit !== undefined) plan.limit = view.limit;

  // ---- filter：global + view 外层 AND 合并（设计 §6）----
  const merged = mergeFilters(doc.filters, view.filters);
  if (merged !== undefined) {
    const compiled = compileFilter(merged, doc.path, limits, diagnostics);
    if (compiled !== undefined) plan.filter = compiled;
  }

  // ---- order：投影列原文 + 编译（缺省 ["file.name"]）----
  const columns = view.order ?? [...DEFAULT_COLUMNS];
  plan.columns = columns;
  const columnExprs: BaseExpr[] = [];
  let columnsOk = true;
  for (const column of columns) {
    const result = parseCached(column, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      columnsOk = false;
      pushExprErrors(diagnostics, doc.path, view.span, column, result.errors, "order 列");
      continue;
    }
    columnExprs.push(result.expr);
  }
  // 任一列解析失败即整体失败（error 诊断已聚合，engine 据此短路；半截 AST 不交给求值侧）。
  if (columnsOk) plan.columnExprs = columnExprs;

  // ---- sort：property 字符串编译（保持声明顺序；P0 未记逐项位置，锚定 view.span）----
  for (const sort of view.sort ?? []) {
    const result = parseCached(sort.property, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      pushExprErrors(diagnostics, doc.path, view.span, sort.property, result.errors, "sort 项");
      continue;
    }
    plan.sort.push({ property: sort.property, direction: sort.direction, ast: result.expr });
  }

  // ---- formulas（P2a 计划「关键取舍」#6）：编译 + 依赖图（循环/未定义引用/SEC-006 预算）----
  const compiled = compileFormulas(doc, limits, diagnostics);
  plan.formulas = compiled.formulas;
  plan.formulaOrder = compiled.order;

  // ---- groupBy（P2b 片三，计划「关键取舍」#8）：分组键表达式编译（复用 sort 模式）----
  if (view.groupBy !== undefined) {
    const result = parseCached(view.groupBy.property, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      pushExprErrors(
        diagnostics,
        doc.path,
        view.span,
        view.groupBy.property,
        result.errors,
        "groupBy",
      );
    } else {
      plan.groupBy = {
        property: view.groupBy.property,
        direction: view.groupBy.direction,
        ast: result.expr,
      };
    }
  }

  // ---- summaries（P2b 片三，计划「关键取舍」#10/#11）----
  // 顶层自定义汇总编译（SUM-002 暂定）：复用 formulas 的编译缓存与位置换算模式；
  // 不建依赖图、不静态核验 formula.* 引用——自定义汇总在隐式 values 作用域求值（无行上下文），
  // formula.* 求值期按既有「无公式上下文」口径拒绝，注释存证。
  for (const [name, def] of Object.entries(doc.summaries ?? {})) {
    const result = parseCached(def.expr, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      for (const err of result.errors) {
        diagnostics.push(
          baseDiagnostic(
            doc.path,
            spanPlusOffset(def.span, def.expr, err.offset),
            err.rule,
            "error",
            `汇总 "${name}" 表达式解析失败：${err.message}`,
            { target: err.target ?? name },
          ),
        );
      }
      continue;
    }
    plan.customSummaries[name] = { name, ast: result.expr, source: def.expr, span: def.span };
  }

  // view summaries：汇总名核验（内置 15 名或顶层自定义名；未知名 → base/unknown-function error，
  // 计划 #11）+ 目标列 property-ref 表达式编译（同 order/sort 模式）。
  const knownSummaryNames = new Set([
    ...BUILTIN_SUMMARIES.keys(),
    ...Object.keys(doc.summaries ?? {}),
  ]);
  for (const [prop, name] of Object.entries(view.summaries ?? {})) {
    if (!knownSummaryNames.has(name)) {
      diagnostics.push(
        baseDiagnostic(
          doc.path,
          view.span,
          BASE_RULES.unknownFunction,
          "error",
          `未知汇总 "${name}"（既非内置汇总，也非顶层自定义汇总；位置锚定 view 起点，为近似值）`,
          { target: name, suggestions: [...knownSummaryNames] },
        ),
      );
      continue;
    }
    const result = parseCached(prop, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      pushExprErrors(diagnostics, doc.path, view.span, prop, result.errors, "summaries 目标列");
      continue;
    }
    plan.summaries.push({ property: prop, name, ast: result.expr });
  }

  // filter/order/sort 中的 formula.* 引用名核对（公式体内的引用已在 compileFormulas 内核验）。
  const definedFormulas = new Set(Object.keys(plan.formulas));
  const checkRefs = (ast: BaseExpr, report: (offset: number, name: string) => void): void => {
    for (const ref of collectFormulaRefs(ast)) {
      if (!definedFormulas.has(ref.name)) report(ref.offset, ref.name);
    }
  };
  const refSuggestions = (): { suggestions?: string[] } =>
    definedFormulas.size > 0 ? { suggestions: [...definedFormulas] } : {};
  if (plan.filter !== undefined) {
    forEachFilterExpr(plan.filter, (leaf) =>
      checkRefs(leaf.ast, (offset, name) =>
        diagnostics.push(
          baseDiagnostic(
            doc.path,
            spanPlusOffset(leaf.span, leaf.source, offset),
            BASE_RULES.unknownProperty,
            "error",
            `filter 引用了未定义公式 "${name}"`,
            { target: name, ...refSuggestions() },
          ),
        ),
      ),
    );
  }
  plan.columnExprs.forEach((ast, i) =>
    checkRefs(ast, (_offset, name) =>
      diagnostics.push(
        baseDiagnostic(
          doc.path,
          view.span,
          BASE_RULES.unknownProperty,
          "error",
          `order 列 "${plan.columns[i] ?? ""}" 引用了未定义公式 "${name}"（位置锚定 view 起点，为近似值）`,
          { target: name, ...refSuggestions() },
        ),
      ),
    ),
  );
  for (const s of plan.sort) {
    checkRefs(s.ast, (_offset, name) =>
      diagnostics.push(
        baseDiagnostic(
          doc.path,
          view.span,
          BASE_RULES.unknownProperty,
          "error",
          `sort 项 "${s.property}" 引用了未定义公式 "${name}"（位置锚定 view 起点，为近似值）`,
          { target: name, ...refSuggestions() },
        ),
      ),
    );
  }
  // groupBy 分组键与 summaries 目标列同属逐行求值语境，formula.* 引用名一并核验（P2b 片三）。
  if (plan.groupBy !== undefined) {
    checkRefs(plan.groupBy.ast, (_offset, name) =>
      diagnostics.push(
        baseDiagnostic(
          doc.path,
          view.span,
          BASE_RULES.unknownProperty,
          "error",
          `groupBy "${plan.groupBy?.property ?? ""}" 引用了未定义公式 "${name}"（位置锚定 view 起点，为近似值）`,
          { target: name, ...refSuggestions() },
        ),
      ),
    );
  }
  for (const s of plan.summaries) {
    checkRefs(s.ast, (_offset, name) =>
      diagnostics.push(
        baseDiagnostic(
          doc.path,
          view.span,
          BASE_RULES.unknownProperty,
          "error",
          `summaries 目标列 "${s.property}" 引用了未定义公式 "${name}"（位置锚定 view 起点，为近似值）`,
          { target: name, ...refSuggestions() },
        ),
      ),
    );
  }

  return plan;
}

/** global/view filter 外层 AND 合并（两者都在时 and 节点 span 取 view filter 的）。 */
function mergeFilters(
  global: BaseFilter | undefined,
  view: BaseFilter | undefined,
): BaseFilter | undefined {
  if (global !== undefined && view !== undefined) {
    return { kind: "and", children: [global, view], span: view.span };
  }
  return global ?? view;
}

/**
 * 递归编译合并后 filter 树（深度已被文档层 maxFilterDepth ≤ 32 限住，递归无栈溢出风险，
 * 无须重复 P0 的显式栈——那里防御的是**未校验**输入）。
 *
 * 空 children 数组 → `base/unsupported-feature`（error）：空 filter 数组语义待官方 oracle
 * 冻结，P1 直接拒绝，不猜 and:[]→true / or:[]→false / not:[]→true。
 *
 * @returns 任一节点失败返回 undefined（诊断已聚合），该 filter 视为整体失败
 */
function compileFilter(
  node: BaseFilter,
  file: string,
  limits: BaseExecutionLimits,
  diagnostics: BasaltDiagnostic[],
): CompiledFilter | undefined {
  if (node.kind === "expr") {
    const result = parseCached(node.expr, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      for (const err of result.errors) {
        diagnostics.push(
          baseDiagnostic(
            file,
            spanPlusOffset(node.span, node.expr, err.offset),
            err.rule,
            "error",
            err.message,
            { target: err.target },
          ),
        );
      }
      return undefined;
    }
    return { kind: "expr", ast: result.expr, source: node.expr, span: node.span };
  }
  if (node.children.length === 0) {
    diagnostics.push(
      baseDiagnostic(
        file,
        node.span,
        BASE_RULES.unsupportedFeature,
        "error",
        `空 filter 数组（${node.kind}: []）语义待官方 oracle 冻结，P1 直接拒绝`,
        { target: node.kind, reason: "empty_filter_array" },
      ),
    );
    return undefined;
  }
  const children: CompiledFilter[] = [];
  let ok = true;
  for (const child of node.children) {
    const compiled = compileFilter(child, file, limits, diagnostics);
    if (compiled === undefined) {
      ok = false; // 继续编译剩余兄弟节点：一次报全诊断，不留半截树
    } else {
      children.push(compiled);
    }
  }
  if (!ok) return undefined;
  return { kind: node.kind, children, span: node.span };
}

/** order/sort 表达式解析失败：逐条转 error 诊断（位置锚定 anchor，注明近似来源）。 */
function pushExprErrors(
  diagnostics: BasaltDiagnostic[],
  file: string,
  anchor: SourceSpan,
  source: string,
  errors: BaseExpressionParseError[],
  label: string,
): void {
  for (const err of errors) {
    diagnostics.push(
      baseDiagnostic(
        file,
        spanPlusOffset(anchor, source, err.offset),
        err.rule,
        "error",
        `${label}表达式解析失败：${err.message}（位置锚定 view 起点，P0 未记录逐项位置，为近似值）`,
        { target: err.target ?? source },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// P2a 增量：公式编译 + 依赖图（计划「关键取舍」#6）
// ---------------------------------------------------------------------------

/**
 * 从 AST 收集 `formula.<name>` 引用（property 节点 base="formula" 的首段名 + offset）。
 * 迭代显式栈遍历（不递归）：AST 深度虽已被 parser 限住，迭代与 document 层防御风格一致。
 */
function collectFormulaRefs(root: BaseExpr): Array<{ name: string; offset: number }> {
  const out: Array<{ name: string; offset: number }> = [];
  const stack: BaseExpr[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as BaseExpr;
    switch (node.kind) {
      case "property":
        if (node.base === "formula" && node.path.length > 0) {
          out.push({ name: node.path[0] as string, offset: node.offset });
        }
        break;
      case "list":
        stack.push(...node.items);
        break;
      case "member":
        stack.push(node.target);
        break;
      case "index":
        stack.push(node.target, node.index);
        break;
      case "call":
        if (node.receiver !== null) stack.push(node.receiver);
        stack.push(...node.args);
        break;
      case "not":
      case "neg":
        stack.push(node.arg);
        break;
      case "binary":
        stack.push(node.left, node.right);
        break;
      default:
        break; // literal / duration 无子节点
    }
  }
  return out;
}

/** 遍历编译后 filter 树的全部 expr 叶子（深度已被 maxFilterDepth 限住，递归安全）。 */
function forEachFilterExpr(
  node: CompiledFilter,
  fn: (leaf: Extract<CompiledFilter, { kind: "expr" }>) => void,
): void {
  if (node.kind === "expr") {
    fn(node);
    return;
  }
  for (const child of node.children) forEachFilterExpr(child, fn);
}

/**
 * Kahn 剩余子图中还原一条完整循环链（FORM-004）。
 * 不变量：Kahn 结束后剩余节点在子图内出度均 ≥ 1（否则已被剥离），故沿边走必然成环。
 * 起点与每步后继都取字典序最小者，保证 message 字节稳定（不依赖 YAML 键序/遍历序）。
 */
function findFormulaCycle(
  remaining: ReadonlySet<string>,
  deps: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  let cur = [...remaining].toSorted()[0] as string;
  const path: string[] = [];
  const seenAt = new Map<string, number>();
  for (;;) {
    const at = seenAt.get(cur);
    if (at !== undefined) return path.slice(at); // 首次重复点即循环起点
    seenAt.set(cur, path.length);
    path.push(cur);
    const next = [...(deps.get(cur) ?? [])].filter((n) => remaining.has(n)).toSorted()[0];
    // 不变量兜底：next 缺失说明 cur 在剩余子图内出度为 0，本该已被 Kahn 剥离。
    // 不加这一步则 cur 变 undefined，循环再也命中不了 seenAt → 死循环（比抛错难查得多）。
    if (next === undefined) {
      throw new Error(`公式循环还原失败：节点 "${cur}" 在剩余子图内无出边（Kahn 不变量被破）`);
    }
    cur = next;
  }
}

/**
 * 编译全部公式并建依赖图（P2a 计划「关键取舍」#6）：
 * 1. 节点数预算（SEC-006 maxFormulaNodes）；
 * 2. 逐条 parseBaseExpression 编译（复用 filter 的缓存与位置换算模式；失败 → error 诊断）；
 * 3. 依赖收集：`formula.<name>` 引用未定义公式 → base/unknown-property（suggestions 列可用名）；
 * 4. Kahn 拓扑排序（与 YAML 键序无关，FORM-003；ready 集字典序出队保证字节稳定）；
 * 5. 循环 → base/formula-cycle（error，message 含完整循环链，FORM-004）；
 * 6. 最长依赖链深度预算（SEC-006 maxFormulaDepth，message 含依赖路径）。
 *
 * 任一阶段失败即返回已编译子集 + 空拓扑序（error 诊断已聚合，engine 据此短路空结果）。
 */
function compileFormulas(
  doc: BaseDocument,
  limits: BaseExecutionLimits,
  diagnostics: BasaltDiagnostic[],
): { formulas: Record<string, CompiledFormula>; order: string[] } {
  const defs = doc.formulas ?? {};
  const empty: { formulas: Record<string, CompiledFormula>; order: string[] } = {
    formulas: {},
    order: [],
  };
  const names = Object.keys(defs);
  if (names.length === 0) return empty;

  // SEC-006 节点数上限：超限不建图（防超大公式图耗尽资源）。
  if (names.length > limits.maxFormulaNodes) {
    diagnostics.push(
      baseDiagnostic(
        doc.path,
        doc.viewsSpan,
        BASE_RULES.executionBudget,
        "error",
        `公式数量 ${names.length} 超过预算上限 ${limits.maxFormulaNodes}（SEC-006，防超大依赖图）`,
        { reason: "formula_nodes" },
      ),
    );
    return empty;
  }

  // 逐条编译（复用 filter 的解析缓存；一条失败不中断其余，一次报全诊断）。
  const formulas: Record<string, CompiledFormula> = {};
  let compileOk = true;
  for (const name of names) {
    const def = defs[name] as { expr: string; span: SourceSpan };
    const result = parseCached(def.expr, limits.maxExpressionNodes);
    if (result.errors.length > 0 || result.expr === undefined) {
      compileOk = false;
      for (const err of result.errors) {
        diagnostics.push(
          baseDiagnostic(
            doc.path,
            spanPlusOffset(def.span, def.expr, err.offset),
            err.rule,
            "error",
            `公式 "${name}" 表达式解析失败：${err.message}`,
            { target: err.target ?? name },
          ),
        );
      }
      continue;
    }
    formulas[name] = { name, ast: result.expr, source: def.expr, span: def.span };
  }
  if (!compileOk) return { formulas, order: [] };

  // 依赖收集 + 未定义引用核对（自引用也入边，交给循环检测报 formula-cycle）。
  const defined = new Set(Object.keys(formulas));
  const deps = new Map<string, Set<string>>();
  let refsOk = true;
  for (const name of Object.keys(formulas)) {
    const f = formulas[name] as CompiledFormula;
    const set = new Set<string>();
    for (const ref of collectFormulaRefs(f.ast)) {
      if (!defined.has(ref.name)) {
        refsOk = false;
        diagnostics.push(
          baseDiagnostic(
            doc.path,
            spanPlusOffset(f.span, f.source, ref.offset),
            BASE_RULES.unknownProperty,
            "error",
            `公式 "${name}" 引用了未定义公式 "${ref.name}"`,
            { target: ref.name, suggestions: [...defined] },
          ),
        );
        continue;
      }
      set.add(ref.name);
    }
    deps.set(name, set);
  }
  if (!refsOk) return { formulas, order: [] };

  // Kahn 拓扑排序（被依赖者在前；ready 集字典序出队，字节稳定不依赖 YAML 键序）。
  const remainingDeps = new Map<string, Set<string>>();
  for (const [n, d] of deps) remainingDeps.set(n, new Set(d));
  const order: string[] = [];
  for (;;) {
    const ready = [...remainingDeps.entries()]
      .filter(([, d]) => d.size === 0)
      .map(([n]) => n)
      .toSorted();
    if (ready.length === 0) break;
    for (const n of ready) {
      order.push(n);
      remainingDeps.delete(n);
      for (const d of remainingDeps.values()) d.delete(n);
    }
  }

  // 循环（FORM-004）：message 含完整循环链（如 a → b → a），执行不挂死。
  if (remainingDeps.size > 0) {
    const cycle = findFormulaCycle(new Set(remainingDeps.keys()), deps);
    const chain = [...cycle, cycle[0] as string].join(" → ");
    diagnostics.push(
      baseDiagnostic(
        doc.path,
        (formulas[cycle[0] as string] as CompiledFormula).span,
        BASE_RULES.formulaCycle,
        "error",
        `公式依赖循环：${chain}（无法拓扑排序，执行终止）`,
        { target: cycle[0] as string, suggestions: [...defined] },
      ),
    );
    return { formulas, order: [] };
  }

  // SEC-006 深度上限：最长依赖链（memo 递归，深度 ≤ 节点数 ≤ maxFormulaNodes，栈安全）。
  const depthMemo = new Map<string, { depth: number; path: string[] }>();
  const depthOf = (n: string): { depth: number; path: string[] } => {
    const hit = depthMemo.get(n);
    if (hit !== undefined) return hit;
    let best: { depth: number; path: string[] } = { depth: 1, path: [n] };
    for (const d of deps.get(n) ?? []) {
      const sub = depthOf(d);
      if (sub.depth + 1 > best.depth) best = { depth: sub.depth + 1, path: [n, ...sub.path] };
    }
    depthMemo.set(n, best);
    return best;
  };
  let worst: { depth: number; path: string[] } = { depth: 0, path: [] };
  for (const n of order) {
    const r = depthOf(n);
    if (r.depth > worst.depth) worst = r;
  }
  if (worst.depth > limits.maxFormulaDepth) {
    diagnostics.push(
      baseDiagnostic(
        doc.path,
        (formulas[worst.path[0] as string] as CompiledFormula).span,
        BASE_RULES.executionBudget,
        "error",
        `公式依赖链深度 ${worst.depth} 超过预算上限 ${limits.maxFormulaDepth}` +
          `（SEC-006，依赖路径：${worst.path.join(" → ")}）`,
        { reason: "formula_depth" },
      ),
    );
    return { formulas, order: [] };
  }

  return { formulas, order };
}

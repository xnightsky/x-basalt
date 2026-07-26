/**
 * base 模块类型：.base 文档（BaseDocument / BaseView / BaseFilter）、源码位置 SourceSpan、
 * 文档层预算 BaseDocumentLimits、表达式 AST（BaseExpr，P1）、执行预算 BaseExecutionLimits（P1）。
 *
 * P0 落地文档层（YAML + schema + filter 结构 + 表达式浅扫描），不求值；
 * BaseFilter 的 expr 分支仍存原始表达式字符串，P1 planner 在 query 时经 parseBaseExpression
 * 解析为 BaseExpr 并缓存（计划「关键取舍」#2），文档结构本身不动。
 *
 * 上游：src/base/document.ts 产出、src/base/index.ts 出口。
 * 下游：P1 planner / engine 消费；诊断形状复用 src/diagnostic.ts 公共契约。
 * 设计真相源：docs/specs/2026-07-22-bases-headless-engine-design.md §5/§6/§12。
 */

// === 自建实现 ===

/** 源码位置：1-based 完整文件行号 + 1-based UTF-16 code unit 列（对齐 BasaltDiagnostic 契约）。 */
export interface SourceSpan {
  line: number;
  column: number;
}

/**
 * 文档层资源预算（设计 §12 BaseExecutionLimits 的 P0 子集）。
 * 默认值经 fixture 校准，均为硬上限；耗尽即产 `base/execution-budget`，不返回部分结果冒充成功。
 */
export interface BaseDocumentLimits {
  /** .base 文档字节数上限（读取前以 stat 预判，超限不读内容）。 */
  maxDocumentBytes: number;
  /** YAML alias 解析上限，对齐 `yaml` 包 `maxAliasCount` 语义（防 alias bomb）。 */
  maxYamlAliases: number;
  /** filter 对象 and/or/not 嵌套深度上限（迭代 + 显式深度计数，杜绝栈溢出）。 */
  maxFilterDepth: number;
  /** 表达式浅扫描 token 数上限（P0 阶段 = token 计数，P1 parser 落地后语义升级为 AST 节点数）。 */
  maxExpressionNodes: number;
}

/** 文档层预算默认值（计划「关键取舍」#4 拍板值）。 */
export const DEFAULT_BASE_DOCUMENT_LIMITS: BaseDocumentLimits = {
  maxDocumentBytes: 1024 * 1024, // 1 MiB
  maxYamlAliases: 100,
  maxFilterDepth: 32,
  maxExpressionNodes: 1000,
};

/**
 * 表达式 AST 节点（P1，设计 §7；计划「关键取舍」#1 拍板落点在本文件，不单建 ast.ts）。
 *
 * 每个节点带 `offset`：表达式内 UTF-16 code unit offset（0-based），
 * 由调用方叠加 YAML scalar 起点换算完整文件行列（同 P0 浅扫描口径）。
 * 括号不产节点（返回内层 AST）；二元/一元节点 offset 取其最左 token（二元 = left.offset，
 * 一元 `!` = 叹号起点）；postfix（member/index/call）offset 取触发 token（`.`/`[`/函数名）起点。
 */
export type BaseExpr =
  | {
      kind: "literal";
      offset: number;
      value: null | boolean | number | string;
    }
  | {
      /** 列表字面量 `[a, b, ...]`；元素可为任意表达式（含嵌套 list）。 */
      kind: "list";
      offset: number;
      items: BaseExpr[];
    }
  | {
      /**
       * 属性引用根：裸 `status` → base "note"（note property 简写）；`note.status` /
       * `note["Review Status"]` → base "note"；`file.name` → base "file"。
       * `formula.*` / `this.*` 语法上接受（base = "formula"/"this"），由 evaluator 拒绝
       * （`base/unsupported-feature` / `base/dynamic-context-required`，计划「关键取舍」#4）。
       * path 只含首段；更深段落（`note.a.b`）落在 member/index 节点。
       */
      kind: "property";
      offset: number;
      base: "note" | "file" | "formula" | "this";
      path: string[];
    }
  | {
      /** 只读成员访问（如 `file.properties.x`）；禁止动态调用，调用形态只认 `.name(args)`。 */
      kind: "member";
      offset: number;
      target: BaseExpr;
      name: string;
    }
  | {
      /** 列表/对象索引 `target[expr]`（`note["…"]` 的首段例外，归入 property.path）。 */
      kind: "index";
      offset: number;
      target: BaseExpr;
      index: BaseExpr;
    }
  | {
      /**
       * 白名单调用：receiver=null 为全局函数（`if(a,b,c)`），否则为方法调用
       * （`status.contains("x")`）。name 一定在 BASE_FUNCTION_NAMES 内——
       * 不在时 parser 产 `base/unknown-function` 诊断且整体不返回 AST。
       */
      kind: "call";
      offset: number;
      name: string;
      receiver: BaseExpr | null;
      args: BaseExpr[];
    }
  | {
      /** 一元真值取反 `!expr`。 */
      kind: "not";
      offset: number;
      arg: BaseExpr;
    }
  | {
      /** 一元取负 `-expr`（P2a 增量；支持 `-42`、`-(a + b)`，与 `!` 同优先级层级）。 */
      kind: "neg";
      offset: number;
      arg: BaseExpr;
    }
  | {
      /**
       * duration 字面量（P2a 增量，词法层单 token `<number><unit>`）。
       * amount 为数值部分；unit 归一为单数枚举（复数形态在 parser 层剥掉词尾 `s`）。
       * 毫秒换算（month=30day、year=365day 的固定约定）在 values.ts 的值层完成。
       */
      kind: "duration";
      offset: number;
      amount: number;
      unit: BaseDurationUnit;
    }
  | {
      /**
       * 二元运算；左结合（`a == b == c` → `(a==b)==c`，`a - b - c` → `(a-b)-c`）。
       * P2a 增量：算术 `+ - * /`（优先级 `* /` > `+ -` > 比较，见 parser.ts 优先级链注释）。
       */
      kind: "binary";
      offset: number;
      op: "&&" | "||" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/";
      left: BaseExpr;
      right: BaseExpr;
    };

// === Obsidian 规范来源: Bases duration 单位表（语法真相源 §4.3，对齐官方 duration 单位）===
/** duration 单位枚举（AST 层归一为单数；`1days`/`1day` 同为 "day"）。 */
export type BaseDurationUnit =
  | "millisecond"
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

/**
 * 执行期资源预算（设计 §12 全量字段；文档层四项与 BaseDocumentLimits 同义同源）。
 * 默认值经 fixture 校准，均为硬上限；任一耗尽即产 `base/execution-budget`，
 * 不返回部分结果冒充成功。本任务只落地类型与默认值，扣减在 P1 evaluator/engine。
 */
export interface BaseExecutionLimits {
  /** .base 文档字节数上限（同 BaseDocumentLimits）。 */
  maxDocumentBytes: number;
  /** YAML alias 解析上限（同 BaseDocumentLimits）。 */
  maxYamlAliases: number;
  /** filter 对象 and/or/not 嵌套深度上限（同 BaseDocumentLimits）。 */
  maxFilterDepth: number;
  /** 表达式 AST 节点数上限（P1 起语义 = AST 节点计数，parser 侧扣减）。 */
  maxExpressionNodes: number;
  /** 函数/方法调用嵌套深度上限（evaluator 侧扣减，防深递归求值栈溢出）。 */
  maxCallDepth: number;
  /** 公式依赖图节点数上限（P2a SEC-006：planner 侧校验，防超大公式图耗尽资源）。 */
  maxFormulaNodes: number;
  /** 公式依赖链深度上限（P2a SEC-006：planner 侧校验，防超深链递归求值栈溢出）。 */
  maxFormulaDepth: number;
  /** 单次查询候选行数上限（source 层截断）。 */
  maxRows: number;
  /** 列表/对象等集合元素数上限（list 字面量与运行时集合共用）。 */
  maxCollectionItems: number;
  /** 求值操作数总预算：每次 AST 节点求值/函数调用/列表元素比较/行过滤扣一。 */
  maxOperations: number;
}

/** 执行预算默认值（计划「关键取舍」#9 拍板值；文档层四项复用 P0 默认）。 */
export const DEFAULT_BASE_EXECUTION_LIMITS: BaseExecutionLimits = {
  maxDocumentBytes: 1024 * 1024, // 1 MiB
  maxYamlAliases: 100,
  maxFilterDepth: 32,
  maxExpressionNodes: 1000,
  maxCallDepth: 64,
  maxFormulaNodes: 256, // SEC-006：远超真实 .base 公式量，只挡对抗输入
  maxFormulaDepth: 64, // SEC-006：与 maxCallDepth 同量级，防深链递归爆栈
  maxRows: 100_000,
  maxCollectionItems: 10_000,
  maxOperations: 1_000_000,
};

/**
 * filter 结构（设计 §6 的 P0 形态）。
 *
 * - `expr`：表达式 filter，P0 仅存原始字符串与位置（P1 换 BaseExpr AST）；
 * - `and`/`or`/`not`：逻辑组合，children 为 filter 数组。
 *
 * 空数组语义（and:[]→true / or:[]→false / not:[]→true）按设计 §6 暂定、待官方 oracle 冻结；
 * P0 只记录结构不求值，不在此下结论。
 */
export type BaseFilter =
  | { kind: "expr"; expr: string; span: SourceSpan }
  | { kind: "and" | "or" | "not"; children: BaseFilter[]; span: SourceSpan };

/** view 的 sort 项（P0 只做结构记录，property-ref 合法性 P1 再验）。 */
export interface BaseViewSort {
  property: string;
  direction: "ASC" | "DESC";
}

/**
 * view 的 groupBy 配置（P2b 片三，设计 §13）：结构同 sort 项（{ property, direction }），
 * direction 缺省 ASC。property-ref 的表达式编译在 planner（同 sort 模式）。
 */
export interface BaseViewGroupBy {
  property: string;
  direction: "ASC" | "DESC";
}

/**
 * formulas 段单条公式定义（P2a，设计 §5/§13）：
 * key 为公式名（合法标识符，document 层校验），value 为表达式字符串原文 + 位置
 * （span 取 YAML 表达式 scalar 起点，与 filter expr 同口径，planner 叠加 AST offset 换算）。
 * 表达式本体编译/依赖图建图属 planner，本层只做结构 + 浅扫描。
 */
export interface BaseFormulaDef {
  expr: string;
  span: SourceSpan;
}

/**
 * 单个 view（设计 §5 schema 子集）。
 *
 * `type` 保留原文（含未知/插件类型），能否执行由诊断表达：
 * cards/list/map → `base/unsupported-feature`，未知 → `base/unsupported-view-type`，
 * 选中即不可执行，故均为 error（P1 engine 据此拒绝执行）。
 */
export interface BaseView {
  type: string;
  name: string;
  filters?: BaseFilter;
  order?: string[];
  sort?: BaseViewSort[];
  limit?: number;
  /** view 分组配置（P2b 片三）：标量分组键；list/link 键在执行层暂定拒绝（GROUP-002 待 oracle）。 */
  groupBy?: BaseViewGroupBy;
  /** view 汇总配置（P2b 片三）：property-ref → 汇总名（内置 15 名或顶层自定义名）。 */
  summaries?: Record<string, string>;
  /** view map 起点（`type` key 位置），供 view 级诊断定位。 */
  span: SourceSpan;
}

/**
 * 解析后的 .base 文档 + 聚合诊断。
 *
 * 诊断一律经 `diagnostics` 返回（不 throw），终止性问题（YAML 非法 / 路径越界 / 预算耗尽）
 * 会使 views 为空或字段缺失，由调用方检查 error 级诊断后中止。
 * 未知顶层 key 的原值按 warning 口径保留在 `unknownKeys`（设计 §5 向前兼容）。
 */
export interface BaseDocument {
  /** .base 的 vault 相对 POSIX 路径；路径越界时为原始输入。 */
  path: string;
  filters?: BaseFilter;
  /** formulas 段（P2a）：公式名 → 表达式原文 + 位置；编译与依赖图在 planner。 */
  formulas?: Record<string, BaseFormulaDef>;
  /**
   * 顶层 summaries 段（P2b 片三，SUM-002 暂定）：自定义汇总名 → 表达式原文 + 位置。
   * 结构同 formulas（复用 {@link BaseFormulaDef}），但求值语境不同：隐式 `values` 作用域
   * （目标列跨行值列表），无行上下文；编译在 planner，求值在 engine。
   */
  summaries?: Record<string, BaseFormulaDef>;
  properties?: Record<string, { displayName?: string }>;
  views: BaseView[];
  /** 未知顶层 key → toJS 原值（随 warning 保留，不参与执行）。 */
  unknownKeys: Record<string, unknown>;
  /** `views` key 位置（selectView 的 view-not-found 诊断定位用）。 */
  viewsSpan: SourceSpan;
  diagnostics: import("../diagnostic.js").BasaltDiagnostic[];
}

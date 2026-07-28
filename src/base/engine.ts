/**
 * base 模块 P1 执行引擎：BaseEngine.query() —— 对 SQLite 索引执行 .base view，返回行/列。
 *
 * conformance（数据集口径，P3 片二开关，缺省 `bases-markdown-2026-07`）：
 * - `bases-markdown-2026-07`：md-only 数据集（files 表），附件不作为行；
 * - `bases-all-files-2026-07`：files ∪ vault_entries 合并数据集，附件作为行
 *   （note fields 缺失、file fields 可用、file.tags/file.links 恒 []）；
 *   旧库无 vault_entries 表 → 降级 md-only + compat warning，回传实际生效口径。
 *
 * 执行流程（顺序即诊断顺序，保证字节稳定）：
 *   conformance 选项校验（未知 id → base/invalid-schema error 空结果短路）
 *   → loadBaseDocument（文档层诊断）→ 任一 error 即空结果短路
 *   → planBaseQuery（planner 诊断；view 选择 + filter 合并 + 表达式编译）→ 同上短路
 *   → all-files 降级判定（旧库无 vault_entries 表 → compat warning + 生效口径改写）
 *   → markdown-only-dataset warning（markdown 模式每次查询恒发，BASE-DATA-001/002；
 *     all-files 模式不发）
 *   → types.json 显式类型表读取（P2b，可选只读，BASE-TYPE-001..003）
 *   → 无显式 sort 时 default-sort-tiebreak info（x-basalt 扩展，BASE-RESULT-004）
 *   → readBaseRows（SQLite → BaseRow；maxRows 预算在此截断）
 *   → 逐行求值合并 filter（无 filter 全量通过）→ 多键 sort（恒附 file.path ASC tie-break）
 *   → limit 截断（total = filter 后 limit 前行数）→ 逐列投影序列化
 *   → groupBy 分桶（P2b 片三，可选；list/link 键暂定拒绝 GROUP-002）
 *   → summaries 汇总（P2b 片三，可选；计算集 = filter 后 limit 前全量，暂定）
 *
 * 错误口径（设计 §11「error 阻止结果」，计划「关键取舍」#10）：
 * - query() **不 throw**——加载/选择/解析/预算任一 error 级诊断即返回
 *   rows=[]/total=0/columns=[] + 全量诊断；
 * - 行级类型错误（onRowError 通道）不阻断查询：filter 语境该行按不通过处理、投影语境该
 *   cell 置 null，诊断 severity=warning、主位置指表达式（.base 完整文件位置）、
 *   message/target 附行 file.path（设计 §11 位置规则）；
 * - BaseBudgetError（maxRows/maxOperations/maxTotalOperations/maxCallDepth/maxCollectionItems
 *   任一耗尽）捕获后转 base/execution-budget（error）+ 空结果，绝不返回部分行冒充成功；
 *   其中 maxTotalOperations 为**查询级**总额（跨行累计），由 opsBudget 单点计数；
 * - 行级诊断设上限 {@link MAX_ROW_DIAGNOSTICS} 条（防洪），超出补一条汇总诊断。
 *
 * DB 连接：按 dbPath 缓存只读连接（readonly + fileMustExist；:memory: 例外不加这两个 flag，
 * 照搬 src/query/index.ts 模式），close() 关全部。
 *
 * 上游：P0 文档层（document.ts）、planner.ts、source.ts、evaluator.ts。
 * 下游：未来 CLI 薄出口（本阶段不加 CLI 命令）。
 * 不变量：不写任何 vault 文件；无 eval/new Function；SQL 全部固定无拼接（见 source.ts）。
 * 设计真相源：docs/design/bases-engine.md §4/§10/§11/§12。
 */

import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import type { BasaltDiagnostic } from "../diagnostic.js";
import { loadBaseDocument } from "./document.js";
import {
  evaluateExpression,
  isBaseBudgetError,
  spendShared,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseSharedOperationBudget,
  type EvalContext,
} from "./evaluator.js";
import { BASE_RULES, baseDiagnostic } from "./errors.js";
import {
  planBaseQuery,
  spanPlusOffset,
  type CompiledCustomSummary,
  type CompiledFilter,
} from "./planner.js";
import {
  createFileResolver,
  hasVaultEntriesTable,
  readBaseRows,
  type BaseDataset,
} from "./source.js";
import { BUILTIN_SUMMARIES, runBuiltinSummary } from "./summaries.js";
import { loadBaseTypeSchema } from "./typeschema.js";
import {
  DEFAULT_BASE_EXECUTION_LIMITS,
  type BaseExecutionLimits,
  type SourceSpan,
} from "./types.js";
import {
  MISSING,
  createFileValue,
  isLinkValue,
  sortKeyCompare,
  sortKeyCompareDirected,
  toOutputValue,
  truthy,
  typedEqual,
  type BaseValue,
} from "./values.js";

// === 自建实现 ===

/** Markdown conformance id（md-only 数据集；附件不作为行，缺省口径）。 */
const CONFORMANCE = "bases-markdown-2026-07" as const;

/** all-files conformance id（P3 片二：files ∪ vault_entries，附件作为行、note fields 缺失）。 */
const CONFORMANCE_ALL_FILES = "bases-all-files-2026-07" as const;

/**
 * BaseEngine 支持的 conformance id 联合（P3 片二数据集开关）。
 * `BaseQueryResult.conformance` 回传**实际生效**口径：all-files 遇旧库降级时回传 markdown
 * 并附 compat warning（口径见 query() 降级段注释）。
 */
export type BaseConformance = typeof CONFORMANCE | typeof CONFORMANCE_ALL_FILES;

/**
 * 行级诊断条数上限（防洪）：单行单表达式至多一条，但行数 × 表达式数仍可膨胀；
 * 超出后只补一条汇总诊断，保证诊断数组不随行数无界增长（字节稳定前提之一）。
 */
const MAX_ROW_DIAGNOSTICS = 100;

/**
 * 自定义汇总求值用的占位行（P2b 片三，SUM-002 暂定）：summaryValues 作用域下 note/file
 * 属性一律 MISSING（evaluator 不读行内容），本行仅满足 BaseRow 契约，字段永不参与求值。
 */
const SUMMARY_ROW: BaseRow = {
  note: {},
  file: createFileValue({
    name: "",
    basename: "",
    path: "",
    folder: "",
    ext: "",
    size: 0,
    ctime: 0,
    mtime: 0,
    properties: {},
    tags: [],
    links: [],
  }),
};

/**
 * query() 输出值的稳定 JSON 形状（设计 §4）：无类实例、无 symbol 键、无 undefined。
 * P2a 起含 typed values 包装形状：`{ type: "date"|"datetime", value }` 与
 * `{ type: "link", path, display?, subpath? }`（序列化真相源在 values.ts toOutputValue）。
 */
export type BaseOutputValue =
  | null
  | string
  | number
  | boolean
  | BaseOutputValue[]
  | { [key: string]: BaseOutputValue };

/** BaseEngine.query() 入参（设计 §4，签名与契约一字不差）。 */
export interface BaseQueryOptions {
  /** .base 路径（vault 相对或绝对；resolve 后必须落在 vaultRoots 内，BASE-SEC-008）。 */
  basePath: string;
  /** 指定 view 名；缺省取 views[0]（BASE-VIEW-001）。 */
  view?: string;
  /** 索引库路径（engine 只读打开；:memory: 仅测试用）。 */
  dbPath: string;
  /** 允许的 vault 根（多根时索引键为 `<根目录名>/<相对>` 命名空间路径）。 */
  vaultRoots: string[];
  /**
   * `this.*` 的显式动态上下文（2026-07-28 覆盖率片六，BASE-CTX-001；P1 起就在契约里占位）。
   *
   * 取值为 vault 内文件路径（与 `file.path` 同一套键：单根为根内相对路径，多根带
   * `<根目录名>/` 前缀；也接受 bare basename / 省略扩展名，解析口径同 `file(path)`）。
   * 在**当前查询行集内**解析：给了但解析不到 → `base/dynamic-context-required`（error）
   * + 空结果，**不静默忽略**。不给则 `this.*` 保持既有拒绝口径。
   */
  contextFile?: string;
  /**
   * 注入时钟（P2a 起消费）：today/now 的时间来源，缺省 `() => new Date()`。
   * 测试必须注入固定 clock，保证重复运行字节一致（FORM-006）。
   */
  clock?: () => Date;
  /** 执行预算覆盖（缺省 DEFAULT_BASE_EXECUTION_LIMITS）。 */
  limits?: Partial<BaseExecutionLimits>;
  /**
   * 数据集 conformance 开关（P3 片二）：缺省 `bases-markdown-2026-07`（md-only，附件不为行）；
   * `bases-all-files-2026-07` = files ∪ vault_entries 合并数据集（附件作为行，note fields
   * 经 MISSING 传播为缺失、file fields 可用、file.tags/file.links 恒 []）。
   * 未知 id → base/invalid-schema（error）空结果短路（rule 复用口径见 query() 校验段注释）。
   */
  conformance?: BaseConformance;
}

/** BaseEngine.query() 结果（设计 §4，签名与契约一字不差）。 */
export interface BaseQueryResult {
  /** 实际生效的数据集 conformance（all-files 降级旧库时回传 markdown 并附降级诊断）。 */
  conformance: BaseConformance;
  /** .base 的 vault 相对 POSIX 路径。 */
  base: string;
  /** 实际执行的 view 名。 */
  view: string;
  /** 投影列原文数组（= view.order，缺省 ["file.name"]）。 */
  columns: string[];
  /** filter 后、limit 前行数。 */
  total: number;
  /** 行数组（长度 ≤ limit）；key 为列原文，missing 投影为 null。 */
  rows: Record<string, BaseOutputValue>[];
  /**
   * 分组结果（P2b 片三增量可选字段；view 配置 groupBy 时存在，否则缺省）。
   * 组序 = 组键比较（`groupKeyCompare`，direction 控制方向）；组内行序 = view sort +
   * file.path tie-break（与顶层 rows 同一比较器）；rows 与顶层 rows 同一投影形状
   * （向后兼容，顶层 rows 平铺行为不变）。key 经 toOutputValue 序列化（稳定 JSON）。
   *
   * **⚠ list 键会扇出**（2026-07-28 片五 GROUP-002）：分组键求值为 list 时，一行进入
   * 其**每个元素**的组（`groupBy: tags` 的自然语义），因此 **`groups` 各组行数之和可能
   * 大于 `rows.length`**——需要「每行恰好一次」的读出方请用顶层 `rows`。
   *
   * `summaries`（2026-07-28 片五）：view 同时配置 groupBy 与 summaries 时存在。
   * 计算集 = **该组在 limit 后的行**，与顶层 `summaries`（filter 后 **limit 前**全量）
   * 有意不同——组本身就建立在 limit 后行集上。
   */
  groups?: {
    key: BaseOutputValue;
    rows: Record<string, BaseOutputValue>[];
    summaries?: Record<string, BaseOutputValue>;
  }[];
  /**
   * 汇总结果（P2b 片三增量可选字段；view 配置 summaries 时存在，否则缺省）。
   * key = view summaries 的 property-ref 原文（YAML 声明序）；计算集 = filter 后
   * limit 前全量（暂定口径）；全部值被类型跳过 → null。
   */
  summaries?: Record<string, BaseOutputValue>;
  /** 全量诊断（顺序：文档层 → planner → 引擎级 → 行级按行序，字节稳定）。 */
  diagnostics: BasaltDiagnostic[];
}

/**
 * 入口形态检查（2026-07-28 覆盖率片六，BASE-CTX-002/003 的「不做 + 诊断」）。
 *
 * 只支持**独立 `.base` 文件**。另两种官方形态显式拒绝并说清替代写法：
 * - `![[View.base#Name]]` embed（CTX-003）：路径里带 `#` 锚点 → 让用户改用 `--view`；
 * - Markdown 内嵌 ` ```base ` 代码块（CTX-002）：扩展名不是 `.base` → 直说不做。
 *
 * 判据只看**路径形态**，不读文件——诊断要在读取之前给出，避免「先报 YAML 解析失败」
 * 这种与用户意图无关的误导。
 */
function checkEntryForm(basePath: string): { message: string; reason: string } | undefined {
  const hash = basePath.indexOf("#");
  if (hash !== -1) {
    return {
      message: `不支持 \`![[View.base#Name]]\` 形态的 view 嵌入引用（BASE-CTX-003 ❌ 不做：嵌入只在 Obsidian 界面里渲染才有意义，无头执行拿不到宿主上下文）。请去掉 "#" 锚点、改用 --view 指定 view 名：${basePath.slice(0, hash)} --view ${basePath.slice(hash + 1)}`,
      reason: "base_embed_reference",
    };
  }
  if (!basePath.toLowerCase().endsWith(".base")) {
    return {
      message: `只支持独立 \`.base\` 文件，收到 "${basePath}"。Markdown 内嵌的 \`\`\`base 代码块不做（BASE-CTX-002 ❌：同样只在 Obsidian 界面里渲染才有意义）——请把查询定义单独存成 .base 文件`,
      reason: "base_code_block",
    };
  }
  return undefined;
}

/**
 * 分组键比较（2026-07-28 覆盖率片五）：分组专用，不能直接用 `sortKeyCompare`——
 * 后者对 link **抛类型错误**（link 无排序语义），而分组只需要一个**确定性**的组序。
 *
 * 序：可比标量（按 sortKeyCompare 的 rank/值）< link < null/MISSING。
 * link 之间按归一 `path` + `subpath` 字典序——只声称确定，不声称有语义。
 */
function groupKeyCompare(a: BaseValue, b: BaseValue): number {
  const la = isLinkValue(a);
  const lb = isLinkValue(b);
  if (!la && !lb) return sortKeyCompare(a, b);
  if (la && lb) {
    const ka = `${a.path}#${a.subpath ?? ""}`;
    const kb = `${b.path}#${b.subpath ?? ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }
  // 空值键排最后（沿用 sortKeyCompare 的 ASC 口径，link 不得插到它们后面）。
  // 注意：**组序的方向维度未取证**——调用方对 DESC 整体取反，空值组因此翻到最前，
  // 与顶层 sort 的「恒最后」（oracle runbook ②，已冻结）不同。㉓ 只登记了组序的相对次序、
  // 没登记它是否与方向无关，官方 oracle 也未覆盖，故此处维持既有行为不动（见 runbook §5 备注）。
  if (a === null || a === MISSING) return 1;
  if (b === null || b === MISSING) return -1;
  return la ? 1 : -1;
}

/** 诊断数组是否含 error 级（error 阻止结果，设计 §11）。 */
function hasError(diagnostics: BasaltDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/**
 * 运行时值 → 输出 JSON 形状（设计 §4「不能泄漏类实例」）。
 * P2a 起委托 values.ts 的 {@link toOutputValue}（typed values 序列化真相源：
 * MISSING→null、file→path、date/datetime/duration/link 包装形状、object/array 递归）；
 * 本导出仅为兼容 P1 调用方保留，行为与 toOutputValue 完全一致。
 */
export function toBaseOutputValue(v: BaseValue): BaseOutputValue {
  return toOutputValue(v);
}

/**
 * Bases 无头执行引擎（设计 §4 公共 API）。
 *
 * @example
 * const engine = new BaseEngine();
 * const r = engine.query({ basePath: "views/projects.base", dbPath: ".x-basalt/index.db", vaultRoots: ["."] });
 * engine.close();
 */
export class BaseEngine {
  /** dbPath → 只读连接缓存（同库多次查询复用；close() 统一关闭）。 */
  private readonly dbs = new Map<string, Db>();

  /** 打开（或复用）索引库只读连接；:memory: 例外（better-sqlite3 限制，仅测试用）。 */
  private getDb(dbPath: string): Db {
    let db = this.dbs.get(dbPath);
    if (db === undefined) {
      const inMemory = dbPath === ":memory:";
      // fileMustExist：未建库直接报错，而非静默创建空库给出误导性空结果（同 query/index.ts）。
      db = new Database(dbPath, { readonly: !inMemory, fileMustExist: !inMemory });
      this.dbs.set(dbPath, db);
    }
    return db;
  }

  /** 关闭全部缓存连接（幂等）。 */
  close(): void {
    for (const db of this.dbs.values()) db.close();
    this.dbs.clear();
  }

  /**
   * 执行一次 .base 查询。不 throw（行级/文档级/预算问题一律经 diagnostics 表达）；
   * 唯一例外是索引库打不开（fileMustExist）等编程/环境错误，与 DataviewEngine 同口径。
   */
  query(options: BaseQueryOptions): BaseQueryResult {
    const limits: BaseExecutionLimits = { ...DEFAULT_BASE_EXECUTION_LIMITS, ...options.limits };

    // ---- 查询选项校验（诊断顺序 0：先于文档层）----
    // 未知 conformance id → error + 空结果短路。rule 复用 base/invalid-schema（不新增无谓 rule）：
    // 与 types.json 的「配置形状不合法」同族（见 typeschema.ts 模块头复用口径）。
    const requested = options.conformance ?? CONFORMANCE;
    if (requested !== CONFORMANCE && requested !== CONFORMANCE_ALL_FILES) {
      return {
        conformance: CONFORMANCE, // 未执行任何数据集，回传缺省口径
        base: options.basePath, // 文档层未运行，无法 resolve 出 vault 相对路径，原样回传入参
        view: options.view ?? "",
        columns: [],
        total: 0,
        rows: [],
        diagnostics: [
          baseDiagnostic(
            options.basePath,
            { line: 1, column: 1 },
            BASE_RULES.invalidSchema,
            "error",
            `未知 conformance id：${String(options.conformance)}` +
              `（支持 "${CONFORMANCE}" / "${CONFORMANCE_ALL_FILES}"）`,
            { reason: "unknown_conformance" },
          ),
        ],
      };
    }
    /** 实际生效的 conformance：all-files 遇旧库（无 vault_entries 表）降级时改写为 markdown。 */
    let effectiveConformance: BaseConformance = requested;
    /** 数据集口径（conformance 的数据侧体现）：降级判定后透传到 readBaseRows。 */
    let dataset: BaseDataset = requested === CONFORMANCE_ALL_FILES ? "all-files" : "markdown";

    // ---- 入口形态检查（2026-07-28 覆盖率片六：CTX-002/003 的「不做 + 诊断」落地点）----
    // 这两项官方形态只在 Obsidian 界面里渲染才有意义，无头执行拿不到宿主上下文、产物无
    // 消费方，故判❌不做（用户 2026-07-28 拍板）。但**不能静默**：用户真写成这两种形态时
    // 必须得到一条说清楚「不做 + 为什么 + 该怎么写」的诊断，而不是一句 YAML 解析失败。
    const entryIssue = checkEntryForm(options.basePath);
    if (entryIssue !== undefined) {
      return {
        conformance: effectiveConformance,
        base: options.basePath,
        view: options.view ?? "",
        columns: [],
        total: 0,
        rows: [],
        diagnostics: [
          baseDiagnostic(
            options.basePath,
            { line: 1, column: 1 },
            BASE_RULES.unsupportedFeature,
            "error",
            entryIssue.message,
            { target: options.basePath, reason: entryIssue.reason },
          ),
        ],
      };
    }

    // ---- 文档层（诊断顺序 1：文档层）----
    const doc = loadBaseDocument({
      basePath: options.basePath,
      vaultRoots: options.vaultRoots,
      limits,
    });
    const diagnostics: BasaltDiagnostic[] = [...doc.diagnostics];
    const base = doc.path;

    /** 空结果（error 短路 / 预算耗尽共用）：rows=[]/total=0/columns=[]，诊断全量。 */
    const emptyResult = (view: string): BaseQueryResult => ({
      conformance: effectiveConformance,
      base,
      view,
      columns: [],
      total: 0,
      rows: [],
      diagnostics,
    });

    // md-only conformance warning：markdown 模式每次查询恒发（成功/短路/预算耗尽路径都发），
    // 声明附件不作为行的数据集差异（BASE-DATA-001/002）；all-files 模式不发（附件作为行）。
    const pushMarkdownOnly = (): void => {
      diagnostics.push(
        baseDiagnostic(
          base,
          { line: 1, column: 1 },
          BASE_RULES.markdownOnlyDataset,
          "warning",
          "本次查询为 md-only conformance（bases-markdown-2026-07）：仅 Markdown 笔记作为行，" +
            "附件（图片/PDF/.base 等）不作为行（BASE-DATA-001/002）",
          { reason: "markdown_only_dataset" },
        ),
      );
    };

    /**
     * all-files → md-only 降级（旧库无 vault_entries 表，决策 §3）：改写生效口径 +
     * compat warning 一条（不崩）。rule 复用 base/unsupported-feature：该索引库（旧 schema）
     * 不支持 all-files 数据集，与「特性不受支持」同族；severity=warning（降级可继续，非终止）。
     */
    const degradeAllFiles = (): void => {
      dataset = "markdown";
      effectiveConformance = CONFORMANCE;
      diagnostics.push(
        baseDiagnostic(
          base,
          { line: 1, column: 1 },
          BASE_RULES.unsupportedFeature,
          "warning",
          "索引库无 vault_entries 表（旧 schema）：all-files 数据集降级为 md-only，" +
            "附件不作为行（用当前版本 indexer 重建索引可启用 all-files）",
          { reason: "all_files_degraded_no_vault_entries" },
        ),
      );
    };

    // 文档层 error 短路：数据集未实际执行，conformance 回传请求值；md-only warning 仅
    // markdown 模式发（all-files 请求不发——附件口径声明对空结果无意义且会误导）。
    if (hasError(diagnostics)) {
      if (dataset === "markdown") pushMarkdownOnly();
      return emptyResult(options.view ?? "");
    }

    // ---- planner（诊断顺序 2：view 选择 + filter 合并 + 表达式编译）----
    const plan = planBaseQuery(doc, options.view, limits);
    diagnostics.push(...plan.diagnostics);
    if (hasError(plan.diagnostics) || plan.view === undefined) {
      if (dataset === "markdown") pushMarkdownOnly();
      return emptyResult(options.view ?? "");
    }
    const view = plan.view;

    // ---- 引擎级诊断（顺序 3）：all-files 降级判定 → md-only warning + types.json + 默认排序 info ----
    // 降级判定放在 md-only warning 之前：保证降级后 md-only warning 的诊断位置与纯 markdown
    // 模式一致（字节稳定）；markdown 模式对 vault_entries 存在性零感知（不查表）。
    if (dataset === "all-files" && !hasVaultEntriesTable(this.getDb(options.dbPath))) {
      degradeAllFiles();
    }
    if (dataset === "markdown") pushMarkdownOnly();

    // types.json 显式类型表（P2b 片二，BASE-TYPE-001..003，语法 §5.1 第 1 条）。
    // 每次 query 读一次、不做缓存：文件通常 <1KB，同步读成本远低于一次 SQLite 全表读；
    // 缓存会引入「vault 内文件已改而表陈旧」的一致性问题（索引监听不覆盖 .obsidian/），
    // 每次重读保证与 vault 当前状态一致。
    const typeSchema = loadBaseTypeSchema(options.vaultRoots);
    diagnostics.push(...typeSchema.diagnostics);

    if (plan.sort.length === 0) {
      // 无显式 sort：最终按 file.path ASC 稳定排序，避免文件系统遍历顺序漂移（BASE-RESULT-004）。
      diagnostics.push(
        baseDiagnostic(
          base,
          view.span,
          BASE_RULES.defaultSortTiebreak,
          "info",
          "view 未显式 sort：按 file.path ASC 稳定排序（x-basalt 扩展，非官方 Bases 语义）",
          { reason: "default_sort_tiebreak" },
        ),
      );
    }

    // 查询级共享操作数计数器（跨行累计，见 BaseExecutionLimits.maxTotalOperations）：
    // 本次 query 的全部求值 + groupBy 分桶 + summaries 迭代共用这一份总额。
    const opsBudget: BaseSharedOperationBudget = { used: 0 };

    // ---- 行级诊断收集（顺序 4：source 问题 → filter/sort/投影按行序）----
    let rowDiagCount = 0;
    let rowDiagSuppressed = 0;
    const pushRowDiagnostic = (
      span: SourceSpan,
      source: string,
      info: BaseRowErrorInfo,
      rowPath: string,
    ): void => {
      // 防洪上限：超出只计数，结束后补一条汇总诊断（见模块头）。
      if (rowDiagCount >= MAX_ROW_DIAGNOSTICS) {
        rowDiagSuppressed += 1;
        return;
      }
      rowDiagCount += 1;
      diagnostics.push(
        baseDiagnostic(
          base,
          spanPlusOffset(span, source, info.offset),
          info.rule,
          // 行级错误不阻断查询（该行按不通过 / cell 置 null 处理），故 severity=warning。
          "warning",
          `${info.message}（行：${rowPath}）`,
          // 设计 §11：主位置指表达式，target 附行 file.path（原 target 存在时一并保留）。
          { target: info.target === undefined ? rowPath : `${info.target}（行：${rowPath}）` },
        ),
      );
    };
    const flushSuppressed = (): void => {
      if (rowDiagSuppressed > 0) {
        diagnostics.push(
          baseDiagnostic(
            base,
            view.span,
            BASE_RULES.propertyTypeMismatch,
            "warning",
            `行级诊断超过上限 ${MAX_ROW_DIAGNOSTICS} 条，后续 ${rowDiagSuppressed} 条已省略（防洪）`,
            { reason: "row_diagnostics_capped" },
          ),
        );
      }
    };

    /** 预算耗尽统一出口：execution-budget（error）+ 空结果，不返回部分行。 */
    const budgetFailure = (e: unknown): BaseQueryResult | undefined => {
      if (!isBaseBudgetError(e)) return undefined;
      diagnostics.push(
        baseDiagnostic(
          base,
          view.span,
          BASE_RULES.executionBudget,
          "error",
          `执行预算耗尽：${e.message}`,
          { reason: "execution_budget" },
        ),
      );
      return emptyResult(view.name);
    };

    // ---- 数据源（source 问题诊断先于求值诊断；maxRows 预算在此截断）----
    let rows: BaseRow[];
    try {
      rows = readBaseRows(
        this.getDb(options.dbPath),
        limits,
        (issue) => {
          diagnostics.push(
            baseDiagnostic(
              base,
              { line: 1, column: 1 },
              BASE_RULES.invalidYaml,
              "warning",
              issue.message,
              { target: issue.file, reason: issue.reason },
            ),
          );
        },
        {
          dataset,
          // 防御兜底：正常不触发——engine 已在引擎级（顺序 3）做过降级判定并把 dataset
          // 改写为 markdown；仅在「判定后表被并发删除」等极端路径到达。到达时保持同一降级
          // 口径，并补发 md-only warning（顺序 3 时按 all-files 未发）。
          onAllFilesDegraded: () => {
            if (dataset === "all-files") {
              degradeAllFiles();
              pushMarkdownOnly();
            }
          },
        },
      );
    } catch (e) {
      const failure = budgetFailure(e);
      if (failure !== undefined) return failure;
      throw e;
    }

    try {
      // ---- 公式求值接线（P2a 计划「关键取舍」#6）----
      // 拍板「按需 + 每行缓存」而非「一律按拓扑序求全量」：未被 filter/sort/投影引用到的公式
      // 不求值、不产生行级诊断（其类型错误不应污染无关查询）；公式体内的 formula.* 递归经同一
      // accessor，天然按依赖序求值（循环/超深已由 planner 静态拒绝，深度 ≤ maxFormulaDepth）。
      // 拓扑序（plan.formulaOrder）在 planner 用于循环/深度校验，求值侧无需再按序驱动。
      const hasFormulas = plan.formulaOrder.length > 0;
      const formulaAccessors = new WeakMap<BaseRow, { get(name: string): BaseValue }>();
      const formulaAccessorFor = (row: BaseRow): { get(name: string): BaseValue } | undefined => {
        if (!hasFormulas) return undefined;
        let acc = formulaAccessors.get(row);
        if (acc === undefined) {
          // 每行每公式至多求值一次（Map 缓存）；BaseValue 域不含 undefined，get 命中即有效缓存。
          const cache = new Map<string, BaseValue>();
          acc = {
            get: (name: string): BaseValue => {
              const hit = cache.get(name);
              if (hit !== undefined) return hit;
              const def = plan.formulas[name];
              // 未定义公式名已由 planner 静态拒绝（unknown-property error 短路）；此处防御兜底。
              if (def === undefined) return MISSING;
              const value = evaluateExpression(def.ast, row, {
                limits,
                ...(options.clock !== undefined ? { clock: options.clock } : {}),
                formulas: acc as { get(name: string): BaseValue },
                propertyTypes: typeSchema.table,
                sharedBudget: opsBudget,
                // 片六：公式体内同样可用 this.*（与 filter/投影/sort 同一上下文行）；
                // 自定义汇总的 values 作用域仍有意不注入（禁止访问行外状态）。
                ...(contextRow !== undefined ? { contextRow } : {}),
                onRowError: (info) => pushRowDiagnostic(def.span, def.source, info, row.file.path),
              });
              cache.set(name, value);
              return value;
            },
          };
          formulaAccessors.set(row, acc);
        }
        return acc;
      };

      /**
       * 逐行求值上下文装配（filter / sort / 投影 / groupBy / summaries 目标列共用一处）。
       * 收在此处的原因：这五个语境的可选字段展开逐字相同，此前各写一遍，
       * 其中 formulaAccessorFor(row) 还被判定与取值各调一次；漏传任一字段都是静默行为差异。
       */
      // 行集内 file 解析器（片三：`file(path)` / `link.asFile()`）。索引按需构建，
      // 用不到这两个函数的查询零成本。**有意只给行求值上下文**——自定义汇总的
      // `values` 作用域不注入，那里访问行外状态属越权（见 evaluator EvalContext.resolveFile）。
      const fileResolver = createFileResolver(rows);

      // ---- contextFile → this.* 的上下文行（片六 BASE-CTX-001）----
      // 走与 `file(path)` 同一个解析器（精确 path → pathKey → bare basename），保证
      // 「`--context-file` 能指到的」与「`file()` 能解析到的」是同一集合，不造第二套路径口径。
      let contextRow: BaseRow | undefined;
      if (options.contextFile !== undefined) {
        const hit = fileResolver.resolve(options.contextFile);
        const found = hit === undefined ? undefined : rows.find((r) => r.file === hit);
        if (found === undefined) {
          // 给了 contextFile 却解析不到 = 用户意图明确但落空，必须报错而不是当没给
          // （静默忽略会让 `this.*` 退化成「需要上下文」的误导性诊断）。
          flushSuppressed();
          diagnostics.push(
            baseDiagnostic(
              base,
              { line: 1, column: 1 },
              BASE_RULES.dynamicContextRequired,
              "error",
              `contextFile "${options.contextFile}" 在当前数据集中找不到（路径解析口径同 file(path)：完整路径 / 去扩展名忽略大小写路径 / 文件名）`,
              { target: options.contextFile, reason: "context_file_not_found" },
            ),
          );
          return emptyResult(view.name);
        }
        contextRow = found;
      }

      const rowEvalContext = (
        row: BaseRow,
        onRowError: (info: BaseRowErrorInfo) => void,
      ): EvalContext => {
        const formulas = formulaAccessorFor(row);
        return {
          limits,
          ...(options.clock !== undefined ? { clock: options.clock } : {}),
          ...(formulas !== undefined ? { formulas } : {}),
          propertyTypes: typeSchema.table,
          sharedBudget: opsBudget,
          resolveFile: (target) => fileResolver.resolve(target),
          ...(contextRow !== undefined ? { contextRow } : {}),
          onRowError,
        };
      };

      // ---- filter：逐行求值合并 filter（无 filter 全量通过；行级错误该行按不通过处理）----
      const filtered = rows.filter((row) => {
        if (plan.filter === undefined) return true;
        return evalFilter(plan.filter, row, pushRowDiagnostic, rowEvalContext);
      });

      // ---- sort keys：逐行求值（行级错误 → MISSING 键，sortKeyCompare 恒排最后组）----
      const decorated = filtered.map((row) => ({
        row,
        keys: plan.sort.map((s) =>
          evaluateExpression(
            s.ast,
            row,
            rowEvalContext(row, (info) =>
              pushRowDiagnostic(view.span, s.property, info, row.file.path),
            ),
          ),
        ),
      }));

      // 多键稳定比较（方向经 sortKeyCompareDirected 施加：空值组恒最后、不随 DESC 翻转，
      // oracle runbook ②）；最终恒附 file.path ASC tie-break（计划「关键取舍」#11：
      // 含显式 sort 的场景也兜底，保证全键相等时结果仍字节稳定）。
      decorated.sort((a, b) => {
        for (let i = 0; i < plan.sort.length; i += 1) {
          const c = sortKeyCompareDirected(
            a.keys[i] as BaseValue,
            b.keys[i] as BaseValue,
            (plan.sort[i] as { direction: "ASC" | "DESC" }).direction,
          );
          if (c !== 0) return c;
        }
        const pa = a.row.file.path;
        const pb = b.row.file.path;
        return pa < pb ? -1 : pa > pb ? 1 : 0;
      });

      // ---- limit：total = filter 后 limit 前行数（limit=0 → rows=[] 但 total 正确）----
      const total = decorated.length;
      const limited = plan.limit === undefined ? decorated : decorated.slice(0, plan.limit);

      // ---- 投影：逐行逐列求值并序列化（行级错误 → 该 cell null + 诊断，同行级口径）----
      const outRows = limited.map(({ row }) => {
        const out: Record<string, BaseOutputValue> = {};
        for (let i = 0; i < plan.columns.length; i += 1) {
          const column = plan.columns[i] as string;
          // columnExprs 与 columns 一一对应（planner 保证任一失败即整体 error 短路，此处必存在）。
          const value = evaluateExpression(
            plan.columnExprs[i] as (typeof plan.columnExprs)[number],
            row,
            rowEvalContext(row, (info) =>
              pushRowDiagnostic(view.span, column, info, row.file.path),
            ),
          );
          // P2a：序列化走 toOutputValue（typed values 真相源）；P1 形状行为不回归。
          out[column] = toOutputValue(value);
        }
        return out;
      });

      // ---- groupBy（P2b 片三，计划「关键取舍」#9，BASE-GROUP-001）----
      // 作用于 limit 后行集（= 顶层 rows 同一集合，向后兼容：顶层 rows 平铺行为不变）。
      let groups:
        | {
            key: BaseOutputValue;
            rows: Record<string, BaseOutputValue>[];
            summaries?: Record<string, BaseOutputValue>;
          }[]
        | undefined;
      /** 分桶中间态（组级汇总要按桶取 limited 行下标，故与 groups 并行保留）。 */
      let groupBuckets: { key: BaseValue; rowIdx: number[] }[] | undefined;
      if (plan.groupBy !== undefined) {
        const groupBy = plan.groupBy;
        // 分组键逐行求值（行级错误 → MISSING 键；公式/时钟/类型表同 sort 键求值接线）。
        const keys = limited.map(({ row }) =>
          evaluateExpression(
            groupBy.ast,
            row,
            rowEvalContext(row, (info) =>
              pushRowDiagnostic(view.span, groupBy.property, info, row.file.path),
            ),
          ),
        );
        // 分桶：typedEqual 相等即同组。oracle ① 冻结后 MISSING 与 null 在值域相等语义上**合并**，
        // 故 missing 键与显式 null 键落进**同一组**（序列化后 key 同为 null，此前分两组时读出方
        // 也分辨不了——合并顺带消掉了这个歧义）。
        // 比较/迭代扣查询级共享总额（防大行数 × 多组 O(n·g) 耗尽）——与求值侧同一份预算，
        // 否则分桶自建计数器等于给同一次查询又开了一份 maxOperations 额度。
        const spendGroup = (): void => spendShared(opsBudget, limits);
        const buckets: { key: BaseValue; rowIdx: number[] }[] = [];
        const putInBucket = (key: BaseValue, rowIdx: number): void => {
          spendGroup();
          const hit = buckets.find((b) => {
            spendGroup();
            return typedEqual(b.key, key);
          });
          if (hit !== undefined) hit.rowIdx.push(rowIdx);
          else buckets.push({ key, rowIdx: [rowIdx] });
        };
        keys.forEach((key, i) => {
          // GROUP-002（2026-07-28 覆盖率片五落地；暂定口径，待 oracle）：
          // **list 键扇出**——一行进入其每个元素的组（`groupBy: tags` 的自然语义：
          // 一篇多标签笔记应出现在每个标签下）。代价是「组内行数之和 ≥ rows.length」，
          // 已在 BaseQueryResult.groups 契约里显式声明；顶层 rows 仍是平铺一份，不变。
          if (Array.isArray(key)) {
            // 行内元素先 typedEqual 去重：`[a, a]` 不得把同一行塞进同一组两次。
            const seen: BaseValue[] = [];
            for (const el of key) {
              spendGroup();
              if (seen.some((s) => typedEqual(s, el))) continue;
              seen.push(el);
            }
            // 空 list 视同 MISSING 键（单独成组），**不静默丢行**。
            if (seen.length === 0) putInBucket(MISSING, i);
            else for (const el of seen) putInBucket(el, i);
            return;
          }
          // link 是**标量**键（不是多值）：按路径感知相等分组，与 list 分道处理。
          putInBucket(key, i);
        });
        // 组序：groupKeyCompare（恒 ASC 语义，DESC 整体取反——沿用顶层 sort 的既有口径，
        // null/MISSING/不可比键在同 rank 组内按首现序稳定）；桶内行序 = limited 顺序
        // （= view sort + file.path tie-break，与顶层 rows 同一比较器结果）。
        buckets.sort((a, b) => {
          const c = groupKeyCompare(a.key, b.key);
          return groupBy.direction === "DESC" ? -c : c;
        });
        groups = buckets.map((b) => ({
          key: toOutputValue(b.key),
          rows: b.rowIdx.map((i) => outRows[i] as Record<string, BaseOutputValue>),
        }));
        groupBuckets = buckets;
      }

      // ---- summaries（P2b 片三，计划「关键取舍」#10/#11，BASE-SUM-001 / SUM-002 暂定）----
      // 计算集 = filter 后 limit 前全量（暂定口径）；groupBy 同现时仍按全量集计算一份——
      // 组级汇总属官方 UI 形态，无头 JSON 暂不做，注释标注。
      let summariesOut: Record<string, BaseOutputValue> | undefined;
      if (plan.summaries.length > 0) {
        summariesOut = {};
        // 汇总迭代/比较预算（Unique 的 O(n²) 去重等）：扣查询级共享总额，同 groupBy 的理由。
        const spendSummary = (): void => spendShared(opsBudget, limits);
        for (const s of plan.summaries) {
          // 目标列逐行求值（行级错误 → MISSING 进列表，由内置口径跳过/Empty 计数）。
          const values = filtered.map((row) =>
            evaluateExpression(
              s.ast,
              row,
              rowEvalContext(row, (info) =>
                pushRowDiagnostic(view.span, s.property, info, row.file.path),
              ),
            ),
          );
          const builtin = BUILTIN_SUMMARIES.get(s.name);
          if (builtin !== undefined) {
            summariesOut[s.property] = toOutputValue(
              runBuiltinSummary(builtin, values, spendSummary),
            );
            continue;
          }
          // 顶层自定义汇总（SUM-002 暂定）：隐式 values 作用域 = 目标列跨行**非空**值列表
          // （null/MISSING 剔除，与内置「空值跳过」口径对齐——mean 等 list 聚合遇空值即类型
          // 错误，剔除后官方示例 values.mean().round(3) 可用）；无行上下文：values 之外
          // note/file 属性为 MISSING（禁止访问行外状态，见 evaluator EvalContext.summaryValues）。
          const custom = plan.customSummaries[s.name] as CompiledCustomSummary; // 名字合法性 planner 已核验
          const scopeValues = values.filter((v) => v !== MISSING && v !== null);
          const value = evaluateExpression(custom.ast, SUMMARY_ROW, {
            limits,
            ...(options.clock !== undefined ? { clock: options.clock } : {}),
            summaryValues: scopeValues,
            sharedBudget: opsBudget,
            onRowError: (info) =>
              pushRowDiagnostic(custom.span, custom.source, info, `汇总 ${s.name}`),
          });
          summariesOut[s.property] = toOutputValue(value);
        }

        // ---- 组级汇总（2026-07-28 覆盖率片五，SUM-002 收口）----
        // 口径变更留档：P2b 曾判「组级汇总属官方 UI 形态，无头 JSON 暂不做」。片五 GROUP-002
        // 落地后 groups 成为一等产物，「有组没有组的汇总」是半个功能，故补上。
        // **计算集与顶层不同，有意为之**：顶层 summaries = filter 后 **limit 前**全量；
        // 组级 = 该组在 **limit 后**的行——因为组本身就建立在 limit 后行集上，用 limit 前的
        // 集合去配 limit 后的组会给出「组里看不见的行也算进汇总」的怪结果。
        if (groups !== undefined && groupBuckets !== undefined) {
          const perRowValues = plan.summaries.map((s) =>
            limited.map(({ row }) =>
              evaluateExpression(
                s.ast,
                row,
                rowEvalContext(row, (info) =>
                  pushRowDiagnostic(view.span, s.property, info, row.file.path),
                ),
              ),
            ),
          );
          groups = groups.map((g, gi) => {
            const idx = (groupBuckets as { rowIdx: number[] }[])[gi]?.rowIdx ?? [];
            const out: Record<string, BaseOutputValue> = {};
            for (let si = 0; si < plan.summaries.length; si += 1) {
              const s = plan.summaries[si] as (typeof plan.summaries)[number];
              const values = idx.map((i) => (perRowValues[si] as BaseValue[])[i] as BaseValue);
              const builtin = BUILTIN_SUMMARIES.get(s.name);
              if (builtin !== undefined) {
                out[s.property] = toOutputValue(runBuiltinSummary(builtin, values, spendSummary));
                continue;
              }
              const custom = plan.customSummaries[s.name] as CompiledCustomSummary;
              const value = evaluateExpression(custom.ast, SUMMARY_ROW, {
                limits,
                ...(options.clock !== undefined ? { clock: options.clock } : {}),
                summaryValues: values.filter((v) => v !== MISSING && v !== null),
                sharedBudget: opsBudget,
                onRowError: (info) =>
                  pushRowDiagnostic(custom.span, custom.source, info, `汇总 ${s.name}`),
              });
              out[s.property] = toOutputValue(value);
            }
            return { ...g, summaries: out };
          });
        }
      }

      flushSuppressed();
      return {
        conformance: effectiveConformance, // 实际生效口径（降级时已改写为 markdown）
        base,
        view: view.name,
        columns: plan.columns,
        total,
        rows: outRows,
        ...(groups !== undefined ? { groups } : {}),
        ...(summariesOut !== undefined ? { summaries: summariesOut } : {}),
        diagnostics,
      };
    } catch (e) {
      const failure = budgetFailure(e);
      if (failure !== undefined) return failure;
      throw e;
    }
  }
}

/**
 * 求值编译后 filter 树于一行（深度已被文档层 maxFilterDepth 限住，递归安全）。
 * - expr：evaluateExpression 返回值的 truthy（行级错误 → MISSING → false，该行不通过）；
 * - and：全部通过（短路）；or：任一通过（短路）；
 * - not：不满足其中任何一项 = NOT(child1 OR child2 ...)（设计 §6）。
 *
 * 空 children 的三个默认值由 every/some 天然给出：`and:[]`=真、`or:[]`=假、`not:[]`=真
 * ——与官方 1.12.7 实测一致（oracle runbook ④），故 planner 放行空数组后此处无需特判。
 * BaseBudgetError 不在此吞掉，继续上抛（engine 转 execution-budget + 空结果）。
 *
 * 求值上下文（注入时钟 / 公式 accessor / types.json 类型表 / 查询级共享预算）由调用方经
 * `makeContext` 装配注入——与投影 / sort / groupBy / summaries 共用同一处装配，杜绝漏传字段。
 */
function evalFilter(
  node: CompiledFilter,
  row: BaseRow,
  pushRowDiagnostic: (
    span: SourceSpan,
    source: string,
    info: BaseRowErrorInfo,
    rowPath: string,
  ) => void,
  makeContext: (row: BaseRow, onRowError: (info: BaseRowErrorInfo) => void) => EvalContext,
): boolean {
  switch (node.kind) {
    case "expr": {
      const value = evaluateExpression(
        node.ast,
        row,
        makeContext(row, (info) => pushRowDiagnostic(node.span, node.source, info, row.file.path)),
      );
      return truthy(value);
    }
    case "and":
      return node.children.every((child) => evalFilter(child, row, pushRowDiagnostic, makeContext));
    case "or":
      return node.children.some((child) => evalFilter(child, row, pushRowDiagnostic, makeContext));
    case "not":
      return !node.children.some((child) => evalFilter(child, row, pushRowDiagnostic, makeContext));
  }
}

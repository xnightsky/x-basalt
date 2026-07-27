/**
 * base 文档层主入口：loadBaseDocument() 读取并校验 .base（YAML + schema + filter 结构 + 表达式浅扫描），
 * selectView() 按名选择 view。
 *
 * 职责链（顺序即防线，任一终止性失败立即返回、不继续向下）：
 *   路径越界检查（resolve 后必须落在 vaultRoots 内，读取前拒绝）
 *   → 文档大小预算（stat 预判，超限不读内容）
 *   → yaml parseDocument（LineCounter 换算行列）+ alias 预算（toJS maxAliasCount）
 *   → schema 校验（views / view name / limit / 未知 key / unsupported feature / formulas、
 *     view 级 groupBy/summaries 与顶层 summaries 结构）
 *   → filter 结构校验（迭代 + 显式深度计数，禁递归）
 *   → 表达式浅扫描（expressions.ts）
 *
 * 上游：P1 engine / 未来 CLI 薄出口；下游：src/diagnostic.ts 契约、src/base/{types,errors,expressions}。
 * 不变量：本模块是 .base 的唯一读取边界——只经 fs 读、不写任何 vault 文件、无 eval/new Function。
 * 设计真相源：docs/specs/2026-07-22-bases-headless-engine-design.md §5/§6/§11/§12。
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Pair,
  type Scalar,
} from "yaml";
import type { BasaltDiagnostic } from "../diagnostic.js";
import { isPathInside, resolveVaultLayout } from "../utils/path.js";
import { BASE_RULES, baseDiagnostic } from "./errors.js";
import { scanExpression } from "./expressions.js";
import {
  DEFAULT_BASE_DOCUMENT_LIMITS,
  type BaseDocument,
  type BaseDocumentLimits,
  type BaseFilter,
  type BaseFormulaDef,
  type BaseView,
  type BaseViewGroupBy,
  type BaseViewSort,
  type SourceSpan,
} from "./types.js";

// === 自建实现 ===

/** loadBaseDocument 入参。 */
export interface LoadBaseDocumentOptions {
  /** .base 路径（vault 相对或绝对；相对路径按 cwd resolve）。 */
  basePath: string;
  /** 允许的 vault 根（resolve 后 basePath 必须落在其内，读取前拒绝越界）。 */
  vaultRoots: string[];
  /** 文档层预算覆盖（缺省用 {@link DEFAULT_BASE_DOCUMENT_LIMITS}）。 */
  limits?: Partial<BaseDocumentLimits>;
}

/** selectView 结果：命中的 view + 本次选择新产的诊断（不含 loadBaseDocument 已聚合的）。 */
export interface SelectViewResult {
  view?: BaseView;
  diagnostics: BasaltDiagnostic[];
}

/** 已知但未支持的顶层特性 key（设计 §5：解析并给 base/unsupported-feature，不执行）。
 * P2a：formulas 已移出本集合（落地执行，见 parseFormulas）；
 * P2b 片三：summaries 已移出（顶层自定义汇总，同 parseFormulas 模式）；
 * 顶层 groupBy 仍拒绝（groupBy 属 view 级配置，顶层形态不在本片范围）。 */
const UNSUPPORTED_FEATURE_KEYS = new Set(["groupBy"]);

/** view 内已知但未支持的特性 key（官方 Bases 中 formulas 只在顶层，view 内出现仍拒绝）。
 * P2b 片三：view 级 groupBy / summaries 已移出（落地执行，见 validateView）。 */
const VIEW_UNSUPPORTED_FEATURE_KEYS = new Set(["formulas"]);

/** 已知但未支持的 view type（设计 §5；选中即不可执行，故 error）。 */
const UNSUPPORTED_VIEW_TYPES = new Set(["cards", "list", "map"]);

/** P0 支持的 view type（仅 table，见设计 §5 schema 子集）。 */
const SUPPORTED_VIEW_TYPES = new Set(["table"]);

/** filter 对象允许的唯一 key（设计 §6）。 */
const FILTER_LOGIC_KEYS = new Set(["and", "or", "not"]);

/** view 内已知 key（其余按 warning 处理，见下方 validateView 注释）。 */
const KNOWN_VIEW_KEYS = new Set([
  "type",
  "name",
  "filters",
  "order",
  "sort",
  "limit",
  // P2b 片三增量：view 级分组与汇总（结构解析见 parseGroupBy / parseViewSummaries）
  "groupBy",
  "summaries",
  ...VIEW_UNSUPPORTED_FEATURE_KEYS,
]);

/** LineCounter.linePos 的 {line, col} → SourceSpan（col 即 UTF-16 code unit 列，1-based）。 */
function spanOf(lineCounter: LineCounter, offset: number): SourceSpan {
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

/** YAML 节点起点 → 完整文件位置（range[0] 为节点在源文本的 UTF-16 offset；非节点兜底 1:1）。 */
function nodeSpan(lineCounter: LineCounter, node: unknown): SourceSpan {
  if (!isNode(node)) return { line: 1, column: 1 };
  const range = node.range;
  return range ? spanOf(lineCounter, range[0]) : { line: 1, column: 1 };
}

/**
 * 表达式 scalar 的值起点 offset：引号包裹的 scalar 其 range[0] 指向引号本身，值起点需 +1；
 * 块级/多行 scalar 的折叠语义不在 P0 浅扫描保证范围内——offset 始终基于源文本原始字节，
 * 折叠 scalar 内换行处列号会指向原文本位置而非折叠后逻辑位置（如实记录，不伪造）。
 */
function scalarValueOffset(source: string, scalar: Scalar): number {
  const start = scalar.range?.[0] ?? 0;
  const ch = source[start];
  return ch === '"' || ch === "'" ? start + 1 : start;
}

/** 空文档占位（终止性失败时返回：views 为空、诊断已聚合）。 */
function emptyDocument(
  path: string,
  diagnostics: BasaltDiagnostic[],
  viewsSpan: SourceSpan = { line: 1, column: 1 },
): BaseDocument {
  return { path, views: [], unknownKeys: {}, viewsSpan, diagnostics };
}

/** 路径解析结果：ok=落在 vault 内；否则 reason 为人读拒绝原因（不同原因不混成「越界」）。 */
type VaultResolution =
  | { ok: true; abs: string; rel: string }
  | { ok: false; reason: string; detail: string };

/**
 * 路径安全：resolve 后必须落在某个 vault root 内（先 resolve 再判定，读取前拒绝，
 * 覆盖 `..` 越界与绝对路径绕出，BASE-SEC-008）。
 *
 * 根集合与 rel 主键一律经 {@link resolveVaultLayout} 计算，与 indexer 写入 `files.path`
 * 用的是同一个函数——多根下 rel 因此带 `<根目录名>/` 命名空间前缀，与行的 `file.path`
 * 同一套键（此前本函数自行 `relative()`，多根时 `.base` 路径缺前缀，同一结果里两套键）。
 * 包含判定复用 {@link isPathInside}（Windows 盘符大小写不敏感，避免合法路径被安全门假阳拒绝）。
 */
function resolveInsideVault(basePath: string, vaultRoots: string[]): VaultResolution {
  const abs = resolve(basePath);
  let layout: ReturnType<typeof resolveVaultLayout>;
  try {
    layout = resolveVaultLayout(vaultRoots);
  } catch (e) {
    // 空根 / 多根目录名冲突：无法判定归属，一律拒绝执行——但如实报真实原因，
    // 不混进「路径越界」（读出方据此改的东西完全不同）。
    return { ok: false, reason: "invalid_vault_roots", detail: (e as Error).message };
  }
  if (!layout.roots.some((root) => isPathInside(abs, root))) {
    return { ok: false, reason: "outside_vault", detail: `.base 路径越出 vault 根：${basePath}` };
  }
  return { ok: true, abs, rel: layout.toKey(abs) };
}

/**
 * 读取并校验一个 .base 文档，产出 BaseDocument + 聚合诊断（不 throw，终止性问题以 error 诊断表达）。
 *
 * @behavior
 * Given basePath resolve 后越出所有 vaultRoots（`..` 或绝对路径绕出）
 * When loadBaseDocument
 * Then 在文件读取前返回 base/path-outside-vault（error），不读任何字节
 *
 * @behavior
 * Given 文档字节数超 maxDocumentBytes
 * When loadBaseDocument
 * Then stat 预判命中即返回 base/execution-budget（error），不读取内容
 *
 * @behavior
 * Given 非法 YAML 或 alias 数量超预算（alias bomb）
 * When loadBaseDocument
 * Then 分别返回 base/invalid-yaml / base/execution-budget（error，带完整文件位置），执行终止
 *
 * @behavior
 * Given 合法文档
 * When loadBaseDocument
 * Then 返回 views/unknownKeys（未知顶层 key 原值保留）与全部 warning 级以下诊断
 */
export function loadBaseDocument(options: LoadBaseDocumentOptions): BaseDocument {
  const limits: BaseDocumentLimits = { ...DEFAULT_BASE_DOCUMENT_LIMITS, ...options.limits };

  // 防线 1：路径越界（BASE-SEC-008）——读取前拒绝。文件位置未知，诊断定位 1:1、file 用原始输入。
  const resolved = resolveInsideVault(options.basePath, options.vaultRoots);
  if (!resolved.ok) {
    return emptyDocument(options.basePath, [
      baseDiagnostic(
        options.basePath,
        { line: 1, column: 1 },
        BASE_RULES.pathOutsideVault,
        "error",
        `${resolved.detail}（读取前拒绝）`,
        { target: options.basePath, reason: resolved.reason },
      ),
    ]);
  }
  const { abs, rel } = resolved;

  // 防线 2：文档大小预算——stat 预判，超限不读内容（BASE-SEC-007 尺寸维度）。
  let size: number;
  try {
    size = statSync(abs).size;
  } catch {
    return emptyDocument(rel, [
      baseDiagnostic(
        rel,
        { line: 1, column: 1 },
        BASE_RULES.invalidYaml,
        "error",
        `无法读取 .base 文件：${rel}`,
        { reason: "unreadable" },
      ),
    ]);
  }
  if (size > limits.maxDocumentBytes) {
    return emptyDocument(rel, [
      baseDiagnostic(
        rel,
        { line: 1, column: 1 },
        BASE_RULES.executionBudget,
        "error",
        `.base 文档 ${size} 字节超过预算上限 ${limits.maxDocumentBytes}（读取前拒绝）`,
        { reason: "document_too_large" },
      ),
    ]);
  }
  const source = readFileSync(abs, "utf8");

  // 防线 3：YAML 解析。安全默认 schema；LineCounter 供全部诊断换算完整文件行列。
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  if (doc.errors.length > 0) {
    const diagnostics = doc.errors.map((err) => {
      const pos = err.linePos?.[0];
      return baseDiagnostic(
        rel,
        pos ? { line: pos.line, column: pos.col } : { line: 1, column: 1 },
        BASE_RULES.invalidYaml,
        "error",
        `非法 YAML：${err.message.split("\n")[0]}`,
        { reason: err.code },
      );
    });
    return emptyDocument(rel, diagnostics);
  }

  // alias 预算：yaml 包在 toJS 解析 alias 时强制 maxAliasCount（parse 阶段不查），
  // 超限抛 "Excessive alias count"——转为 base/execution-budget（BASE-SEC-007 alias 维度）。
  // 位置无法从该异常还原，如实定位文档起点 1:1，不伪造精确行列。
  let js: unknown;
  try {
    js = doc.toJS({ maxAliasCount: limits.maxYamlAliases });
  } catch {
    return emptyDocument(rel, [
      baseDiagnostic(
        rel,
        { line: 1, column: 1 },
        BASE_RULES.executionBudget,
        "error",
        `YAML alias 数量超过预算上限 ${limits.maxYamlAliases}（疑似 alias bomb，解析已终止）`,
        { reason: "yaml_alias_limit" },
      ),
    ]);
  }

  const diagnostics: BasaltDiagnostic[] = [];
  const result: BaseDocument = {
    path: rel,
    views: [],
    unknownKeys: {},
    viewsSpan: { line: 1, column: 1 },
    diagnostics,
  };

  // 顶层必须是 map；空文档（contents=null）按 views 缺失处理。
  if (doc.contents === null) {
    diagnostics.push(
      baseDiagnostic(
        rel,
        { line: 1, column: 1 },
        BASE_RULES.viewRequired,
        "error",
        "views 缺失或为空：.base 至少需要一个 view",
      ),
    );
    return result;
  }
  if (!isMap(doc.contents)) {
    diagnostics.push(
      baseDiagnostic(
        rel,
        nodeSpan(lineCounter, doc.contents),
        BASE_RULES.invalidSchema,
        "error",
        ".base 顶层必须是 YAML map",
      ),
    );
    return result;
  }

  // 顶层 key 遍历：已知 key 校验、未支持特性 error、未知 key warning + 保留原值。
  const jsTop = (js ?? {}) as Record<string, unknown>;
  let viewsPair: Pair | undefined;
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key)) {
      diagnostics.push(
        baseDiagnostic(
          rel,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          "顶层 key 必须是标量",
        ),
      );
      continue;
    }
    const key = String(pair.key.value);
    const keySpan = nodeSpan(lineCounter, pair.key);

    if (key === "views") {
      viewsPair = pair;
      result.viewsSpan = keySpan;
      continue;
    }
    if (key === "filters") {
      if (pair.value !== null) {
        const filter = validateFilter(pair.value, rel, source, lineCounter, limits, diagnostics);
        if (filter !== undefined) result.filters = filter;
      }
      continue;
    }
    if (key === "properties") {
      result.properties = parseProperties(pair.value, rel, lineCounter, diagnostics);
      continue;
    }
    if (key === "formulas") {
      if (pair.value !== null) {
        const formulas = parseFormulas(pair.value, rel, source, lineCounter, limits, diagnostics);
        if (formulas !== undefined) result.formulas = formulas;
      }
      continue;
    }
    if (key === "summaries") {
      // 顶层 summaries（P2b 片三，SUM-002 暂定）：自定义汇总表达式 map，结构同 formulas
      // （浅扫描照旧）；view 内 summaries 引用其名的合法性在 planner 核验。
      if (pair.value !== null) {
        const summaries = parseFormulas(
          pair.value,
          rel,
          source,
          lineCounter,
          limits,
          diagnostics,
          "summaries",
          "汇总",
        );
        if (summaries !== undefined) result.summaries = summaries;
      }
      continue;
    }
    if (UNSUPPORTED_FEATURE_KEYS.has(key)) {
      diagnostics.push(
        baseDiagnostic(
          rel,
          keySpan,
          BASE_RULES.unsupportedFeature,
          "error",
          `暂不支持顶层特性 "${key}"（groupBy 属 view 级配置，请移入具体 view）`,
          { target: key },
        ),
      );
      continue;
    }
    // 未知顶层 key：warning 并保留原值（设计 §5 向前兼容口径）。
    result.unknownKeys[key] = jsTop[key];
    diagnostics.push(
      baseDiagnostic(
        rel,
        keySpan,
        BASE_RULES.invalidSchema,
        "warning",
        `未知顶层 key "${key}"（原值保留，不影响已知字段执行）`,
        { target: key, reason: "unknown_top_level_key" },
      ),
    );
  }

  validateViews(viewsPair, result, rel, source, lineCounter, limits, diagnostics);
  return result;
}

/** properties 段：仅记录 <property-ref> → { displayName } 结构（合法性 P1 再验）。 */
function parseProperties(
  value: unknown,
  file: string,
  lineCounter: LineCounter,
  diagnostics: BasaltDiagnostic[],
): Record<string, { displayName?: string }> | undefined {
  if (value === null) return undefined;
  if (!isMap(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        nodeSpan(lineCounter, value),
        BASE_RULES.invalidSchema,
        "error",
        "properties 必须是 map（<property-ref> → { displayName }）",
      ),
    );
    return undefined;
  }
  const out: Record<string, { displayName?: string }> = {};
  for (const pair of value.items) {
    if (!isScalar(pair.key)) continue;
    const name = String(pair.key.value);
    const entry: { displayName?: string } = {};
    if (isMap(pair.value)) {
      const display = pair.value.get("displayName", true);
      if (isScalar(display) && typeof display.value === "string") {
        entry.displayName = display.value;
      }
    }
    out[name] = entry;
  }
  return out;
}

// === Obsidian 规范来源: Bases 公式名为表达式标识符（同 tokens.ts IDENT_BODY 口径）===
/** 公式名校验：Unicode 字母/_ 起，后续可含数字（与表达式标识符同一口径）。 */
const FORMULA_NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * formulas 段解析（P2a 计划「关键取舍」#5）：结构校验 + 浅扫描，不编译表达式本体
 * （parseBaseExpression 编译与依赖图建图在 planner，同 filter 的分层模式）。
 *
 * P2b 片三起被顶层 summaries 复用（label/noun 参数化消息文案）：自定义汇总表达式与
 * 公式同形态（<名> → <表达式字符串>），仅求值语境不同（隐式 `values` 作用域，SUM-002 暂定）。
 *
 * 结构契约（违反 → base/invalid-schema error，带完整文件位置）：
 * - 必须是 map（<名> → <表达式字符串>）；
 * - key 必须是合法标识符（{@link FORMULA_NAME_RE}，同表达式标识符口径）；
 * - value 必须是字符串（表达式原文）。
 * 合法项照常做 scanExpression 浅扫描（白名单核对 + token 预算），位置换算同 filter 表达式。
 */
function parseFormulas(
  value: unknown,
  file: string,
  source: string,
  lineCounter: LineCounter,
  limits: BaseDocumentLimits,
  diagnostics: BasaltDiagnostic[],
  label = "formulas",
  noun = "公式",
): Record<string, BaseFormulaDef> | undefined {
  if (!isMap(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        nodeSpan(lineCounter, value),
        BASE_RULES.invalidSchema,
        "error",
        `${label} 必须是 map（<${noun}名> → <表达式字符串>）`,
      ),
    );
    return undefined;
  }
  const out: Record<string, BaseFormulaDef> = {};
  for (const pair of value.items) {
    if (!isScalar(pair.key)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          `${label} 的 key 必须是标量${noun}名`,
        ),
      );
      continue;
    }
    const name = String(pair.key.value);
    if (!FORMULA_NAME_RE.test(name)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          `${noun}名 "${name}" 不是合法标识符（须 Unicode 字母或 _ 起，后续可含数字）`,
          { target: name },
        ),
      );
      continue;
    }
    const scalar = pair.value;
    if (!isScalar(scalar) || typeof scalar.value !== "string") {
      diagnostics.push(
        baseDiagnostic(
          file,
          scalar !== null ? nodeSpan(lineCounter, scalar) : nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          `${noun} "${name}" 的值必须是表达式字符串`,
          { target: name },
        ),
      );
      continue;
    }
    out[name] = { expr: scalar.value, span: nodeSpan(lineCounter, scalar) };
    // 表达式浅扫描：位置 = YAML scalar 值起点 + 表达式内 UTF-16 offset（与 filter 同款口径）。
    const valueOffset = scalarValueOffset(source, scalar);
    for (const finding of scanExpression(scalar.value, limits.maxExpressionNodes)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          spanOf(lineCounter, valueOffset + finding.offset),
          finding.rule,
          "error",
          finding.message,
          { target: finding.target },
        ),
      );
    }
  }
  return out;
}

/** views 段校验：缺失/空 → view-required；逐项校验 view map。 */
function validateViews(
  viewsPair: Pair | undefined,
  result: BaseDocument,
  file: string,
  source: string,
  lineCounter: LineCounter,
  limits: BaseDocumentLimits,
  diagnostics: BasaltDiagnostic[],
): void {
  if (viewsPair === undefined || viewsPair.value === null) {
    diagnostics.push(
      baseDiagnostic(
        file,
        result.viewsSpan,
        BASE_RULES.viewRequired,
        "error",
        "views 缺失或为空：.base 至少需要一个 view",
      ),
    );
    return;
  }
  const seq = viewsPair.value;
  if (!isSeq(seq)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        nodeSpan(lineCounter, seq),
        BASE_RULES.invalidSchema,
        "error",
        "views 必须是数组",
      ),
    );
    return;
  }
  if (seq.items.length === 0) {
    diagnostics.push(
      baseDiagnostic(
        file,
        result.viewsSpan,
        BASE_RULES.viewRequired,
        "error",
        "views 缺失或为空：.base 至少需要一个 view",
      ),
    );
    return;
  }
  const seenNames = new Set<string>();
  for (const item of seq.items) {
    if (item === null) continue;
    const view = validateView(item, file, source, lineCounter, limits, diagnostics, seenNames);
    if (view !== undefined) result.views.push(view);
  }
}

/**
 * 单个 view 校验：type/name/limit/order/sort/filters + unsupported feature/view type。
 *
 * view 内未知 key 的 P0 口径：warning（不保留原值）。设计 §5「未知已知结构内部 key 按是否
 * 影响结果分别 warning/error」的精确分界属 P1——P0 已支持的字段不受未知 view key 影响，
 * 故一律 warning 并注释，不静默丢弃。
 */
function validateView(
  item: unknown,
  file: string,
  source: string,
  lineCounter: LineCounter,
  limits: BaseDocumentLimits,
  diagnostics: BasaltDiagnostic[],
  seenNames: Set<string>,
): BaseView | undefined {
  if (!isMap(item)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        nodeSpan(lineCounter, item),
        BASE_RULES.invalidSchema,
        "error",
        "view 必须是 map（至少含 type 与 name）",
      ),
    );
    return undefined;
  }
  const span = nodeSpan(lineCounter, item);
  let type = "";
  let name = "";
  // 必填项的「键是否出现过」与其位置：缺失校验必须在 key 循环**之外**做（见循环后注释）。
  let sawType = false;
  let sawName = false;
  let nameSpan: SourceSpan | undefined;
  let filters: BaseFilter | undefined;
  let order: string[] | undefined;
  let sort: BaseViewSort[] | undefined;
  let limit: number | undefined;
  let groupBy: BaseViewGroupBy | undefined;
  let summaries: Record<string, string> | undefined;

  for (const pair of item.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const value = pair.value;
    const valueSpan = value !== null ? nodeSpan(lineCounter, value) : spanOf(lineCounter, 0);

    if (VIEW_UNSUPPORTED_FEATURE_KEYS.has(key)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.unsupportedFeature,
          "error",
          `暂不支持特性 "${key}"（官方 Bases 中 formulas 只在顶层，view 内出现仍拒绝）`,
          { target: key },
        ),
      );
      continue;
    }
    if (!KNOWN_VIEW_KEYS.has(key)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "warning",
          `view 内未知 key "${key}"（不影响 P0 已支持字段执行）`,
          { target: key, reason: "unknown_view_key" },
        ),
      );
      continue;
    }

    switch (key) {
      case "type": {
        sawType = true;
        type = isScalar(value) && typeof value.value === "string" ? value.value : "";
        if (UNSUPPORTED_VIEW_TYPES.has(type)) {
          diagnostics.push(
            baseDiagnostic(
              file,
              valueSpan,
              BASE_RULES.unsupportedFeature,
              "error",
              `暂不支持 view type "${type}"（P0 仅支持 table）`,
              { target: type, suggestions: [...SUPPORTED_VIEW_TYPES] },
            ),
          );
        } else if (!SUPPORTED_VIEW_TYPES.has(type)) {
          diagnostics.push(
            baseDiagnostic(
              file,
              valueSpan,
              BASE_RULES.unsupportedViewType,
              "error",
              `未知 view type "${type}"（可能来自插件；不按 table 猜测）`,
              { target: type, suggestions: [...SUPPORTED_VIEW_TYPES] },
            ),
          );
        }
        break;
      }
      case "name": {
        // 空值/重名判定统一放到循环外：与「name 键整个缺失」共用一条出口，
        // 否则缺 name 的 view 拿到 name=""，既不报错也不参与重名判定。
        sawName = true;
        nameSpan = valueSpan;
        name = isScalar(value) && typeof value.value === "string" ? value.value : "";
        break;
      }
      case "limit": {
        // 与 BASE-RESULT-003 对齐：负数/非整数一律 invalid-schema。
        if (!isScalar(value) || typeof value.value !== "number") {
          diagnostics.push(
            baseDiagnostic(
              file,
              valueSpan,
              BASE_RULES.invalidSchema,
              "error",
              "limit 必须是非负整数",
            ),
          );
        } else if (!Number.isInteger(value.value) || value.value < 0) {
          diagnostics.push(
            baseDiagnostic(
              file,
              valueSpan,
              BASE_RULES.invalidSchema,
              "error",
              `limit 必须是非负整数（实际 ${value.value}）`,
            ),
          );
        } else {
          limit = value.value;
        }
        break;
      }
      case "filters": {
        if (value !== null) {
          const filter = validateFilter(value, file, source, lineCounter, limits, diagnostics);
          if (filter !== undefined) filters = filter;
        }
        break;
      }
      case "order": {
        // property-ref 形态（note.x / file.x / 裸属性）只做结构记录，合法性 P1 再验。
        order = parseStringSeq(value, file, lineCounter, diagnostics, "order");
        break;
      }
      case "sort": {
        sort = parseSort(value, file, lineCounter, diagnostics);
        break;
      }
      case "groupBy": {
        groupBy = parseGroupBy(value, file, lineCounter, diagnostics);
        break;
      }
      case "summaries": {
        summaries = parseViewSummaries(value, file, lineCounter, diagnostics);
        break;
      }
    }
  }

  // 必填项校验只能在 key 循环之外做：上面的 switch 按「出现的 key」分派，
  // 键**整个缺失**时一条分支都不跑。曾因此漏掉两类静默失败——
  //   缺 type → type=""，engine 照 table 执行完（与 unsupported-view-type「不按 table 猜测」矛盾）；
  //   缺 name → name=""，零诊断且逃过重名判定（两个无名 view 都能进 views）。
  if (!sawType) {
    diagnostics.push(
      baseDiagnostic(
        file,
        span,
        BASE_RULES.invalidSchema,
        "error",
        "view 缺少必填字段 type（缺失不按 table 猜测，同未知 type 口径）",
        { target: "type", reason: "missing_view_type", suggestions: [...SUPPORTED_VIEW_TYPES] },
      ),
    );
  }
  if (name === "") {
    diagnostics.push(
      baseDiagnostic(
        file,
        nameSpan ?? span,
        BASE_RULES.invalidSchema,
        "error",
        sawName ? "view name 必须是非空字符串" : "view 缺少必填字段 name",
        { target: "name", reason: sawName ? "empty_view_name" : "missing_view_name" },
      ),
    );
  } else if (seenNames.has(name)) {
    // 重名直接 error：避免命名选择歧义（设计 §5）。
    diagnostics.push(
      baseDiagnostic(
        file,
        nameSpan ?? span,
        BASE_RULES.duplicateViewName,
        "error",
        `view 重名 "${name}"（拒绝歧义选择）`,
        { target: name },
      ),
    );
  } else {
    seenNames.add(name);
  }

  return { type, name, filters, order, sort, limit, groupBy, summaries, span };
}

/**
 * view 级 groupBy 解析（P2b 片三，计划「关键取舍」#8）：结构同 sort 项
 * `{ property: <非空字符串 property-ref>, direction: ASC|DESC（缺省 ASC） }`。
 * 非 map / property 空 / direction 非法 → base/invalid-schema（error，带位置），返回 undefined。
 * property-ref 的表达式合法性不在此校验（planner 编译时核验，同 sort 模式）。
 */
function parseGroupBy(
  value: unknown,
  file: string,
  lineCounter: LineCounter,
  diagnostics: BasaltDiagnostic[],
): BaseViewGroupBy | undefined {
  if (!isMap(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        value !== null ? nodeSpan(lineCounter, value) : { line: 1, column: 1 },
        BASE_RULES.invalidSchema,
        "error",
        "groupBy 必须是 { property, direction } map",
      ),
    );
    return undefined;
  }
  const property = value.get("property", true);
  const prop = isScalar(property) && typeof property.value === "string" ? property.value : "";
  if (prop === "") {
    diagnostics.push(
      baseDiagnostic(
        file,
        isScalar(property) ? nodeSpan(lineCounter, property) : nodeSpan(lineCounter, value),
        BASE_RULES.invalidSchema,
        "error",
        "groupBy.property 必须是非空字符串（property-ref）",
      ),
    );
    return undefined;
  }
  const direction = value.get("direction", true);
  const dir = isScalar(direction) && typeof direction.value === "string" ? direction.value : "ASC";
  if (dir !== "ASC" && dir !== "DESC") {
    diagnostics.push(
      baseDiagnostic(
        file,
        isScalar(direction) ? nodeSpan(lineCounter, direction) : nodeSpan(lineCounter, value),
        BASE_RULES.invalidSchema,
        "error",
        `groupBy.direction 必须是 ASC 或 DESC（实际 "${dir}"）`,
      ),
    );
    return undefined;
  }
  return { property: prop, direction: dir };
}

/**
 * view 级 summaries 解析（P2b 片三，计划「关键取舍」#10）：
 * map（<property-ref> → <汇总名>），key 与值均须非空字符串；
 * 非法项 → base/invalid-schema（error，带位置）并跳过该项。
 * 汇总名合法性（内置 15 名 / 顶层自定义名）不在此校验（planner 核验，base/unknown-function）。
 */
function parseViewSummaries(
  value: unknown,
  file: string,
  lineCounter: LineCounter,
  diagnostics: BasaltDiagnostic[],
): Record<string, string> | undefined {
  if (!isMap(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        value !== null ? nodeSpan(lineCounter, value) : { line: 1, column: 1 },
        BASE_RULES.invalidSchema,
        "error",
        "summaries 必须是 map（<property-ref> → <汇总名>）",
      ),
    );
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const pair of value.items) {
    if (!isScalar(pair.key)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          "summaries 的 key 必须是标量 property-ref",
        ),
      );
      continue;
    }
    const prop = String(pair.key.value);
    const scalar = pair.value;
    if (
      prop === "" ||
      !isScalar(scalar) ||
      typeof scalar.value !== "string" ||
      scalar.value === ""
    ) {
      diagnostics.push(
        baseDiagnostic(
          file,
          scalar !== null ? nodeSpan(lineCounter, scalar) : nodeSpan(lineCounter, pair.key),
          BASE_RULES.invalidSchema,
          "error",
          `summaries 条目 "${prop}" 的 property-ref 与汇总名均须为非空字符串`,
          { target: prop },
        ),
      );
      continue;
    }
    out[prop] = scalar.value;
  }
  return out;
}

/** order：必须是字符串数组（结构校验，property-ref 语义 P1）。 */
function parseStringSeq(
  value: unknown,
  file: string,
  lineCounter: LineCounter,
  diagnostics: BasaltDiagnostic[],
  label: string,
): string[] | undefined {
  if (!isSeq(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        value !== null ? nodeSpan(lineCounter, value) : { line: 1, column: 1 },
        BASE_RULES.invalidSchema,
        "error",
        `${label} 必须是字符串数组`,
      ),
    );
    return undefined;
  }
  const out: string[] = [];
  for (const item of value.items) {
    if (isScalar(item) && typeof item.value === "string") {
      out.push(item.value);
      continue;
    }
    // 非字符串项不静默丢弃：静默会让 `order: [file.name, 42]` 少投影一列且无从察觉。
    diagnostics.push(
      baseDiagnostic(
        file,
        nodeSpan(lineCounter, item),
        BASE_RULES.invalidSchema,
        "error",
        `${label} 的每一项都必须是字符串 property-ref`,
        { reason: "non_string_item" },
      ),
    );
  }
  return out;
}

/** sort：必须是 { property, direction: ASC|DESC } 数组（结构校验，property-ref 语义 P1）。 */
function parseSort(
  value: unknown,
  file: string,
  lineCounter: LineCounter,
  diagnostics: BasaltDiagnostic[],
): BaseViewSort[] | undefined {
  if (!isSeq(value)) {
    diagnostics.push(
      baseDiagnostic(
        file,
        value !== null ? nodeSpan(lineCounter, value) : { line: 1, column: 1 },
        BASE_RULES.invalidSchema,
        "error",
        "sort 必须是 { property, direction } 数组",
      ),
    );
    return undefined;
  }
  const out: BaseViewSort[] = [];
  for (const item of value.items) {
    if (!isMap(item)) {
      // 非 map 项不静默跳过：静默会让排序键悄悄少一个，结果顺序变了却无诊断。
      diagnostics.push(
        baseDiagnostic(
          file,
          nodeSpan(lineCounter, item),
          BASE_RULES.invalidSchema,
          "error",
          "sort 的每一项都必须是 { property, direction } map",
          { reason: "non_map_sort_item" },
        ),
      );
      continue;
    }
    const property = item.get("property", true);
    const direction = item.get("direction", true);
    const prop = isScalar(property) && typeof property.value === "string" ? property.value : "";
    if (prop === "") {
      diagnostics.push(
        baseDiagnostic(
          file,
          isScalar(property) ? nodeSpan(lineCounter, property) : nodeSpan(lineCounter, item),
          BASE_RULES.invalidSchema,
          "error",
          "sort.property 必须是非空字符串（property-ref）",
          { reason: "empty_sort_property" },
        ),
      );
      continue;
    }
    const dir =
      isScalar(direction) && typeof direction.value === "string" ? direction.value : "ASC";
    if (dir !== "ASC" && dir !== "DESC") {
      diagnostics.push(
        baseDiagnostic(
          file,
          isScalar(direction) ? nodeSpan(lineCounter, direction) : nodeSpan(lineCounter, item),
          BASE_RULES.invalidSchema,
          "error",
          `sort direction 必须是 ASC 或 DESC（实际 "${dir}"）`,
        ),
      );
      continue;
    }
    out.push({ property: prop, direction: dir });
  }
  return out;
}

/**
 * filter 结构校验（设计 §6）：字符串 = 表达式 filter（顺带浅扫描）；对象仅允许 and/or/not
 * 单键、值为 filter 数组。
 *
 * 实现硬要求：**迭代 + 显式深度计数**（显式栈，禁递归），嵌套深度超 maxFilterDepth 时产
 * base/execution-budget 并停止展开该分支，杜绝栈溢出（BASE-DOC-009）。
 * 空数组（and:[]/or:[]/not:[]）P0 只记录结构不求值——语义（and:[]→true / or:[]→false /
 * not:[]→true）待官方 oracle 冻结（设计 §6）。
 */
function validateFilter(
  root: unknown,
  file: string,
  source: string,
  lineCounter: LineCounter,
  limits: BaseDocumentLimits,
  diagnostics: BasaltDiagnostic[],
): BaseFilter | undefined {
  // 显式工作栈：{ node, depth, out }，out 为该节点结果应挂入的 children 数组。
  const rootChildren: BaseFilter[] = [];
  const stack: Array<{ node: unknown; depth: number; out: BaseFilter[] }> = [
    { node: root, depth: 1, out: rootChildren },
  ];
  let rootFilter: BaseFilter | undefined;

  while (stack.length > 0) {
    const { node, depth, out } = stack.pop() as {
      node: unknown;
      depth: number;
      out: BaseFilter[];
    };
    const span = nodeSpan(lineCounter, node);

    if (isScalar(node) && typeof node.value === "string") {
      const filter: BaseFilter = { kind: "expr", expr: node.value, span };
      out.push(filter);
      // 表达式浅扫描：位置 = YAML scalar 起点 + 表达式内 UTF-16 offset（设计 §11）。
      const valueOffset = scalarValueOffset(source, node);
      for (const finding of scanExpression(node.value, limits.maxExpressionNodes)) {
        diagnostics.push(
          baseDiagnostic(
            file,
            spanOf(lineCounter, valueOffset + finding.offset),
            finding.rule,
            "error",
            finding.message,
            { target: finding.target },
          ),
        );
      }
      continue;
    }

    if (isMap(node)) {
      const keys = node.items.map((p) => (isScalar(p.key) ? String(p.key.value) : ""));
      const valid =
        node.items.length === 1 && keys.length === 1 && FILTER_LOGIC_KEYS.has(keys[0] as string);
      const pair = node.items[0];
      const logicKey = keys[0] as "and" | "or" | "not";
      if (!valid || pair === undefined || !isSeq(pair.value)) {
        diagnostics.push(
          baseDiagnostic(
            file,
            span,
            BASE_RULES.invalidSchema,
            "error",
            'filter 对象必须是 and/or/not 单键且值为 filter 数组（如 `and: ["a == 1"]`）',
          ),
        );
        continue;
      }
      const filter: BaseFilter = { kind: logicKey, children: [], span };
      out.push(filter);
      if (depth + 1 > limits.maxFilterDepth && pair.value.items.length > 0) {
        // 深度预算耗尽：拒绝展开该分支（不继续入栈），绝不用递归换简洁。
        diagnostics.push(
          baseDiagnostic(
            file,
            span,
            BASE_RULES.executionBudget,
            "error",
            `filter 嵌套深度超过预算上限 ${limits.maxFilterDepth}（拒绝展开，防栈溢出）`,
            { reason: "filter_depth" },
          ),
        );
        continue;
      }
      // 空数组（and:[]/or:[]/not:[]）：P0 只记录结构不求值，语义待官方 oracle（设计 §6）。
      // LIFO 栈会反转弹出顺序：倒序入栈，保证 children 保持 YAML 声明顺序（P1 求值按序短路依赖此）。
      for (let i = pair.value.items.length - 1; i >= 0; i--) {
        const child = pair.value.items[i];
        if (child !== null && child !== undefined) {
          stack.push({ node: child, depth: depth + 1, out: filter.children });
        }
      }
      continue;
    }

    diagnostics.push(
      baseDiagnostic(
        file,
        span,
        BASE_RULES.invalidSchema,
        "error",
        "filter 必须是表达式字符串或 and/or/not 对象",
      ),
    );
  }

  // 根节点本身即唯一 filter（顶层 filters 标量/单对象时 rootChildren 恰有一项）。
  if (rootChildren.length === 1) rootFilter = rootChildren[0];
  return rootFilter;
}

/**
 * 选择 view：未指定取 `views[0]`；指定不存在 → base/view-not-found（suggestions 列可用 view 名）。
 *
 * 注：选中带 error 级诊断的 view（如 unsupported type）时是否拒绝执行由调用方（P1 engine）
 * 决定，本函数只产出诊断（计划「关键取舍」#7）。
 *
 * @behavior
 * Given 未指定 view 名且文档有 view
 * When selectView
 * Then 返回 views[0] 作为默认 view（BASE-VIEW-001）
 *
 * @behavior
 * Given 指定的 view 名不存在
 * When selectView
 * Then 返回 base/view-not-found（error）且 suggestions 列出全部可用 view 名（BASE-DOC-005）
 */
export function selectView(doc: BaseDocument, name?: string): SelectViewResult {
  if (name === undefined) {
    return { view: doc.views[0], diagnostics: [] };
  }
  const view = doc.views.find((v) => v.name === name);
  if (view !== undefined) {
    return { view, diagnostics: [] };
  }
  return {
    diagnostics: [
      baseDiagnostic(
        doc.path,
        doc.viewsSpan,
        BASE_RULES.viewNotFound,
        "error",
        `view "${name}" 不存在`,
        { target: name, suggestions: doc.views.map((v) => v.name) },
      ),
    ],
  };
}

/**
 * base 模块 P1 数据源：SQLite 索引 → {@link BaseRow}（设计 §10）。
 *
 * 三条只读查询（files 全行 / tags 按 file_path 聚合 / links 按 source 聚合）均为**固定 SQL、
 * 零参数、无字符串拼接**——表达式里的用户输入只进 evaluator 内存过滤，永不进入 SQL，
 * BASE-SEC-003（SQL 注入）与 BASE-SEC-009（恶意属性名拼 SQL）由此在数据源层结构性满足。
 * P1 不做 SQL predicate 下推（设计 §10：一次读候选行、evaluator 内存过滤）。
 *
 * 数据集口径（P3 片二起两模式，决策 §3「Bases 数据源扩展」）：
 * - `markdown`（默认）：files 表即 .md-only 数据集（indexer 只索引 .md），附件（图片/PDF/.base）
 *   天然不为行（BASE-DATA-002）；
 * - `all-files`：`files` ∪ `vault_entries` 内存合并、全局 `path ASC`（决策 §3：无 SQL 下推先例，
 *   先内存合并，性能证据出现再议）；附件行 note fields 全缺失（`note = {}` 经既有 MISSING
 *   传播、投影输出塌缩 null，不逐字段手写 MISSING）、file fields 可用、`file.tags`/`file.links`
 *   恒 `[]`（未知格式不伪造内容链接，BASE-ALL-002 满足线）。
 * 两模式均**不合入 inline_fields 表**——Dataview inline fields 不属于官方 Bases
 * （设计 §10 明确禁止泄漏）。
 *
 * 上游：indexer 写入的 files/tags/links 表 + vault_entries 附件表（schema 见 src/indexer/schema.ts 连接键注释）。
 * 下游：P1 engine.ts 消费 BaseRow 做 filter/sort/投影。
 * 设计真相源：docs/design/bases-engine.md §10/§12；
 * all-files 决策真相源：docs/design/bases-vault-entries.md §3。
 */

import type { Database } from "better-sqlite3";
import { linkKey, pathKey } from "../utils/path.js";
import type { BaseRow } from "./evaluator.js";
import type { BaseExecutionLimits } from "./types.js";
import {
  BaseBudgetError,
  createFileValue,
  wrapValue,
  type BaseFileValue,
  type BaseValueObject,
} from "./values.js";

// === 自建实现 ===

/**
 * 行组装期的非终止性问题（目前仅 frontmatter JSON 解析失败）。
 * 不 throw：该行的 note 按空对象处理，问题经回调上报（engine 转 warning 诊断）。
 */
export interface BaseSourceIssue {
  /** vault 相对 POSIX 路径（= files.path，多根含命名空间前缀）。 */
  file: string;
  /** 机器可读原因（目前仅 "frontmatter_json_parse_failed"）。 */
  reason: string;
  message: string;
}

/** files 表行形状（只取 base 需要的列；content 大列不读）。 */
interface FileDbRow {
  path: string;
  name: string;
  extension: string;
  folder: string;
  size: number;
  mtime: number;
  ctime: number;
  frontmatter: string;
}

/**
 * files / vault_entries 共有的文件系统列（file 字段映射的唯一输入形状）。
 * vault_entries 无 frontmatter 列（决策 §3：附件不解析内容），故映射输入不含它。
 */
type FileLikeDbRow = Omit<FileDbRow, "frontmatter">;

/**
 * 数据源数据集口径（P3 片二 conformance 开关的数据侧体现）：
 * - `markdown`（默认）：只读 files 表，对 vault_entries 存在性**零感知**（连表检查都不做）；
 * - `all-files`：files ∪ vault_entries 内存合并；旧库无 vault_entries 表时按 md-only 降级
 *   （不崩，经 {@link ReadBaseRowsOptions.onAllFilesDegraded} 上报一次）。
 */
export type BaseDataset = "markdown" | "all-files";

/** {@link readBaseRows} 可选参数（第 4 参，缺省全等价于 P1 行为，现签名兼容）。 */
export interface ReadBaseRowsOptions {
  /** 数据集口径（缺省 "markdown"）。 */
  dataset?: BaseDataset;
  /**
   * all-files 模式但库中无 vault_entries 表（旧 schema）时恰好触发一次：
   * 调用方（engine）转 compat warning 诊断，本函数按 md-only 继续返回笔记行。
   */
  onAllFilesDegraded?: (message: string) => void;
}

/**
 * vault_entries 表存在性检查（旧库降级判定的唯一实现；engine 与 readBaseRows 共用）。
 * 固定零参数 sqlite_master 查询，与模块其余 SQL 同契约（无拼接）。
 */
export function hasVaultEntriesTable(db: Database): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vault_entries'")
      .get() !== undefined
  );
}

/**
 * file 字段映射（笔记行与附件行**共用同一函数**——计划「风险」第 4 条：
 * 两表 folder/ext/name 口径若分叉会导致 Bases 行字段不一致，故禁止复制出两套映射）。
 * name = basename + "." + extension（无扩展名时即 basename）；ext 含点（无扩展名时空串）。
 */
function fileValueFrom(
  f: FileLikeDbRow,
  properties: BaseValueObject,
  tags: readonly string[],
  links: readonly string[],
): BaseFileValue {
  return createFileValue({
    name: f.extension === "" ? f.name : `${f.name}.${f.extension}`,
    basename: f.name,
    path: f.path,
    folder: f.folder,
    ext: f.extension === "" ? "" : `.${f.extension}`,
    size: f.size,
    ctime: f.ctime,
    mtime: f.mtime,
    properties,
    tags,
    links,
  });
}

/**
 * 从索引库读出全部候选行并组装为 {@link BaseRow}（数据集口径见 {@link BaseDataset}）。
 *
 * 字段映射（设计 §10 / 计划「关键取舍」#6；笔记行与附件行共用 {@link fileValueFrom}）：
 * - `note` / `file.properties` ← `files.frontmatter` JSON：note 保留 JSON.parse 原始对象
 *   （evaluator 经 safeGetOwn + wrapValue 安全读取），file.properties 为 wrapValue 包装副本；
 *   parse 失败当空对象处理并经 `onIssue` 上报（不崩）。
 *   附件行无 frontmatter：`note = {}`、`file.properties = wrapValue({})`，note fields 经
 *   既有 MISSING 传播全部缺失（投影输出塌缩 null），不逐字段手写 MISSING；
 * - `file.path` ← files/vault_entries.path（vault 相对 POSIX；多根时 indexer 已写入
 *   `<根目录名>/<相对>` 命名空间键，本层原样透传，不感知物理绝对路径）；
 * - `file.basename` ← name（无扩展名）；`file.name` ← basename + "." + extension
 *   （无扩展名时即为 basename）；`file.ext` ← "." + extension（无扩展名时空串）；
 * - `file.folder/size/ctime/mtime` ← 两表同名列（ctime/mtime 为 epoch 毫秒 number）；
 * - `file.tags` ← tags 表按 file_path 聚合（含 frontmatter + inline，去重保序）；
 *   附件行恒 []（不查不补）；
 * - `file.links` ← links 表按 source 聚合的**原始 target 文本**（含 embed：is_embed=1 计入，
 *   与 Obsidian outlinks 口径一致，依据 schema.ts 注释）；附件行恒 []
 *   （未知格式不伪造内容链接，BASE-ALL-002 满足线）。
 *
 * @param db - 已打开的索引库连接（engine 侧只读打开）
 * @param limits - 执行预算（本层只消费 maxRows）
 * @param onIssue - 行组装期非终止问题回调（可选）
 * @param options - 数据集口径与降级回调（可选，缺省 = P1 markdown 行为）
 * @throws {BaseBudgetError} 候选行数超过 `limits.maxRows`（engine 转 base/execution-budget）：
 *   markdown 模式对 files 单侧计数（P1 口径不变）；all-files 模式对 files ∪ vault_entries
 *   **合并集**计数（新数据集口径，与 md-only 的单侧截断不同——同一 vault 下 all-files
 *   更早触及预算属预期）。
 */
export function readBaseRows(
  db: Database,
  limits: BaseExecutionLimits,
  onIssue?: (issue: BaseSourceIssue) => void,
  options?: ReadBaseRowsOptions,
): BaseRow[] {
  const dataset = options?.dataset ?? "markdown";

  // 固定 SQL 零参数：files 全行按 path 排序读出，保证后续稳定排序的行序基底确定（字节稳定前提）。
  const fileRows = db
    .prepare(
      "SELECT path, name, extension, folder, size, mtime, ctime, frontmatter FROM files ORDER BY path ASC",
    )
    .all() as FileDbRow[];

  // all-files 增读 vault_entries（同款轻 SELECT：无 content 大列可读）。
  // 旧库无该表 → 经 onAllFilesDegraded 上报一次后按 md-only 继续（降级不崩，决策 §3）；
  // markdown 模式对 vault_entries 存在性零感知（不查表）。
  let entryRows: FileLikeDbRow[] = [];
  if (dataset === "all-files") {
    if (hasVaultEntriesTable(db)) {
      entryRows = db
        .prepare(
          "SELECT path, name, extension, folder, size, mtime, ctime FROM vault_entries ORDER BY path ASC",
        )
        .all() as FileLikeDbRow[];
    } else {
      options?.onAllFilesDegraded?.(
        "索引库无 vault_entries 表（旧 schema）：all-files 数据集降级为 md-only，附件不作为行" +
          "（用当前版本 indexer 重建索引可启用 all-files）",
      );
    }
  }

  // 行数硬上限（设计 §12 maxRows，source 层截断）：超限即中止，不返回部分结果冒充成功。
  // 计数口径见 JSDoc @throws：markdown = files 单侧；all-files = 合并集。
  const candidateCount = fileRows.length + entryRows.length;
  if (candidateCount > limits.maxRows) {
    throw new BaseBudgetError(
      `候选行数 ${candidateCount} 超过预算上限 ${limits.maxRows}（防资源耗尽）`,
    );
  }

  // tags 聚合：file_path → 去重保序 tag 数组（frontmatter 与 inline 同名 tag 只留一份，
  // 防 frontmatter `tags: [area]` + 行内 `#area` 重复计入影响 hasTag/投影确定性）。
  const tagsByFile = new Map<string, string[]>();
  for (const row of db
    .prepare("SELECT file_path, tag FROM tags ORDER BY file_path ASC, id ASC")
    .all() as { file_path: string; tag: string }[]) {
    const list = tagsByFile.get(row.file_path);
    if (list === undefined) {
      tagsByFile.set(row.file_path, [row.tag]);
    } else if (!list.includes(row.tag)) {
      list.push(row.tag);
    }
  }

  // links 聚合：source → 原始 target 文本数组（按写入序 id 保序；含 embed，见模块头口径）。
  const linksByFile = new Map<string, string[]>();
  for (const row of db
    .prepare("SELECT source, target FROM links ORDER BY source ASC, id ASC")
    .all() as { source: string; target: string }[]) {
    const list = linksByFile.get(row.source);
    if (list === undefined) {
      linksByFile.set(row.source, [row.target]);
    } else {
      list.push(row.target);
    }
  }

  // 笔记行：tags/links 聚合只服务笔记行（附件行不查不补）。
  const noteRows = fileRows.map((f) => {
    // frontmatter JSON → note 原始对象。parse 失败 / 产物非普通对象（如 "null" / 数组）
    // 一律当空对象并上报（不崩）：该行仍可经 file.* 参与查询，note 属性按缺失处理。
    let note: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(f.frontmatter);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        note = parsed as Record<string, unknown>;
      }
    } catch {
      onIssue?.({
        file: f.path,
        reason: "frontmatter_json_parse_failed",
        message: `frontmatter JSON 解析失败，该行 note 属性按空对象处理：${f.path}`,
      });
    }
    const properties = wrapValue(note) as BaseValueObject;
    return {
      note,
      file: fileValueFrom(
        f,
        properties,
        tagsByFile.get(f.path) ?? [],
        linksByFile.get(f.path) ?? [],
      ),
    };
  });

  if (entryRows.length === 0) return noteRows; // markdown 模式 / 降级路径：行集与 P1 完全一致

  // 附件行：note = {}（note fields 经 MISSING 传播全缺失）、properties 空对象、tags/links 恒 []；
  // file 其余字段与笔记行走同一映射函数（fileValueFrom，防口径分叉）。
  const attachmentRows = entryRows.map((e): BaseRow => {
    const note: Record<string, unknown> = {};
    return {
      note,
      file: fileValueFrom(e, wrapValue(note) as BaseValueObject, [], []),
    };
  });

  // 内存合并 + 全局 path ASC：两表各自已按 path ASC 有序，且 path 跨表唯一（扩展名分派
  // 不变量：同一物理文件只进一张表，决策 §4），比较无并列，合并序确定（字节稳定）。
  return [...noteRows, ...attachmentRows].toSorted((a, b) => {
    const pa = a.file.path;
    const pb = b.file.path;
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// 2026-07-28 覆盖率片三：路径 → file 值解析（`file(path)` / `link.asFile()` 用）
// ---------------------------------------------------------------------------

/**
 * 行集内的 file 解析器（引擎每次查询建一个，注入 {@link EvalContext.files}）。
 *
 * 只在**当前查询的行集**内解析——不额外查库、不碰文件系统：这既是性能取舍
 * （行集已在内存），也是语义取舍（`file()` 能看到的与查询数据集口径一致：
 * markdown 模式解析不到附件，all-files 模式才能）。
 */
export interface BaseFileResolver {
  /** 解析一个路径/链接目标；解析不到返回 undefined（调用方转 MISSING，不伪造空 file 值）。 */
  resolve(target: string): BaseFileValue | undefined;
}

/**
 * 建立按需索引的 file 解析器（三级匹配，逐级放宽，与 `file.hasLink` 同一套路径原语）：
 *
 * 1. **精确 path**（`file("Projects/A.md")`）；
 * 2. **pathKey**（POSIX + 去扩展名 + 小写，故 `file("projects/a")` 命中 `Projects/A.md`）；
 * 3. **linkKey**（小写 basename，故 `[[A]]` 这种 bare wikilink 能解析）。
 *
 * 索引**首次调用时才构建**：绝大多数查询用不到 file()/asFile()，不为它们付出建表成本。
 * 同键多文件（bare basename 撞名）取 **path 升序第一个**——行集本就按 path ASC，
 * 建索引时「首次写入者胜」即为该口径，保证字节稳定（不做「最近修改优先」这类会漂的规则）。
 */
export function createFileResolver(rows: readonly BaseRow[]): BaseFileResolver {
  let byPath: Map<string, BaseFileValue> | undefined;
  let byPathKey: Map<string, BaseFileValue> | undefined;
  let byLinkKey: Map<string, BaseFileValue> | undefined;
  const build = (): void => {
    byPath = new Map();
    byPathKey = new Map();
    byLinkKey = new Map();
    for (const row of rows) {
      const f = row.file;
      if (!byPath.has(f.path)) byPath.set(f.path, f);
      const pk = pathKey(f.path);
      if (!byPathKey.has(pk)) byPathKey.set(pk, f);
      const lk = linkKey(f.path);
      if (!byLinkKey.has(lk)) byLinkKey.set(lk, f);
    }
  };
  return {
    resolve: (target: string): BaseFileValue | undefined => {
      if (byPath === undefined) build();
      return (
        (byPath as Map<string, BaseFileValue>).get(target) ??
        (byPathKey as Map<string, BaseFileValue>).get(pathKey(target)) ??
        (byLinkKey as Map<string, BaseFileValue>).get(linkKey(target))
      );
    },
  };
}

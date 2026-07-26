/**
 * base 模块 P1 数据源：SQLite 索引 → {@link BaseRow}（设计 §10）。
 *
 * 三条只读查询（files 全行 / tags 按 file_path 聚合 / links 按 source 聚合）均为**固定 SQL、
 * 零参数、无字符串拼接**——表达式里的用户输入只进 evaluator 内存过滤，永不进入 SQL，
 * BASE-SEC-003（SQL 注入）与 BASE-SEC-009（恶意属性名拼 SQL）由此在数据源层结构性满足。
 * P1 不做 SQL predicate 下推（设计 §10：一次读候选行、evaluator 内存过滤）。
 *
 * 数据集口径：files 表即 .md-only 数据集（indexer 只索引 .md），附件（图片/PDF/.base）
 * 天然不为行（BASE-DATA-002）；**P1 不合入 inline_fields 表**——Dataview inline fields
 * 不属于官方 Bases（设计 §10 明确禁止泄漏）。
 *
 * 上游：indexer 写入的 files/tags/links 表（schema 见 src/indexer/schema.ts 连接键注释）。
 * 下游：P1 engine.ts 消费 BaseRow 做 filter/sort/投影。
 * 设计真相源：docs/specs/2026-07-22-bases-headless-engine-design.md §10/§12。
 */

import type { Database } from "better-sqlite3";
import type { BaseRow } from "./evaluator.js";
import type { BaseExecutionLimits } from "./types.js";
import { BaseBudgetError, createFileValue, wrapValue, type BaseValueObject } from "./values.js";

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
 * 从索引库读出全部候选 Markdown 行并组装为 {@link BaseRow}。
 *
 * 字段映射（设计 §10 / 计划「关键取舍」#6）：
 * - `note` / `file.properties` ← `files.frontmatter` JSON：note 保留 JSON.parse 原始对象
 *   （evaluator 经 safeGetOwn + wrapValue 安全读取），file.properties 为 wrapValue 包装副本；
 *   parse 失败当空对象处理并经 `onIssue` 上报（不崩）；
 * - `file.path` ← files.path（vault 相对 POSIX；多根时 indexer 已写入 `<根目录名>/<相对>`
 *   命名空间键，本层原样透传，不感知物理绝对路径）；
 * - `file.basename` ← files.name（无扩展名）；`file.name` ← basename + "." + extension
 *   （无扩展名时即为 basename）；`file.ext` ← "." + extension（无扩展名时空串）；
 * - `file.folder/size/ctime/mtime` ← files 列（ctime/mtime 为 epoch 毫秒 number）；
 * - `file.tags` ← tags 表按 file_path 聚合（含 frontmatter + inline，去重保序）；
 * - `file.links` ← links 表按 source 聚合的**原始 target 文本**（含 embed：is_embed=1 计入，
 *   与 Obsidian outlinks 口径一致，依据 schema.ts 注释）。
 *
 * @param db - 已打开的索引库连接（engine 侧只读打开）
 * @param limits - 执行预算（本层只消费 maxRows）
 * @param onIssue - 行组装期非终止问题回调（可选）
 * @throws {BaseBudgetError} files 行数超过 `limits.maxRows`（engine 转 base/execution-budget）
 */
export function readBaseRows(
  db: Database,
  limits: BaseExecutionLimits,
  onIssue?: (issue: BaseSourceIssue) => void,
): BaseRow[] {
  // 固定 SQL 零参数：files 全行按 path 排序读出，保证后续稳定排序的行序基底确定（字节稳定前提）。
  const fileRows = db
    .prepare(
      "SELECT path, name, extension, folder, size, mtime, ctime, frontmatter FROM files ORDER BY path ASC",
    )
    .all() as FileDbRow[];

  // 行数硬上限（设计 §12 maxRows，source 层截断）：超限即中止，不返回部分结果冒充成功。
  if (fileRows.length > limits.maxRows) {
    throw new BaseBudgetError(
      `候选行数 ${fileRows.length} 超过预算上限 ${limits.maxRows}（防资源耗尽）`,
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

  return fileRows.map((f) => {
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
      file: createFileValue({
        name: f.extension === "" ? f.name : `${f.name}.${f.extension}`,
        basename: f.name,
        path: f.path,
        folder: f.folder,
        ext: f.extension === "" ? "" : `.${f.extension}`,
        size: f.size,
        ctime: f.ctime,
        mtime: f.mtime,
        properties,
        tags: tagsByFile.get(f.path) ?? [],
        links: linksByFile.get(f.path) ?? [],
      }),
    };
  });
}

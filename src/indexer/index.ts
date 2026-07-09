import Database from "better-sqlite3";
import type { Database as Db, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, posix as posixPath, sep } from "node:path";
import { parseFrontmatter } from "../parser/frontmatter.js";
import { VaultParser } from "../parser/index.js";
import { wikilinkIndexKey } from "../parser/wikilink.js";
import { linkKey, pathKey, resolveVaultLayout, type VaultLayout } from "../utils/path.js";
import { createSchema } from "./schema.js";
import { startWatch } from "./watcher.js";

// === 自建实现: Vault 索引器，唯一写 SQLite 的边界，不内联 DQL ===
//
// 上游：cli 的 index / watch 子命令；watcher 的 add/change/unlink 增量回调。
// 下游：调 VaultParser 拿 ObsidianNode[]，写入 files/links/tags/tasks/blocks/inline_fields 六表。
// 不变量：隐式字段（inlinks/outlinks）不在写入期物化，由 query 层 JOIN 实时计算（硬约束第 6 条）。

/** 索引器构造选项。 */
export interface IndexerOptions {
  /** Vault 根目录：单目录字符串或多目录列表（多目录索引其并集）。 */
  vaultPath: string | string[];
  /** SQLite 索引文件路径 */
  dbPath: string;
}

/** 单个目录桶下的 added/modified/deleted 计数（标量，不含文件名，永不随规模膨胀/截断）。 */
export interface ScanDirCounts {
  added: number;
  modified: number;
  deleted: number;
}

/** scan 差异核心字段（路径均为相对 Vault 的 POSIX 路径），scanIter 每批 yield 与最终报告共享。 */
export interface ScanDiff {
  /** 新增文件（在 FS 不在库） */
  added: string[];
  /** 改动文件（mtime/size 或内容变化） */
  modified: string[];
  /** 删除文件（在库不在 FS） */
  deleted: string[];
  /** 未变文件数（跳过，未重读） */
  unchanged: number;
}

/** scan 增量重索引的最终报告：{@link ScanDiff} + 按目录聚合。 */
export interface ScanReport extends ScanDiff {
  /**
   * 按目录聚合的标量计数（key = 相对 Vault 的 POSIX 目录路径，根目录下的文件归 `"."`）。
   * 对治「按子目录统计」误路由到逐文件列举、灌爆 context 撞顶（见 docs/plans/2026-07-02-deterministic-eval-gaps.md）：
   * 这里只给计数、不给文件名，规模再大也是常数大小。仅在最终报告投影一次（scan()），
   * scanIter 每批 yield 的 {@link ScanProgress} 不含此字段，避免每批重复聚合。
   */
  byDir: Record<string, ScanDirCounts>;
}

/**
 * 按目录聚合 added/modified/deleted 三个相对路径列表为标量计数（scan `--by-dir` 用）。
 * 独立纯函数：不碰 fs/DB，便于单测；多根路径带命名空间前缀（如 `vaultB/notes/A.md`）时
 * 天然按 `posixPath.dirname` 分到 `vaultB/notes` 桶，根间不会混桶。
 */
export function groupByDir(report: {
  added: string[];
  modified: string[];
  deleted: string[];
}): Record<string, ScanDirCounts> {
  const byDir: Record<string, ScanDirCounts> = {};
  const bump = (rel: string, key: keyof ScanDirCounts): void => {
    const dir = posixPath.dirname(rel);
    const bucket = (byDir[dir] ??= { added: 0, modified: 0, deleted: 0 });
    bucket[key]++;
  };
  for (const rel of report.added) bump(rel, "added");
  for (const rel of report.modified) bump(rel, "modified");
  for (const rel of report.deleted) bump(rel, "deleted");
  return byDir;
}

/** scanIter 每批 yield 的累计进度。 */
export interface ScanProgress extends ScanDiff {
  /** 还有多少「新增+改动」文件待处理（调用方据此决定是否续跑）。 */
  remaining: number;
}

/** 单文件落库前的完整负载（一次解析的全部行，供事务内批量写入）。 */
interface FilePayload {
  path: string;
  name: string;
  nameKey: string;
  pathKey: string;
  extension: string;
  folder: string;
  size: number;
  mtime: number;
  ctime: number;
  content: string;
  frontmatter: string;
  links: LinkRow[];
  tags: TagRow[];
  tasks: TaskRow[];
  blocks: BlockRow[];
  inlineFields: InlineFieldRow[];
}

interface LinkRow {
  source: string;
  target: string;
  targetKey: string;
  targetPathKey: string | null;
  alias: string | null;
  heading: string | null;
  blockId: string | null;
  isEmbed: number;
}
interface TagRow {
  filePath: string;
  tag: string;
  inFrontmatter: number;
}
interface TaskRow {
  filePath: string;
  lineNumber: number;
  status: string;
  text: string;
  dueDate: string | null;
}
interface BlockRow {
  filePath: string;
  blockId: string;
  content: string;
  lineNumber: number;
}
// inline fields（key:: value）行：keyNorm = key 小写（查询连接键，spec §6.2）；
// parser 已 last-wins 去重，每 file × keyNorm 至多一行。
interface InlineFieldRow {
  filePath: string;
  key: string;
  keyNorm: string;
  value: string;
  lineNumber: number;
}

// rebuild 流式分批大小（S3.3）：单批并发读盘后立即落库，使内存占用 O(批) 而非 O(整库)，
// 兼作文件读取并发上限（批内 Promise.all 并行、批间串行），避免大库 OOM 与 fd 耗尽。
const REBUILD_BATCH = 100;

// FTS5 分词策略版本号（S3.5 全文检索）：升级 tokenize/归一规则时递增，触发 ensureFts 重建
// files_fts（抄 qmd 的版本号迁移模式，见 store_config 表注释）。常规 FTS5 表（非 external content，
// 自存 path/name/content 副本）：rowid 对齐 files.id，删除按 path 过滤即可、无需回查 files.id。
const FTS_VERSION = "1";

/**
 * 确保 files_fts 全文索引与当前 {@link FTS_VERSION} 一致，缺失或版本不符则重建（drop + create +
 * 从 files 全量回填）。覆盖两个场景：① 全新库首次建索引；② 升级前建的旧库（有 files 无 FTS，
 * 或分词策略要升级）首次以新版本的 indexer 打开。已是当前版本且表存在则不动（开库零额外开销）。
 *
 * @behavior
 * Given 全新库（无 store_config.fts_version、无 files_fts）
 * When ensureFts
 * Then 建表并从 files 回填（此时 files 为空，回填结果为空表）
 *
 * @behavior
 * Given 旧库：有 files 表数据、从未建过 files_fts（升级前索引）
 * When ensureFts（构造 VaultIndexer 即触发，无需显式 rebuild/scan）
 * Then 建表并从 files 现有数据全量回填，无需重新解析笔记
 *
 * @behavior
 * Given store_config.fts_version 与当前 FTS_VERSION 不符（分词策略已升级）
 * When ensureFts
 * Then 先 DROP 旧 files_fts 再重建 + 回填，不与旧分词策略的索引混用
 */
function ensureFts(db: Db): void {
  const row = db.prepare("SELECT value FROM store_config WHERE key = 'fts_version'").get() as
    | { value: string }
    | undefined;
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'files_fts'")
    .get();
  if (row?.value === FTS_VERSION && tableExists) return;

  db.exec("DROP TABLE IF EXISTS files_fts");
  db.exec("CREATE VIRTUAL TABLE files_fts USING fts5(path, name, content, tokenize='trigram')");
  db.exec(
    "INSERT INTO files_fts(rowid, path, name, content) SELECT id, path, name, content FROM files",
  );
  db.prepare(
    "INSERT INTO store_config(key, value) VALUES ('fts_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(FTS_VERSION);
}

// === Obsidian 规范来源: task 文本中的到期日按 YYYY-MM-DD 提取（调研 §2.6）===
const DUE_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
// 块锚点定义所在行的行尾 ^id，截取块内容时剥离。
const TRAILING_BLOCK_ID_RE = /\s*\^[A-Za-z0-9-]+\s*$/;

/**
 * 把 frontmatter 的 tags / tag 字段归一化为不带 `#` 的标签数组。
 * 支持数组、单字符串（按空白或逗号切分）；其余类型忽略。
 *
 * @param frontmatter - 解析后的 frontmatter 键值对
 */
function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags ?? frontmatter.tag;
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v !== "string") return;
    for (const part of v.split(/[\s,]+/)) {
      const t = part.replace(/^#/, "").trim();
      if (t) out.push(t);
    }
  };
  if (Array.isArray(raw)) for (const v of raw) push(v);
  else push(raw);
  return out;
}

/** abs 是否等于或严格位于 root 之下（同分隔符前缀，避免 `/foo-bar` 误判为 `/foo` 的子路径）。 */
function isUnderRoot(abs: string, root: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** abs 是否位于 roots 中任意一个之下（缺失根批量判断用）。 */
function isUnderAnyRoot(abs: string, roots: string[]): boolean {
  return roots.some((root) => isUnderRoot(abs, root));
}

/** 递归收集 Vault 下所有 `.md`，跳过隐藏项与 `.obsidian/`（任意以 `.` 开头的目录/文件）。 */
async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // 隐藏文件与 .obsidian/ 等一律跳过
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  };
  await walk(root);
  return out;
}

export class VaultIndexer {
  /** vault 物理布局：遍历/监听的根集合 + 主键↔绝对路径互转（按根命名空间，无公共祖先 base）。 */
  private readonly layout: VaultLayout;
  private readonly db: Db;
  private readonly parser = new VaultParser();
  private stopWatch: (() => void) | null = null;

  // 预编译写语句（better-sqlite3 同步 API，事务内复用）。
  private readonly stmts: {
    insertFile: Statement;
    insertLink: Statement;
    insertTag: Statement;
    insertTask: Statement;
    insertBlock: Statement;
    insertInlineField: Statement;
    insertFts: Statement;
    delFile: Statement;
    delLinks: Statement;
    delTags: Statement;
    delTasks: Statement;
    delBlocks: Statement;
    delInlineFields: Statement;
    delFts: Statement;
    getContent: Statement;
  };

  constructor(opts: IndexerOptions) {
    // 始终用绝对路径：相对路径 + chokidar 回调可能回报 cwd 相对路径（如 docs\file.md），
    // 主键归一交给 layout（已对每个根 resolve；单根=相对该根，多根=根名命名空间，无公共祖先 base）。
    this.layout = resolveVaultLayout(opts.vaultPath);
    // 确保索引文件父目录存在：默认 db 放隐藏目录 .x-basalt/，首次可能尚未创建。
    // better-sqlite3 只建文件不建目录；:memory: 无文件，跳过。
    if (opts.dbPath !== ":memory:") mkdirSync(dirname(opts.dbPath), { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    createSchema(this.db);
    // FTS5 全文索引（S3.5）：缺失/版本不符则（重）建 + 回填，覆盖全新库与升级前的旧库两种场景。
    ensureFts(this.db);

    this.stmts = {
      insertFile: this.db.prepare(
        `INSERT INTO files (path, name, name_key, path_key, extension, folder, size, mtime, ctime, content, frontmatter)
         VALUES (@path, @name, @nameKey, @pathKey, @extension, @folder, @size, @mtime, @ctime, @content, @frontmatter)`,
      ),
      insertLink: this.db.prepare(
        `INSERT INTO links (source, target, target_key, target_path_key, alias, heading, block_id, is_embed)
         VALUES (@source, @target, @targetKey, @targetPathKey, @alias, @heading, @blockId, @isEmbed)`,
      ),
      insertTag: this.db.prepare(
        `INSERT INTO tags (file_path, tag, in_frontmatter) VALUES (@filePath, @tag, @inFrontmatter)`,
      ),
      insertTask: this.db.prepare(
        `INSERT INTO tasks (file_path, line_number, status, text, due_date)
         VALUES (@filePath, @lineNumber, @status, @text, @dueDate)`,
      ),
      insertBlock: this.db.prepare(
        `INSERT OR REPLACE INTO blocks (file_path, block_id, content, line_number)
         VALUES (@filePath, @blockId, @content, @lineNumber)`,
      ),
      insertInlineField: this.db.prepare(
        `INSERT INTO inline_fields (file_path, key, key_norm, value, line_number)
         VALUES (@filePath, @key, @keyNorm, @value, @lineNumber)`,
      ),
      // rowid 显式对齐 files.id（非 external content 模式，自存一份 path/name/content）。
      insertFts: this.db.prepare(
        `INSERT INTO files_fts (rowid, path, name, content) VALUES (?, ?, ?, ?)`,
      ),
      delFile: this.db.prepare(`DELETE FROM files WHERE path = ?`),
      delLinks: this.db.prepare(`DELETE FROM links WHERE source = ?`),
      delTags: this.db.prepare(`DELETE FROM tags WHERE file_path = ?`),
      delTasks: this.db.prepare(`DELETE FROM tasks WHERE file_path = ?`),
      delBlocks: this.db.prepare(`DELETE FROM blocks WHERE file_path = ?`),
      // delete-in-lockstep（spec §6.2 生命周期）：凡删 tags/tasks 处必同步删 inline_fields，
      // 否则 scan/update 后残留旧字段（回归高危点）。
      delInlineFields: this.db.prepare(`DELETE FROM inline_fields WHERE file_path = ?`),
      // 按 path 删（files_fts 自存 path 列），不依赖 files.id/rowid 回查，与 delFile 顺序无关。
      delFts: this.db.prepare(`DELETE FROM files_fts WHERE path = ?`),
      getContent: this.db.prepare(`SELECT content FROM files WHERE path = ?`),
    };
  }

  /**
   * 划分 layout.roots 为「当前可达」与「当前缺失」（不存在或非目录）。
   * 缺失根逐个 warn 并跳过，其余根照常索引；全部根都缺失则抛出清晰错误
   * ——避免 rebuild/scan 悄悄清空索引却建不出任何新内容。
   *
   * 对治场景库 scale/doc-migration-count 坐实的缺口：多根 vault 含尚未创建的目录（如迁移目标）
   * 时，旧行为是 `readdir` 直接 ENOENT、整条 index/scan 全量失败（见
   * docs/plans/2026-07-02-deterministic-eval-gaps.md [冲突提示]，并非该场景原描述的"静默接受"）。
   *
   * @behavior
   * Given 多根中一个目录不存在
   * When rebuild / scan
   * Then warn 该根并跳过，其余根照常建/扫（不再整体崩 ENOENT）
   *
   * @behavior
   * Given 多根全部不存在
   * When rebuild / scan
   * Then 抛出清晰错误（而非静默产出空索引）
   */
  private async partitionRoots(): Promise<{ existing: string[]; missing: string[] }> {
    const ok = await Promise.all(
      this.layout.roots.map(async (root) => {
        try {
          return (await stat(root)).isDirectory();
        } catch {
          return false; // 不存在 / 无权限访问等一律按缺失处理
        }
      }),
    );
    const existing = this.layout.roots.filter((_, i) => ok[i]);
    const missing = this.layout.roots.filter((_, i) => !ok[i]);
    for (const root of missing) console.warn(`⚠ 跳过不存在的 vault 根：${root}`);
    if (existing.length === 0) {
      throw new Error(`所有 vault 根都不存在：${this.layout.roots.join(", ")}`);
    }
    return { existing, missing };
  }

  /**
   * 遍历所有根收集 `.md`（多根并发，跳过缺失根，见 {@link partitionRoots}）；
   * 根已剔子根、通常无重叠，仍按绝对路径去重保险。
   *
   * @returns files - 收集到的绝对路径；missingRoots - 本次被跳过的根（供 computeDiff 排除误判删除）
   */
  private async collectAllMarkdown(): Promise<{ files: string[]; missingRoots: string[] }> {
    const { existing, missing } = await this.partitionRoots();
    const per = await Promise.all(existing.map((r) => collectMarkdownFiles(r)));
    return { files: [...new Set(per.flat())], missingRoots: missing };
  }

  /**
   * 全量扫描 Vault 下所有 `.md` 重建索引（流式分批，S3.3）。
   *
   * 手动 BEGIN/COMMIT 包裹「先清空再分批写」，整体失败 ROLLBACK，保持「无半成品索引」原子性；
   * 每批并发读盘后立即落库、随即可回收，内存占用 O(批) 而非 O(整库)，避免大库 OOM。
   *
   * 约定：rebuild 期间独占该 db 连接（CLI index 一次性调用 / watch 前先 rebuild），
   * 故跨 await 持有事务安全——其间不会有 update/remove 在同连接上插入（否则会落进本事务）。
   *
   * @behavior
   * Given 文件数远超单批的大库
   * When rebuild
   * Then 分批读写，内存不随库规模线性膨胀，且 files/links/tags/tasks 行数与逐文件全量等价
   *
   * @behavior
   * Given 重建中途某文件读取/解析抛错
   * When rebuild
   * Then 跳过该文件并 warn，其余照常入库（单文件失败不中断全量）
   *
   * @behavior
   * Given 多根中一个此前已建过索引的根本次不可达
   * When rebuild
   * Then warn 该根并跳过；rebuild 是"重置为当前可见 FS 真相"的全量操作，
   *      该根旧记录不会被保留（与单文件被删的既有语义一致，非缺陷）——
   *      需要"缺失根旧记录原样保留"的场景应用增量 {@link scan}，见其对应 @behavior
   */
  async rebuild(): Promise<void> {
    const { files } = await this.collectAllMarkdown();
    // 手动事务跨 await：better-sqlite3 的 db.transaction() 仅接同步函数，无法在其中 await 读盘，
    // 故用裸 BEGIN/COMMIT/ROLLBACK 在分批异步读取之间保持同一事务（原子 + 流式）。
    this.db.exec("BEGIN");
    try {
      this.db.exec(
        "DELETE FROM files; DELETE FROM links; DELETE FROM tags; DELETE FROM tasks; DELETE FROM blocks; DELETE FROM inline_fields; DELETE FROM files_fts;",
      );
      for (let i = 0; i < files.length; i += REBUILD_BATCH) {
        const batch = files.slice(i, i + REBUILD_BATCH);
        // 批内并发读盘（并发上限 = REBUILD_BATCH）；单文件失败降级为 null，不拖垮整批。
        const payloads = await Promise.all(
          batch.map((abs) =>
            this.buildPayload(abs).catch((err) => {
              // 设计 §5：单文件失败跳过并 warn，不中断全量重建。
              console.warn(`⚠ 跳过无法索引的文件 ${abs}：${(err as Error).message}`);
              return null;
            }),
          ),
        );
        for (const p of payloads) if (p) this.insertPayload(p);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      // 任意批写入异常：整体回滚，库回到 rebuild 前状态（无半成品）。
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /**
   * 计算文件系统当前态与库内快照的差异（不写库，便宜）。
   *
   * @param rehash - true 按内容对比（读盘 + 比库内 content）；否则按 mtime+size（floored-ms 快判）
   * @returns 新增/改动/删除相对路径（已排序）+ 未变文件数
   *
   * @behavior
   * Given 多根中一个此前已建过索引的根本次不可达（如临时未挂载 / 配置笔误）
   * When computeDiff（经 scan）
   * Then 该根旧记录既不判 deleted 也不判 modified/unchanged——原样留在库里、本轮不touch，
   *      不会被误判成"文件被删"而清空；等根恢复可达后下次 scan 自动回到正常 diff。
   *      与 {@link rebuild} 的"全量重置"语义刻意不同：增量 scan 的契约是"只同步我看得见的"，
   *      看不见的根 = 未知态，不是"已确认删除"。
   */
  private async computeDiff(rehash: boolean): Promise<ScanDiff> {
    const { files: absFiles, missingRoots } = await this.collectAllMarkdown();
    const fsMap = new Map<string, { mtime: number; size: number }>();
    for (const abs of absFiles) {
      const st = await stat(abs);
      fsMap.set(this.layout.toKey(abs), {
        mtime: Math.floor(st.mtimeMs),
        size: st.size,
      });
    }
    const dbRows = this.db.prepare("SELECT path, mtime, size FROM files").all() as {
      path: string;
      mtime: number;
      size: number;
    }[];
    const dbMap = new Map(dbRows.map((r) => [r.path, { mtime: r.mtime, size: r.size }]));

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    let unchanged = 0;
    // 删除 = 在库不在 FS，且不属于本轮缺失的根（见上 @behavior）。
    for (const path of dbMap.keys()) {
      if (fsMap.has(path)) continue;
      if (missingRoots.length > 0 && isUnderAnyRoot(this.layout.toAbs(path), missingRoots))
        continue;
      deleted.push(path);
    }
    for (const [rel, fs] of fsMap) {
      const db = dbMap.get(rel);
      if (db === undefined) {
        added.push(rel);
        continue;
      }
      let changed: boolean;
      if (rehash) {
        // 内容对比：绕开 mtime+size 的「同尺寸+同 mtime 改动 / 保留 mtime 复制」漏判窗口（git racy 同款）。
        const current = await readFile(this.toAbsolute(rel), "utf8");
        const stored = this.stmts.getContent.get(rel) as { content: string } | undefined;
        changed = stored === undefined || stored.content !== current;
      } else {
        changed = fs.mtime !== db.mtime || fs.size !== db.size;
      }
      if (changed) modified.push(rel);
      else unchanged++;
    }
    added.sort();
    modified.sort();
    deleted.sort();
    return { added, modified, deleted, unchanged };
  }

  /**
   * 按需增量重索引迭代器（scan 内核）：diff 文件系统 vs 库，按批 (re)build 落库，每批 yield 进度。
   *
   * 无常驻 watcher 的核心入口——被人/AI 定期触发、丢来目录，自行算变更只重扫变化的。
   * 调用方可中途 `break` 只处理一部分；未写入的文件下次扫描仍被检出，天然断点续扫（无游标）。
   *
   * @param opts.rehash - 内容对比检测（慢但稳），默认 mtime+size
   * @param opts.dryRun - 只算差异不写库，yield 一次完整计划
   * @param opts.batchSize - 每批文件数（默认 REBUILD_BATCH），兼作内存上界与读盘并发上限
   *
   * @behavior
   * Given 变更文件远多于单批
   * When scanIter
   * Then 分批 (re)build 落库、每批 yield，内存占用 O(批) 而非 O(变更总数)
   *
   * @behavior
   * Given 调用方在某批后 break
   * When 下次 scan
   * Then 已写批保留、未写文件仍判为改动 → 续扫剩余（断点续）
   */
  async *scanIter(
    opts: { rehash?: boolean; dryRun?: boolean; batchSize?: number } = {},
  ): AsyncGenerator<ScanProgress> {
    const batchSize = opts.batchSize ?? REBUILD_BATCH;
    const { added, modified, deleted, unchanged } = await this.computeDiff(opts.rehash ?? false);

    if (opts.dryRun) {
      yield { added, modified, deleted, unchanged, remaining: 0 };
      return;
    }

    // 删除便宜，一次性清（即便无新增/改动也执行）。
    if (deleted.length > 0) {
      const delTx = this.db.transaction(() => {
        for (const rel of deleted) this.deleteByPath(rel);
      });
      delTx();
    }

    const work = [...added, ...modified]; // 待 (re)build 的相对路径
    if (work.length === 0) {
      yield { added: [], modified: [], deleted, unchanged, remaining: 0 };
      return;
    }

    const addedSet = new Set(added);
    const doneAdded: string[] = [];
    const doneModified: string[] = [];
    for (let i = 0; i < work.length; i += batchSize) {
      const batch = work.slice(i, i + batchSize);
      // 批内并发读盘 + 解析；单文件失败降级跳过，不拖垮整批（同 rebuild）。
      const payloads = (
        await Promise.all(
          batch.map((rel) =>
            this.buildPayload(this.toAbsolute(rel)).catch((err) => {
              console.warn(`⚠ 跳过无法索引的文件 ${rel}：${(err as Error).message}`);
              return null;
            }),
          ),
        )
      ).filter((p): p is FilePayload => p !== null);
      // 一个事务内先删后插（改动幂等）。
      const tx = this.db.transaction(() => {
        for (const p of payloads) {
          this.deleteByPath(p.path);
          this.insertPayload(p);
        }
      });
      tx();
      for (const p of payloads) (addedSet.has(p.path) ? doneAdded : doneModified).push(p.path);
      yield {
        added: [...doneAdded],
        modified: [...doneModified],
        deleted,
        unchanged,
        remaining: work.length - (i + batch.length),
      };
    }
  }

  /**
   * 增量重索引并全跑到底（drain {@link scanIter}），返回累计差异报告。
   *
   * @param opts - 同 scanIter（rehash / dryRun / batchSize）
   */
  async scan(
    opts: { rehash?: boolean; dryRun?: boolean; batchSize?: number } = {},
  ): Promise<ScanReport> {
    let last: ScanProgress | undefined;
    for await (const p of this.scanIter(opts)) last = p;
    const report = last
      ? {
          added: last.added,
          modified: last.modified,
          deleted: last.deleted,
          unchanged: last.unchanged,
        }
      : { added: [], modified: [], deleted: [], unchanged: 0 };
    return { ...report, byDir: groupByDir(report) };
  }

  /**
   * 增量更新单个文件的索引（先删后插，事务保证原子）。
   *
   * @param filePath - 绝对路径或相对 Vault 的路径
   */
  async update(filePath: string): Promise<void> {
    const payload = await this.buildPayload(this.toAbsolute(filePath));
    const tx = this.db.transaction((p: FilePayload) => {
      this.deleteByPath(p.path);
      this.insertPayload(p);
    });
    tx(payload);
  }

  /**
   * 删除单个文件的索引记录（供 watch 等文件系统路径调用方使用）。
   *
   * @param filePath - 绝对路径或相对 Vault 的路径
   */
  remove(filePath: string): void {
    const rel = this.toRelative(filePath);
    this.removeByKey(rel);
  }

  /**
   * 按索引主键精确删除文件记录。
   *
   * @param key - files.path 主键（已归一化的 POSIX 路径）
   * @returns 是否实际删除了行
   */
  removeByKey(key: string): boolean {
    let removed = false;
    const tx = this.db.transaction((p: string) => {
      removed = this.deleteByPath(p);
    });
    tx(key);
    return removed;
  }

  /**
   * 启动 chokidar 监听，增量维护索引。
   *
   * @param onEvent - 可选回调：索引更新完成后触发，供 CLI 实时输出 / 执行 on-change 命令。
   *                  add/change 在 update 落库后才回调，保证回调看到的索引已是最新。
   */
  watch(
    onEvent?: (event: "add" | "change" | "unlink", filePath: string) => void,
    onReady?: () => void,
  ): void {
    if (this.stopWatch) return; // 幂等：重复调用不叠加监听
    // 增量回调是 fire-and-forget：失败仅 warn，不能让一个文件异常拖垮监听循环。
    const onWrite = (event: "add" | "change", p: string): void => {
      void this.update(p)
        .then(() => onEvent?.(event, p))
        .catch((e) => console.warn(`⚠ 索引${event === "add" ? "新增" : "更新"}失败 ${p}：${e}`));
    };
    this.stopWatch = startWatch(this.layout.roots, {
      onAdd: (p) => onWrite("add", p),
      onChange: (p) => onWrite("change", p),
      onUnlink: (p) => {
        // I2：删除失败仅 warn，不让一个文件异常拖垮监听循环。
        try {
          this.remove(p);
          onEvent?.("unlink", p);
        } catch (e) {
          console.warn(`⚠ 索引删除失败 ${p}：${e}`);
        }
      },
      // I1：监听器错误不崩进程，降级为告警。
      onError: (e) => console.warn(`⚠ 文件监听错误：${e}`),
      onReady,
    });
  }

  /** 关闭监听与数据库连接。 */
  close(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.db.close();
  }

  /** 把任意输入路径解析为绝对路径（主键 / cwd 相对 / 绝对皆可）。公开：供编排器动作还原 .md 绝对路径。 */
  toAbsolute(filePath: string): string {
    return this.layout.toAbs(filePath);
  }

  /** 把任意输入路径归一化为索引主键（POSIX；单根=相对根，多根=根名命名空间）。 */
  private toRelative(filePath: string): string {
    return this.layout.toKey(this.layout.toAbs(filePath));
  }

  /** 读取并解析单文件，组装成可直接落库的 FilePayload。 */
  private async buildPayload(absPath: string): Promise<FilePayload> {
    const content = await readFile(absPath, "utf8");
    const st = await stat(absPath);
    const rel = this.layout.toKey(absPath);

    const ext = extname(rel);
    const name = basename(rel, ext);
    const slash = rel.lastIndexOf("/");
    const folder = slash === -1 ? "" : rel.slice(0, slash);

    const { nodes, frontmatter } = this.parser.parse(content);
    // 块内容需要正文行：复用 parser 的 frontmatter 剥离，避免在此重写 YAML 边界判断。
    const bodyLines = parseFrontmatter(content).body.split(/\r?\n/);

    const links: LinkRow[] = [];
    const seenLinkKeys = new Set<string>();
    const tags: TagRow[] = [];
    const tasks: TaskRow[] = [];
    const blocks: BlockRow[] = [];
    const inlineFields: InlineFieldRow[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "wikilink":
          {
            // parser 保留每次出现供 links/lint 诊断；indexer 仍按历史 target+anchor+embed 去重，
            // 保持 file.inlinks/file.outlinks 聚合不因同一文件重复链接而膨胀。
            const key = wikilinkIndexKey(node);
            if (seenLinkKeys.has(key)) break;
            seenLinkKeys.add(key);
          }
          links.push({
            source: rel,
            target: node.target,
            targetKey: linkKey(node.target),
            // qualified 链接（target 含目录）落 path_key 精确键；bare 链接为 NULL，查询期回退 basename（S3.2）。
            targetPathKey: node.target.includes("/") ? pathKey(node.target) : null,
            alias: node.alias ?? null,
            heading: node.heading ?? null,
            blockId: node.blockId ?? null,
            isEmbed: node.embed ? 1 : 0,
          });
          break;
        case "tag":
          tags.push({ filePath: rel, tag: node.value, inFrontmatter: 0 });
          break;
        case "task":
          tasks.push({
            filePath: rel,
            lineNumber: node.line,
            status: node.status,
            text: node.text,
            dueDate: DUE_DATE_RE.exec(node.text)?.[1] ?? null,
          });
          break;
        case "blockRef":
          blocks.push({
            filePath: rel,
            blockId: node.id,
            content: blockContent(bodyLines, node.line),
            lineNumber: node.line,
          });
          break;
        case "inlineField":
          // key_norm 在写侧统一小写（查询层按小写连接，spec §6.3）；parser 已 last-wins 去重。
          inlineFields.push({
            filePath: rel,
            key: node.key,
            keyNorm: node.key.toLowerCase(),
            value: node.value,
            lineNumber: node.line,
          });
          break;
        // callout / highlight 不进五表索引（无对应查询字段），仅 parse 子命令展示。
        default:
          break;
      }
    }

    // frontmatter tags 单独并入（in_frontmatter=1），与行内 tag 区分（解析层不重复产出，见 parser/index.ts）。
    for (const tag of frontmatterTags(frontmatter)) {
      tags.push({ filePath: rel, tag, inFrontmatter: 1 });
    }

    return {
      path: rel,
      name,
      nameKey: name.toLowerCase(),
      // 全路径键（projects/alpha），供 qualified 链接精确反向匹配（S3.2）。
      pathKey: pathKey(rel),
      extension: ext.startsWith(".") ? ext.slice(1) : ext,
      folder,
      size: st.size,
      mtime: Math.floor(st.mtimeMs),
      // 部分文件系统 birthtime 为 0，回退到 ctime，保证非空且单调可比。
      ctime: Math.floor(st.birthtimeMs || st.ctimeMs),
      content,
      frontmatter: JSON.stringify(frontmatter),
      links,
      tags,
      tasks,
      blocks,
      inlineFields,
    };
  }

  /** 在当前事务内写入单文件的全部行（调用方负责包事务）。 */
  private insertPayload(p: FilePayload): void {
    const info = this.stmts.insertFile.run({
      path: p.path,
      name: p.name,
      nameKey: p.nameKey,
      pathKey: p.pathKey,
      extension: p.extension,
      folder: p.folder,
      size: p.size,
      mtime: p.mtime,
      ctime: p.ctime,
      content: p.content,
      frontmatter: p.frontmatter,
    });
    // rowid 对齐刚插入的 files.id：便于日后按需 JOIN 回 files（当前 search 不需要，仅对齐语义）。
    this.stmts.insertFts.run(info.lastInsertRowid, p.path, p.name, p.content);
    for (const l of p.links) this.stmts.insertLink.run(l);
    for (const t of p.tags) this.stmts.insertTag.run(t);
    for (const t of p.tasks) this.stmts.insertTask.run(t);
    for (const b of p.blocks) this.stmts.insertBlock.run(b);
    for (const f of p.inlineFields) this.stmts.insertInlineField.run(f);
  }

  /** 删除某文件在六表 + files_fts 中的全部记录（调用方负责包事务）。 */
  private deleteByPath(rel: string): boolean {
    const info = this.stmts.delFile.run(rel);
    this.stmts.delLinks.run(rel);
    this.stmts.delTags.run(rel);
    this.stmts.delTasks.run(rel);
    this.stmts.delBlocks.run(rel);
    this.stmts.delInlineFields.run(rel);
    this.stmts.delFts.run(rel);
    return info.changes > 0;
  }
}

/** 取块锚点所在正文行（1-based），剥离行尾 ^id 并 trim，作为 blocks.content。 */
function blockContent(bodyLines: string[], line: number): string {
  const raw = bodyLines[line - 1] ?? "";
  return raw.replace(TRAILING_BLOCK_ID_RE, "").trim();
}

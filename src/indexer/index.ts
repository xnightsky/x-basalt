import Database from "better-sqlite3";
import type { Database as Db, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseFrontmatter } from "../parser/frontmatter.js";
import { VaultParser } from "../parser/index.js";
import { linkKey, pathKey, toPosix } from "../utils/path.js";
import { createSchema } from "./schema.js";
import { startWatch } from "./watcher.js";

// === 自建实现: Vault 索引器，唯一写 SQLite 的边界，不内联 DQL ===
//
// 上游：cli 的 index / watch 子命令；watcher 的 add/change/unlink 增量回调。
// 下游：调 VaultParser 拿 ObsidianNode[]，写入 files/links/tags/tasks/blocks 五表。
// 不变量：隐式字段（inlinks/outlinks）不在写入期物化，由 query 层 JOIN 实时计算（硬约束第 6 条）。

/** 索引器构造选项。 */
export interface IndexerOptions {
  /** Vault 根目录 */
  vaultPath: string;
  /** SQLite 索引文件路径 */
  dbPath: string;
}

/** scan 增量重索引的差异报告（路径均为相对 Vault 的 POSIX 路径）。 */
export interface ScanReport {
  /** 新增文件（在 FS 不在库） */
  added: string[];
  /** 改动文件（mtime/size 或内容变化） */
  modified: string[];
  /** 删除文件（在库不在 FS） */
  deleted: string[];
  /** 未变文件数（跳过，未重读） */
  unchanged: number;
}

/** scanIter 每批 yield 的累计进度。 */
export interface ScanProgress extends ScanReport {
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

// rebuild 流式分批大小（S3.3）：单批并发读盘后立即落库，使内存占用 O(批) 而非 O(整库)，
// 兼作文件读取并发上限（批内 Promise.all 并行、批间串行），避免大库 OOM 与 fd 耗尽。
const REBUILD_BATCH = 100;

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
  private readonly vaultPath: string;
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
    delFile: Statement;
    delLinks: Statement;
    delTags: Statement;
    delTasks: Statement;
    delBlocks: Statement;
    getContent: Statement;
  };

  constructor(opts: IndexerOptions) {
    // 始终用绝对路径作为 vault 根：相对路径 + chokidar 回调可能回报 cwd 相对路径（如 docs\file.md），
    // 若 vault 仍为相对值，toAbsolute 会 join(vault, path) 双重拼接 → ENOENT。
    this.vaultPath = resolve(opts.vaultPath);
    // 确保索引文件父目录存在：默认 db 放隐藏目录 .x-basalt/，首次可能尚未创建。
    // better-sqlite3 只建文件不建目录；:memory: 无文件，跳过。
    if (opts.dbPath !== ":memory:") mkdirSync(dirname(opts.dbPath), { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    createSchema(this.db);

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
      delFile: this.db.prepare(`DELETE FROM files WHERE path = ?`),
      delLinks: this.db.prepare(`DELETE FROM links WHERE source = ?`),
      delTags: this.db.prepare(`DELETE FROM tags WHERE file_path = ?`),
      delTasks: this.db.prepare(`DELETE FROM tasks WHERE file_path = ?`),
      delBlocks: this.db.prepare(`DELETE FROM blocks WHERE file_path = ?`),
      getContent: this.db.prepare(`SELECT content FROM files WHERE path = ?`),
    };
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
   */
  async rebuild(): Promise<void> {
    const files = await collectMarkdownFiles(this.vaultPath);
    // 手动事务跨 await：better-sqlite3 的 db.transaction() 仅接同步函数，无法在其中 await 读盘，
    // 故用裸 BEGIN/COMMIT/ROLLBACK 在分批异步读取之间保持同一事务（原子 + 流式）。
    this.db.exec("BEGIN");
    try {
      this.db.exec(
        "DELETE FROM files; DELETE FROM links; DELETE FROM tags; DELETE FROM tasks; DELETE FROM blocks;",
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
   */
  private async computeDiff(
    rehash: boolean,
  ): Promise<{ added: string[]; modified: string[]; deleted: string[]; unchanged: number }> {
    const absFiles = await collectMarkdownFiles(this.vaultPath);
    const fsMap = new Map<string, { mtime: number; size: number }>();
    for (const abs of absFiles) {
      const st = await stat(abs);
      fsMap.set(toPosix(relative(this.vaultPath, abs)), {
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
    // 删除 = 在库不在 FS。
    for (const path of dbMap.keys()) if (!fsMap.has(path)) deleted.push(path);
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
    return last
      ? {
          added: last.added,
          modified: last.modified,
          deleted: last.deleted,
          unchanged: last.unchanged,
        }
      : { added: [], modified: [], deleted: [], unchanged: 0 };
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
   * 删除单个文件的索引记录。
   *
   * @param filePath - 绝对路径或相对 Vault 的路径
   */
  remove(filePath: string): void {
    const rel = this.toRelative(filePath);
    const tx = this.db.transaction((p: string) => this.deleteByPath(p));
    tx(rel);
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
    this.stopWatch = startWatch(this.vaultPath, {
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

  /** 把任意输入路径解析为绝对路径（相对路径按 vaultPath 解析；兼容 cwd 已含 vault 前缀的路径）。 */
  private toAbsolute(filePath: string): string {
    if (isAbsolute(filePath)) return filePath;
    const fromCwd = resolve(filePath);
    const vaultPrefix = this.vaultPath + sep;
    if (fromCwd.startsWith(vaultPrefix) || fromCwd === this.vaultPath) return fromCwd;
    return join(this.vaultPath, filePath);
  }

  /** 把任意输入路径归一化为相对 Vault 根的 POSIX 路径（索引内的主键形态）。 */
  private toRelative(filePath: string): string {
    const abs = this.toAbsolute(filePath);
    return toPosix(relative(this.vaultPath, abs));
  }

  /** 读取并解析单文件，组装成可直接落库的 FilePayload。 */
  private async buildPayload(absPath: string): Promise<FilePayload> {
    const content = await readFile(absPath, "utf8");
    const st = await stat(absPath);
    const rel = toPosix(relative(this.vaultPath, absPath));

    const ext = extname(rel);
    const name = basename(rel, ext);
    const slash = rel.lastIndexOf("/");
    const folder = slash === -1 ? "" : rel.slice(0, slash);

    const { nodes, frontmatter } = this.parser.parse(content);
    // 块内容需要正文行：复用 parser 的 frontmatter 剥离，避免在此重写 YAML 边界判断。
    const bodyLines = parseFrontmatter(content).body.split(/\r?\n/);

    const links: LinkRow[] = [];
    const tags: TagRow[] = [];
    const tasks: TaskRow[] = [];
    const blocks: BlockRow[] = [];

    for (const node of nodes) {
      switch (node.type) {
        case "wikilink":
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
    };
  }

  /** 在当前事务内写入单文件的全部行（调用方负责包事务）。 */
  private insertPayload(p: FilePayload): void {
    this.stmts.insertFile.run({
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
    for (const l of p.links) this.stmts.insertLink.run(l);
    for (const t of p.tags) this.stmts.insertTag.run(t);
    for (const t of p.tasks) this.stmts.insertTask.run(t);
    for (const b of p.blocks) this.stmts.insertBlock.run(b);
  }

  /** 删除某文件在五表中的全部记录（调用方负责包事务）。 */
  private deleteByPath(rel: string): void {
    this.stmts.delFile.run(rel);
    this.stmts.delLinks.run(rel);
    this.stmts.delTags.run(rel);
    this.stmts.delTasks.run(rel);
    this.stmts.delBlocks.run(rel);
  }
}

/** 取块锚点所在正文行（1-based），剥离行尾 ^id 并 trim，作为 blocks.content。 */
function blockContent(bodyLines: string[], line: number): string {
  const raw = bodyLines[line - 1] ?? "";
  return raw.replace(TRAILING_BLOCK_ID_RE, "").trim();
}

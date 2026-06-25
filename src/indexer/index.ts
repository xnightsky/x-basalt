import Database from "better-sqlite3";
import type { Database as Db, Statement } from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { parseFrontmatter } from "../parser/frontmatter.js";
import { VaultParser } from "../parser/index.js";
import { linkKey, toPosix } from "../utils/path.js";
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

/** 单文件落库前的完整负载（一次解析的全部行，供事务内批量写入）。 */
interface FilePayload {
  path: string;
  name: string;
  nameKey: string;
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
  };

  constructor(opts: IndexerOptions) {
    this.vaultPath = opts.vaultPath;
    // 确保索引文件父目录存在：默认 db 放隐藏目录 .x-basalt/，首次可能尚未创建。
    // better-sqlite3 只建文件不建目录；:memory: 无文件，跳过。
    if (opts.dbPath !== ":memory:") mkdirSync(dirname(opts.dbPath), { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    createSchema(this.db);

    this.stmts = {
      insertFile: this.db.prepare(
        `INSERT INTO files (path, name, name_key, extension, folder, size, mtime, ctime, content, frontmatter)
         VALUES (@path, @name, @nameKey, @extension, @folder, @size, @mtime, @ctime, @content, @frontmatter)`,
      ),
      insertLink: this.db.prepare(
        `INSERT INTO links (source, target, target_key, alias, heading, block_id, is_embed)
         VALUES (@source, @target, @targetKey, @alias, @heading, @blockId, @isEmbed)`,
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
    };
  }

  /** 全量扫描 Vault 下所有 `.md` 重建索引。 */
  async rebuild(): Promise<void> {
    const files = await collectMarkdownFiles(this.vaultPath);
    const payloads: FilePayload[] = [];
    for (const abs of files) {
      try {
        payloads.push(await this.buildPayload(abs));
      } catch (err) {
        // 设计 §5：单文件失败跳过并 warn，不中断全量重建。
        console.warn(`⚠ 跳过无法索引的文件 ${abs}：${(err as Error).message}`);
      }
    }
    // 全量重建在单事务内先清空再写入：失败整体回滚，避免半成品索引。
    const tx = this.db.transaction((items: FilePayload[]) => {
      this.db.exec(
        "DELETE FROM files; DELETE FROM links; DELETE FROM tags; DELETE FROM tasks; DELETE FROM blocks;",
      );
      for (const p of items) this.insertPayload(p);
    });
    tx(payloads);
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
  watch(onEvent?: (event: "add" | "change" | "unlink", filePath: string) => void): void {
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
        this.remove(p);
        onEvent?.("unlink", p);
      },
    });
  }

  /** 关闭监听与数据库连接。 */
  close(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.db.close();
  }

  /** 把任意输入路径解析为绝对路径（相对路径按 vaultPath 解析）。 */
  private toAbsolute(filePath: string): string {
    return isAbsolute(filePath) ? filePath : join(this.vaultPath, filePath);
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

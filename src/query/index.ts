import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import type { QueryResult } from "./ast.js";
import { parseDql } from "./parser.js";
import { safeRegexpMatch } from "./regexp.js";
import { generateListSql, generateSql, type ListFilter } from "./sql-generator.js";

export type { DqlQuery, QueryResult } from "./ast.js";
export { DqlSyntaxError } from "./errors.js";
export type { ListFilter } from "./sql-generator.js";

/** list() 结果：分页元信息同 QueryResult 约定（total/offset/size/returned/hasMore 前置）。 */
export interface ListResult {
  total: number;
  offset: number;
  size?: number;
  returned: number;
  hasMore: boolean;
  files: { path: string; name: string; folder: string; mtime: number }[];
}

/** search() 结果：分页元信息同 QueryResult/ListResult 约定。 */
export interface SearchResult {
  total: number;
  offset: number;
  size?: number;
  returned: number;
  hasMore: boolean;
  rows: { path: string; name: string; snippet: string }[];
}

/** trigram 子串检索的最短查询长度（分词器至少需要 3 字符才能形成一个 trigram）。 */
const MIN_FTS_QUERY_LEN = 3;

/**
 * 把用户原始查询整体转义为 FTS5 MATCH 的字面短语参数（`"` → `""` 并整体加引号）：
 * 杜绝 FTS5 查询语法（NEAR/OR/列过滤/前缀通配/未闭合引号等）被用户输入意外触发——
 * 未转义的悬空操作符或未闭合引号会让 SQLite 直接抛语法错误（S3.5 手工验证过）。
 * trigram 分词器 + 短语查询 = 子串搜索，是 SQLite 官方推荐用法。
 */
function escapeFtsPhrase(raw: string): string {
  return `"${raw.replaceAll('"', '""')}"`;
}

// === 自建实现: Dataview 子集执行引擎，不依赖 obsidian-dataview 的 Evaluator/Executor ===
//
// 上游：cli 的 query 子命令；下游：只读打开索引库，执行 tokenizer→ast→sql 编译出的参数化 SQL。
// 不直接读取 `.md` 文件（边界见 AGENTS.md）：一切数据来自 indexer 写入的 SQLite。

/**
 * DQL 查询执行引擎：query 模块的唯一对外接口。
 *
 * 只读打开 indexer 写入的 SQLite 库，执行 tokenize→parse→generateSql 编译管线，
 * 用 better-sqlite3 prepare/all 取结果，聚合 JSON 列（tags/inlinks/outlinks/tasks）就地解析为数组。
 *
 * 不变量：不读取任何 `.md` 文件；不执行写操作；隐式字段无物化视图，查询期 JOIN 实时计算。
 */
export class DataviewEngine {
  private readonly db: Db;

  constructor(dbPath: string) {
    // 真实查询永远只读打开文件库；内存库（:memory:）不能 readonly（better-sqlite3 限制），
    // 仅用于测试/校验实例化，故放行可写且无须文件存在。
    const inMemory = dbPath === ":memory:";
    // fileMustExist：未建库直接报错，而非静默创建空库给出误导性空结果。
    this.db = new Database(dbPath, { readonly: !inMemory, fileMustExist: !inMemory });
    // 注册 REGEXP：SQLite 默认无正则，regexmatch() 依赖此自定义函数（deterministic 利于优化）。
    // 匹配逻辑 + ReDoS 缓解抽到 safeRegexpMatch（S2.23，可单元测）。
    this.db.function("regexp", { deterministic: true }, (pattern: unknown, value: unknown) =>
      safeRegexpMatch(pattern, value),
    );
  }

  /**
   * 分页外包：给定无 LIMIT/OFFSET 的基础 SQL + 参数，返回本页行与 total/hasMore 元信息。
   * `query()` / `list()` 共享此逻辑（此前各自内联一份，S2 打磨期合并去重，行为不变）。
   *
   * 省略 size 且 offset=0 时不分页（返回全部，向后兼容）；否则包一层
   * `SELECT * FROM (<sql>) LIMIT ? OFFSET ?`，`total` 走独立 `SELECT COUNT(*) FROM (<sql>)`。
   *
   * @param sql - 基础查询（无 LIMIT/OFFSET）
   * @param params - sql 的绑定参数
   * @param opts.offset - 起始偏移（默认 0）
   * @param opts.size - 本页最大行数；省略 = 不分页
   */
  private paginate<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
    opts: { offset?: number; size?: number },
  ): { rows: T[]; total: number; offset: number; size?: number; returned: number; hasMore: boolean } {
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    const size = opts.size === undefined ? undefined : Math.max(0, Math.trunc(opts.size));
    // 仅在显式分页（给了 size，或 offset>0）时才包子查询 + 单独 COUNT；否则保持原"全量"路径与开销。
    const doPaginate = size !== undefined || offset > 0;

    let rows: T[];
    let total: number;
    if (doPaginate) {
      const countRow = this.db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as {
        n: number;
      };
      total = countRow.n;
      // size 省略时 LIMIT -1 = 取 offset 之后全部。
      rows = this.db.prepare(`SELECT * FROM (${sql}) LIMIT ? OFFSET ?`).all(...params, size ?? -1, offset) as T[];
    } else {
      rows = this.db.prepare(sql).all(...params) as T[];
      total = rows.length;
    }
    const returned = rows.length;
    return { rows, total, offset, size, returned, hasMore: offset + returned < total };
  }

  /**
   * 执行一条 DQL，返回 JSON 结果（带分页元信息）。分页语义见 {@link paginate}；
   * DQL 自带的 `LIMIT` 充当"全集上限"，外层 offset/size 在其内分页，不改 DQL 文法。
   *
   * @param dql - DQL 查询语句
   * @param opts.offset - 起始偏移（默认 0）
   * @param opts.size - 本页最大行数；省略 = 不分页（返回全部，向后兼容）
   * @throws DqlSyntaxError 语法不在子集内；Error 字段不支持
   *
   * @behavior
   * Given 落在子集内的 DQL（不带分页）
   * When 执行
   * Then 返回全部行 + total=行数；聚合列（file.tags/inlinks/outlinks/tasks）就地解析为数组
   *
   * @behavior
   * Given 带 size/offset 的 DQL
   * When 执行
   * Then rows 只含本页 ≤size 行，total 为命中总数，hasMore=offset+returned<total
   *
   * @behavior
   * Given 语法越界或引用不支持字段的 DQL
   * When 执行
   * Then 抛出带位置的 DqlSyntaxError / Error，而非返回误导性的空结果
   */
  query(dql: string, opts: { offset?: number; size?: number } = {}): QueryResult {
    // 词法+语法走 chevrotain（parser.ts）；旧手写 tokenizer/ast.parseQuery 已退役（S2.8 切换）。
    const compiled = generateSql(parseDql(dql));
    const columns = compiled.columns.map((c) => c.name);
    const { rows, total, offset, size, returned, hasMore } = this.paginate<Record<string, unknown>>(
      compiled.sql,
      compiled.params,
      opts,
    );

    // 聚合列（file.tags/inlinks/outlinks/tasks）以 JSON 字符串返回，就地解析为数组。
    const jsonCols = compiled.columns.filter((c) => c.json).map((c) => c.name);
    for (const row of rows) {
      for (const c of jsonCols) {
        const v = row[c];
        row[c] = typeof v === "string" ? JSON.parse(v) : (v ?? []);
      }
    }

    // 元信息前置（rows 之前），截断时优先保住 total/hasMore。
    return { type: compiled.type, columns, total, offset, size, returned, hasMore, rows };
  }

  /**
   * 列出笔记（按 folder/tag/name 过滤，分页），供 chat `list` 工具复用（对标 agent-browser
   * `snapshot -i`/`tab list` 的「发现有哪些笔记」缺口）。分页语义同 {@link paginate}。
   *
   * @param filter - folder/tag/name 过滤条件（任意组合，AND 拼接；见 {@link ListFilter}）
   * @param opts.offset - 起始偏移（默认 0）
   * @param opts.size - 本页最大行数；省略 = 不分页（返回全部）
   *
   * @behavior
   * Given 无过滤条件
   * When list
   * Then 返回全部文件（含 path/name/folder/mtime），按 file.path 升序
   *
   * @behavior
   * Given folder/tag/name 任意组合
   * When list
   * Then 按 AND 组合过滤；tag 前缀语义同 DQL FROM #tag，folder 前缀语义同 DQL FROM "folder"
   */
  list(filter: ListFilter = {}, opts: { offset?: number; size?: number } = {}): ListResult {
    const compiled = generateListSql(filter);
    const { rows, total, offset, size, returned, hasMore } = this.paginate<ListResult["files"][number]>(
      compiled.sql,
      compiled.params,
      opts,
    );
    return { total, offset, size, returned, hasMore, files: rows };
  }

  /**
   * 全文检索笔记正文（FTS5 + trigram 子串匹配，覆盖中英文，S3.5）。基于索引快照的 `files_fts`
   * 虚表（由 indexer 唯一写边界维护，见 indexer/index.ts ensureFts）；若从未用当前版本的
   * indexer 打开过该库，`files_fts` 可能不存在，此时给出清晰的「先建索引」提示而非裸 SQLite 错误。
   *
   * @param query - 原始查询文本（整体转义为字面短语，见 {@link escapeFtsPhrase}；不支持 FTS5 查询语法）
   * @param opts.offset - 起始偏移（默认 0）
   * @param opts.size - 本页最大行数；省略 = 不分页
   * @throws Error 查询 trim 后长度 < 3（trigram 无法形成子串匹配）
   * @throws Error `files_fts` 不存在（提示先 index/scan 建索引）
   *
   * @behavior
   * Given trim 后长度 < 3 的查询（含空串/纯空白/CJK 2 字）
   * When search
   * Then 抛出「不合法」错误并给出最短长度提示，而非静默返回空结果或裸 SQLite 语法错误
   *
   * @behavior
   * Given 含 FTS5 查询语法关键字/未闭合引号/悬空操作符的查询
   * When search
   * Then 整体转义为字面短语参与匹配，按字面子串命中，不被解释为查询语法、不抛裸 SQLite 错误
   */
  search(query: string, opts: { offset?: number; size?: number } = {}): SearchResult {
    const trimmed = query.trim();
    if (trimmed.length < MIN_FTS_QUERY_LEN) {
      throw new Error(
        `全文检索查询不合法：至少需要 ${MIN_FTS_QUERY_LEN} 个字符（trigram 子串匹配要求），当前 ${trimmed.length} 个`,
      );
    }
    const phrase = escapeFtsPhrase(trimmed);
    // 片段截取列 = content（第 2 列，0-based）；ORDER BY 内联在基础 SQL 里，随 paginate 分页窗口保序。
    const baseSql =
      "SELECT path AS path, name AS name, snippet(files_fts, 2, '[', ']', ' … ', 16) AS snippet, bm25(files_fts) AS rank " +
      "FROM files_fts WHERE files_fts MATCH ? ORDER BY rank, path ASC";
    let paged: ReturnType<typeof this.paginate<{ path: string; name: string; snippet: string; rank: number }>>;
    try {
      paged = this.paginate<{ path: string; name: string; snippet: string; rank: number }>(
        baseSql,
        [phrase],
        opts,
      );
    } catch (e) {
      if (e instanceof Error && /no such table:\s*files_fts/i.test(e.message)) {
        throw new Error("全文索引不存在：请先运行 index 或 scan 建立索引后再试", { cause: e });
      }
      throw e;
    }
    const rows = paged.rows.map(({ path, name, snippet }) => ({ path, name, snippet }));
    return {
      total: paged.total,
      offset: paged.offset,
      size: paged.size,
      returned: paged.returned,
      hasMore: paged.hasMore,
      rows,
    };
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }
}

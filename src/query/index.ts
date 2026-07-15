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

/** 全文检索最短查询长度（P4 放宽 3→2：2 字 CJK 是常见词，改走 LIKE 子串兜底，见 {@link DataviewEngine.search}）。 */
const MIN_FTS_QUERY_LEN = 2;

/** trigram 窗口长度：≥3 字的词才能形成 FTS5 MATCH 可用的 trigram token；更短的词走 LIKE。 */
const TRIGRAM_LEN = 3;

/**
 * 把单个词转义为 FTS5 MATCH 的字面短语参数（`"` → `""` 并整体加引号）：
 * 杜绝 FTS5 查询语法（NEAR/OR/列过滤/前缀通配/未闭合引号等）被用户输入意外触发——
 * 未转义的悬空操作符或未闭合引号会让 SQLite 直接抛语法错误（S3.5 手工验证过）。
 * trigram 分词器 + 短语查询 = 子串搜索，是 SQLite 官方推荐用法。
 */
function escapeFtsPhrase(raw: string): string {
  return `"${raw.replaceAll('"', '""')}"`;
}

/** 查询是否含 CJK 汉字：决定用「trigram-OR 宽松召回」（CJK 无空白分词）还是「字面短语 AND」（ASCII 词天然以空白分界）。 */
function hasCjk(s: string): boolean {
  return /[㐀-䶿一-鿿]/.test(s);
}

/** 把一个词切成重叠 trigram（步长 1）：`前端单元测试` → [前端单, 端单元, 单元测, 元测试]。 */
function overlappingTrigrams(term: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + TRIGRAM_LEN <= term.length; i++) out.push(term.slice(i, i + TRIGRAM_LEN));
  return out;
}

/** 转义 SQL LIKE 通配符（`\` `%` `_`），配合 `ESCAPE '\'` 让用户输入按字面子串匹配、不被当通配。 */
function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** LIKE 兜底命中时就地构造高亮片段（FTS 的 snippet() 只作用于 files_fts，此路径用 files 表、需自建）。 */
function likeSnippet(content: string, terms: string[]): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const lc = flat.toLowerCase();
  // 取最先出现的命中词为片段中心。
  let idx = -1;
  let hit = "";
  for (const t of terms) {
    const i = lc.indexOf(t.toLowerCase());
    if (i >= 0 && (idx < 0 || i < idx)) {
      idx = i;
      hit = flat.slice(i, i + t.length);
    }
  }
  if (idx < 0) return flat.slice(0, 64); // 防御：LIKE 已命中，理论不达此
  const start = Math.max(0, idx - 20);
  const end = Math.min(flat.length, idx + hit.length + 44);
  const before = flat.slice(start, idx);
  const after = flat.slice(idx + hit.length, end);
  return `${start > 0 ? "… " : ""}${before}[${hit}]${after}${end < flat.length ? " …" : ""}`;
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
  ): {
    rows: T[];
    total: number;
    offset: number;
    size?: number;
    returned: number;
    hasMore: boolean;
  } {
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
      rows = this.db
        .prepare(`SELECT * FROM (${sql}) LIMIT ? OFFSET ?`)
        .all(...params, size ?? -1, offset) as T[];
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
    const { rows, total, offset, size, returned, hasMore } = this.paginate<
      ListResult["files"][number]
    >(compiled.sql, compiled.params, opts);
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
        `全文检索查询不合法：至少需要 ${MIN_FTS_QUERY_LEN} 个字符，当前 ${trimmed.length} 个`,
      );
    }
    // === 自建实现: 中文相关性/分词的查询构造（P4）——只动查询侧，索引 tokenizer 与库结构不变 ===
    // 此前把「整条查询（含空格）」转成单一字面短语，trigram 下等价「要求原文含该连续子串」：
    // 多词（空格）、异措辞、2 字词一律落空（首跑复发的召回失真）。改为按空白切词后分档：
    const terms = trimmed.split(/\s+/).filter(Boolean);
    const hasShort = terms.some((t) => t.length < TRIGRAM_LEN);

    // 档 3（含短词）：任一词 < 3 字（2 字 CJK / 短 ASCII）无法形成 trigram token，放进 MATCH 会使整体
    // 落空 → 直接走 LIKE 子串兜底（每词 AND，精确）。这也是 2 字 CJK（测试/标签/任务）的唯一可行路径。
    if (hasShort) return this.searchLike(terms, opts);

    if (hasCjk(trimmed)) {
      // 档 1（CJK，全部 ≥3 字）：各词重叠 trigram 取并集后 OR + bm25。完整连续子串命中全部 trigram →
      // bm25 排最前；异措辞但字面 trigram 有交集者也浮现（召回）。比「严格短语命中即止」更能兜住
      // 「只回 1 条且不相关」——严格命中即止会漏掉措辞不同的相关笔记。
      const trigrams = [...new Set(terms.flatMap(overlappingTrigrams))];
      const expr = (trigrams.length > 0 ? trigrams : terms).map(escapeFtsPhrase).join(" OR ");
      return this.searchFts(expr, opts);
    }
    // 档 2（纯 ASCII，全部 ≥3 字）：每词字面短语 AND——保留既有精确子串语义（英文以空白分界，无需拆
    // trigram），并把此前「整串单短语」升级为「多词 AND」，修掉带空格查询要求连续子串的问题。
    const expr = terms.map(escapeFtsPhrase).join(" AND ");
    return this.searchFts(expr, opts);
  }

  /** FTS5 MATCH 执行 + 分页 + 缺表友好报错（trigram 索引路径；bm25 排序、snippet 高亮）。 */
  private searchFts(matchExpr: string, opts: { offset?: number; size?: number }): SearchResult {
    // 片段截取列 = content（第 2 列，0-based）；ORDER BY 内联在基础 SQL 里，随 paginate 分页窗口保序。
    const baseSql =
      "SELECT path AS path, name AS name, snippet(files_fts, 2, '[', ']', ' … ', 16) AS snippet, bm25(files_fts) AS rank " +
      "FROM files_fts WHERE files_fts MATCH ? ORDER BY rank, path ASC";
    let paged: ReturnType<
      typeof this.paginate<{ path: string; name: string; snippet: string; rank: number }>
    >;
    try {
      paged = this.paginate<{ path: string; name: string; snippet: string; rank: number }>(
        baseSql,
        [matchExpr],
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

  /**
   * LIKE 子串兜底（含短词档 / 2 字 CJK）：直接查 files 表，每词 `content/name LIKE '%词%'` 的 AND。
   * 走全表扫描（无 trigram MATCH 的 bm25），故按 path 稳定排序、就地自建高亮片段。vault 量级可接受。
   */
  private searchLike(terms: string[], opts: { offset?: number; size?: number }): SearchResult {
    const cond = terms
      .map(() => "(content LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')")
      .join(" AND ");
    const params = terms.flatMap((t) => {
      const p = `%${escapeLikePattern(t)}%`;
      return [p, p];
    });
    const baseSql = `SELECT path AS path, name AS name, content AS content FROM files WHERE ${cond} ORDER BY path ASC`;
    const paged = this.paginate<{ path: string; name: string; content: string }>(
      baseSql,
      params,
      opts,
    );
    const rows = paged.rows.map(({ path, name, content }) => ({
      path,
      name,
      snippet: likeSnippet(content, terms),
    }));
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

import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import type { QueryResult } from "./ast.js";
import { parseDql } from "./parser.js";
import { safeRegexpMatch } from "./regexp.js";
import { generateSql } from "./sql-generator.js";

export type { DqlQuery, QueryResult } from "./ast.js";
export { DqlSyntaxError } from "./errors.js";

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
   * 执行一条 DQL，返回 JSON 结果（带分页元信息）。
   *
   * 分页在引擎层完成、**不改 DQL 文法**：把编译出的 SQL 外包一层
   * `SELECT * FROM (<compiled>) LIMIT ? OFFSET ?`；`total` 走 `SELECT COUNT(*) FROM (<compiled>)`，
   * 不受分页影响。DQL 自带的 `LIMIT` 充当"全集上限"，外层 offset/size 在其内分页。
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
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
    const size = opts.size === undefined ? undefined : Math.max(0, Math.trunc(opts.size));
    // 仅在显式分页（给了 size，或 offset>0）时才包子查询 + 单独 COUNT；否则保持原"全量"路径与开销。
    const paginate = size !== undefined || offset > 0;

    let rows: Record<string, unknown>[];
    let total: number;
    if (paginate) {
      // total：DQL 约束内的命中总数（含 DQL 自带 LIMIT 作为全集上限），与分页窗口无关。
      const countRow = this.db
        .prepare(`SELECT COUNT(*) AS n FROM (${compiled.sql})`)
        .get(...compiled.params) as { n: number };
      total = countRow.n;
      // 本页：外层 LIMIT/OFFSET 包住编译 SQL；size 省略时 LIMIT -1 = 取 offset 之后全部。
      rows = this.db
        .prepare(`SELECT * FROM (${compiled.sql}) LIMIT ? OFFSET ?`)
        .all(...compiled.params, size ?? -1, offset) as Record<string, unknown>[];
    } else {
      rows = this.db.prepare(compiled.sql).all(...compiled.params) as Record<string, unknown>[];
      total = rows.length;
    }

    // 聚合列（file.tags/inlinks/outlinks/tasks）以 JSON 字符串返回，就地解析为数组。
    const jsonCols = compiled.columns.filter((c) => c.json).map((c) => c.name);
    for (const row of rows) {
      for (const c of jsonCols) {
        const v = row[c];
        row[c] = typeof v === "string" ? JSON.parse(v) : (v ?? []);
      }
    }

    const returned = rows.length;
    // 元信息前置（rows 之前），截断时优先保住 total/hasMore。
    return { type: compiled.type, columns, total, offset, size, returned, hasMore: offset + returned < total, rows };
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }
}

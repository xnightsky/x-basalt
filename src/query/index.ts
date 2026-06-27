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
   * 执行一条 DQL，返回 JSON 结果。
   *
   * @param dql - DQL 查询语句
   * @throws DqlSyntaxError 语法不在子集内；Error 字段不支持
   *
   * @behavior
   * Given 落在子集内的 DQL
   * When 执行
   * Then 返回 { type, columns, rows }，聚合列（file.tags/inlinks/outlinks/tasks）就地解析为数组
   *
   * @behavior
   * Given 语法越界或引用不支持字段的 DQL
   * When 执行
   * Then 抛出带位置的 DqlSyntaxError / Error，而非返回误导性的空结果
   */
  query(dql: string): QueryResult {
    // 词法+语法走 chevrotain（parser.ts）；旧手写 tokenizer/ast.parseQuery 已退役（S2.8 切换）。
    const compiled = generateSql(parseDql(dql));
    const rows = this.db.prepare(compiled.sql).all(...compiled.params) as Record<string, unknown>[];

    // 聚合列（file.tags/inlinks/outlinks/tasks）以 JSON 字符串返回，就地解析为数组。
    const jsonCols = compiled.columns.filter((c) => c.json).map((c) => c.name);
    for (const row of rows) {
      for (const c of jsonCols) {
        const v = row[c];
        row[c] = typeof v === "string" ? JSON.parse(v) : (v ?? []);
      }
    }

    return { type: compiled.type, columns: compiled.columns.map((c) => c.name), rows };
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }
}

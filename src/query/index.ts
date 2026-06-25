import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";
import { parseQuery, type QueryResult } from "./ast.js";
import { generateSql } from "./sql-generator.js";
import { tokenize } from "./tokenizer.js";

export type { DqlQuery, QueryResult } from "./ast.js";
export { DqlSyntaxError } from "./tokenizer.js";

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
    this.db.function("regexp", { deterministic: true }, (pattern: unknown, value: unknown) => {
      if (value === null || value === undefined) return 0;
      try {
        return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
      } catch {
        // 非法正则视为不匹配，不抛错中断整条查询。
        return 0;
      }
    });
  }

  /**
   * 执行一条 DQL，返回 JSON 结果。
   *
   * @param dql - DQL 查询语句
   * @throws DqlSyntaxError 语法不在子集内；Error 字段不支持
   */
  query(dql: string): QueryResult {
    const compiled = generateSql(parseQuery(tokenize(dql)));
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

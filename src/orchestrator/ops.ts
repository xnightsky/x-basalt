import { parseAction } from "./actions.js";
import { register } from "./registry.js";
import type { ActionContext, Op, OpContext, OpFailure, OpOutcome, Row } from "./types.js";

// === 自建实现: 内建动作的 Op 包装（设计：docs/design/pipeline-op-model.md §3.2）===
//
// 每个 Op 通过 parseAction 复用 actions.ts 已导出的 Action 实现，不复制粘贴动作逻辑。
// Op.run 遍历入参 rows，把每个 Row 投影成 ChangeEvent 喂给 Action.run，收集结果。
// 无参算子（index/parse/normalize）在注册时绑定；带参算子（apply/set/unset/rename）在 resolve 时绑定。

function buildOp(actionToken: string): Op {
  const action = parseAction(actionToken);
  return {
    name: action.name,
    write: action.write,
    rowwise: true,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      // OpContext 与 ActionContext 结构一致，直接投影
      const actCtx = ctx as ActionContext;
      const outcome: OpOutcome = { rows: [], failed: [], changed: [], skipped: [] };

      for (const row of rows) {
        try {
          const result = await action.run({ path: row.path, type: row.event ?? "change" }, actCtx);
          if (result.error) {
            outcome.failed.push({ path: row.path, op: action.name, error: result.error });
          } else {
            outcome.rows.push(row);
          }
          // D9: 收集 changed/skipped 信号（ActionResult 本就有，之前没外传）
          if (result.changed) outcome.changed.push(row.path);
          if (result.skipped) outcome.skipped.push(row.path);
        } catch (err) {
          outcome.failed.push({
            path: row.path,
            op: action.name,
            error: String(err),
          });
          // 抛异常的行：不变更不跳过，不加到 changed/skipped
        }
      }

      return outcome;
    },
  };
}

// 无参算子：注册时直接绑定
const NOPARAM_OPS = ["index", "parse", "normalize"] as const;

// 带参算子：在 resolve 时通过 factory 绑定（parseAction 内部校验参数合法性）
type ParamBuilder = (params: string) => string;
const PARAM_OPS: Record<string, ParamBuilder> = {
  apply: (p) => `apply ${p}`,
  set: (p) => `set ${p}`,
  unset: (p) => `unset ${p}`,
  rename: (p) => `rename ${p}`,
};

// === 片二：只读算子（query / search），依赖 ctx.engine（设计：docs/design/pipeline-op-model.md §4）===
// 两个算子都是 rowwise: false（一次查库看全批）、write: false（不改任何东西）。

/**
 * query <dql> 算子工厂。既是源也是转换：
 * - 源模式（入参 rows 为空）：执行 DQL，每个命中文件产出为 Row（path=文件路径，fields=DQL 列值）。
 * - 转换模式（入参 rows 非空）：执行 DQL 得到命中 path 集合，过滤 rows 只保留命中行，
 *   并把 DQL 的列值合并进对应 Row 的 fields。合并策略：row.fields 已有同名键时不覆盖
 *   （上游流下来的结果优先），DQL 只填充新增键。
 *
 * DQL 错误处理策略：
 * - 源模式：返回空 rows + 一条 failed（path="<query>"）。
 * - 转换模式：返回 rows 原样透传 + 一条整体 failed。
 *   理由：过滤条件未能应用但行数据本身有效，清除行对上游损失太大；
 *   失败记录会在报告中清晰体现。
 */
function makeQueryOp(dql: string): Op {
  return {
    name: "query",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.engine) {
        const errMsg = "ctx.engine 未提供：query 算子需要 engine 支持";
        const failedEntry: OpFailure = { path: "<query>", op: "query", error: errMsg };
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [failedEntry],
          changed: [],
          skipped: [],
        };
      }
      try {
        const result = ctx.engine.query(dql);
        const columns = result.columns;

        // 源模式：忽略入参，从 DQL 结果直接产出行
        if (rows.length === 0) {
          if (!columns.includes("file.path")) {
            return {
              rows: [],
              failed: [
                {
                  path: "<query>",
                  op: "query",
                  error:
                    "TABLE 查询缺少 file.path 列，无法映射行路径。请在 DQL 查询中显式包含 file.path 列，例如：TABLE file.path, status FROM ...",
                },
              ],
              changed: [],
              skipped: [],
            };
          }
          const out: Row[] = result.rows.map((r) => {
            const path = r["file.path"];
            const fields: Record<string, unknown> = {};
            for (const col of columns) {
              if (col !== "file.path") fields[col] = r[col];
            }
            return { path: String(path ?? ""), fields };
          });
          return { rows: out, failed: [], changed: [], skipped: [] };
        }

        // 转换模式：过滤 + 合并 DQL 列值
        if (!columns.includes("file.path")) {
          return {
            rows: [],
            failed: rows.map((r) => ({
              path: r.path,
              op: "query",
              error:
                "TABLE 查询缺少 file.path 列，无法映射行路径。请在 DQL 查询中显式包含 file.path 列，例如：TABLE file.path, status FROM ...",
            })),
            changed: [],
            skipped: [],
          };
        }
        const hitPaths = new Set<string>();
        const dqlFieldsMap = new Map<string, Record<string, unknown>>();
        for (const r of result.rows) {
          const p = r["file.path"];
          if (typeof p === "string") {
            hitPaths.add(p);
            const fields: Record<string, unknown> = {};
            for (const col of columns) {
              if (col !== "file.path") fields[col] = r[col];
            }
            dqlFieldsMap.set(p, fields);
          }
        }

        const out: Row[] = [];
        for (const row of rows) {
          if (hitPaths.has(row.path)) {
            const qf = dqlFieldsMap.get(row.path);
            // 合并策略：DQL 列值填充新键，不覆盖 row.fields 已有同名键
            // （上游流下来的结果优先于 DQL 列值）
            const mergedFields = { ...qf, ...row.fields };
            out.push({ ...row, fields: mergedFields });
          }
          // 不命中的行排除——query 作转换时也是过滤器
        }
        return { rows: out, failed: [], changed: [], skipped: [] };
      } catch (err) {
        const errMsg = String(err);
        const failedEntry: OpFailure = { path: "<query>", op: "query", error: errMsg };
        if (rows.length === 0) {
          return { rows: [], failed: [failedEntry], changed: [], skipped: [] };
        }
        // 转换模式：行原样透传，同时报告失败（见模块注释的策略说明）
        return { rows, failed: [failedEntry], changed: [], skipped: [] };
      }
    },
  };
}

/**
 * search <text> 算子工厂。双角色（源/转换）：
 * - 源模式（入参 rows 为空）：执行全文检索，每个命中文件产出为 Row（path=文件路径，fields={name,snippet}）。
 * - 转换模式（入参 rows 非空）：执行全文检索得到命中 path 集合，过滤 rows 只保留命中行，
 *   并把 search 的 name/snippet 合并进对应 Row 的 fields（上游同名键优先）。
 *
 * 错误处理策略同 query 算子。
 */
function makeSearchOp(text: string): Op {
  return {
    name: "search",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.engine) {
        const errMsg = "ctx.engine 未提供：search 算子需要 engine 支持";
        const failedEntry: OpFailure = { path: "<search>", op: "search", error: errMsg };
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [failedEntry],
          changed: [],
          skipped: [],
        };
      }
      try {
        const result = ctx.engine.search(text);
        const hitPaths = new Set(result.rows.map((r) => r.path));
        const searchFieldsMap = new Map<string, Record<string, unknown>>();
        for (const r of result.rows) {
          searchFieldsMap.set(r.path, { name: r.name, snippet: r.snippet });
        }

        // 源模式：忽略入参，从检索结果直接产出行
        if (rows.length === 0) {
          const out: Row[] = result.rows.map((r) => ({
            path: r.path,
            fields: { name: r.name, snippet: r.snippet } as Record<string, unknown>,
          }));
          return { rows: out, failed: [], changed: [], skipped: [] };
        }

        // 转换模式：过滤 + 合并 search 字段
        const out: Row[] = [];
        for (const row of rows) {
          if (hitPaths.has(row.path)) {
            const sf = searchFieldsMap.get(row.path);
            // 合并策略：search 字段填充新键，不覆盖 row.fields 已有同名键
            const mergedFields = { ...sf, ...row.fields };
            out.push({ ...row, fields: mergedFields });
          }
        }
        return { rows: out, failed: [], changed: [], skipped: [] };
      } catch (err) {
        const errMsg = String(err);
        const failedEntry: OpFailure = { path: "<search>", op: "search", error: errMsg };
        if (rows.length === 0) {
          return { rows: [], failed: [failedEntry], changed: [], skipped: [] };
        }
        // 转换模式：行原样透传，同时报告失败
        return { rows, failed: [failedEntry], changed: [], skipped: [] };
      }
    },
  };
}

/**
 * 注册内建算子到 registry。
 * 不要在模块顶层自动执行——调用方显式调，避免 import 副作用与测试污染。
 */
export function registerBuiltinOps(): void {
  for (const name of NOPARAM_OPS) {
    register(name, () => buildOp(name));
  }
  for (const [name, builder] of Object.entries(PARAM_OPS)) {
    register(name, (params: string) => {
      if (!params) throw new Error(`${name} 算子需要参数，格式参考：${builder("<param>")}`);
      return buildOp(builder(params));
    });
  }
  // 片二只读算子：依赖 ctx.engine（设计：docs/design/pipeline-op-model.md §4）
  register("query", (params: string) => {
    if (!params) throw new Error("query 算子需要 DQL 参数");
    return makeQueryOp(params);
  });
  register("search", (params: string) => {
    if (!params) throw new Error("search 算子需要搜索文本参数");
    return makeSearchOp(params);
  });
}

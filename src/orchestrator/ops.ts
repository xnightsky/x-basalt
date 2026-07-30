import { parseAction } from "./actions.js";
import { register } from "./registry.js";
import { BaseEngine } from "../base/index.js";
import { resolveVaultLayout } from "../utils/path.js";
import { runLint } from "../lint/index.js";
import { runLinksCheck, runLinksSuggest } from "../links/index.js";
import { hasInterpolation, interpolateToken } from "./interp.js";
import { makeFilterOp, makeLimitOp, makeDedupOp, makeMapOp } from "./ops-pure.js";
import type { ActionContext, Op, OpContext, OpFailure, OpOutcome, Row } from "./types.js";
import type { BasaltDiagnostic } from "../diagnostic.js";

// === 自建实现: 内建动作的 Op 包装（设计：docs/design/pipeline-op-model.md §3.2）===
//
// 每个 Op 通过 parseAction 复用 actions.ts 已导出的 Action 实现，不复制粘贴动作逻辑。
// Op.run 遍历入参 rows，把每个 Row 投影成 ChangeEvent 喂给 Action.run，收集结果。
// 无参算子（index/parse/normalize）在注册时绑定；带参算子（apply/set/unset/rename）在 resolve 时绑定。

/**
 * 构造 Op 包装。
 *
 * 无插值的 actionToken 走当前路径（parseAction 一次绑定，行为逐字节不变——§9.1-A 判据）。
 * 含 {{row.xxx}} 插值的 actionToken 走插值路径：对每行渲染参数后再构造 Action。
 *
 * 这是 §5 数据传递的兑现点：base 的 formula 计算列经 {{row.x}} 抵达写算子。
 */
function buildOp(actionToken: string): Op {
  // === §5 插值兑现：不含 {{row. 时走零开销逃逸路径（§9.1-A 判据保护） ===
  if (!hasInterpolation(actionToken)) {
    const action = parseAction(actionToken);
    return {
      name: action.name,
      write: action.write,
      rowwise: true,
      async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
        const actCtx = ctx as ActionContext;
        const outcome: OpOutcome = { rows: [], failed: [], changed: [], skipped: [] };

        for (const row of rows) {
          try {
            const result = await action.run(
              { path: row.path, type: row.event ?? "change" },
              actCtx,
            );
            if (result.error) {
              outcome.failed.push({ path: row.path, op: action.name, error: result.error });
            } else {
              outcome.rows.push(row);
            }
            if (result.changed) outcome.changed.push(row.path);
            if (result.skipped) outcome.skipped.push(row.path);
          } catch (err) {
            outcome.failed.push({
              path: row.path,
              op: action.name,
              error: String(err),
            });
          }
        }

        return outcome;
      },
    };
  }

  // === 插值路径：每行渲染后再构造/调用（守 §5 / D4「只读不求值」） ===
  const verb = actionToken.split(/\s+/)[0]!;
  return {
    name: verb,
    write: true,
    rowwise: true,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      const actCtx = ctx as ActionContext;
      const outcome: OpOutcome = { rows: [], failed: [], changed: [], skipped: [] };

      for (const row of rows) {
        const [rendered, renderFailures] = interpolateToken(actionToken, row, verb);
        outcome.failed.push(...renderFailures);
        // 即使有渲染失败的字段（缺失字段→空串），仍然执行动作
        try {
          const interpAction = parseAction(rendered);
          const result = await interpAction.run(
            { path: row.path, type: row.event ?? "change" },
            actCtx,
          );
          if (result.error) {
            outcome.failed.push({ path: row.path, op: verb, error: result.error });
          } else {
            outcome.rows.push(row);
          }
          if (result.changed) outcome.changed.push(row.path);
          if (result.skipped) outcome.skipped.push(row.path);
        } catch (err) {
          outcome.failed.push({
            path: row.path,
            op: verb,
            error: String(err),
          });
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
 *   并把 DQL 的列值合并进对应 Row 的 fields（同名键以 DQL 的值为准，覆盖上游值）。
 *
 * DQL 错误处理策略：
 * - 源模式：返回空 rows + 一条 failed（path="<query>"）。
 * - 转换模式：每行各记一条 failed + rows 原样透传。
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
            // 合并策略：DQL 列值覆盖上游同名键（设计：docs/design/pipeline-op-model.md §5 数据传递）
            const mergedFields = { ...row.fields, ...qf };
            out.push({ ...row, fields: mergedFields });
          }
          // 不命中的行排除——query 作转换时也是过滤器
        }
        return { rows: out, failed: [], changed: [], skipped: [] };
      } catch (err) {
        const errMsg = String(err);
        if (rows.length === 0) {
          return {
            rows: [],
            failed: [{ path: "<query>", op: "query", error: errMsg }],
            changed: [],
            skipped: [],
          };
        }
        // 转换模式：每行各记一条 failed + rows 原样透传
        return {
          rows,
          failed: rows.map((r) => ({ path: r.path, op: "query", error: errMsg })),
          changed: [],
          skipped: [],
        };
      }
    },
  };
}

/**
 * search <text> 算子工厂。双角色（源/转换）：
 * - 源模式（入参 rows 为空）：执行全文检索，每个命中文件产出为 Row（path=文件路径，
 *   fields 含 score/name/snippet）。
 * - 转换模式（入参 rows 非空）：执行全文检索得到命中 path 集合，过滤 rows 只保留命中行，
 *   并把 search 的字段合并进对应 Row 的 fields（同名键以 search 的值为准，覆盖上游值）。
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
          // score 取自 DataviewEngine.search 的 bm25 排名（FTS 路径）或 0（LIKE 兜底路径）
          searchFieldsMap.set(r.path, {
            score: r.score,
            name: r.name,
            snippet: r.snippet,
          });
        }

        // 源模式：忽略入参，从检索结果直接产出行
        if (rows.length === 0) {
          const out: Row[] = result.rows.map((r) => ({
            path: r.path,
            fields: { score: r.score, name: r.name, snippet: r.snippet } as Record<string, unknown>,
          }));
          return { rows: out, failed: [], changed: [], skipped: [] };
        }

        // 转换模式：过滤 + 合并 search 字段
        const out: Row[] = [];
        for (const row of rows) {
          if (hitPaths.has(row.path)) {
            const sf = searchFieldsMap.get(row.path);
            // 合并策略：search 字段覆盖上游同名键
            const mergedFields = { ...row.fields, ...sf };
            out.push({ ...row, fields: mergedFields });
          }
        }
        return { rows: out, failed: [], changed: [], skipped: [] };
      } catch (err) {
        const errMsg = String(err);
        if (rows.length === 0) {
          return {
            rows: [],
            failed: [{ path: "<search>", op: "search", error: errMsg }],
            changed: [],
            skipped: [],
          };
        }
        // 转换模式：每行各记一条 failed + rows 原样透传
        return {
          rows,
          failed: rows.map((r) => ({ path: r.path, op: "search", error: errMsg })),
          changed: [],
          skipped: [],
        };
      }
    },
  };
}

/**
 * base <file>[#<viewName>] 算子工厂。双角色（源/转换）：
 * - 源模式（入参 rows 为空）：执行 BaseEngine.query，每个命中文件产出为 Row（path=文件路径，
 *   fields=该行所有列值，包括 formula 计算列——这是本算子的核心价值）。
 * - 转换模式（入参 rows 非空）：用 BaseEngine 结果的 path 集合过滤上游行，
 *   并把列值合并进保留行的 fields，同名键上游优先。
 *
 * 参数格式：`base <file>[#<viewName>]`，# 后为 view 名，缺省取 views[0]。
 *
 * 诊断处理：
 * - severity=error 的诊断必须记进 failed（不抛异常，不静默吞掉）。
 * - severity=warning/info 的诊断不进 failed（base 的 markdown-only 数据集恒发 warning，
 *   若 warning 也算失败则任何 base 算子都会失败）。
 *
 * 生命周期：每次 run 自己开自己关 BaseEngine，不要泄漏连接。
 */
function makeBaseOp(params: string): Op {
  // 解析 `base <file>[#<viewName>]` 格式
  const hashIdx = params.indexOf("#");
  const basePath = hashIdx === -1 ? params.trim() : params.slice(0, hashIdx).trim();
  const viewName = hashIdx === -1 ? undefined : params.slice(hashIdx + 1).trim() || undefined;

  return {
    name: "base",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.vaultRoots || !ctx.dbPath) {
        const missing: string[] = [];
        if (!ctx.vaultRoots) missing.push("vaultRoots");
        if (!ctx.dbPath) missing.push("dbPath");
        const errMsg = `ctx.${missing.join("/")} 未提供：base 算子需要 vaultRoots 和 dbPath`;
        const failedEntry: OpFailure = { path: "<base>", op: "base", error: errMsg };
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [failedEntry],
          changed: [],
          skipped: [],
        };
      }

      // 把 basePath 解析为 vault 内绝对路径：loadBaseDocument 用 resolve() 从 CWD 解析，
      // 而 vault 根未必是 CWD（尤其在测试中）。这里用 resolveVaultLayout.toAbs 把
      // vault 相对路径转绝对路径，与 indexer 的路径解析口径一致。
      let absBasePath: string;
      try {
        const layout = resolveVaultLayout(ctx.vaultRoots);
        absBasePath = layout.toAbs(basePath);
      } catch {
        const failedEntry: OpFailure = { path: "<base>", op: "base", error: "vault 根解析失败" };
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [failedEntry],
          changed: [],
          skipped: [],
        };
      }

      const engine = new BaseEngine();
      try {
        const result = engine.query({
          basePath: absBasePath,
          view: viewName,
          dbPath: ctx.dbPath,
          vaultRoots: ctx.vaultRoots,
        });

        // 收集 error 级诊断到 failed
        const baseFailed: OpFailure[] = [];
        for (const d of result.diagnostics) {
          if (d.severity === "error") {
            baseFailed.push({
              path: d.file,
              op: "base",
              error: `${d.rule}: ${d.message}`,
            });
          }
        }

        const columns = result.columns;

        // 源模式：忽略入参，从 BaseEngine 结果直接产出行
        if (rows.length === 0) {
          if (baseFailed.length > 0) {
            return { rows: [], failed: baseFailed, changed: [], skipped: [] };
          }
          const out: Row[] = result.rows.map((r) => {
            const path = String(r["file.path"] ?? "");
            const fields: Record<string, unknown> = {};
            for (const col of columns) {
              if (col !== "file.path") fields[col] = r[col];
            }
            return { path, fields };
          });
          return { rows: out, failed: [], changed: [], skipped: [] };
        }

        // 转换模式：过滤 + 合并列值
        if (baseFailed.length > 0) {
          // 有 error 诊断时，行原样透传（不丢弃有效数据），同时报告失败
          return { rows, failed: baseFailed, changed: [], skipped: [] };
        }

        const hitPaths = new Set<string>();
        const fieldsMap = new Map<string, Record<string, unknown>>();
        for (const r of result.rows) {
          const p = r["file.path"];
          if (typeof p === "string") {
            hitPaths.add(p);
            const fields: Record<string, unknown> = {};
            for (const col of columns) {
              if (col !== "file.path") fields[col] = r[col];
            }
            fieldsMap.set(p, fields);
          }
        }

        const out: Row[] = [];
        for (const row of rows) {
          const bf = fieldsMap.get(row.path);
          if (bf !== undefined) {
            // 合并策略：BaseEngine 列值填充新键，不覆盖 row.fields 已有同名键
            const mergedFields = { ...bf, ...row.fields };
            out.push({ ...row, fields: mergedFields });
          }
        }
        return { rows: out, failed: [], changed: [], skipped: [] };
      } finally {
        engine.close();
      }
    },
  };
}

// === 片二只读诊断类算子（设计：docs/design/pipeline-op-model.md §4 / §12）===
//
// 设计决策：诊断挂在 Row.fields.diagnostics，类型复用各模块既有的 BasaltDiagnostic 结构，
// 不另造形状。三个算子都遵守这个键名。理由是复用既有结构、消费方一处适配即可。
// links.suggest 的路径建议用 fields.linkSuggestions。

/**
 * 把诊断数组按文件分组，转换为算子产出行。
 * - 源模式（inputRows 为空）：每个有诊断的文件产出一行（path=文件路径，fields.diagnostics=诊断数组）。
 * - 转换模式（inputRows 非空）：按行路径匹配诊断后挂到该行 fields.diagnostics，所有行原样透传。
 */
function diagnosticsToRows(diagnostics: BasaltDiagnostic[], inputRows: Row[]): Row[] {
  const diagMap = new Map<string, BasaltDiagnostic[]>();
  for (const d of diagnostics) {
    const arr = diagMap.get(d.file) ?? [];
    arr.push(d);
    diagMap.set(d.file, arr);
  }

  if (inputRows.length === 0) {
    // 源模式：每个有诊断的文件产出一行
    const out: Row[] = [];
    for (const [file, ds] of diagMap) {
      out.push({ path: file, fields: { diagnostics: ds } });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  // 转换模式：按行路径匹配诊断后透传（诊断 ≠ 失败，不丢弃行）
  return inputRows.map((row) => {
    const ds = diagMap.get(row.path);
    if (ds && ds.length > 0) {
      return { ...row, fields: { ...row.fields, diagnostics: ds } };
    }
    return row;
  });
}

/**
 * lint 算子工厂。双角色（源/转换）：
 * - 源模式（入参 rows 为空）：对整个 vault 跑 lint，每个有诊断的文件产出为 Row
 *   （path=文件路径，fields.diagnostics=该文件的诊断数组）。
 * - 转换模式（入参 rows 非空）：对整个 vault 跑 lint，按行路径过滤诊断后挂到该行 fields.diagnostics；
 *   有诊断的行仍然透传下去——lint 的产物就是诊断本身，把诊断当失败会让整条链断掉。
 *
 * 失败边界：failed 只用于「跑 lint 这个动作本身失败」（如 vault 根不可读），
 * 不用于「发现了诊断」。
 * changed/skipped 恒为空（只读算子）。
 */
function makeLintOp(): Op {
  return {
    name: "lint",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.vaultRoots || ctx.vaultRoots.length === 0) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [
            {
              path: "<lint>",
              op: "lint",
              error: "ctx.vaultRoots 未提供：lint 算子需要 vaultRoots",
            },
          ],
          changed: [],
          skipped: [],
        };
      }
      try {
        const result = await runLint({ vault: ctx.vaultRoots });
        return {
          rows: diagnosticsToRows(result.diagnostics, rows),
          failed: [],
          changed: [],
          skipped: [],
        };
      } catch (err) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [{ path: "<lint>", op: "lint", error: String(err) }],
          changed: [],
          skipped: [],
        };
      }
    },
  };
}

/**
 * links.check 算子工厂。语义同 lint 算子——断链诊断挂 fields.diagnostics，行照常透传/产出。
 * 失败边界同上：failed 只用于「跑断链检查动作本身失败」，不用于「发现了断链」。
 * changed/skipped 恒为空（只读算子）。
 */
function makeLinksCheckOp(): Op {
  return {
    name: "links.check",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.vaultRoots || ctx.vaultRoots.length === 0) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [
            {
              path: "<links.check>",
              op: "links.check",
              error: "ctx.vaultRoots 未提供：links.check 算子需要 vaultRoots",
            },
          ],
          changed: [],
          skipped: [],
        };
      }
      try {
        const result = await runLinksCheck({ vault: ctx.vaultRoots });
        return {
          rows: diagnosticsToRows(result.diagnostics, rows),
          failed: [],
          changed: [],
          skipped: [],
        };
      } catch (err) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [{ path: "<links.check>", op: "links.check", error: String(err) }],
          changed: [],
          skipped: [],
        };
      }
    },
  };
}

/**
 * links.suggest 算子工厂。单文件入口，spec 格式：`links.suggest <fileRel>`。
 * 把路径建议挂进 fields.linkSuggestions（类型为 string[]，已去重）。
 *
 * 双角色（源/转换）：
 * - 源模式（入参 rows 为空）：产出文件所在行（path=fileRel，fields.linkSuggestions=建议列表）。
 * - 转换模式（入参 rows 非空）：所有行透传，添加 fields.linkSuggestions。
 */
function makeLinksSuggestOp(fileRel: string): Op {
  return {
    name: "links.suggest",
    write: false,
    rowwise: false,
    async run(rows: Row[], ctx: OpContext): Promise<OpOutcome> {
      if (!ctx.vaultRoots || ctx.vaultRoots.length === 0) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [
            {
              path: fileRel,
              op: "links.suggest",
              error: "ctx.vaultRoots 未提供：links.suggest 算子需要 vaultRoots",
            },
          ],
          changed: [],
          skipped: [],
        };
      }
      try {
        const result = await runLinksSuggest(fileRel, { vault: ctx.vaultRoots });
        const suggestions = [...new Set(result.diagnostics.flatMap((d) => d.suggestions ?? []))];
        const fields: Record<string, unknown> = { linkSuggestions: suggestions };

        if (rows.length === 0) {
          // 源模式：产出文件路径 + 建议
          return { rows: [{ path: fileRel, fields }], failed: [], changed: [], skipped: [] };
        }

        // 转换模式：所有行透传 + 挂建议
        const out: Row[] = rows.map((row) => ({
          ...row,
          fields: { ...row.fields, ...fields },
        }));
        return { rows: out, failed: [], changed: [], skipped: [] };
      } catch (err) {
        return {
          rows: rows.length === 0 ? [] : rows,
          failed: [{ path: fileRel, op: "links.suggest", error: String(err) }],
          changed: [],
          skipped: [],
        };
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
  // 片二只读算子：base（依赖 ctx.vaultRoots/dbPath）
  register("base", (params: string) => {
    if (!params)
      throw new Error("base 算子需要 .base 文件路径参数，格式：base <file>[#<viewName>]");
    return makeBaseOp(params);
  });

  // 片二只读诊断类算子（设计：docs/design/pipeline-op-model.md §4 / §12）
  // === 设计决策：诊断挂在 Row.fields.diagnostics，类型复用各模块既有的 BasaltDiagnostic 结构，
  //     不另造形状。三个算子都遵守这个键名。理由是复用既有结构、消费方一处适配即可。
  //     links.suggest 的路径建议用 fields.linkSuggestions。
  // ===
  register("lint", () => makeLintOp());
  register("links.check", () => makeLinksCheckOp());
  register("links.suggest", (params: string) => {
    if (!params) throw new Error("links.suggest 算子需要文件路径参数");
    return makeLinksSuggestOp(params);
  });

  // === 片三纯函数算子（设计：docs/design/pipeline-op-model.md §5 / §12、D4）===
  // 全部 rowwise:false、write:false（纯函数，不碰 IO）。
  register("filter", (params: string) => {
    if (!params) throw new Error("filter 算子需要表达式参数");
    return makeFilterOp(params);
  });
  register("limit", (params: string) => {
    if (params === undefined || params.trim() === "") throw new Error("limit 算子需要数字参数");
    return makeLimitOp(params);
  });
  register("dedup", (params: string) => {
    return makeDedupOp(params); // params 可空（缺省按 path 去重）
  });
  register("map", (params: string) => {
    if (!params) throw new Error("map 算子需要 <targetField>=<template> 参数");
    return makeMapOp(params);
  });
}

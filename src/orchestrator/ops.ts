import { parseAction } from "./actions.js";
import { register } from "./registry.js";
import type { ActionContext, Row, Op, OpContext, OpOutcome } from "./types.js";

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

/**
 * 注册 7 个内建动作算子到 registry。
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
}

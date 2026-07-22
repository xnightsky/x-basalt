import type { BasaltDiagnostic } from "../diagnostic.js";
import { checkVault } from "../links/check.js";
import type { LintIgnoreConfig } from "../links/ignore.js";

// === 自建实现: lint 壳（P2 最小面：唯一 links 规则，复用 links/checkVault）===
//
// 上游：src/cli.ts lint 命令；下游：按 rule 分发到规则 runner（P2 仅 links → checkVault）。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §3.3/§9；计划见
// docs/plans/2026-07-22-kb-compiler-p2-diagnostic-contract.md。
// 边界：不做 profile / fix / ci / baseline（P3–P5）；纯内存 per-run，不碰 SQLite。

export interface LintRunOptions {
  vault: string | string[];
  rules?: string[]; // 省略/空 → 默认 ["links"]
  ignore?: LintIgnoreConfig;
}

export interface LintRunResult {
  diagnostics: BasaltDiagnostic[];
  exitCode: number;
}

/** 规则 runner 注册表：rule 名 → 产出诊断的编排函数。P2 仅 links；P3 起在此登记 metadata 等。 */
const RULE_RUNNERS: Record<string, (opts: LintRunOptions) => Promise<BasaltDiagnostic[]>> = {
  links: (opts) => checkVault({ vault: opts.vault, ignore: opts.ignore }),
};

/** 当前支持的规则名（用于校验与报错提示）。 */
export const LINT_RULES = Object.keys(RULE_RUNNERS);

/** 按 rules 分发跑规则，汇总诊断并按 file/line/column 稳定排序；有 error 级 → 退出码 1。 */
export async function runLint(opts: LintRunOptions): Promise<LintRunResult> {
  const rules = opts.rules?.length ? opts.rules : ["links"];
  const unknown = rules.filter((r) => !(r in RULE_RUNNERS));
  if (unknown.length > 0) {
    throw new Error(
      `未知/未实现 lint 规则：${unknown.join(", ")}（当前支持：${LINT_RULES.join(", ")}）`,
    );
  }
  const collected: BasaltDiagnostic[] = [];
  for (const rule of rules) {
    const runner = RULE_RUNNERS[rule] as (o: LintRunOptions) => Promise<BasaltDiagnostic[]>;
    collected.push(...(await runner(opts)));
  }
  const diagnostics = collected.toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
  return { diagnostics, exitCode: diagnostics.some((d) => d.severity === "error") ? 1 : 0 };
}

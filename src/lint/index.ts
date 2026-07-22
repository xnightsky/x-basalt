import type { BasaltDiagnostic } from "../diagnostic.js";
import { checkVault } from "../links/check.js";
import type { LintIgnoreConfig } from "../links/ignore.js";
import { checkMetadata } from "./metadata.js";
import type { ProfileConfig } from "./profile.js";

// === 自建实现: lint 壳（规则注册表分发；P2 links / P3a metadata）===
//
// 上游：src/cli.ts lint 命令；下游：按 rule 分发到 runner（links → checkVault，metadata → checkMetadata）。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §3.3/§8/§9；计划见
// docs/plans/2026-07-22-kb-compiler-p2-diagnostic-contract.md（P2）与 -p3a-profile-lint.md（P3a）。
// 边界：不做自定义 profile / fix / ci / baseline（P3b–P5）；纯内存 per-run，不碰 SQLite。

export interface LintRunOptions {
  vault: string | string[];
  rules?: string[]; // 省略：给了 profile → ["metadata"]，否则 ["links"]（保持 P2 行为）
  profile?: string; // metadata 规则用的 profile 名（config profile 优先，否则内置）
  profiles?: Record<string, ProfileConfig>; // 自定义 config profile（config.profiles；P3b）
  ignore?: LintIgnoreConfig;
}

export interface LintRunResult {
  diagnostics: BasaltDiagnostic[];
  exitCode: number;
}

/** 规则 runner 注册表：rule 名 → 产出诊断的编排函数。P3b 起在此登记自定义 profile 等。 */
const RULE_RUNNERS: Record<string, (opts: LintRunOptions) => Promise<BasaltDiagnostic[]>> = {
  links: (opts) => checkVault({ vault: opts.vault, ignore: opts.ignore }),
  metadata: (opts) =>
    checkMetadata({
      vault: opts.vault,
      profile: opts.profile as string,
      profiles: opts.profiles,
      ignore: opts.ignore,
    }),
};

/** 当前支持的规则名（用于校验与报错提示）。 */
export const LINT_RULES = Object.keys(RULE_RUNNERS);

/**
 * 按 rules 分发跑规则，汇总诊断并按 file/line/column 稳定排序；有 error 级 → 退出码 1。
 * rules 省略时：给了 `--profile` 默认跑 metadata，否则默认 links（保持 P2 行为）。metadata 规则需 profile。
 */
export async function runLint(opts: LintRunOptions): Promise<LintRunResult> {
  const rules = opts.rules?.length ? opts.rules : opts.profile ? ["metadata"] : ["links"];
  const unknown = rules.filter((r) => !(r in RULE_RUNNERS));
  if (unknown.length > 0) {
    throw new Error(
      `未知/未实现 lint 规则：${unknown.join(", ")}（当前支持：${LINT_RULES.join(", ")}）`,
    );
  }
  if (rules.includes("metadata") && !opts.profile) {
    throw new Error("metadata 规则需指定 --profile <name>（内置：pkm-note / llm-wiki / ssg-blog）");
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

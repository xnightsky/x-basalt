import type { BasaltIssue } from "./types.js";

// === 自建实现: links ignore 匹配（极简 glob，无外部依赖）===
//
// 上游：src/links/check.ts 用 config.lint.ignore 编译后逐 issue 过滤；
// 语义真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §7。

export interface LintIgnoreConfig {
  paths?: string[]; // 被检查文件（issue.file）glob
  targets?: string[]; // 目标字符串（issue.target）glob
  rules?: Record<string, string[]>; // rule → 该 rule 下额外忽略的 file/target glob
}

export interface IgnoreMatcher {
  ignored(issue: BasaltIssue): boolean;
}

/** 极简 glob → RegExp：`**`=跨段任意、`*`=单段任意、`?`=单字符；其余字面转义，整体锚定。 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 编译 ignore 配置为匹配器；paths 比对 issue.file，targets 比对 issue.target，rules 二者皆比。 */
export function compileIgnore(cfg: LintIgnoreConfig | undefined): IgnoreMatcher {
  const paths = (cfg?.paths ?? []).map(globToRegExp);
  const targets = (cfg?.targets ?? []).map(globToRegExp);
  const rules = new Map<string, RegExp[]>(
    Object.entries(cfg?.rules ?? {}).map(([r, pats]) => [r, pats.map(globToRegExp)]),
  );
  return {
    ignored(issue: BasaltIssue): boolean {
      if (paths.some((re) => re.test(issue.file))) return true;
      if (issue.target !== undefined && targets.some((re) => re.test(issue.target as string)))
        return true;
      const rulePats = rules.get(issue.rule);
      if (rulePats) {
        if (rulePats.some((re) => re.test(issue.file))) return true;
        if (issue.target !== undefined && rulePats.some((re) => re.test(issue.target as string)))
          return true;
      }
      return false;
    },
  };
}

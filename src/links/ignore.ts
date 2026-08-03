import type { BasaltDiagnostic } from "./types.js";

// === 自建实现: links ignore 匹配（极简 glob，无外部依赖）===
//
// 上游：src/links/check.ts 用 config.lint.ignore 编译后逐诊断过滤；
// 语义真相源：docs/design/kb-compiler.md §7。

export interface LintIgnoreConfig {
  paths?: string[]; // 被检查文件（diagnostic.file）glob
  targets?: string[]; // 目标字符串（diagnostic.target）glob
  rules?: Record<string, string[]>; // rule → 该 rule 下额外忽略的 file/target glob
}

export interface IgnoreMatcher {
  ignored(diagnostic: BasaltDiagnostic): boolean;
}

/**
 * 极简 glob → RegExp：`**`=跨段任意、`*`=单段任意、`?`=单字符；其余字面转义，整体锚定。
 *
 * @behavior
 * Given glob 含 `**`/`*`/`?` 通配
 * When globToRegExp
 * Then 分别映射为跨段/单段/单字符匹配，其余字符字面转义
 *
 * @behavior
 * Given 匹配语义
 * When globToRegExp
 * Then 整体锚定（^...$），不产生子串误匹配
 */
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

/** 编译 ignore 配置为匹配器；paths 比对 diagnostic.file，targets 比对 diagnostic.target，rules 二者皆比。 */
export function compileIgnore(cfg: LintIgnoreConfig | undefined): IgnoreMatcher {
  const paths = (cfg?.paths ?? []).map(globToRegExp);
  const targets = (cfg?.targets ?? []).map(globToRegExp);
  const rules = new Map<string, RegExp[]>(
    Object.entries(cfg?.rules ?? {}).map(([r, pats]) => [r, pats.map(globToRegExp)]),
  );
  return {
    ignored(diagnostic: BasaltDiagnostic): boolean {
      const target = diagnostic.target;
      if (paths.some((re) => re.test(diagnostic.file))) return true;
      if (target !== undefined && targets.some((re) => re.test(target))) return true;
      const rulePats = rules.get(diagnostic.rule);
      if (rulePats) {
        if (rulePats.some((re) => re.test(diagnostic.file))) return true;
        if (target !== undefined && rulePats.some((re) => re.test(target))) return true;
      }
      return false;
    },
  };
}

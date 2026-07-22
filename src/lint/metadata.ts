import { readFile } from "node:fs/promises";
import type { BasaltDiagnostic } from "../diagnostic.js";
import { compileIgnore, globToRegExp, type LintIgnoreConfig } from "../links/ignore.js";
import { collectFiles } from "../links/scan.js";
import { readFrontmatter } from "../meta/index.js";
import { resolveVaultLayout } from "../utils/path.js";
import { type ProfileConfig, resolveLintProfile } from "./profile.js";

// === 自建实现: metadata 规则（内置 + 自定义 config profile 校验，P3a required / P3b enum）===
//
// 上游：src/lint/index.ts 的 runLint（rule=metadata）；下游：resolveLintProfile（extends 合并）
// + meta 的 readFrontmatter（只读读字段值）。设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.1/§8.2。
// 只读（读 frontmatter 判 required/enum），不写 .md（写侧仍唯一在 src/meta）；纯内存 per-run，不碰 SQLite。
// collectFiles/compileIgnore/globToRegExp 复用 links 的通用件（非 links 专有语义）。

export interface MetadataCheckOptions {
  vault: string | string[];
  /** profile 名：config profile 优先（同名覆盖内置），否则回退内置；两者都不是 → 定向报错。 */
  profile: string;
  /** 自定义 config profile 映射（来自 config.profiles）；缺省 = 只认内置。 */
  profiles?: Record<string, ProfileConfig>;
  ignore?: LintIgnoreConfig;
}

const REQUIRED_RULE = "metadata/required-missing";
const ENUM_RULE = "metadata/enum-invalid";

/** 校验 vault 内文档的 required（缺字段）与 enum（值不在允许集），产 BasaltDiagnostic。 */
export async function checkMetadata(opts: MetadataCheckOptions): Promise<BasaltDiagnostic[]> {
  // 前置解析（未知 profile / extends 环 / 未知父 立即定向报错，即使 vault 为空、无文件可触发）。
  const profile = resolveLintProfile(opts.profile, opts.profiles ?? {});
  const layout = resolveVaultLayout(opts.vault);
  const { markdown } = await collectFiles(layout.roots, layout.toKey);
  // include（可选）：只校验匹配该 glob 的文件；缺省 = 全 vault（诊断级 lint.ignore 仍照常叠加）。
  const files =
    profile.include === undefined
      ? markdown
      : markdown.filter((f) => globToRegExp(profile.include as string).test(f.key));
  const ignore = compileIgnore(opts.ignore);
  const diagnostics: BasaltDiagnostic[] = [];
  for (const file of files) {
    const fm = readFrontmatter(await readFile(file.abs, "utf8"));
    // required：字段不存在（Object.hasOwn 语义同 meta 的 hasMeta），无具体行 → frontmatter 整体 (1:1)。
    for (const key of profile.required) {
      if (Object.hasOwn(fm, key)) continue;
      const diagnostic: BasaltDiagnostic = {
        file: file.key,
        line: 1,
        column: 1,
        rule: REQUIRED_RULE,
        severity: "error",
        message: `缺 required 字段「${key}」（profile ${opts.profile}）`,
        target: key,
        reason: "required_missing",
        fixable: false,
      };
      if (!ignore.ignored(diagnostic)) diagnostics.push(diagnostic);
    }
    // enum：字段有值且值不在允许集。缺失/空(null) 跳过（缺失交给 required，不双报）；数组逐元素。
    for (const [field, allowed] of Object.entries(profile.enums)) {
      const raw = fm[field];
      if (raw === undefined || raw === null) continue;
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        if (v === undefined || v === null || allowed.includes(String(v))) continue;
        const diagnostic: BasaltDiagnostic = {
          file: file.key,
          line: 1,
          column: 1,
          rule: ENUM_RULE,
          severity: "error",
          message: `字段「${field}」值「${String(v)}」不在允许集（profile ${opts.profile}；允许：${allowed.join(" / ")}）`,
          target: field,
          reason: "enum_invalid",
          fixable: false,
        };
        if (!ignore.ignored(diagnostic)) diagnostics.push(diagnostic);
      }
    }
  }
  return diagnostics.toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

import { readFile } from "node:fs/promises";
import type { BasaltDiagnostic } from "../diagnostic.js";
import { compileIgnore, type LintIgnoreConfig } from "../links/ignore.js";
import { collectFiles } from "../links/scan.js";
import { getProfile, inspectProfile } from "../meta/index.js";
import { resolveVaultLayout } from "../utils/path.js";

// === 自建实现: metadata 规则（内置 profile required 校验，P3a）===
//
// 上游：src/lint/index.ts 的 runLint（rule=metadata）；下游：meta 的 inspectProfile（读侧 diffProfile）。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.1。
// 只读（读 frontmatter 判 required），不写 .md（写侧仍唯一在 src/meta）；纯内存 per-run，不碰 SQLite。
// collectFiles/compileIgnore 复用 links 的通用件（非 links 专有语义）。

export interface MetadataCheckOptions {
  vault: string | string[];
  profile: string; // 内置 profile 名（未知 → getProfile 定向报错）
  ignore?: LintIgnoreConfig;
}

const RULE = "metadata/required-missing";

/** 校验 vault 内文档缺哪些 required 字段（对照内置 profile），产 BasaltDiagnostic。 */
export async function checkMetadata(opts: MetadataCheckOptions): Promise<BasaltDiagnostic[]> {
  getProfile(opts.profile); // 未知 profile 立即定向报错（即使 vault 为空、无文件可触发 inspect）
  const layout = resolveVaultLayout(opts.vault);
  const { markdown } = await collectFiles(layout.roots, layout.toKey);
  const ignore = compileIgnore(opts.ignore);
  const diagnostics: BasaltDiagnostic[] = [];
  for (const file of markdown) {
    const content = await readFile(file.abs, "utf8");
    const diff = inspectProfile(content, opts.profile);
    for (const field of diff.missing.required) {
      // required 缺项无具体行，指向 frontmatter 整体（line:1 col:1）；target=字段名，reason 机器可读。
      const diagnostic: BasaltDiagnostic = {
        file: file.key,
        line: 1,
        column: 1,
        rule: RULE,
        severity: "error",
        message: `缺 required 字段「${field}」（profile ${opts.profile}）`,
        target: field,
        reason: "required_missing",
        fixable: false,
      };
      if (!ignore.ignored(diagnostic)) diagnostics.push(diagnostic);
    }
  }
  return diagnostics.toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

import { readFile } from "node:fs/promises";
import { resolveVaultLayout } from "../utils/path.js";
import { checkFile, checkVault } from "./check.js";
import { compileIgnore, type LintIgnoreConfig } from "./ignore.js";
import { buildTargetIndex, collectFiles } from "./scan.js";
import type { BasaltDiagnostic } from "./types.js";

// === 自建实现: links 模块对外入口（CLI 装配点）===
//
// 上游：src/cli.ts links check / suggest；下游：check/scan/ignore 纯逻辑。

export interface LinksRunOptions {
  vault: string | string[];
  ignore?: LintIgnoreConfig;
}

export interface LinksRunResult {
  diagnostics: BasaltDiagnostic[];
  exitCode: number;
}

/** 全 vault 断链检查。有 error 级诊断 → 退出码 1，否则 0。 */
export async function runLinksCheck(opts: LinksRunOptions): Promise<LinksRunResult> {
  const diagnostics = await checkVault({ vault: opts.vault, ignore: opts.ignore });
  return { diagnostics, exitCode: diagnostics.some((d) => d.severity === "error") ? 1 : 0 };
}

/** 单文件断链 + 建议（建同一 vault 白名单索引，只检查目标文件）。 */
export async function runLinksSuggest(
  fileRel: string,
  opts: LinksRunOptions,
): Promise<LinksRunResult> {
  const layout = resolveVaultLayout(opts.vault);
  const { all } = await collectFiles(layout.roots, layout.toKey);
  const index = buildTargetIndex(all);
  const ignore = compileIgnore(opts.ignore);
  const fileAbs = layout.toAbs(fileRel);
  const content = await readFile(fileAbs, "utf8");
  const key = layout.toKey(fileAbs);
  const diagnostics = checkFile(fileAbs, key, content, index, ignore);
  return { diagnostics, exitCode: diagnostics.some((d) => d.severity === "error") ? 1 : 0 };
}

export type { BasaltDiagnostic } from "./types.js";

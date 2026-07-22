/**
 * links 模块类型：断链原因 LinkDiagnosticReason、白名单目标索引 TargetIndex、链接判定 LinkFinding。
 *
 * 公共稳定诊断契约 BasaltDiagnostic 的真相源在 src/diagnostic.ts；此处 re-export，便于 links 侧就近引用。
 *
 * 上游：src/links/scan（建索引）、resolve（判定）、check（编排）。
 * 下游：src/cli.ts links 命令输出。
 * 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §5/§6。
 */

// 公共契约真相源在 src/diagnostic.ts（中立叶子）；links 侧 re-export，消费方可从任一处引入。
export type { BasaltDiagnostic, BasaltDiagnosticSeverity } from "../diagnostic.js";

/** P1 产出的断链原因（tmp_path/unsupported_reference_link 后置，见 spec §5/§6 收敛说明）。 */
export type LinkDiagnosticReason =
  | "not_found"
  | "outside_vault"
  | "backslash_path"
  | "ambiguous_target"
  | "external_skipped";

/** 白名单目标索引（Docusaurus 式集合；key 全小写，值保留原始大小写相对路径）。 */
export interface TargetIndex {
  pathSet: Set<string>; // 所有文件相对 vault 的 POSIX 路径（含扩展名），已小写
  notesByStem: Map<string, string[]>; // .md：linkKey → 原始相对路径列表
  notesByPathKey: Set<string>; // .md：pathKey（去扩展名 POSIX 小写）
  filesByBasename: Map<string, string[]>; // 所有文件：小写含扩展名 basename → 原始相对路径列表
}

/** 已收集文件：绝对路径 + vault 相对主键（layout.toKey）。 */
export interface CollectedFile {
  abs: string;
  key: string;
}

/** 单链接判定结果：reason 为空表示链接有效。 */
export interface LinkFinding {
  reason?: LinkDiagnosticReason;
  suggestions?: string[];
}

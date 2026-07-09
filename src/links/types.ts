/**
 * links 模块公共类型：诊断结果 BasaltIssue、白名单目标索引 TargetIndex、链接判定 LinkFinding。
 *
 * 上游：src/links/scan（建索引）、resolve（判定）、check（编排）。
 * 下游：src/cli.ts links 命令输出。
 * 契约冻结程度：P1 放内部模块，字段暂不作为公共 API；P2 再固化为 lint --format json 稳定输出。
 * 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §6。
 */

/** P1 产出的断链原因（tmp_path/unsupported_reference_link 后置，见 spec §5/§6 收敛说明）。 */
export type LinkIssueReason =
  | "not_found"
  | "outside_vault"
  | "backslash_path"
  | "ambiguous_target"
  | "external_skipped";

/** 统一诊断结果（P1 仅 links 规则产出；字段对齐 spec §6，P2 冻结为公共 JSON）。 */
export interface BasaltIssue {
  file: string; // vault 相对 POSIX 路径
  line: number; // 1-based 完整文件行号
  column: number; // 1-based UTF-16 code unit 列
  rule: string; // 如 "links/no-broken-link"
  severity: "error" | "warning" | "info";
  message: string;
  target?: string;
  reason?: LinkIssueReason;
  suggestions?: string[];
  fixable: boolean; // P1 恒为 false（不落盘修复）
}

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
  reason?: LinkIssueReason;
  suggestions?: string[];
}

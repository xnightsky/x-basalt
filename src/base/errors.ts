/**
 * base 模块诊断辅助：`base/*` rule id 常量（单一真相源）与 BasaltDiagnostic 构造。
 *
 * severity 口径（计划「关键取舍」#2 拍板）：终止性问题 = error；未知顶层 key = warning（保留原值）。
 * 诊断形状契约见 src/diagnostic.ts（本模块只构造、不修改该契约）。
 *
 * 上游：src/base/document.ts / expressions.ts 构造诊断。
 * 下游：P1 engine / 未来 CLI 薄出口消费。
 */

import type { BasaltDiagnostic, BasaltDiagnosticSeverity } from "../diagnostic.js";
import type { SourceSpan } from "./types.js";

// === 自建实现 ===

/**
 * `base/*` rule id 常量（设计 §11 诊断契约的 P0 子集 + `base/path-outside-vault`）。
 *
 * 注：`base/path-outside-vault` 不在设计 §11 列表内——§11 未覆盖 BASE-SEC-008 路径越界场景，
 * 此处补一条专用 rule（路径问题与 schema/YAML 无关，复用任何既有 rule 都会误导读出方）。
 */
export const BASE_RULES = {
  invalidYaml: "base/invalid-yaml",
  invalidSchema: "base/invalid-schema",
  viewRequired: "base/view-required",
  viewNotFound: "base/view-not-found",
  duplicateViewName: "base/duplicate-view-name",
  unsupportedViewType: "base/unsupported-view-type",
  unsupportedFeature: "base/unsupported-feature",
  unknownFunction: "base/unknown-function",
  expressionSyntax: "base/expression-syntax",
  executionBudget: "base/execution-budget",
  pathOutsideVault: "base/path-outside-vault",
  // P1 求值层增量（纯追加）：未知 file 属性 / 动态 this / md-only 数据集声明 / 行级类型错误。
  unknownProperty: "base/unknown-property",
  dynamicContextRequired: "base/dynamic-context-required",
  markdownOnlyDataset: "base/markdown-only-dataset",
  propertyTypeMismatch: "base/property-type-mismatch",
  // P1 engine 增量（纯追加）：无显式 sort 时按 file.path ASC 稳定排序的提示（x-basalt 扩展，info）。
  defaultSortTiebreak: "base/default-sort-tiebreak",
  // P2a planner 增量（纯追加）：公式依赖循环（FORM-004，message 含完整循环链）。
  formulaCycle: "base/formula-cycle",
  // 2026-07-28 覆盖率片四增量（纯追加）：`matches` 的正则不合法/不安全（BASE-SEC-004）。
  // 单列一条而非复用 property-type-mismatch：「你的正则写错了/太危险」与「值类型不对」
  // 是两类完全不同的修法，读出方需要能区分。
  invalidRegex: "base/invalid-regex",
} as const;

/** base/* rule id 联合类型（由 {@link BASE_RULES} 派生，保证常量与类型不漂移）。 */
export type BaseRuleId = (typeof BASE_RULES)[keyof typeof BASE_RULES];

/**
 * 构造一条 base 诊断（fixable 恒 false：P0 不落盘修复）。
 *
 * @param file - vault 相对 POSIX 路径
 * @param span - 完整文件位置（1-based 行 + UTF-16 列）
 * @param rule - rule id（须取自 {@link BASE_RULES}）
 * @param severity - error 终止执行；warning 随结果返回
 * @param message - 人读消息（中文）
 * @param extra - 可选 target / reason / suggestions
 */
export function baseDiagnostic(
  file: string,
  span: SourceSpan,
  rule: BaseRuleId,
  severity: BasaltDiagnosticSeverity,
  message: string,
  extra?: { target?: string; reason?: string; suggestions?: string[] },
): BasaltDiagnostic {
  return {
    file,
    line: span.line,
    column: span.column,
    rule,
    severity,
    message,
    target: extra?.target,
    reason: extra?.reason,
    suggestions: extra?.suggestions,
    fixable: false,
  };
}

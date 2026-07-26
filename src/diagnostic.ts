/**
 * 公共稳定诊断契约 BasaltDiagnostic：lint / links 共用的一条问题记录（定位到 file:line:column 的规则诊断）。
 *
 * 冻结程度：**公共稳定 API**——一旦进入 `lint --format json` / CI 即长期契约，字段只增不改、不改语义。
 * 命名对齐本仓工具链 oxc/oxlint `OxcDiagnostic` 与 LSP / TypeScript `Diagnostic`（字段形状即 LSP
 * `Diagnostic`：file/line/column/severity/rule/message），并规避与 GitHub Issue 撞词。
 * 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §6。
 *
 * 消费者：src/links/（links check/suggest 产出）、src/lint/（lint 壳汇聚）、src/cli.ts（JSON/人读输出）。
 * 中立叶子模块（对齐 src/config.ts / src/format.ts）：不 import 任何规则模块，避免依赖倒挂。
 */

// === 自建实现 ===

/** 诊断严重级取值（单一真相源；`error` 决定退出码非 0，`warning`/`info` 是否阻断由 CI 阶段配置）。 */
export const DIAGNOSTIC_SEVERITIES = ["error", "warning", "info"] as const;

/** 诊断严重级：由 {@link DIAGNOSTIC_SEVERITIES} 派生，保证运行期取值与类型一致。 */
export type BasaltDiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

/**
 * 统一诊断结果——一条问题记录，不是 AST 节点。JSON 字段冻结为公共契约。
 *
 * `reason` 为通用 `string`（机器可读原因）：links 侧产 `LinkDiagnosticReason` 字面量（如 `not_found`），
 * 未来 metadata / profile 规则产各自原因（如 `required_missing`），共用同一契约字段。
 */
export interface BasaltDiagnostic {
  file: string; // vault 相对 POSIX 路径
  line: number; // 1-based 完整文件行号
  column: number; // 1-based UTF-16 code unit 列
  rule: string; // 规则 id，如 "links/no-broken-link"
  severity: BasaltDiagnosticSeverity;
  message: string;
  target?: string; // 原始诊断目标（如链接目标）
  reason?: string; // 机器可读原因，如 "not_found"
  suggestions?: string[];
  fixable: boolean; // 能否自动修（P1/P2 恒为 false，不落盘修复）
}

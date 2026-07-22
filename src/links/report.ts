import type { BasaltDiagnostic } from "./types.js";

// === 自建实现: links 人读渲染（JSON 输出由 CLI 用 format.emit）===
//
// 上游：src/cli.ts links check / suggest 的人读默认输出；下游：stdout。

/** 把诊断列表渲染为人读文本；空列表给成功文案。 */
export function renderHuman(diagnostics: BasaltDiagnostic[]): string {
  if (diagnostics.length === 0) return "✓ 未发现断链";
  const lines: string[] = [];
  for (const d of diagnostics) {
    lines.push(`${d.file}:${d.line}:${d.column}  ${d.message}`);
    if (d.suggestions && d.suggestions.length > 0) {
      lines.push(`    → 建议: ${d.suggestions.join(", ")}`);
    }
  }
  lines.push(`\n共 ${diagnostics.length} 处断链`);
  return lines.join("\n");
}

import type { BasaltDiagnostic } from "../diagnostic.js";

// === 自建实现: lint 人读渲染（规则中性，覆盖 links / metadata 等所有 BasaltDiagnostic）===
//
// 上游：src/cli.ts lint 命令人读默认输出；下游：stdout。
// 与 src/links/report.ts 分工：links check 是链接专用命令，用「断链」措辞更贴；lint 是通用壳，
// 汇总须中性（否则 metadata 诊断也被说成「断链」），故这里用「问题」。逐行格式两者一致。

/** 把诊断列表渲染为规则中性的人读文本；空列表给成功文案。 */
export function renderHuman(diagnostics: BasaltDiagnostic[]): string {
  if (diagnostics.length === 0) return "✓ 未发现问题";
  const lines: string[] = [];
  for (const d of diagnostics) {
    lines.push(`${d.file}:${d.line}:${d.column}  ${d.message}`);
    if (d.suggestions && d.suggestions.length > 0) {
      lines.push(`    → 建议: ${d.suggestions.join(", ")}`);
    }
  }
  lines.push(`\n共 ${diagnostics.length} 处问题`);
  return lines.join("\n");
}

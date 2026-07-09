import type { BasaltIssue } from "./types.js";

// === 自建实现: links 人读渲染（JSON 输出由 CLI 用 format.emit）===
//
// 上游：src/cli.ts links check / suggest 的人读默认输出；下游：stdout。

/** 把 issue 列表渲染为人读文本；空列表给成功文案。 */
export function renderHuman(issues: BasaltIssue[]): string {
  if (issues.length === 0) return "✓ 未发现断链";
  const lines: string[] = [];
  for (const i of issues) {
    lines.push(`${i.file}:${i.line}:${i.column}  ${i.message}`);
    if (i.suggestions && i.suggestions.length > 0) {
      lines.push(`    → 建议: ${i.suggestions.join(", ")}`);
    }
  }
  lines.push(`\n共 ${issues.length} 处断链`);
  return lines.join("\n");
}

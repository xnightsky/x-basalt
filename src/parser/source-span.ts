/**
 * Parser 源位置工具：把正则匹配的字符串索引转换为面向编辑器/CI 的行列位置。
 *
 * 上游：链接类提取器在等长掩码文本中匹配语法，再用本模块回指原始 Markdown。
 * 下游：links check / lint 后续会消费 line/column/raw 做诊断定位。
 */

/** parser 链接类节点共享的源位置字段。 */
export interface SourceSpan {
  line: number;
  column: number;
  raw: string;
}

/**
 * 计算匹配起点在源文本中的 1-based 行列位置。
 *
 * @param text - 匹配使用的正文文本；若剥离了 frontmatter，调用方需传入 lineOffset
 * @param index - JavaScript 字符串索引（UTF-16 code unit）
 * @param lineOffset - index 所在文本首行之前的完整文件行数
 * @returns 完整文件 1-based 行号与 UTF-16 code unit 列
 */
export function positionAt(
  text: string,
  index: number,
  lineOffset = 0,
): Pick<SourceSpan, "line" | "column"> {
  const before = text.slice(0, index);
  const line = lineOffset + before.split("\n").length;
  const lastNewline = text.lastIndexOf("\n", index - 1);
  const column = index - lastNewline;
  return { line, column };
}

/** 统计文本中的换行数，用于把正文相对行号换算成完整文件行号。 */
export function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

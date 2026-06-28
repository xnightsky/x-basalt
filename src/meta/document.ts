import { Document, parseDocument } from "yaml";

// === 自建实现: frontmatter 往返内核（写侧地基）===
//
// 设计：docs/plans/2026-06-28-meta-frontmatter-write.md（调研结论：用 yaml Document API 往返，
// 保留键序/注释、对需引号的值自动加引号；不用 gray-matter 写回——它从对象重序列化丢注释）。
//
// 职责：content ⇄ FrontmatterParts。纯字符串/对象变换，不碰 fs（fs 在 src/meta/index.ts）。
// 硬要求：body（闭合 --- 之后的内容）逐字节保真，绝不经 YAML 解析；EOL/BOM 保留；只认顶部块。
// 上游：src/meta/index.ts（editMeta/applyProfile 读文件后传入 content）。下游：yaml(eemeli) Document API。

/**
 * 文件切分产物：frontmatter 各部件与原始正文切片。
 * 由 splitDocument 产出；经 operations 改动 doc 后由 serializeDocument 重组。
 */
export interface FrontmatterParts {
  /** 文件开头 BOM（"" 或 "﻿"），原样保留在最前。 */
  bom: string;
  /** 是否存在合法的顶部 frontmatter（有开头且有闭合 ---）。 */
  hasFrontmatter: boolean;
  /** frontmatter 的 yaml Document（无 frontmatter 时为空 Document，可被 set 填充后生成块）。 */
  doc: Document;
  /** 闭合 --- 行之后的原始正文切片（逐字节保真）。 */
  body: string;
  /** 探测到的文件 EOL：含 \r\n → CRLF，否则 LF。用于 frontmatter 块的换行还原。 */
  eol: "\n" | "\r\n";
  /** 原文闭合 --- 行后的换行（"" 表示闭合在文件末且无换行）。 */
  closeEol: string;
}

// === Obsidian 规范来源: frontmatter 仅当文件首行为 --- 且其后有单独成行的 --- 闭合时生效 ===
// 开头：首行恰为 ---（允许行尾空白）。闭合：某一行恰为 ---（允许行尾空白）。
const OPEN_RE = /^---[ \t]*\r?\n/;
const CLOSE_RE = /^---[ \t]*(\r?\n|$)/m;

/** 统计 Document 顶层映射的键数（空/标量 contents 记 0）。 */
function itemCount(doc: Document): number {
  const contents = doc.contents as { items?: unknown[] } | null;
  return contents && Array.isArray(contents.items) ? contents.items.length : 0;
}

/**
 * 切分文件为 frontmatter 各部件。无/非法 frontmatter 时整文件作 body（不毁文件）。
 *
 * @param content - 文件完整内容
 *
 * @behavior
 * Given 文件首行不是 --- When 切分 Then hasFrontmatter=false，整文件作 body
 *
 * @behavior
 * Given 首行是 --- 但无闭合 --- When 切分 Then hasFrontmatter=false，整文件作 body（防误改非 frontmatter 的 --- 分割线）
 *
 * @behavior
 * Given 合法 frontmatter 含 UTF-8 BOM When 切分 Then BOM 单独提取到 bom 字段，body 为闭合后切片逐字节保真
 */
export function splitDocument(content: string): FrontmatterParts {
  let bom = "";
  let rest = content;
  // === Obsidian 规范来源: UTF-8 BOM 可出现在文件首，需原样保留 ===
  if (rest.charCodeAt(0) === 0xfeff) {
    bom = "﻿";
    rest = rest.slice(1);
  }
  const eol: "\n" | "\r\n" = rest.includes("\r\n") ? "\r\n" : "\n";

  const open = OPEN_RE.exec(rest);
  if (!open) {
    return { bom, hasFrontmatter: false, doc: parseDocument(""), body: rest, eol, closeEol: eol };
  }
  const body0 = rest.slice(open[0].length);
  const close = CLOSE_RE.exec(body0);
  if (!close) {
    // 有开头 --- 但无闭合：不是合法 frontmatter，整文件作 body（防止误改毁文件）。
    return { bom, hasFrontmatter: false, doc: parseDocument(""), body: rest, eol, closeEol: eol };
  }
  const rawYaml = body0.slice(0, close.index);
  const closeEol = close[1] ?? "";
  const body = body0.slice(close.index + close[0].length);
  return { bom, hasFrontmatter: true, doc: parseDocument(rawYaml), body, eol, closeEol };
}

/**
 * 由 FrontmatterParts 重组文件内容。body 原样拼回；frontmatter 块用 yaml 序列化并还原 EOL。
 * 当 doc 有键（即使原本无 frontmatter）则产出 `---\n…\n---`；doc 空且原本无 frontmatter 则不产块。
 *
 * @param parts - splitDocument 的产物（doc 可能已被 operations 改动）
 *
 * @behavior
 * Given doc 无键且原本无 frontmatter When 序列化 Then 直接返回 body，不产 --- 块（保持无 frontmatter 文件不变）
 *
 * @behavior
 * Given doc 有键（含原本无 frontmatter 的新建场景）When 序列化 Then 产出 ---\nyaml\n--- 块并按文件 EOL 风格换行
 */
export function serializeDocument(parts: FrontmatterParts): string {
  const hasContent = itemCount(parts.doc) > 0;
  if (!hasContent && !parts.hasFrontmatter) return parts.bom + parts.body;

  let yamlText = "";
  if (hasContent) {
    // lineWidth:0 关闭折行，避免长值被折叠破坏往返保真。
    yamlText = parts.doc.toString({ lineWidth: 0 });
    if (parts.eol === "\r\n") yamlText = yamlText.replace(/\n/g, "\r\n");
    if (!yamlText.endsWith(parts.eol)) yamlText += parts.eol;
  }
  return `${parts.bom}---${parts.eol}${yamlText}---${parts.closeEol}${parts.body}`;
}

/**
 * Markdown inline link 提取子模块：识别 `[text](target)` 与 `![alt](target)`。
 *
 * 上游：src/parser/index.ts 在代码区等长掩码后调用本模块。
 * 下游：后续 links check / lint 消费节点位置；indexer 当前不落库 Markdown link。
 */
import type { ObsidianNode } from "./types.js";
import { positionAt } from "./source-span.js";

type MarkdownLinkNode = Extract<ObsidianNode, { type: "markdownLink" }>;

interface MarkdownLinkOptions {
  sourceText?: string;
  lineOffset?: number;
}

// === Obsidian 规范来源: Obsidian 兼容标准 Markdown inline link / image link ===
// === 自建实现: P0 保守子集 ===
// 只覆盖 `[text](target)` / `![alt](target)` / 带简单引号 title 的形态；reference link、
// 嵌套括号与复杂转义留后续 CommonMark 扩展。不使用全局正则扫描，避免大量未闭合 `[` 触发退化。

/** 拆分 Markdown inline link 的 destination 与简单 title。 */
function parseDestination(rawDestination: string): Pick<MarkdownLinkNode, "target" | "title"> {
  const value = rawDestination.trim();
  const doubleQuoted = /^(\S+)\s+"([^"]*)"$/.exec(value);
  if (doubleQuoted) return { target: doubleQuoted[1] ?? "", title: doubleQuoted[2] ?? "" };
  const singleQuoted = /^(\S+)\s+'([^']*)'$/.exec(value);
  if (singleQuoted) return { target: singleQuoted[1] ?? "", title: singleQuoted[2] ?? "" };
  return { target: value };
}

/**
 * 提取 Markdown inline link / image link 节点。
 *
 * @param maskedText - 已等长屏蔽代码区的正文
 * @param options - sourceText 用于回切 raw；lineOffset 用于换算完整文件行号
 * @returns P0 子集内的 Markdown link 节点；外部 URL / mailto / anchor-only 也产出，留给 links check 判断
 *
 * @behavior
 * Given 正文含 `[text](target)` 或 `![alt](target)`
 * When 提取 Markdown link
 * Then 产出含 text/target/image/line/column/raw 的 markdownLink 节点
 *
 * @behavior
 * Given link destination 后带简单引号 title
 * When 提取 Markdown link
 * Then target 不含 title，title 单独进入节点字段
 */
export function extractMarkdownLinks(
  maskedText: string,
  options: MarkdownLinkOptions = {},
): ObsidianNode[] {
  const sourceText = options.sourceText ?? maskedText;
  const lineOffset = options.lineOffset ?? 0;
  const out: ObsidianNode[] = [];
  let cursor = 0;

  while (cursor < maskedText.length) {
    const open = maskedText.indexOf("[", cursor);
    if (open === -1) break;
    const image = open > 0 && maskedText.charAt(open - 1) === "!";
    const index = image ? open - 1 : open;
    const close = maskedText.indexOf("]", open + 1);
    if (close === -1) break;
    if (maskedText.charAt(close + 1) !== "(") {
      cursor = close + 1;
      continue;
    }
    const destClose = maskedText.indexOf(")", close + 2);
    if (destClose === -1) break;
    const text = maskedText.slice(open + 1, close);
    const rawDestination = maskedText.slice(close + 2, destClose);
    if (text.includes("\n") || rawDestination.includes("\n")) {
      cursor = destClose + 1;
      continue;
    }

    const raw = sourceText.slice(index, destClose + 1);
    const { line, column } = positionAt(maskedText, index, lineOffset);
    const destination = parseDestination(rawDestination);
    if (destination.target === "") {
      cursor = destClose + 1;
      continue;
    }
    out.push({
      type: "markdownLink",
      text,
      ...destination,
      image,
      line,
      column,
      raw,
    });
    cursor = destClose + 1;
  }
  return out;
}

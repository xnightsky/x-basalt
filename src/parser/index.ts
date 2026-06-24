import { parseFrontmatter } from "./frontmatter.js";
import type { ObsidianNode, ParsedFile } from "./types.js";
import { extractWikilinks } from "./wikilink.js";

export type { ObsidianNode, ParsedFile } from "./types.js";

// === Obsidian 规范来源: 行内专有语法的提取规则，详见 skill biz-obsidian-spec / 调研 §2 ===
// 这些正则按行或全局匹配，逐类产出 ObsidianNode；frontmatter 已先行剥离，故不会误吃顶部 YAML。

// Tag：# 前不能是字母/数字/下划线（word 字符）——比「行首或空白」更贴近 Obsidian：
//   允许 CJK 标点后成标签（如「标签：#moc」），但排除 word#x / 123#x / Concepts#heading。
// 标签体取 Unicode 字母/数字/下划线/连字符/斜杠；纯数字（如 #123）由下方过滤排除。
const TAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_/-]+)/gu;
// Task：行首可缩进的 - 或 *，方括号内单字符状态，其后正文。
const TASK_RE = /^\s*[-*]\s+\[(.)\]\s+(.*)$/;
// Callout 头：> [!type] 可带折叠标记 +/-，其后为标题。
const CALLOUT_HEAD_RE = /^>\s*\[!([^\]]+)\]([+-]?)\s*(.*)$/;
// Highlight：成对 ==...==，非贪婪，至少一个字符。
const HIGHLIGHT_RE = /==(.+?)==/g;
// BlockRef 定义：行尾 ^id（id 为字母数字与连字符）；^ 前需行首或空白，排除 [[#^id]] 这类引用。
const BLOCKREF_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

/** 提取行内 tag 节点：保留嵌套全名，排除纯数字，按 value 去重。 */
function extractTags(text: string): ObsidianNode[] {
  const seen = new Set<string>();
  const out: ObsidianNode[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const value = m[1] ?? "";
    // === Obsidian 规范来源: 标签须含至少一个非数字字符，纯数字 #123 不是标签 ===
    if (!/[\p{L}_]/u.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ type: "tag", value });
  }
  return out;
}

/** 提取 highlight 节点。 */
function extractHighlights(text: string): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (const m of text.matchAll(HIGHLIGHT_RE)) {
    out.push({ type: "highlight", content: m[1] ?? "" });
  }
  return out;
}

/** 提取 task 节点：逐行匹配，status 取方括号内单字符。 */
function extractTasks(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (const line of lines) {
    const m = TASK_RE.exec(line);
    if (m) out.push({ type: "task", status: m[1] ?? " ", text: (m[2] ?? "").trim() });
  }
  return out;
}

/** 提取 blockRef 定义节点：逐行匹配行尾 ^id。 */
function extractBlockRefs(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (const line of lines) {
    const m = BLOCKREF_RE.exec(line);
    if (m?.[1]) out.push({ type: "blockRef", id: m[1] });
  }
  return out;
}

/**
 * 提取 callout 节点：头行 `> [!type]...` 起始，后续连续 `>` 引用行聚合为 content。
 * type 归一化为小写；折叠标记 `+`/`-` → foldable=true。
 */
function extractCallouts(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const head = CALLOUT_HEAD_RE.exec(line);
    if (!head) continue;
    const marker = head[2] ?? ""; // 折叠标记 +/-（无则空）
    // 聚合后续连续的 `>` 行作为正文（去掉前缀 `>` 与一个空格）。
    const content: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j];
      if (next === undefined || !next.startsWith(">")) break;
      content.push(next.replace(/^>\s?/, ""));
    }
    out.push({
      type: "callout",
      calloutType: (head[1] ?? "").trim().toLowerCase(),
      title: (head[3] ?? "").trim(),
      foldable: marker === "+" || marker === "-",
      content: content.join("\n"),
    });
    i = j - 1; // 跳过已并入正文的行，避免把正文行当作新 callout。
  }
  return out;
}

/**
 * Vault 解析器：输入文件内容 → 标准化 AST。
 * 纯函数，不触碰文件系统或数据库（边界见 AGENTS.md「代码与规范」）。
 *
 * 编排：parseFrontmatter → extractWikilinks → 行内 tag/callout/task/highlight/blockRef 提取。
 * 说明：tag 节点只含**行内**标签；frontmatter 的 tags 通过 ParsedFile.frontmatter 单独传递，
 * 由 indexer 负责并入 tags 表（in_frontmatter=1），parser 不在 nodes 中重复产出，保持单一职责。
 */
export class VaultParser {
  /**
   * 解析单文件内容为 frontmatter + ObsidianNode[]。
   *
   * @param content - 文件完整内容
   */
  parse(content: string): ParsedFile {
    const { frontmatter, body } = parseFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const nodes: ObsidianNode[] = [
      ...extractWikilinks(body),
      ...extractTags(body),
      ...extractCallouts(lines),
      ...extractTasks(lines),
      ...extractHighlights(body),
      ...extractBlockRefs(lines),
    ];

    return { frontmatter, nodes };
  }
}

/**
 * Wikilink / Embed 提取子模块：从正文中识别 [[...]] 与 ![[...]] 并产出规范化节点。
 *
 * 上游：src/parser/index.ts 的 VaultParser.parse() 是唯一调用方。
 * 下游：extractWikilinks 的输出经 indexer 写入 links 表（is_embed 区分嵌入与普通链接）。
 *       资源 vs 笔记嵌入的区分由 indexer 调用 utils/path.isAssetEmbed 完成，parser 不区分。
 */
import { linkKey } from "../utils/path.js";
import { positionAt } from "./source-span.js";
import type { ObsidianNode } from "./types.js";

type WikilinkNode = Extract<ObsidianNode, { type: "wikilink" }>;

interface WikilinkOptions {
  sourceText?: string;
  lineOffset?: number;
}

// === Obsidian 规范来源 ===
// [[Note]] / [[Note|Alias]] / [[Folder/Note]] / [[Note#Heading]] / [[Note#^block-id]]
// 可组合 [[Folder/Note#Heading|Alias]]；解析顺序 target →(#heading | #^blockId)→ |alias。
// embed：前缀 ! 即 ![[...]]（笔记嵌入 vs 资源嵌入由 utils/path.isAssetEmbed 区分）。
// === 自建实现: 阶段 1 用正则提取，不依赖 @flowershow/remark-wiki-link 的渲染逻辑 ===

// 捕获可选前缀 ! 与 [[...]] 内部内容（内部不含 ] ，wikilink 不嵌套）。
const WIKILINK_RE = /(!?)\[\[([^\][]+?)\]\]/g;

/** 解析 [[...]] 内部文本为各字段（不含 embed 与源位置字段）。 */
function parseInner(
  inner: string,
): Omit<WikilinkNode, "type" | "embed" | "line" | "column" | "raw"> {
  // === Obsidian 规范来源: 先按首个 | 切出别名，再从链接段切锚点 ===
  const pipe = inner.indexOf("|");
  const linkPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();

  const hash = linkPart.indexOf("#");
  if (hash === -1) {
    return alias ? { target: linkPart, alias } : { target: linkPart };
  }
  const target = linkPart.slice(0, hash);
  const anchor = linkPart.slice(hash + 1);
  // #^ 优先识别为 block 引用，单 # 为 heading。
  const fields: Omit<WikilinkNode, "type" | "embed" | "line" | "column" | "raw"> =
    anchor.startsWith("^") ? { target, blockId: anchor.slice(1) } : { target, heading: anchor };
  if (alias) fields.alias = alias;
  return fields;
}

/**
 * 从文本中提取全部 wikilink / embed 节点。
 * 解析每个链接的 target、alias、heading 锚点、block 引用、是否 embed。
 *
 * P0 links 诊断要求 parser 保留每一次出现，不能在解析层去重；indexer 若需要维持 outlinks
 * 查询语义，应在写库边界按 target+anchor+embed 去重。
 *
 * @param text - 已等长屏蔽代码区的正文；未屏蔽时会按原文提取
 * @param options - sourceText 用于回切 raw；lineOffset 用于换算完整文件行号
 * @returns 规范化后的 wikilink 节点数组；每次出现都会保留源位置
 *
 * @behavior
 * Given 正文含 [[Target#Heading|Alias]] 形式的链接
 * When 提取 wikilink
 * Then 产出含 target/heading/alias 字段的节点，embed=false
 *
 * @behavior
 * Given 正文含 ![[Image.png]] 形式的嵌入
 * When 提取 wikilink
 * Then 产出 embed=true 的节点；资源 vs 笔记区分由 indexer 的 isAssetEmbed 完成，parser 不区分
 *
 * @behavior
 * Given 同一文件内相同 target+anchor+embed 的链接出现多次
 * When 提取 wikilink
 * Then 每次出现都产出节点，供 links check 分别诊断位置
 *
 * @behavior
 * Given [[...]] 内部为空字符串
 * When 提取 wikilink
 * Then 该匹配被静默跳过，不产出节点
 */
export function extractWikilinks(text: string, options: WikilinkOptions = {}): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  const sourceText = options.sourceText ?? text;
  const lineOffset = options.lineOffset ?? 0;

  for (const m of text.matchAll(WIKILINK_RE)) {
    const embed = m[1] === "!";
    const inner = (m[2] ?? "").trim();
    if (inner === "") continue;
    const fields = parseInner(inner);
    const index = m.index ?? 0;
    const raw = sourceText.slice(index, index + (m[0]?.length ?? 0));
    const { line, column } = positionAt(text, index, lineOffset);
    out.push({ type: "wikilink", ...fields, embed, line, column, raw });
  }
  return out;
}

/** indexer 写库前的 wikilink 去重键：保留历史 outlinks 聚合语义，不影响 parser 诊断节点。 */
export function wikilinkIndexKey(node: WikilinkNode): string {
  const anchor = node.blockId ? `#^${node.blockId}` : node.heading ? `#${node.heading}` : "";
  return `${node.embed ? "!" : ""}${linkKey(node.target)}${anchor.toLowerCase()}`;
}

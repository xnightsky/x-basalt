/**
 * Wikilink / Embed 提取子模块：从正文中识别 [[...]] 与 ![[...]] 并产出规范化节点。
 *
 * 上游：src/parser/index.ts 的 VaultParser.parse() 是唯一调用方。
 * 下游：extractWikilinks 的输出经 indexer 写入 links 表（is_embed 区分嵌入与普通链接）。
 *       资源 vs 笔记嵌入的区分由 indexer 调用 utils/path.isAssetEmbed 完成，parser 不区分。
 */
import { linkKey } from "../utils/path.js";
import type { ObsidianNode } from "./types.js";

type WikilinkNode = Extract<ObsidianNode, { type: "wikilink" }>;

// === Obsidian 规范来源 ===
// [[Note]] / [[Note|Alias]] / [[Folder/Note]] / [[Note#Heading]] / [[Note#^block-id]]
// 可组合 [[Folder/Note#Heading|Alias]]；解析顺序 target →(#heading | #^blockId)→ |alias。
// embed：前缀 ! 即 ![[...]]（笔记嵌入 vs 资源嵌入由 utils/path.isAssetEmbed 区分）。
// === 自建实现: 阶段 1 用正则提取，不依赖 @flowershow/remark-wiki-link 的渲染逻辑 ===

// 捕获可选前缀 ! 与 [[...]] 内部内容（内部不含 ] ，wikilink 不嵌套）。
const WIKILINK_RE = /(!?)\[\[([^\][]+?)\]\]/g;

/** 解析 [[...]] 内部文本为各字段（不含 embed 标记）。 */
function parseInner(inner: string): Omit<WikilinkNode, "type" | "embed"> {
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
  const fields: Omit<WikilinkNode, "type" | "embed"> = anchor.startsWith("^")
    ? { target, blockId: anchor.slice(1) }
    : { target, heading: anchor };
  if (alias) fields.alias = alias;
  return fields;
}

/**
 * 从文本中提取全部 wikilink / embed 节点。
 * 解析每个链接的 target、alias、heading 锚点、block 引用、是否 embed。
 *
 * 去重：同一文件内规范化（target basename + 锚点 + embed 标记）相同的链接只保留一次。
 * 之所以把 embed 纳入去重键，是因为 indexer 的 outlinks 需要区分 is_embed，
 * 若忽略 embed 会把 [[X]] 与 ![[X]] 合并而丢失嵌入语义。
 *
 * @param text - 去掉 frontmatter 的正文
 * @returns 规范化后的 wikilink 节点数组；同一文件内 target+anchor+embed 相同的链接只保留一次
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
 * Then 只保留第一次出现的节点，后续重复被静默丢弃
 *
 * @behavior
 * Given [[...]] 内部为空字符串
 * When 提取 wikilink
 * Then 该匹配被静默跳过，不产出节点
 */
export function extractWikilinks(text: string): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(WIKILINK_RE)) {
    const embed = m[1] === "!";
    const inner = (m[2] ?? "").trim();
    if (inner === "") continue;
    const fields = parseInner(inner);

    // 规范化去重键：basename 大小写不敏感 + 锚点小写 + embed 标记。
    const anchor = fields.blockId
      ? `#^${fields.blockId}`
      : fields.heading
        ? `#${fields.heading}`
        : "";
    const key = `${embed ? "!" : ""}${linkKey(fields.target)}${anchor.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ type: "wikilink", ...fields, embed });
  }
  return out;
}

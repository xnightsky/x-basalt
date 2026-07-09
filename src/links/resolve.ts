import { basename, extname, posix } from "node:path";
import type { ObsidianNode } from "../parser/types.js";
import { isAssetEmbed, linkKey, pathKey, toPosix } from "../utils/path.js";
import type { LinkFinding, TargetIndex } from "./types.js";

// === 自建实现: 链接目标判定（纯函数，吃白名单索引，不碰 fs）===
//
// 上游：src/links/check.ts 逐节点调用；下游：产出 LinkFinding（reason?/suggestions）交编排层组装 BasaltIssue。
// 规则真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §5。

type WikilinkNode = Extract<ObsidianNode, { type: "wikilink" }>;
type MarkdownLinkNode = Extract<ObsidianNode, { type: "markdownLink" }>;

const EXTERNAL_RE = /^(https?|mailto|tel|ftp):/i;

/** 把候选 vault 相对路径转成「相对当前文件目录」的 POSIX 建议路径。 */
function toRelative(fromFileRel: string, candidateRel: string): string {
  const rel = posix.relative(posix.dirname(toPosix(fromFileRel)), toPosix(candidateRel));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** 由候选列表构造建议（相对当前文件）；空列表返回 undefined。 */
function suggestFrom(fromFileRel: string, candidates: string[] | undefined): string[] | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  return candidates.map((c) => toRelative(fromFileRel, c)).toSorted();
}

/** 判定 wikilink / embed 目标（笔记按 stem/pathKey，资源按含扩展名 basename/path）。 */
export function resolveWikilink(
  node: WikilinkNode,
  index: TargetIndex,
  fileRel: string,
): LinkFinding {
  const target = node.target;
  const qualified = target.includes("/");
  const asset = isAssetEmbed(target);

  if (asset) {
    if (qualified) {
      return index.pathSet.has(toPosix(target).toLowerCase()) ? {} : { reason: "not_found" };
    }
    const hits = index.filesByBasename.get(basename(target).toLowerCase());
    if (!hits) return { reason: "not_found" };
    if (hits.length > 1) return { reason: "ambiguous_target", suggestions: suggestFrom(fileRel, hits) };
    return {};
  }

  // 笔记
  if (qualified) {
    return index.notesByPathKey.has(pathKey(target)) ? {} : { reason: "not_found" };
  }
  const hits = index.notesByStem.get(linkKey(target));
  if (!hits) return { reason: "not_found" };
  if (hits.length > 1) return { reason: "ambiguous_target", suggestions: suggestFrom(fileRel, hits) };
  return {};
}

/** 宽容 decodeURI：非法转义序列时原样返回，不抛错。 */
function decodeURITarget(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

/** 判定 Markdown inline link / 图片的本地目标。外部/锚点跳过；相对路径按当前文件目录解析。 */
export function resolveMarkdownLink(
  node: MarkdownLinkNode,
  index?: TargetIndex,
  fileRel = "",
): LinkFinding {
  const rawTarget = node.target;
  if (rawTarget === "") return {};
  if (EXTERNAL_RE.test(rawTarget) || rawTarget.startsWith("#")) return { reason: "external_skipped" };

  const backslash = rawTarget.includes("\\");
  const normalized = backslash ? rawTarget.replaceAll("\\", "/") : rawTarget;
  // 去锚点段（P1 只查文件目标；#heading / #^block 校验后置 P1.5）。
  const hashAt = normalized.indexOf("#");
  const pathPart = hashAt === -1 ? normalized : normalized.slice(0, hashAt);
  if (pathPart === "") return { reason: "external_skipped" }; // 纯锚点（去反斜杠后）

  // 相对当前文件目录解析为 vault 相对 POSIX 路径。
  const fromDir = posix.dirname(toPosix(fileRel));
  const joined = posix.normalize(posix.join(fromDir, toPosix(decodeURITarget(pathPart))));
  if (joined.startsWith("..")) return { reason: "outside_vault" };

  const idx = index as TargetIndex;
  const lower = joined.toLowerCase();
  const hit = idx.pathSet.has(lower) || (extname(lower) === "" && idx.pathSet.has(`${lower}.md`));
  if (backslash) return { reason: "backslash_path" }; // 反斜杠写法始终报（跨平台会断），优先级最高
  if (hit) return {};

  const candidates = idx.filesByBasename.get(basename(joined).toLowerCase());
  return { reason: "not_found", suggestions: suggestFrom(fileRel, candidates) };
}

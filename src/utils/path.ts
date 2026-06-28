import { basename, extname } from "node:path";

// === 自建实现: 路径归一化与连接键工具 ===
//
// 本文件是 parser / indexer / query 三层共用的「连接键真相源」。
// 上游：parser 提取 wikilink target 后调 linkKey/pathKey 生成 ObsidianNode 的匹配键；
//       indexer 写入 links 表时以 pathKey 存储 source/target；
//       query 做 bare/qualified 链接 JOIN 匹配时以 linkKey/pathKey 查索引。
// 不变量：indexer 写入侧与 query 查询侧必须调用同一套 linkKey/pathKey 函数生成键；
//         任一侧自行实现等价逻辑会导致 bare/qualified 链接匹配漏命中。

/**
 * 把任意平台的路径分隔符归一化为 POSIX 正斜杠。
 *
 * 索引内的 `files.path` / `links.source` 等一律以 POSIX 形式存储，
 * 使 Windows（反斜杠）与 *nix 产出的索引可移植、且 DQL `FROM "folder"` 的前缀匹配跨平台一致。
 *
 * @param p - 原始路径（可能含反斜杠）
 */
export function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

// === Obsidian 规范来源: 支持 embed 的媒体资源格式（图片/视频/音频/PDF）===
// 非此列表的 embed target（如 .md）视为笔记嵌入，由 linkKey/pathKey 处理。
/** Obsidian 资源型 embed 的扩展名（非笔记，按资源处理）。 */
const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
]);

/**
 * 由 wikilink target 推导用于匹配的规范化 key：去扩展名 + 小写 basename。
 * bare 链接（`[[Note]]`）与同名歧义回退时使用（大小写不敏感）。
 *
 * Obsidian 链接规范：`[[Note]]` 与 `[[Note.md]]` 等价（target 可省略扩展名），
 * 且链接解析大小写不敏感——故 key 去 extname、basename 全小写。
 *
 * @param target - wikilink 的 target 段，如 `Folder/Note` 或 `image.png`
 */
export function linkKey(target: string): string {
  return basename(target, extname(target)).toLowerCase();
}

/**
 * 由 path-qualified wikilink target（或文件相对路径）推导路径键：去扩展名 + POSIX + 小写。
 *
 * 仅当 target 含 `/`（指定了目录）时有区分意义——用于 inlinks/outlinks 的精确匹配，
 * 消除同名异目录串味（S3.2）：`Projects/Alpha` 与 `Archive/Alpha` 得到不同 key。
 * 对无目录的 bare 名退化为与 {@link linkKey} 相同的小写 basename。
 *
 * @param target - wikilink target（如 `Projects/Alpha`）或文件相对路径（如 `Projects/Alpha.md`）
 * @returns 形如 `projects/alpha`
 */
export function pathKey(target: string): string {
  const noExt = target.slice(0, target.length - extname(target).length);
  return toPosix(noExt).toLowerCase();
}

/**
 * 判断 embed 目标是否为资源文件（图片/媒体/PDF）而非笔记嵌入。
 *
 * @param target - embed 的 target 段
 */
export function isAssetEmbed(target: string): boolean {
  return ASSET_EXTENSIONS.has(extname(target).toLowerCase());
}

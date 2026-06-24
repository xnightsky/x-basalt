import { basename, extname } from "node:path";

// === 自建实现: 链接解析与 embed 判定的路径工具 ===

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
 * 对应链接解析的 MVP 近似（basename、大小写不敏感）。
 *
 * @param target - wikilink 的 target 段，如 `Folder/Note` 或 `image.png`
 */
export function linkKey(target: string): string {
  return basename(target, extname(target)).toLowerCase();
}

/**
 * 判断 embed 目标是否为资源文件（图片/媒体/PDF）而非笔记嵌入。
 *
 * @param target - embed 的 target 段
 */
export function isAssetEmbed(target: string): boolean {
  return ASSET_EXTENSIONS.has(extname(target).toLowerCase());
}

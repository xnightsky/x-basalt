import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Document } from "yaml";
import { serializeDocument, splitDocument } from "./document.js";
import { getMeta } from "./operations.js";

export type { FrontmatterParts } from "./document.js";
export { type NormalizeOptions, normalizeDoc } from "./normalize.js";
export {
  coerceValue,
  getMeta,
  hasMeta,
  type MetaScalarType,
  renameMeta,
  setMeta,
  unsetMeta,
} from "./operations.js";

// === 自建实现: 元数据写侧编排（唯一碰 fs 的层）===
//
// 设计：docs/plans/2026-06-28-meta-frontmatter-write.md
// 上游：cli.ts meta 命令组；下游：document（往返内核）+ operations（CRUD）+ fs。
// 边界：parser/indexer 不依赖本模块；本模块只读写单个 .md，不碰 SQLite。

/** editMeta 结果。content 为写入（或 dry-run 下将写入）的完整文件内容。 */
export interface EditResult {
  file: string;
  /** 是否相对原文有字节变化（无变化则不写盘）。 */
  changed: boolean;
  /** 是否为 dry-run（true 则未落盘）。 */
  dryRun: boolean;
  /** 结果文件内容（已写入或将写入）。 */
  content: string;
}

/** 读 frontmatter：无 key 返回整个对象，有 key 返回该键值（缺失为 undefined）。 */
export function readMeta(file: string, key?: string): unknown {
  const parts = splitDocument(readFileSync(file, "utf8"));
  return getMeta(parts.doc, key);
}

/**
 * 编辑 frontmatter：读文件 → 解析 → 用 mutate 改 doc → 序列化 → 原子写回。
 * frontmatter 为非法 YAML 时拒写并抛错（绝不在无法解析的结构上写、防毁文件）。
 * 无字节变化则不写盘；dry-run 仅计算不落盘。
 *
 * @param file - 目标 .md 路径
 * @param mutate - 在 yaml Document 上的改动（用 operations 的 set/unset/rename）
 * @param opts.dryRun - 只算不写
 */
export function editMeta(
  file: string,
  mutate: (doc: Document) => void,
  opts: { dryRun?: boolean } = {},
): EditResult {
  const original = readFileSync(file, "utf8");
  const parts = splitDocument(original);
  if (parts.doc.errors.length > 0) {
    throw new Error(
      `frontmatter YAML 解析失败，拒绝写入：${parts.doc.errors[0]?.message ?? "未知错误"}`,
    );
  }
  mutate(parts.doc);
  const content = serializeDocument(parts);
  const changed = content !== original;
  const dryRun = opts.dryRun === true;
  if (changed && !dryRun) atomicWrite(file, content);
  return { file, changed, dryRun, content };
}

/** 原子写：同目录临时文件 + rename 覆盖，避免半写损坏。 */
function atomicWrite(file: string, content: string): void {
  const tmp = join(dirname(file), `.${basename(file)}.x-basalt-tmp-${process.pid}`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

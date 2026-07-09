import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { linkKey, pathKey, toPosix } from "../utils/path.js";
import type { CollectedFile, TargetIndex } from "./types.js";

// === 自建实现: links 白名单目标索引 + vault 文件枚举（Docusaurus 式集合，内存 per-run，不碰 SQLite）===
//
// 上游：src/links/check.ts 在 checkVault 开头调用；下游：resolve.ts 消费索引判存在性/建议。
// 设计要点：一次遍历同时产出「待解析 .md 列表」与「所有文件白名单」——资源 embed（![[img.png]]）
// 的目标是非 .md 文件，故白名单必须收全部文件，否则图片链接永远误报 not_found。
// 规则真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §5。

/** 由已收集文件构建白名单目标索引（key 全小写，Obsidian 链接大小写不敏感；值保留原始大小写）。 */
export function buildTargetIndex(all: CollectedFile[]): TargetIndex {
  const pathSet = new Set<string>();
  const notesByStem = new Map<string, string[]>();
  const notesByPathKey = new Set<string>();
  const filesByBasename = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const f of all) {
    const rel = toPosix(f.key);
    pathSet.add(rel.toLowerCase());
    push(filesByBasename, basename(rel).toLowerCase(), rel);
    if (extname(rel).toLowerCase() === ".md") {
      push(notesByStem, linkKey(rel), rel);
      notesByPathKey.add(pathKey(rel));
    }
  }
  return { pathSet, notesByStem, notesByPathKey, filesByBasename };
}

/**
 * 递归收集 roots 下所有文件（跳过任意 `.` 开头目录/文件，含 .obsidian/ 与隐藏项）。
 * 返回 all（全部文件，建白名单用）与 markdown（.md 子集，待解析找链接）。
 * 语义与 indexer 的 walk 一致，但同时保留非 .md 文件（资源 embed 目标需要）。
 */
export async function collectFiles(
  roots: string[],
  toKey: (abs: string) => string,
): Promise<{ all: CollectedFile[]; markdown: CollectedFile[] }> {
  const all: CollectedFile[] = [];
  const markdown: CollectedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const file: CollectedFile = { abs: full, key: toKey(full) };
        all.push(file);
        if (e.name.toLowerCase().endsWith(".md")) markdown.push(file);
      }
    }
  };
  for (const root of roots) await walk(root);
  return { all, markdown };
}

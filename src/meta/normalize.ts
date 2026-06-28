import type { Document } from "yaml";
import { renameMeta } from "./operations.js";

// === 自建实现: frontmatter 归一（normalize · Phase 2）===
//
// 设计：docs/plans/2026-06-28-meta-normalize.md
// 把"裸/乱"的 frontmatter 归一成对 Obsidian 合法有效的形态。纯函数，在 yaml Document 上原位改，
// 返回应用了哪些变更（供报告）。建立在 Phase 1 往返内核之上（正文/原子写/幂等由 editMeta 复用）。
// 上游：src/meta/index.ts（applyProfile 在机械预填后调 normalizeDoc 收尾）；下游：src/meta/operations.ts（renameMeta）。

/** normalizeDoc 的选项；所有字段可选，未提供时取默认值。 */
export interface NormalizeOptions {
  /** opt-in：顶层键按字母序排序（可能动空行，故默认 false）。 */
  sortKeys?: boolean;
}

// === Obsidian 规范来源: tags/aliases/cssclasses 为内置 List 属性；单数 tag/alias/cssclass 1.9 已弃 ===
const SINGULAR_TO_PLURAL: Record<string, string> = {
  tag: "tags",
  alias: "aliases",
  cssclass: "cssclasses",
};
const RESERVED_LIST_KEYS = ["tags", "aliases", "cssclasses"] as const;
// tags/cssclasses 不含空格，标量串按空白/逗号拆；aliases 可含空格，标量当单个别名不拆。
const SPLIT_ON_WHITESPACE = new Set<string>(["tags", "cssclasses"]);
// === Obsidian 规范来源: frontmatter 的 tags 项带 # 前缀会失效（YAML # 起注释）===
const STRIP_HASH = new Set<string>(["tags"]);

/** 按 per-key 规则把原始值拆成字符串项（不做去 #/去重，仅拆分）。 */
function splitToItems(raw: unknown, key: string): string[] {
  if (raw == null) return [];
  // 数组：丢弃 null/undefined 项——真实 vault 里 `- #x`（未加引号）会被 YAML 当注释解析成 null，
  // 这类空项应直接丢弃，而非 String(null)="null" 污染结果。
  if (Array.isArray(raw)) return raw.filter((v) => v != null).map((v) => String(v));
  if (typeof raw === "string") {
    return SPLIT_ON_WHITESPACE.has(key) ? raw.split(/[\s,]+/) : [raw];
  }
  return [String(raw)]; // number / boolean 等标量 → 单元素
}

/** 把原始值归一为干净列表：拆分 → trim →（tags）去 # → 去空 → 保序去重。 */
function normalizeListValue(raw: unknown, key: string): string[] {
  const stripHash = STRIP_HASH.has(key);
  const out: string[] = [];
  const seen = new Set<string>();
  for (let item of splitToItems(raw, key)) {
    item = item.trim();
    if (stripHash) item = item.replace(/^#+/, "");
    if (item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** 浅比较：仅当 before 为同长同元素的数组才相等（用于判断列表是否已规范）。 */
function sameList(before: unknown, list: string[]): boolean {
  return (
    Array.isArray(before) && before.length === list.length && before.every((v, i) => v === list[i])
  );
}

/**
 * 归一 frontmatter（原位改 doc），返回变更说明列表。
 *
 * 默认 ON：单数键→复数键迁移（合并/原位改名）、tags/aliases/cssclasses 归一为列表、tags 去 #、去重。
 * opt-in：sortKeys 顶层键排序。幂等：已规范时返回 []。
 *
 * @param doc - frontmatter 的 yaml Document
 * @param opts.sortKeys - 是否排序顶层键（可能影响空行，默认 false）
 *
 * @behavior
 * Given tag/alias/cssclass 单数键与对应复数键同时存在 When normalize Then 合并两者并集后删单数键
 *
 * @behavior
 * Given 只有单数键（无对应复数键）When normalize Then 原位改名为复数键，保留在 items 中的位置与值节点
 *
 * @behavior
 * Given tags 含带 # 前缀的项（如 "#工具"）When normalize Then 去掉 # 前缀并去重，输出干净字符串列表
 *
 * @behavior
 * Given frontmatter 已完全规范 When normalize Then 返回空数组且不改 doc（幂等）
 */
export function normalizeDoc(doc: Document, opts: NormalizeOptions = {}): string[] {
  const changes: string[] = [];
  const js = () => (doc.toJS() ?? {}) as Record<string, unknown>;

  // 1. 单数键迁移：两者都在 → 合并并集删单数；只有单数 → 原位改名保位置。
  for (const [singular, plural] of Object.entries(SINGULAR_TO_PLURAL)) {
    if (!doc.has(singular)) continue;
    if (doc.has(plural)) {
      const merged = normalizeListValue(
        [...splitToItems(js()[plural], plural), ...splitToItems(js()[singular], plural)],
        plural,
      );
      doc.set(plural, merged);
      doc.delete(singular);
      changes.push(`合并 ${singular} → ${plural}`);
    } else {
      renameMeta(doc, singular, plural); // 改 Pair.key 节点，保留位置与值
      changes.push(`重命名 ${singular} → ${plural}`);
    }
  }

  // 2. 保留列表属性归一（null 跳过；已是干净列表则不动）。
  for (const key of RESERVED_LIST_KEYS) {
    if (!doc.has(key)) continue;
    const before = js()[key];
    if (before == null) continue;
    const list = normalizeListValue(before, key);
    if (!sameList(before, list)) {
      doc.set(key, list);
      changes.push(`规范 ${key} 为列表`);
    }
  }

  // 3. opt-in：顶层键排序（调研：可能动空行）。
  if (opts.sortKeys) {
    const contents = doc.contents as { items?: { key: unknown }[] } | null;
    if (contents?.items) {
      const items = contents.items;
      const sorted = items.toSorted((a, b) => String(a.key).localeCompare(String(b.key)));
      if (sorted.some((it, i) => it !== items[i])) {
        contents.items = sorted;
        changes.push("排序键");
      }
    }
  }

  return changes;
}

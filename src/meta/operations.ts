import { type Document, isMap, isScalar } from "yaml";

// === 自建实现: frontmatter CRUD（顶层扁平键）===
//
// 设计：docs/plans/2026-06-28-meta-frontmatter-write.md
// 在 yaml Document 上原位操作：set/unset 走 Document API（保留键序）；rename 改 Pair 的 key 节点
// （保位置 + 值节点连同其注释）。类型推断保守（避开 YAML 1.1 yes/no/on/off 的 Norway 陷阱）。

/** set 的取值类型；auto 为保守推断。 */
export type MetaScalarType = "string" | "number" | "boolean" | "null" | "list" | "auto";

/** 读：无 key 返回整个 frontmatter 对象；有 key 返回该键值（缺失为 undefined）。 */
export function getMeta(doc: Document, key?: string): unknown {
  const obj = (doc.toJS() ?? {}) as Record<string, unknown>;
  return key === undefined ? obj : obj[key];
}

/** 键是否存在。 */
export function hasMeta(doc: Document, key: string): boolean {
  return doc.has(key);
}

/** 写：存在则原位更新值，不存在则末尾追加。value 为已定型的 JS 值（用 coerceValue 由字符串转得）。 */
export function setMeta(doc: Document, key: string, value: unknown): void {
  doc.set(key, value);
}

/** 删：键不存在为 no-op（不抛）。 */
export function unsetMeta(doc: Document, key: string): void {
  doc.delete(key);
}

/**
 * 重命名键：保留键在文档中的位置与值节点（连同值上的注释）。
 * 源不存在或目标已存在则抛错（不静默覆盖）。
 */
export function renameMeta(doc: Document, oldKey: string, newKey: string): void {
  if (!doc.has(oldKey)) throw new Error(`属性 "${oldKey}" 不存在`);
  if (doc.has(newKey)) throw new Error(`属性 "${newKey}" 已存在`);
  const contents = doc.contents;
  if (!isMap(contents)) throw new Error("frontmatter 不是键值映射，无法重命名");
  // 只替换 Pair 的 key 节点：位置（items 下标）与 value 节点（及其注释）原样保留。
  // 用 createNode 生成新 key，自动按需加引号（避免直接改 .value 残留旧的 PLAIN 格式产出非法 YAML）。
  for (const pair of contents.items) {
    if (isScalar(pair.key) && pair.key.value === oldKey) {
      pair.key = doc.createNode(newKey);
      return;
    }
  }
}

/**
 * 把 CLI 传入的字符串值按 type 转为 JS 值。
 * auto 仅识别严格 number / true|false / null，其余按字符串——刻意不做 YAML 隐式猜测，
 * 避免 yes/no/on/off 被静默当布尔（调研结论：Norway 问题）。
 *
 * @param raw - 原始字符串
 * @param type - 目标类型
 */
export function coerceValue(raw: string, type: MetaScalarType): unknown {
  switch (type) {
    case "string":
      return raw;
    case "number": {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) throw new Error(`"${raw}" 不是合法 number`);
      return n;
    }
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new Error(`boolean 仅接受 true/false，得到 "${raw}"`);
    case "null":
      return null;
    case "list":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default:
      return autoCoerce(raw);
  }
}

/** 保守自动推断：严格整数/小数 → number；true/false → boolean；null → null；其余字符串。 */
function autoCoerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

import type { Document } from "yaml";
import { type DeriveContext, deriveValue } from "./derive.js";
import { coerceValue, hasMeta, type MetaScalarType, setMeta } from "./operations.js";
import type { Profile } from "./profiles.js";

// === 自建实现: profile 应用（apply · Phase 3）===
//
// 设计：docs/plans/2026-06-28-meta-derive-profiles.md
// 纯函数层：在 yaml Document 上做 diff / 机械预填 / 消费者 kwargs 补缺。全部 top-up（已有不动），
// x-basalt 不补语义字段、不调 LLM——语义/额外字段由消费者经 --set 传入或事后 meta set。

export interface ProfileDiff {
  /** profile 字段中已存在于 frontmatter 的。 */
  present: string[];
  /** 缺失字段，按角色分组。 */
  missing: { required: string[]; recommended: string[]; optional: string[] };
}

/** 对照 profile 模板，给出 present / missing（按角色分组）。 */
export function diffProfile(doc: Document, profile: Profile): ProfileDiff {
  const present: string[] = [];
  const missing = {
    required: [] as string[],
    recommended: [] as string[],
    optional: [] as string[],
  };
  for (const f of profile.fields) {
    if (hasMeta(doc, f.key)) present.push(f.key);
    else missing[f.role].push(f.key);
  }
  return { present, missing };
}

/** 仅补缺失的机械字段（derive 非空），已有跳过。返回补了哪些 key。 */
export function prefillTrivial(doc: Document, profile: Profile, ctx: DeriveContext): string[] {
  const filled: string[] = [];
  for (const f of profile.fields) {
    if (!f.derive || hasMeta(doc, f.key)) continue; // 非机械字段 / 已有 → 不碰
    setMeta(doc, f.key, deriveValue(f.derive, ctx));
    filled.push(f.key);
  }
  return filled;
}

/** 把消费者传入的字符串值按 profile 声明类型转换；profile 无此 key（额外字段）用 auto 保守推断。 */
export function coerceForProfile(profile: Profile, key: string, raw: string): unknown {
  const field = profile.fields.find((f) => f.key === key);
  let t: MetaScalarType;
  if (field === undefined)
    t = "auto"; // 额外字段
  else if (field.type === "list") t = "list";
  else if (field.type === "number") t = "number";
  else if (field.type === "boolean") t = "boolean";
  else t = "string"; // string / datetime / url 等 → 字符串
  return coerceValue(raw, t);
}

/**
 * 消费者 kwargs（key=value）：`--set` 是显式值，**始终写入（覆盖）**——覆盖文件里已有的值、
 * 也覆盖 profile 机械预填的值（apply 中 applySets 先于机械预填跑，机械层再补 --set 没给的缺）。
 * 值按 profile 声明类型转。区别于机械层「补缺/不 clobber」。
 *
 * @returns filled（原本缺失、新补入的 key）/ overridden（原本已有、被覆盖的 key）
 */
export function applySets(
  doc: Document,
  profile: Profile,
  sets: Record<string, string>,
): { filled: string[]; overridden: string[] } {
  const filled: string[] = [];
  const overridden: string[] = [];
  for (const [key, raw] of Object.entries(sets)) {
    const existed = hasMeta(doc, key);
    setMeta(doc, key, coerceForProfile(profile, key, raw)); // 显式值：覆盖写入
    (existed ? overridden : filled).push(key);
  }
  return { filled, overridden };
}

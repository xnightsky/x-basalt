import type { Document } from "yaml";
import { type DeriveContext, deriveValue } from "./derive.js";
import { coerceValue, hasMeta, type MetaScalarType, setMeta } from "./operations.js";
import type { Profile } from "./profiles.js";

// === 自建实现: profile 应用（apply · Phase 3）===
//
// 设计：docs/plans/2026-06-28-meta-derive-profiles.md
// 纯函数层：在 yaml Document 上做 diff / 机械预填 / 消费者 kwargs 补缺。全部 top-up（已有不动），
// x-basalt 不补语义字段、不调 LLM——语义/额外字段由消费者经 --set 传入或事后 meta set。
// 上游：src/meta/index.ts（applyProfile 按顺序调 applySets → prefillTrivial → normalizeDoc → diffProfile）。
// 下游：src/meta/operations.ts（hasMeta/setMeta）、src/meta/derive.ts（deriveValue）、src/meta/profiles.ts（Profile 类型）。

/**
 * profile 应用后的差异报告：哪些字段已有、哪些仍缺（按 required/recommended/optional 分组）。
 * 供 CLI 输出给消费者决策"还需要补什么"；required 字段仍缺时应给出最强提示。
 */
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

/**
 * 仅补缺失的机械字段（derive 非空），已有跳过。返回补了哪些 key。
 * 幂等：机械字段已存在时不覆盖（top-up 语义）；timestamp 二次调用因已存在而跳过，不因写盘更新 mtime 而漂移。
 *
 * @behavior
 * Given profile 字段有 derive 来源且 frontmatter 中已存在该 key When prefill Then 跳过（不 clobber 已有值）
 *
 * @behavior
 * Given profile 字段有 derive 来源且 frontmatter 缺失该 key When prefill Then 机械计算并写入，返回含该 key
 *
 * @behavior
 * Given profile 字段无 derive（语义字段，如 type/title/description）When prefill Then 始终跳过，不补语义字段
 */
export function prefillTrivial(doc: Document, profile: Profile, ctx: DeriveContext): string[] {
  const filled: string[] = [];
  for (const f of profile.fields) {
    if (!f.derive || hasMeta(doc, f.key)) continue; // 非机械字段 / 已有 → 不碰
    setMeta(doc, f.key, deriveValue(f.derive, ctx));
    filled.push(f.key);
  }
  return filled;
}

/**
 * 把消费者传入的字符串值按 profile 声明类型转换；profile 无此 key（额外字段）用 auto 保守推断。
 * datetime / url 等 profile-only 类型均映射为 string（不做额外格式验证，格式由消费者保证）。
 *
 * @behavior
 * Given key 不在 profile.fields 中（额外字段）When 转换 Then 按 auto 保守推断（不识别 yes/no 为布尔）
 */
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
 *
 * @behavior
 * Given --set 给出的 key 在 frontmatter 中已有值 When applySets Then 覆盖写入并列入 overridden（区别于 prefillTrivial 的 top-up）
 *
 * @behavior
 * Given --set 给出的 key 不在 profile.fields 中（额外字段）When applySets Then 按 auto 推断类型后写入
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

import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Document } from "yaml";
import { applySets, diffProfile, type ProfileDiff, prefillTrivial } from "./apply.js";
import { serializeDocument, splitDocument } from "./document.js";
import { normalizeDoc } from "./normalize.js";
import { getMeta } from "./operations.js";
import { getProfile } from "./profiles.js";

export type { FrontmatterParts } from "./document.js";
export type { ProfileDiff } from "./apply.js";
export { type NormalizeOptions, normalizeDoc } from "./normalize.js";
export { getProfile, listProfiles, type Profile } from "./profiles.js";
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
// 不变量：src/meta 是整个进程中唯一写 .md 文件的层；非法 YAML 拒写、原子写、归一在 profile 之上。

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
 *
 * @behavior
 * Given frontmatter 含非法 YAML（parseDocument 有 errors）When editMeta Then 抛错拒写，文件保持原样
 *
 * @behavior
 * Given mutate 未改变任何值（序列化后与原文字节相同）When editMeta Then changed=false，不落盘（不触发 mtime 变动）
 *
 * @behavior
 * Given opts.dryRun=true When editMeta Then 计算出 content 但不写盘，返回 dryRun=true
 *
 * @behavior
 * Given 需要落盘 When editMeta Then 写同目录临时文件再 rename 覆盖（原子写，避免半写损坏）
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

/** applyProfile 结果。filled/skipped 为本次补入/跳过的 key；present/missing 为应用后对照 profile 的状态。 */
export interface ApplyResult {
  file: string;
  profile: string;
  /** 本次新补入的字段（原本缺失：消费者 --set + 机械预填）。 */
  filled: string[];
  /** 消费者 --set 覆盖掉的、原本已有值的 key。 */
  overridden: string[];
  /** 应用后已存在的 profile 字段。 */
  present: string[];
  /** 应用后仍缺的 profile 字段（按角色分组）——消费者据此决定是否补。 */
  missing: ProfileDiff["missing"];
  changed: boolean;
  dryRun: boolean;
  content: string;
}

/**
 * 套用元数据策略（profile）：消费者 --set 补缺（explicit 优先）+ 机械预填（created/modified/sha256）。
 * 全 top-up（已有不动）；非法 YAML 拒写；未知 profile 报错。x-basalt 不补语义字段、不调 LLM——
 * 仍缺的语义/额外字段由消费者（AI 读 `meta profile show` 的规范+文档 / 人）经 --set 或事后 `meta set` 补。
 *
 * @param file - 目标 .md
 * @param profileName - profile 名（未知则报错并列可用名）
 * @param opts.sets - 消费者传入的 key=value（按 profile 类型转）
 * @param opts.dryRun - 只算不写
 *
 * @behavior
 * Given frontmatter 含非法 YAML When applyProfile Then 抛错拒写（同 editMeta 防毁文件保证）
 *
 * @behavior
 * Given 未知 profileName When applyProfile Then 抛错并列出可用 profile 名
 *
 * @behavior
 * Given --set 与机械预填同时作用于同一字段 When applyProfile Then --set 先写（显式覆盖），机械层跳过该字段（不 clobber --set）
 *
 * @behavior
 * Given profile 机械字段已存在于 frontmatter When applyProfile Then 保持原值不动（top-up），不因写盘更新 mtime 漂移
 *
 * @behavior
 * Given 完整流程 When applyProfile Then 执行顺序为 applySets → prefillTrivial → normalizeDoc → diffProfile（归一在填充之后）
 */
export function applyProfile(
  file: string,
  profileName: string,
  opts: { sets?: Record<string, string>; dryRun?: boolean } = {},
): ApplyResult {
  const profile = getProfile(profileName); // 未知 → 抛错列可用名
  const original = readFileSync(file, "utf8");
  const parts = splitDocument(original);
  if (parts.doc.errors.length > 0) {
    throw new Error(
      `frontmatter YAML 解析失败，拒绝写入：${parts.doc.errors[0]?.message ?? "未知错误"}`,
    );
  }
  const stat = statSync(file);
  // 显式 --set 先写（权威覆盖），再机械预填剩余缺失项（机械层只补缺、不抢 --set）——显式值优先。
  const setRes = applySets(parts.doc, profile, opts.sets ?? {});
  const mech = prefillTrivial(parts.doc, profile, {
    birthtime: stat.birthtime,
    mtime: stat.mtime,
    body: parts.body,
  });
  // 标准化收尾：profile 建立在标准化之上——填完即归一（tags 列表化/去#/去重/单数键迁移），
  // 产出既合规又齐全（含清理文件里旧的不规范字段，与 --set/机械填入的值）。
  normalizeDoc(parts.doc);
  const diff = diffProfile(parts.doc, profile); // 归一后：present + 仍缺
  const content = serializeDocument(parts);
  const changed = content !== original;
  const dryRun = opts.dryRun === true;
  if (changed && !dryRun) atomicWrite(file, content);
  return {
    file,
    profile: profileName,
    filled: [...setRes.filled, ...mech],
    overridden: setRes.overridden,
    present: diff.present,
    missing: diff.missing,
    changed,
    dryRun,
    content,
  };
}

/** 原子写：同目录临时文件 + rename 覆盖，避免半写损坏。 */
function atomicWrite(file: string, content: string): void {
  const tmp = join(dirname(file), `.${basename(file)}.x-basalt-tmp-${process.pid}`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

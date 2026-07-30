import { readFileSync } from "node:fs";
import {
  applyProfile,
  coerceValue,
  editMeta,
  getMeta,
  getProfile,
  hasMeta,
  normalizeDoc,
  renameMeta,
  setMeta,
  unsetMeta,
} from "../meta/index.js";
import { VaultParser } from "../parser/index.js";
import type { Document } from "yaml";
import type { Action } from "./types.js";

// === 自建实现: 内建动作（被编排的强类型动词）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §7 动作清单、§14.6 动作算子。
// 动作只**包装**现有 indexer/meta/parser 能力，不新造 vault 能力，也不绕过其写边界
// （index 写 DB 经 indexer；normalize 写 .md 经 meta 的 editMeta 原子写）。
// 写动作（write=true）受 ctx.dryRun 安全闸约束：dryRun 时只预览不落盘。
// 动作分**无参单例**（index/normalize/parse，getAction 取）与**带参工厂**
// （apply/set/unset/rename，parseAction 构造），与 spec §7 的 `apply <profile>` / `rename old new` 记法对应。

const parser = new VaultParser();

/** index：把变更落入 SQLite 索引（写 DB，非 .md，故 write=false）。 */
const indexAction: Action = {
  name: "index",
  write: false,
  async run(ev, ctx) {
    if (ev.type === "unlink") {
      // scan/watch 源已经产出索引主键（多根 = 根名命名空间），直接按主键精确删除。
      const removed = ctx.indexer.removeByKey(ev.path);
      return { action: "index", path: ev.path, changed: removed, skipped: false };
    }
    await ctx.indexer.update(ev.path);
    return { action: "index", path: ev.path, changed: true, skipped: false };
  },
};

/** normalize：归一 frontmatter（写 .md，受 dry-run 闸）。删除事件跳过。 */
const normalizeAction: Action = {
  name: "normalize",
  write: true,
  async run(ev, ctx) {
    if (ev.type === "unlink") {
      return { action: "normalize", path: ev.path, changed: false, skipped: true };
    }
    const abs = ctx.indexer.toAbsolute(ev.path);
    const r = editMeta(abs, (d) => void normalizeDoc(d), { dryRun: ctx.dryRun });
    // dryRun → 未落盘记 skipped；非 dryRun 且有字节变化才记 changed。
    const changed = r.changed && !r.dryRun;
    if (changed) ctx.onWrite?.(ev.path); // 落盘成功 → 通知编排器记录自产生写（防回环 §9 坑①）
    return {
      action: "normalize",
      path: ev.path,
      changed,
      skipped: r.dryRun,
    };
  },
};

/** parse：只读解析校验（可解析性）。删除事件跳过。不写任何东西。 */
const parseOnlyAction: Action = {
  name: "parse",
  write: false,
  async run(ev, ctx) {
    if (ev.type === "unlink") {
      return { action: "parse", path: ev.path, changed: false, skipped: true };
    }
    const abs = ctx.indexer.toAbsolute(ev.path);
    parser.parse(readFileSync(abs, "utf8")); // 抛错即解析失败，由执行层捕获记 failed
    return { action: "parse", path: ev.path, changed: false, skipped: false };
  },
};

/** apply <profile>：对每个路由到的文件套用 profile（top-up）。复用 applyProfile。 */
function applyActionOf(profile: string): Action {
  return {
    name: "apply",
    write: true,
    async run(ev, ctx) {
      if (ev.type === "unlink")
        return { action: "apply", path: ev.path, changed: false, skipped: true };
      const abs = ctx.indexer.toAbsolute(ev.path);
      const r = applyProfile(abs, profile, { dryRun: ctx.dryRun });
      const changed = r.changed && !r.dryRun;
      if (changed) ctx.onWrite?.(ev.path);
      return { action: "apply", path: ev.path, changed, skipped: r.dryRun };
    },
  };
}

/** set <key>=<value>：对每个文件设属性（值已在声明期 coerce，见 {@link parseSetValue}）。 */
function setActionOf(key: string, value: unknown): Action {
  return {
    name: "set",
    write: true,
    async run(ev, ctx) {
      if (ev.type === "unlink")
        return { action: "set", path: ev.path, changed: false, skipped: true };
      const abs = ctx.indexer.toAbsolute(ev.path);
      const r = editMeta(abs, (d) => setMeta(d, key, value), {
        dryRun: ctx.dryRun,
      });
      const changed = r.changed && !r.dryRun;
      if (changed) ctx.onWrite?.(ev.path);
      return { action: "set", path: ev.path, changed, skipped: r.dryRun };
    },
  };
}

/** unset <key>：删属性（键不存在 = 无变化）。 */
function unsetActionOf(key: string): Action {
  return {
    name: "unset",
    write: true,
    async run(ev, ctx) {
      if (ev.type === "unlink")
        return { action: "unset", path: ev.path, changed: false, skipped: true };
      const abs = ctx.indexer.toAbsolute(ev.path);
      const r = editMeta(abs, (d) => unsetMeta(d, key), { dryRun: ctx.dryRun });
      const changed = r.changed && !r.dryRun;
      if (changed) ctx.onWrite?.(ev.path);
      return { action: "unset", path: ev.path, changed, skipped: r.dryRun };
    },
  };
}

/** rename <old> <new>：改键名；遇目标已存在按 ctx.ifExists 策略。 */
function renameActionOf(oldKey: string, newKey: string): Action {
  return {
    name: "rename",
    write: true,
    async run(ev, ctx) {
      if (ev.type === "unlink")
        return { action: "rename", path: ev.path, changed: false, skipped: true };
      const abs = ctx.indexer.toAbsolute(ev.path);
      const r = editMeta(abs, (d) => applyRenamePolicy(d, oldKey, newKey, ctx.ifExists ?? "skip"), {
        dryRun: ctx.dryRun,
      });
      const changed = r.changed && !r.dryRun;
      if (changed) ctx.onWrite?.(ev.path);
      return { action: "rename", path: ev.path, changed, skipped: r.dryRun };
    },
  };
}

const ACTIONS: Record<string, Action> = {
  index: indexAction,
  normalize: normalizeAction,
  parse: parseOnlyAction,
};

/** 取内建动作；未知名报错并列可用名（不静默忽略，防管道声明拼错）。 */
export function getAction(name: string): Action {
  const a = ACTIONS[name];
  if (!a) throw new Error(`未知动作 "${name}"，可用：${Object.keys(ACTIONS).join(", ")}`);
  return a;
}

/** 列出全部内建动作名。 */
export function listActions(): string[] {
  return Object.keys(ACTIONS);
}

/**
 * rename 冲突策略（在 yaml Document 上原位）。源缺失 = no-op；无冲突 = 直接 renameMeta（保位置/注释）。
 * 冲突时：skip 留原样；overwrite 删目标再重命名；merge 仅当双方均为列表时取并集（目标在前、去重）、否则抛错。
 *
 * @behavior Given 源键不存在 When applyRenamePolicy Then no-op（不抛、不改）
 * @behavior Given 目标键不存在 When applyRenamePolicy Then 直接 renameMeta（无冲突路径）
 * @behavior Given 冲突且 mode=skip When applyRenamePolicy Then 留原样不动
 * @behavior Given 冲突且 mode=overwrite When applyRenamePolicy Then 删目标后重命名（旧目标值丢弃）
 * @behavior Given 冲突且 mode=merge 且双方均为列表 When applyRenamePolicy Then 目标值在前合并去重、删源
 * @behavior Given 冲突且 mode=merge 但任一方非列表 When applyRenamePolicy Then 抛错（merge 仅支持列表）
 */
export function applyRenamePolicy(
  doc: Document,
  oldKey: string,
  newKey: string,
  mode: "skip" | "overwrite" | "merge",
): void {
  if (!hasMeta(doc, oldKey)) return; // 源不存在 → no-op
  if (!hasMeta(doc, newKey)) {
    renameMeta(doc, oldKey, newKey); // 无冲突 → 直接重命名（renameMeta 保位置/注释）
    return;
  }
  switch (mode) {
    case "skip":
      return; // 留原样
    case "overwrite":
      unsetMeta(doc, newKey); // 删目标，腾出位置
      renameMeta(doc, oldKey, newKey);
      return;
    case "merge": {
      const a = getMeta(doc, oldKey);
      const b = getMeta(doc, newKey);
      if (Array.isArray(a) && Array.isArray(b)) {
        const merged = [...b, ...a.filter((x) => !b.includes(x))]; // 目标在前 + 去重
        setMeta(doc, newKey, merged);
        unsetMeta(doc, oldKey);
        return;
      }
      throw new Error(`rename ${oldKey}→${newKey} 冲突且 merge 仅支持双方均为列表`);
    }
  }
}

/**
 * 解析管道 `set` 的值：`[a, b]` → 列表，其余 → 标量（auto 保守推断，守 Norway）。
 *
 * 为什么用方括号显式声明列表：在 `--pipe actions=a,b` 里裸逗号是**动作分隔符**，
 * 不能同时兼任列表分隔符；方括号既自描述（同 YAML flow 序列）又能被
 * `orchestrator/params` 的 `splitTopLevel` 括号感知切分保住括号内的逗号。
 * 标量仍禁空格（token 之间靠空格分参数），要多值请用列表写法。
 *
 * @param raw - 动作 token 里 `key=` 之后的原文（已 trim）
 * @returns 列表（元素 trim、丢空项）或标量值
 *
 * @behavior
 * Given 值形如 `[a, b]`
 * When parseSetValue
 * Then 产出字符串列表，落盘为 YAML 列表（`[]` 即空列表）
 *
 * @behavior
 * Given 标量值含空格（如 `set title=a b`）
 * When parseSetValue
 * Then 抛错并指路列表写法，而非把 `b` 当成下一个参数静默丢弃
 */
function parseSetValue(raw: string): unknown {
  if (raw.startsWith("[") && raw.endsWith("]")) return coerceValue(raw.slice(1, -1), "list");
  if (/\s/.test(raw)) {
    throw new Error(`set 的标量值不含空格（多值请写 [a, b]），得到 "${raw}"`);
  }
  return coerceValue(raw, "auto");
}

/**
 * 解析一个动作 token（动词 + 空格分隔参数）成绑定参数的 Action。
 * 无参动作（index/normalize/parse）复用现有单例；带参写动作（apply/set/unset/rename）按工厂构造。
 * 未知动词 / 参数个数不符 / set 缺 `=` 均抛错（声明期失败，不静默）。
 *
 * @behavior Given "index"/"normalize"/"parse" 且无参 When parseAction Then 返回对应内建动作
 * @behavior Given 无参动作却带了参数 When parseAction Then 抛错
 * @behavior Given "apply <profile>" When parseAction Then 校验 profile 存在（getProfile）后返回 apply 动作
 * @behavior Given "set key=value" When parseAction Then 返回 set 动作；缺 `=` 或缺 key 抛错
 * @behavior Given "set key=[a, b]" When parseAction Then 值解析为列表（见 parseSetValue）
 * @behavior Given "unset key" / "rename old new" 参数个数不符 When parseAction Then 抛错
 * @behavior Given 未知动词 When parseAction Then 抛错并列可用动词
 */
export function parseAction(token: string): Action {
  const parts = token.trim().split(/\s+/);
  const verb = parts[0]!;
  const args = parts.slice(1);
  switch (verb) {
    case "index":
    case "normalize":
    case "parse":
      if (args.length > 0) throw new Error(`动作 "${verb}" 不接受参数，得到 "${token}"`);
      return getAction(verb);
    case "apply":
      if (args.length !== 1) throw new Error(`apply 需 1 个 profile 名：apply <profile>`);
      getProfile(args[0]!); // 校验存在，未知则抛错列可用名
      return applyActionOf(args[0]!);
    case "set": {
      // 不按空格切参数：列表值 `[a, b]` 内允许空格，故取动词后的整段原文再切 `=`。
      const rest = token.trim().slice(verb.length).trim();
      const eq = rest.indexOf("=");
      if (eq <= 0) throw new Error(`set 需 key=value：set <key>=<value>（列表值写 [a, b]）`);
      const key = rest.slice(0, eq).trim();
      if (key === "" || /\s/.test(key)) throw new Error(`set 的 key 不含空格，得到 "${key}"`);
      return setActionOf(key, parseSetValue(rest.slice(eq + 1).trim()));
    }
    case "unset":
      if (args.length !== 1) throw new Error(`unset 需 1 个 key：unset <key>`);
      return unsetActionOf(args[0]!);
    case "rename":
      if (args.length !== 2) throw new Error(`rename 需 old new 两个键名：rename <old> <new>`);
      return renameActionOf(args[0]!, args[1]!);
    default:
      throw new Error(
        `未知动作 "${verb}"，可用：index, normalize, parse, apply, set, unset, rename`,
      );
  }
}

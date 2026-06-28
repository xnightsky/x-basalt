import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editMeta, normalizeDoc } from "../meta/index.js";
import { VaultParser } from "../parser/index.js";
import type { Action } from "./types.js";

// === 自建实现: 内建动作（被编排的强类型动词）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §7 动作清单、§14.6 动作算子。
// 动作只**包装**现有 indexer/meta/parser 能力，不新造 vault 能力，也不绕过其写边界
// （index 写 DB 经 indexer；normalize 写 .md 经 meta 的 editMeta 原子写）。
// 写动作（write=true）受 ctx.dryRun 安全闸约束：dryRun 时只预览不落盘。

const parser = new VaultParser();

/** index：把变更落入 SQLite 索引（写 DB，非 .md，故 write=false）。 */
const indexAction: Action = {
  name: "index",
  write: false,
  async run(ev, ctx) {
    if (ev.type === "unlink") {
      ctx.indexer.remove(ev.path);
      return { action: "index", path: ev.path, changed: true, skipped: false };
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
    const abs = join(ctx.vaultPath, ev.path);
    const r = editMeta(abs, (d) => void normalizeDoc(d), { dryRun: ctx.dryRun });
    // dryRun → 未落盘记 skipped；非 dryRun 且有字节变化才记 changed。
    return {
      action: "normalize",
      path: ev.path,
      changed: r.changed && !r.dryRun,
      skipped: r.dryRun,
    };
  },
};

/** parse：只读解析校验（可解析性）。删除事件跳过。不写任何东西。 */
const parseAction: Action = {
  name: "parse",
  write: false,
  async run(ev, ctx) {
    if (ev.type === "unlink") {
      return { action: "parse", path: ev.path, changed: false, skipped: true };
    }
    const abs = join(ctx.vaultPath, ev.path);
    parser.parse(readFileSync(abs, "utf8")); // 抛错即解析失败，由执行层捕获记 failed
    return { action: "parse", path: ev.path, changed: false, skipped: false };
  },
};

const ACTIONS: Record<string, Action> = {
  index: indexAction,
  normalize: normalizeAction,
  parse: parseAction,
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

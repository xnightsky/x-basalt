import { createHash } from "node:crypto";

// === 自建实现: profile 机械预填来源（derive · Phase 3）===
//
// 设计：docs/plans/2026-06-28-meta-derive-profiles.md
// 只做"无需理解文档"的确定性字段：created(birthtime)、modified(mtime)、正文 sha256。
// 语义字段（type/title/description/tags…）不在此机械补——交给消费者（AI 读文档+规范 / 人按判断）。
// 纯函数：fs 数据由调用方读好传入，derive 不碰 fs。

/** 机械预填来源标识。 */
export type DeriveSource = "birthtime" | "mtime" | "sha256-body";

/** 推导上下文：调用方（index.ts）读 fs 后传入。 */
export interface DeriveContext {
  /** 文件创建时间（fs.stat().birthtime）。部分文件系统不可靠，见 reliableBirthtime。 */
  birthtime: Date;
  /** 文件最后修改时间（fs.stat().mtime）。 */
  mtime: Date;
  /** 正文（闭合 --- 之后，逐字节）。 */
  body: string;
}

/**
 * 按来源计算机械字段值。
 *
 * @param source - 来源标识
 * @param ctx - 推导上下文
 */
export function deriveValue(source: DeriveSource, ctx: DeriveContext): unknown {
  switch (source) {
    case "birthtime":
      return toIsoSeconds(reliableBirthtime(ctx));
    case "mtime":
      return toIsoSeconds(ctx.mtime);
    case "sha256-body":
      // 仅对正文计算（frontmatter 改动不影响），用于内容漂移检测。
      return createHash("sha256").update(ctx.body, "utf8").digest("hex");
  }
}

// === 自建实现: birthtime 在部分文件系统不可靠（为 0 或晚于 mtime）→ 回退 mtime（调研结论）===
function reliableBirthtime(ctx: DeriveContext): Date {
  const b = ctx.birthtime;
  if (!b || b.getTime() === 0 || b.getTime() > ctx.mtime.getTime()) return ctx.mtime;
  return b;
}

/** Date → ISO 8601 字符串，去掉毫秒（`2026-06-28T10:30:00Z`）。 */
function toIsoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

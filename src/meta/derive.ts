import { createHash } from "node:crypto";

// === 自建实现: profile 机械预填来源（derive · Phase 3）===
//
// 设计：docs/plans/2026-06-28-meta-derive-profiles.md
// 只做"无需理解文档"的确定性字段：created(birthtime)、modified(mtime)、正文 sha256。
// 语义字段（type/title/description/tags…）不在此机械补——交给消费者（AI 读文档+规范 / 人按判断）。
// 纯函数：fs 数据由调用方读好传入，derive 不碰 fs。
// 上游：src/meta/apply.ts（prefillTrivial 调 deriveValue）。下游：node:crypto。

/**
 * 机械预填来源标识。
 * - `birthtime`：文件创建时间（不可靠时自动回退 mtime，见 reliableBirthtime）。
 * - `mtime`：文件最后修改时间。
 * - `sha256-body`：正文（frontmatter 闭合 --- 之后）的 SHA-256 hex，用于检测内容漂移。
 */
export type DeriveSource = "birthtime" | "mtime" | "sha256-body";

/**
 * 推导上下文：由 src/meta/index.ts 读 fs 后组装传入，derive 层不碰 fs。
 * 三个字段分别对应三种机械来源（birthtime / mtime / sha256-body），按需取用。
 */
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
 * @param ctx - 推导上下文（由 index.ts 读 fs 后传入，本函数不碰 fs）
 *
 * @behavior
 * Given birthtime 为 0 或晚于 mtime（文件系统不可靠）When 取 birthtime 字段 Then 自动回退为 mtime，防止未来时间戳写入 frontmatter
 *
 * @behavior
 * Given source="sha256-body" When 计算 Then 仅对正文（frontmatter 闭合 --- 之后）做 SHA-256，frontmatter 改动不影响 hash
 *
 * @behavior
 * Given source 为 birthtime/mtime When 计算 Then 返回去掉毫秒的 ISO 8601 字符串（如 "2026-06-28T10:30:00Z"）
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

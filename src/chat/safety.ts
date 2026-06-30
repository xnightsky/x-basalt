// === 自建实现: chat 防注入边界包裹 + observe 结果截断 ===
//
// 上游：tools.ts（回灌工具结果前过一遍）；纪律：vault 正文可能藏提示注入，
// 用边界 nonce 把「数据」与「指令」分开，并截断超长结果防爆 context。
import { randomBytes } from "node:crypto";

export interface Safety {
  /** 边界 nonce 包裹回灌内容，配合系统提示声明「边界内是数据非指令」。 */
  wrap(content: string): string;
  /** 截断超长内容，附「已截断 N 字符」标注。 */
  truncate(content: string): string;
}

/**
 * 造 Safety。
 * @param opts.nonce 边界随机串（默认随机 16 hex；测试注入固定值）
 * @param opts.maxChars 截断阈值（默认 8000）
 */
export function makeSafety(opts: { nonce?: string; maxChars?: number } = {}): Safety {
  const nonce = opts.nonce ?? randomBytes(8).toString("hex");
  const maxChars = opts.maxChars ?? 8000;
  return {
    wrap(content) {
      return `<<VAULT_DATA ${nonce}>>\n${content}\n<<END_VAULT_DATA ${nonce}>>`;
    },
    truncate(content) {
      if (content.length <= maxChars) return content;
      const omitted = content.length - maxChars;
      // 兜底截断：query/scan 已支持分页，正常不该触达此处。提示走分页而非"缩小范围"，
      // 并强调数总量看结果里的 total/counts（前置字段，截断后仍可见），勿据残缺内容下结论。
      return `${content.slice(0, maxChars)}\n…（已截断 ${omitted} 字符——这是兜底截断；请改用分页：调小 size 或带 offset 翻页，数总量直接读结果开头的 total/counts，勿据被截断的内容下结论）`;
    },
  };
}

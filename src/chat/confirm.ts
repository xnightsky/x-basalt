// === 自建实现: chat 写动作确认闸——TTY [y/N] / --yes 批放 / 非 TTY 恒拒 ===
//
// 上游：tools.ts 写工具 execute 落盘前调用；纪律：非交互环境恒拒，防 CI/管道里被 LLM 静默改库。
import { createInterface } from "node:readline/promises";

export interface WritePreview {
  kind: "single" | "batch";
  /** 人读动作标签，如 "set status → projects/a.md"。 */
  label: string;
  /** 单文件=将写入的完整内容；批量=RunReport 摘要。 */
  diff: string;
}

export type ConfirmFn = (p: WritePreview) => Promise<boolean>;

/**
 * 造 ConfirmFn。
 * @behavior Given yes=true When 确认 Then 恒 true（不提示）
 * @behavior Given isTTY=false When 确认 Then 恒 false（不提示）
 * @behavior Given 交互 TTY When 确认 Then 打印 diff+label，读 [y/N]，y/yes→true 其余 false
 */
export function makeConfirm(opts: {
  yes: boolean;
  isTTY: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): ConfirmFn {
  return async (p) => {
    if (opts.yes) return true;
    if (!opts.isTTY) return false;
    const output = opts.output ?? process.stdout;
    output.write(`\n${p.diff}\n— ${p.label}\n`);
    const rl = createInterface({ input: opts.input ?? process.stdin, output });
    try {
      const ans = (await rl.question("应用此改动？[y/N] ")).trim().toLowerCase();
      return ans === "y" || ans === "yes";
    } finally {
      rl.close();
    }
  };
}

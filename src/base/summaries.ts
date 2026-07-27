/**
 * base 模块 P2b 片三：view summaries 的 15 个内置汇总（数据驱动表：名字 → 输入类型 → 实现）。
 *
 * 口径（计划「关键取舍」#10/#11）：
 * - 输入值 = 逐行求目标 property-ref 的结果列表（计算集 = filter 后 **limit 前**全量，暂定）；
 * - 类型不匹配的值跳过（Average 只计 number、Earliest 只计 date 等；Empty/Filled/Unique 全计）；
 * - 全部跳过（含计算集为空）→ 结果 null；
 * - Range 按输入类型分派：有 number 值 → max-min（number）；否则有 date 值 → latest-earliest
 *   （DurationValue，经 toOutputValue 序列化为 number 毫秒）；两者皆无 → null；
 * - Stddev 为**总体标准差**（除以 n，非样本 n-1），官方未明示口径，注释声明。
 *
 * 计数类结果（Checked/Unchecked/Empty/Filled/Unique）为 number；Earliest/Latest 返回原
 * DateValue（保精度）；Unique 去重用 typedEqual（每比较一对元素经 spend 扣预算，防 O(n²) 耗尽）。
 *
 * 上游：planner.ts（名字集合核验）/ engine.ts（求值接线）。
 * 设计真相源：docs/design/bases-engine.md §13；
 * 计划：docs/history/plans/2026-07-27-bases-p2b-types-list-group-summary.md 片三 #10。
 */

import { MISSING, createDurationValue, isDateValue, typedEqual, type BaseValue } from "./values.js";

// === Obsidian 规范来源: Bases 内置汇总 15 名（官方 Bases summaries 文档；
// SUM-001 矩阵原文写「Count 类」而官方无 Count（有 Filled/Empty/Unique）——按官方 15 名实现）===

/** 内置汇总输入类型：number / date / boolean 按类型收集（不匹配跳过）；any 全计。 */
export type BuiltinSummaryInput = "number" | "date" | "boolean" | "any";

/** 内置汇总注册项。 */
export interface BuiltinSummaryDef {
  readonly name: string;
  readonly input: BuiltinSummaryInput;
  /**
   * 对已按 {@link input} 收集过滤后的值列表计算结果。
   * 约定：collected 非空（空调用方已短路为 null）；返回 BaseValue（允许 null——
   * 如 Range 收集到值但既非 number 也非 date 时）。
   *
   * @param spend - 每次元素迭代/比较回调一次（engine 借此扣 maxOperations 预算，可抛 BaseBudgetError）
   */
  readonly compute: (collected: BaseValue[], spend: () => void) => BaseValue;
}

/** 取 number 列表的最小/最大值（cmp 选取方向）。 */
function pickNumber(values: number[], pick: "min" | "max"): number {
  let best = values[0] as number;
  for (const v of values) {
    if (pick === "min" ? v < best : v > best) best = v;
  }
  return best;
}

/** 内置汇总表（插入序 = 下列声明序，suggestions 输出字节稳定）。 */
const BUILTIN_SUMMARY_LIST: readonly BuiltinSummaryDef[] = [
  // ---- number ----
  {
    name: "Average",
    input: "number",
    compute: (collected, spend) => {
      let sum = 0;
      for (const v of collected) {
        spend();
        sum += v as number;
      }
      return sum / collected.length;
    },
  },
  {
    name: "Min",
    input: "number",
    compute: (collected) => pickNumber(collected as number[], "min"),
  },
  {
    name: "Max",
    input: "number",
    compute: (collected) => pickNumber(collected as number[], "max"),
  },
  {
    name: "Sum",
    input: "number",
    compute: (collected, spend) => {
      let sum = 0;
      for (const v of collected) {
        spend();
        sum += v as number;
      }
      return sum;
    },
  },
  {
    // Range 按输入类型分派（计划 #10）：number → max-min；否则 date → latest-earliest（Duration）。
    // input 标 any 自行收集（两套过滤口径无法共用单一 input 收集器）。
    name: "Range",
    input: "any",
    compute: (collected, spend) => {
      const nums: number[] = [];
      const epochs: number[] = [];
      for (const v of collected) {
        spend();
        if (typeof v === "number") nums.push(v);
        else if (isDateValue(v)) epochs.push(v.epochMs);
      }
      if (nums.length > 0) return pickNumber(nums, "max") - pickNumber(nums, "min");
      if (epochs.length > 0) {
        return createDurationValue(
          pickNumber(epochs, "max") - pickNumber(epochs, "min"),
          "millisecond",
        );
      }
      return null; // 有值但既非 number 也非 date（如全 string）→ 全跳过口径，结果 null
    },
  },
  {
    name: "Median",
    input: "number",
    compute: (collected, spend) => {
      const nums = (collected as number[]).toSorted((a, b) => a - b);
      spend(); // 排序整体计一（元素级成本由 maxOperations 总额兜底，不逐对回调）
      const mid = Math.floor(nums.length / 2);
      // 偶数个取中间两值均值（拍板，官方未明示；与主流统计口径一致）。
      return nums.length % 2 === 1
        ? (nums[mid] as number)
        : ((nums[mid - 1] as number) + (nums[mid] as number)) / 2;
    },
  },
  {
    name: "Stddev",
    input: "number",
    compute: (collected, spend) => {
      // 总体标准差（除以 n；非样本标准差 n-1）——官方未明示口径，本片冻结为总体口径，注释声明。
      let sum = 0;
      for (const v of collected) {
        spend();
        sum += v as number;
      }
      const mean = sum / collected.length;
      let sq = 0;
      for (const v of collected) {
        spend();
        sq += ((v as number) - mean) ** 2;
      }
      return Math.sqrt(sq / collected.length);
    },
  },
  // ---- date（Earliest/Latest 返回原 DateValue，保留 date/datetime 精度）----
  {
    name: "Earliest",
    input: "date",
    compute: (collected) => {
      let best = collected[0] as BaseValue & { epochMs: number };
      for (const v of collected) {
        if (isDateValue(v) && v.epochMs < best.epochMs) best = v;
      }
      return best;
    },
  },
  {
    name: "Latest",
    input: "date",
    compute: (collected) => {
      let best = collected[0] as BaseValue & { epochMs: number };
      for (const v of collected) {
        if (isDateValue(v) && v.epochMs > best.epochMs) best = v;
      }
      return best;
    },
  },
  // ---- boolean ----
  {
    name: "Checked",
    input: "boolean",
    compute: (collected, spend) => {
      let n = 0;
      for (const v of collected) {
        spend();
        if (v === true) n += 1;
      }
      return n;
    },
  },
  {
    name: "Unchecked",
    input: "boolean",
    compute: (collected, spend) => {
      let n = 0;
      for (const v of collected) {
        spend();
        if (v === false) n += 1;
      }
      return n;
    },
  },
  // ---- any（Empty 计 null/MISSING；Filled 反之；Unique typedEqual 去重计数）----
  {
    name: "Empty",
    input: "any",
    compute: (collected, spend) => {
      let n = 0;
      for (const v of collected) {
        spend();
        if (v === null || v === MISSING) n += 1;
      }
      return n;
    },
  },
  {
    name: "Filled",
    input: "any",
    compute: (collected, spend) => {
      let n = 0;
      for (const v of collected) {
        spend();
        if (v !== null && v !== MISSING) n += 1;
      }
      return n;
    },
  },
  {
    name: "Unique",
    input: "any",
    compute: (collected, spend) => {
      // typedEqual 去重计数（数字 ≠ 数字字符串；date 按 epoch、duration 按毫秒等值域口径）。
      // O(n²) 比较逐对经 spend 扣 maxOperations（防大结果集耗尽）。
      const kept: BaseValue[] = [];
      outer: for (const v of collected) {
        for (const k of kept) {
          spend();
          if (typedEqual(v, k, spend)) continue outer;
        }
        kept.push(v);
      }
      return kept.length;
    },
  },
];

/** 内置汇总索引：名字（大小写敏感，按官方拼写）→ 定义。 */
export const BUILTIN_SUMMARIES: ReadonlyMap<string, BuiltinSummaryDef> = new Map(
  BUILTIN_SUMMARY_LIST.map((d) => [d.name, d]),
);

/** 按 input 类型收集匹配值（number/date/boolean 过滤；any 全计）。 */
function collectByInput(input: BuiltinSummaryInput, values: BaseValue[]): BaseValue[] {
  switch (input) {
    case "number":
      return values.filter((v) => typeof v === "number");
    case "date":
      return values.filter((v) => isDateValue(v));
    case "boolean":
      return values.filter((v) => typeof v === "boolean");
    case "any":
      return [...values];
  }
}

/**
 * 执行一个内置汇总：按 input 收集 → 全跳过（或计算集为空）→ null → def.compute。
 *
 * @param values - 目标 property-ref 跨行求值结果（含 null/MISSING/混合类型）
 * @param spend - 元素迭代/比较预算回调（engine 注入，可抛 BaseBudgetError）
 */
export function runBuiltinSummary(
  def: BuiltinSummaryDef,
  values: BaseValue[],
  spend: () => void,
): BaseValue {
  const collected = collectByInput(def.input, values);
  if (collected.length === 0) return null; // 全部跳过 → null（计划 #10 暂定口径）
  return def.compute(collected, spend);
}

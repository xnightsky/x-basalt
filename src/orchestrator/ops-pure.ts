// === 自建实现: 片三纯函数算子（设计：docs/design/pipeline-op-model.md §5 / §12、D4、D9）===
//
// 四个算子全部纯函数：不碰 IO、write:false、changed/skipped 恒空。
// 全部 rowwise:false（需看全批才能判断；rowwise 默认 false = 保守，见 D6）。
// 设计：filter/limit/dedup 是转换（N→M），map 是转换（N→N，副作用在 fields 上）。

import { hasInterpolation, parseFilterExpr, matchFilter, renderTemplate } from "./interp.js";
import type { Op, OpFailure, Row } from "./types.js";

// === filter <field> <op> [<value>] ===
//
// §12 未决问题决定：只做字段比较，不引入表达式求值器（守 D4 与 §8）。
// DQL WHERE 子集是查索引的语言（在 SQLite 上编译执行），这里过滤的是已在内存中的 Row，
// 两者作用域不同。引入求值器会与 DQL/base 的表达式能力重复且违反 §8。
//
// 过滤语义：不匹配的行直接丢弃，**不进 failed**——这是过滤的本体语义，不是错误。

export function makeFilterOp(params: string): Op {
  const expr = parseFilterExpr(params);

  return {
    name: "filter",
    write: false,
    rowwise: false,
    async run(
      rows: Row[],
      _ctx: unknown,
    ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
      const out = rows.filter((row) => matchFilter(row, expr));
      return { rows: out, failed: [], changed: [], skipped: [] };
    },
  };
}

// === limit <n> ===
//
// 取前 n 行。n 必须为正整数，否则进 failed。

export function makeLimitOp(params: string): Op {
  const nStr = params.trim();
  const n = Number(nStr);

  if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(n)) {
    // n 非法：返回一个总会 failed 的 Op（直接在 run 时产生 failed）
    // 这样 resolve 时不会抛错，保持 registry 统一行为
    return {
      name: "limit",
      write: false,
      rowwise: false,
      async run(
        _rows: Row[],
        _ctx: unknown,
      ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
        return {
          rows: [],
          failed: [
            {
              path: "<pipeline>",
              op: "limit",
              error: `limit 参数必须为正整数，得到 "${nStr}"`,
            },
          ],
          changed: [],
          skipped: [],
        };
      },
    };
  }

  return {
    name: "limit",
    write: false,
    rowwise: false,
    async run(
      rows: Row[],
      _ctx: unknown,
    ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
      return { rows: rows.slice(0, n), failed: [], changed: [], skipped: [] };
    },
  };
}

// === dedup [<key>] ===
//
// 缺省按 Row.path 去重，给了 key 则按 fields 里该键的值去重。
// 保留首次出现的行（与既有 dedup/L2 LWW 的保序口径一致）。

export function makeDedupOp(params: string): Op {
  const key = params.trim() || undefined;

  return {
    name: "dedup",
    write: false,
    rowwise: false,
    async run(
      rows: Row[],
      _ctx: unknown,
    ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
      const seen = new Set<unknown>();
      const out: Row[] = [];

      for (const row of rows) {
        const dedupKey = key === undefined ? row.path : row.fields[key];
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          out.push(row);
        }
      }

      return { rows: out, failed: [], changed: [], skipped: [] };
    },
  };
}

// === map <targetField>=<template> ===
//
// 模板渲染后写进该行 fields 的 targetField。
// 模板走 {{row.x}} 插值（见 interp.ts）。
// 缺失的字段渲染为空字符串并记进 failed（不静默吞掉）。

export function makeMapOp(params: string): Op {
  const eqIdx = params.indexOf("=");
  if (eqIdx <= 0) {
    throw new Error(`map 格式错误：需要 <targetField>=<template>，得到 "${params}"`);
  }

  const targetField = params.slice(0, eqIdx).trim();
  if (!targetField) {
    throw new Error(`map targetField 不能为空`);
  }

  const template = params.slice(eqIdx + 1);

  // 不含插值时直接返回常量
  if (!hasInterpolation(template)) {
    return {
      name: "map",
      write: false,
      rowwise: false,
      async run(
        rows: Row[],
        _ctx: unknown,
      ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
        const out: Row[] = rows.map((row) => ({
          ...row,
          fields: { ...row.fields, [targetField]: template },
        }));
        return { rows: out, failed: [], changed: [], skipped: [] };
      },
    };
  }

  // 含插值：每行渲染
  return {
    name: "map",
    write: false,
    rowwise: false,
    async run(
      rows: Row[],
      _ctx: unknown,
    ): Promise<{ rows: Row[]; failed: OpFailure[]; changed: string[]; skipped: string[] }> {
      const out: Row[] = [];
      const allFailed: OpFailure[] = [];

      for (const row of rows) {
        const [rendered, failures] = renderTemplate(template, row, "map");
        allFailed.push(...failures);
        out.push({
          ...row,
          fields: { ...row.fields, [targetField]: rendered },
        });
      }

      return { rows: out, failed: allFailed, changed: [], skipped: [] };
    },
  };
}

/**
 * Bases date/duration 函数族测试（2026-07-28 覆盖率片二，计划 docs/plans/2026-07-28-bases-functions.md）。
 *
 * 覆盖：global 构造 `date()` / `duration()`（BASE-TYPE-005）、新增 date 分派组
 * `format` / `time` / `relative` / `isEmpty`、以及 relative 的 clock 注入字节稳定
 * （BASE-FORM-006 同款纪律：**测试必须注入固定 clock**）。
 *
 * 合成 BaseRow 单测（不碰 SQLite），与 tests/base-functions-leaf.test.ts 同款脚手架。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_RULES,
  DEFAULT_BASE_EXECUTION_LIMITS,
  MISSING,
  createFileValue,
  evaluateExpression,
  isDateValue,
  isDurationValue,
  parseDurationLike,
  toOutputValue,
  wrapValue,
  type BaseExpr,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseValue,
  type BaseValueObject,
} from "../src/base/index.js";
import { parseBaseExpression } from "../src/base/index.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

/** 固定注入时钟：2026-07-28T12:00:00Z。所有涉时函数用它，保证重跑字节一致。 */
const FIXED_NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const clock = (): Date => new Date(FIXED_NOW);

function makeRow(note: Record<string, unknown> = {}): BaseRow {
  return {
    note,
    file: createFileValue({
      name: "Note.md",
      basename: "Note",
      path: "Projects/Note.md",
      folder: "Projects",
      ext: ".md",
      size: 100,
      ctime: Date.UTC(2026, 0, 2, 3, 4, 5),
      mtime: Date.UTC(2026, 0, 2, 3, 4, 5),
      properties: wrapValue(note) as BaseValueObject,
      tags: [],
      links: [],
    }),
  };
}

function parse(src: string): BaseExpr {
  const r = parseBaseExpression(src, MAX_NODES);
  assert.deepEqual(r.errors, [], `解析应成功: ${src}`);
  assert.ok(r.expr !== undefined);
  return r.expr;
}

function run(
  src: string,
  row: BaseRow = makeRow(),
): { value: BaseValue; errors: BaseRowErrorInfo[] } {
  const errors: BaseRowErrorInfo[] = [];
  const value = evaluateExpression(parse(src), row, {
    limits: DEFAULT_BASE_EXECUTION_LIMITS,
    clock,
    onRowError: (e) => errors.push(e),
  });
  return { value, errors };
}

function ok(src: string, row: BaseRow = makeRow()): BaseValue {
  const { value, errors } = run(src, row);
  assert.deepEqual(errors, [], `不应有行级错误: ${src}`);
  return value;
}

function rowErr(src: string, rule: string, row: BaseRow = makeRow()): BaseRowErrorInfo {
  const { value, errors } = run(src, row);
  assert.equal(value, MISSING, `行级错误后应返回 MISSING: ${src}`);
  assert.equal(errors.length, 1, `应恰好上报一次: ${src}`);
  assert.equal(errors[0]?.rule, rule);
  return errors[0] as BaseRowErrorInfo;
}

// ---------------------------------------------------------------------------
// global date() / duration() 构造
// ---------------------------------------------------------------------------

test("BASE-TYPE-005: date() 严格 ISO 构造 + 幂等 + epoch number 扩展", () => {
  const d = ok('date("2026-08-10")');
  assert.ok(isDateValue(d));
  assert.deepEqual(toOutputValue(d), { type: "date", value: "2026-08-10" });
  // datetime 形态保精度
  assert.deepEqual(toOutputValue(ok('date("2026-08-10T09:30:00Z")')), {
    type: "datetime",
    value: "2026-08-10T09:30:00.000Z",
  });
  // 幂等：date(date(x)) == date(x)
  assert.equal(ok('date(date("2026-08-10")) == date("2026-08-10")'), true);
  // 与 frontmatter 推断同一集合：属性里能识别的，date() 也能构造
  assert.equal(ok('date(due) == date("2026-08-10")', makeRow({ due: "2026-08-10" })), true);
  // 自建扩展：number 按 epoch 毫秒 → datetime（让 date(file.ctime) 可用）
  assert.equal(ok('date(file.ctime).format("YYYY-MM-DD HH:mm:ss")'), "2026-01-02 03:04:05");
});

test("BASE-TYPE-005: date() 非严格形态一律行级类型错误，不猜", () => {
  for (const src of [
    'date("2026-8-10")', // 非补零
    'date("2026-13-01")', // 非法月份
    'date("2026-02-30")', // 非法日
    'date("08/10/2026")', // 非 ISO
    'date("2026-08-10T09:30:00.123Z")', // 带毫秒（值域推断本就不认）
    "date(true)",
    "date([1])",
    "date(null)",
  ]) {
    rowErr(src, BASE_RULES.propertyTypeMismatch);
  }
});

test("BASE-TYPE-005: duration() 长/短单位构造", () => {
  // 与既有 duration 字面量等价（1day 是词法层单 token，duration("1day") 走函数）
  assert.equal(ok('duration("1day") == 1day'), true);
  assert.equal(ok('duration("1 day") == 1day'), true);
  assert.equal(ok('duration("2 hours") == 2hours'), true);
  assert.equal(ok('duration("1.5weeks") == 1.5weeks'), true);
  // 官方短单位（大小写敏感：M=月、m=分）
  assert.equal(ok('duration("1d") == 1day'), true);
  assert.equal(ok('duration("3M") == 3months'), true);
  assert.equal(ok('duration("3m") == 3minutes'), true);
  assert.equal(ok('duration("3M") == duration("3m")'), false, "M 与 m 必须是两个量级");
  // 幂等 + number → 毫秒（与 toOutputValue 输出毫秒数互为逆，可往返）
  assert.equal(ok('duration(duration("1day")) == 1day'), true);
  assert.equal(ok("duration(86400000) == 1day"), true);
  assert.ok(isDurationValue(ok('duration("1day")')));
});

test("BASE-TYPE-005: duration() 歧义/不完整形态报错，不部分解析", () => {
  for (const src of [
    'duration("1D")', // 大写短单位不认（防 D/d 与 M/m 混淆）
    'duration("1Y")',
    'duration("1ms")', // 两字母非长单位名
    'duration("1")', // 无单位
    'duration("day")', // 无数值
    'duration("1d2h")', // 多段组合
    'duration("1 fortnight")',
    "duration(true)",
  ]) {
    rowErr(src, BASE_RULES.propertyTypeMismatch);
  }
});

test("parseDurationLike 单元口径（值层直调）", () => {
  assert.equal(parseDurationLike("1day")?.ms, 86_400_000);
  assert.equal(parseDurationLike("  2 hours  ")?.ms, 7_200_000);
  assert.equal(parseDurationLike("-1d")?.ms, -86_400_000, "负 duration 合法");
  assert.equal(parseDurationLike("1M")?.ms, 30 * 86_400_000, "month 固定 30 天");
  assert.equal(parseDurationLike("1y")?.ms, 365 * 86_400_000, "year 固定 365 天");
  assert.equal(parseDurationLike("1toString"), undefined, "不得命中 Object 原型键");
  assert.equal(parseDurationLike("1constructor"), undefined);
});

// ---------------------------------------------------------------------------
// date 方法组
// ---------------------------------------------------------------------------

test("BASE-TYPE-005: date.format 数字 token + 最长优先 + [字面量] 转义", () => {
  const row = makeRow({ ts: "2026-08-09T07:05:03Z" });
  assert.equal(ok('ts.format("YYYY-MM-DD")', row), "2026-08-09");
  assert.equal(ok('ts.format("YYYY/M/D H:m:s")', row), "2026/8/9 7:5:3");
  assert.equal(ok('ts.format("HH:mm:ss")', row), "07:05:03");
  assert.equal(ok('ts.format("YY")', row), "26");
  // 最长优先：YYYYMMDD 必须切成 YYYY+MM+DD，而不是当成一个未知 token
  assert.equal(ok('ts.format("YYYYMMDD")', row), "20260809");
  // [字面量] 转义（同 moment）
  assert.equal(ok('ts.format("[年]YYYY[月]MM")', row), "年2026月08");
  // 空格/分隔符原样透出
  assert.equal(ok('ts.format("")', row), "");
});

test("BASE-TYPE-005: date.format 拒绝本地化 token 与未闭合转义", () => {
  const row = makeRow({ ts: "2026-08-09" });
  // 月名/星期名/AM-PM 随界面语言变，不是稳定输出——报错而非静默给英文。
  // MMMM 尤其关键：按「最长已知 token 优先」扫描会切成 MM+MM 静默输出 "0808"，
  // 必须按同字符游程整体查表才会落到这条诊断。
  for (const fmt of ["MMMM", "dddd", "A", "Z", "x", "DDDD", "YYY"]) {
    const e = rowErr(`ts.format("${fmt}")`, BASE_RULES.propertyTypeMismatch, row);
    assert.match(e.message, /不支持的格式 token/u);
  }
  const e = rowErr('ts.format("[年")', BASE_RULES.propertyTypeMismatch, row);
  assert.match(e.message, /未闭合/u);
});

test("BASE-TYPE-005: date.time 返回当日 UTC 零点起的 duration", () => {
  const row = makeRow({ ts: "2026-08-09T07:05:03Z", d: "2026-08-09" });
  assert.equal(ok("ts.time() == 7hours + 5minutes + 3seconds", row), true);
  assert.equal(ok("d.time() == 0milliseconds", row), true, "date 精度的 time 恒为 0");
  assert.ok(isDurationValue(ok("ts.time()", row)));
  // 可比较：这正是选 duration 而非 "HH:mm" 字符串的理由
  assert.equal(ok("ts.time() < 12hours", row), true);
});

test("BASE-FORM-006: date.relative 走注入 clock，字节稳定", () => {
  // 注入 clock = 2026-07-28T12:00:00Z
  const past = makeRow({ ts: "2026-07-25T12:00:00Z" });
  assert.equal(ok("ts.relative()", past), "3 days ago");
  const future = makeRow({ ts: "2026-07-30T12:00:00Z" });
  assert.equal(ok("ts.relative()", future), "in 2 days");
  // 单复数
  assert.equal(ok("ts.relative()", makeRow({ ts: "2026-07-27T12:00:00Z" })), "1 day ago");
  assert.equal(ok("ts.relative()", makeRow({ ts: "2026-07-28T11:00:00Z" })), "1 hour ago");
  assert.equal(ok("ts.relative()", makeRow({ ts: "2026-07-28T11:59:59Z" })), "1 second ago");
  assert.equal(ok("ts.relative()", makeRow({ ts: "2026-07-28T12:00:00Z" })), "just now");
  // 阶梯上界：年 = 365 天（与值域 duration 固定约定同源）
  assert.equal(ok("ts.relative()", makeRow({ ts: "2025-07-28T12:00:00Z" })), "1 year ago");
  // 同一表达式两次求值恒等（字节稳定的最小验证）
  assert.equal(ok("ts.relative()", past), ok("ts.relative()", past));
});

test("BASE-TYPE-005: date.isEmpty 恒 false；缺失属性仍走 MISSING", () => {
  assert.equal(ok('date("2026-08-10").isEmpty()'), false);
  assert.equal(ok("missingProp.isEmpty()"), MISSING);
});

test("date 分派组不吞掉其它类型诊断，也不外露内部字段", () => {
  // date 组查不到的方法回退 any 组；再查不到 → 类型不支持
  const e = rowErr('date("2026-08-10").contains("x")', BASE_RULES.propertyTypeMismatch);
  assert.match(e.message, /类型 date 不支持方法 "contains"/u);
  // any 组回退未被新组破坏
  assert.equal(ok('date("2026-08-10").isTruthy()'), true);
  // 内部字段（epochMs/precision）不得因新增方法组而变得可访问
  rowErr('date("2026-08-10").epochMs', BASE_RULES.propertyTypeMismatch);
  // 非 date receiver 调 date 方法 → 类型不支持
  rowErr('"2026-08-10".format("YYYY")', BASE_RULES.propertyTypeMismatch);
});

/**
 * Bases `string.matches(pattern)` 与 ReDoS 防护测试
 * （2026-07-28 覆盖率片四，BASE-SEC-004；计划 docs/plans/2026-07-28-bases-functions.md）。
 *
 * 关键口径：Bases 侧**不静默降级**——非法/不安全正则一律行级 `base/invalid-regex`，
 * 与 DQL 侧 `regexmatch` 把非法正则当「不匹配」的策略有意不同（见 src/base/regexp.ts 文件头）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_RULES,
  DEFAULT_BASE_EXECUTION_LIMITS,
  MISSING,
  createFileValue,
  evaluateExpression,
  parseBaseExpression,
  wrapValue,
  type BaseExpr,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseValue,
  type BaseValueObject,
} from "../src/base/index.js";
import {
  BaseInvalidRegexError,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_SUBJECT_LENGTH,
  baseRegexTest,
  compileBaseRegex,
} from "../src/base/regexp.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

function makeRow(note: Record<string, unknown> = {}): BaseRow {
  return {
    note,
    file: createFileValue({
      name: "Note.md",
      basename: "Note",
      path: "Notes/Note.md",
      folder: "Notes",
      ext: ".md",
      size: 1,
      ctime: 0,
      mtime: 0,
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
// 匹配语义
// ---------------------------------------------------------------------------

test("BASE-EXPR-003: string.matches 子串命中语义（非整串锚定）", () => {
  assert.equal(ok('"hello world".matches("wor")'), true);
  assert.equal(ok('"hello world".matches("^hello")'), true);
  assert.equal(ok('"hello world".matches("^world")'), false);
  assert.equal(ok('"hello".matches("^hello$")'), true, "要整串锚定请自己写 ^…$");
  assert.equal(ok('"a1b2".matches("[0-9]")'), true);
  assert.equal(ok('"abc".matches("[0-9]")'), false);
  assert.equal(ok('"状态：进行中".matches("进行中")'), true);
  // 无 g flag：同一 pattern 连续两次匹配结果一致（有 lastIndex 状态会隔次失败）
  assert.equal(ok('"aaa".matches("a")'), true);
  assert.equal(ok('"aaa".matches("a")'), true);
});

test("BASE-EXPR-003: matches 的 receiver/参数类型诊断", () => {
  rowErr('5.matches("a")', BASE_RULES.propertyTypeMismatch);
  rowErr('"abc".matches(1)', BASE_RULES.propertyTypeMismatch);
  // 缺失属性 receiver 仍走既有 MISSING 传播（any 组无 matches）
  assert.equal(ok('missingProp.matches("a")'), MISSING);
});

// ---------------------------------------------------------------------------
// BASE-SEC-004：ReDoS 防护 —— 一律报诊断，绝不静默当「不匹配」
// ---------------------------------------------------------------------------

test("BASE-SEC-004: 非法正则报 base/invalid-regex，不静默不匹配", () => {
  const e = rowErr('"abc".matches("[")', BASE_RULES.invalidRegex);
  assert.match(e.message, /正则语法非法/u);
  assert.equal(e.target, "matches");
  rowErr('"abc".matches("(unclosed")', BASE_RULES.invalidRegex);
  rowErr('"abc".matches("a{2,1}")', BASE_RULES.invalidRegex);
});

test("BASE-SEC-004: 灾难性回溯构造静态拒绝（无界量词套无界量词/交替）", () => {
  for (const pattern of ["(a+)+$", "(a*)*b", "(a|a)*$", "(a|ab)+c", "(x+x+)+y"]) {
    const e = rowErr(`"aaaa".matches(${JSON.stringify(pattern)})`, BASE_RULES.invalidRegex);
    assert.match(e.message, /灾难性回溯/u, pattern);
  }
});

test("BASE-SEC-004: 正常正则不被误杀（外层量词有界 / 量词不作用于分组）", () => {
  assert.equal(ok('"123".matches("(\\\\d+)?")'), true, "外层 ? 有上界，不该被拒");
  assert.equal(ok('"foofoo".matches("(foo)+")'), true, "分组体内无量词无交替");
  assert.equal(ok('"a@b.com".matches("[a-z]+@[a-z]+")'), true, "量词不作用于分组");
  assert.equal(ok('"2026-07-28".matches("^\\\\d{4}-\\\\d{2}-\\\\d{2}$")'), true);
  assert.equal(ok('"ab".matches("(a|b){1,3}")'), true, "有界重复的交替组放行");
});

test("BASE-SEC-004: 反向引用一律拒绝（强制回溯）", () => {
  const e = rowErr('"aa".matches("(a)\\\\1")', BASE_RULES.invalidRegex);
  assert.match(e.message, /反向引用/u);
  // `\\1`（转义反斜杠 + 字面 1）不是反向引用，不得误杀
  assert.equal(ok('"a\\\\1".matches("\\\\\\\\1")'), true);
});

test("BASE-SEC-004: pattern / 被匹配字符串限长", () => {
  const longPattern = "a".repeat(MAX_REGEX_PATTERN_LENGTH + 1);
  const e = rowErr(`"x".matches(${JSON.stringify(longPattern)})`, BASE_RULES.invalidRegex);
  assert.match(e.message, /正则源长度/u);
  // 被匹配串超长（走值层直调，表达式里塞 10k 字符不现实）
  assert.throws(
    () => baseRegexTest("a", "b".repeat(MAX_REGEX_SUBJECT_LENGTH + 1)),
    (err: unknown) => err instanceof BaseInvalidRegexError && /被匹配字符串长度/u.test(String(err)),
  );
  assert.equal(baseRegexTest("b", "b".repeat(MAX_REGEX_SUBJECT_LENGTH)), true, "刚好等于上限放行");
});

test("compileBaseRegex 缓存有界且不改变语义（值层直调）", () => {
  // 同一 pattern 重复编译返回同一实例（缓存命中）
  assert.equal(compileBaseRegex("^ab"), compileBaseRegex("^ab"));
  // 超过缓存上限后整表清空，行为不变（只验语义，不断言实例同一性）
  for (let i = 0; i < 200; i += 1) compileBaseRegex(`^p${i}x`);
  assert.equal(baseRegexTest("^ab", "abc"), true);
  assert.equal(baseRegexTest("^ab", "xabc"), false);
});

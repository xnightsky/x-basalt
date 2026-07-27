/**
 * Bases 机械叶子函数测试（2026-07-28 覆盖率片一，计划 docs/plans/2026-07-28-bases-functions.md）。
 *
 * 覆盖：string 组 replace/repeat/reverse/slice/split/title/isEmpty（BASE-EXPR-003）、
 * 新增 number 分派组 abs/ceil/floor/toFixed/isEmpty + round 迁组（BASE-EXPR-005）、
 * list 组 reverse/slice（BASE-EXPR-004）、global max/min（BASE-EXPR-005）、
 * 渲染类四函数的 base/unsupported-feature 拒绝、以及产物规模预算（SEC-005 延伸）。
 *
 * 合成 BaseRow 单测（不碰 SQLite），与 tests/base-evaluator.test.ts 同款脚手架。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_FUNCTION_NAMES,
  BASE_RULES,
  DEFAULT_BASE_EXECUTION_LIMITS,
  MISSING,
  createFileValue,
  evaluateExpression,
  isBaseBudgetError,
  parseBaseExpression,
  wrapValue,
  type BaseExecutionLimits,
  type BaseExpr,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseValue,
  type BaseValueObject,
} from "../src/base/index.js";
import { BASE_FUNCTION_REGISTRY } from "../src/base/functions.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

/** 合成一行：note 为 frontmatter 原始对象；file.properties 与 note 同源。 */
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
      ctime: 1_700_000_000_000,
      mtime: 1_700_000_100_000,
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
  limits: BaseExecutionLimits = DEFAULT_BASE_EXECUTION_LIMITS,
): { value: BaseValue; errors: BaseRowErrorInfo[] } {
  const errors: BaseRowErrorInfo[] = [];
  const value = evaluateExpression(parse(src), row, { limits, onRowError: (e) => errors.push(e) });
  return { value, errors };
}

/** 求值必须成功且无行级错误。 */
function ok(src: string, row: BaseRow = makeRow()): BaseValue {
  const { value, errors } = run(src, row);
  assert.deepEqual(errors, [], `不应有行级错误: ${src}`);
  return value;
}

/** 求值必须产一条指定 rule 的行级错误，且按契约返回 MISSING。 */
function rowErr(src: string, rule: string, row: BaseRow = makeRow()): BaseRowErrorInfo {
  const { value, errors } = run(src, row);
  assert.equal(value, MISSING, `行级错误后应返回 MISSING: ${src}`);
  assert.equal(errors.length, 1, `应恰好上报一次: ${src}`);
  assert.equal(errors[0]?.rule, rule);
  return errors[0] as BaseRowErrorInfo;
}

// ---------------------------------------------------------------------------
// string 组（BASE-EXPR-003）
// ---------------------------------------------------------------------------

test("BASE-EXPR-003: string.replace 字面子串全局替换（非 regex，$& 不展开）", () => {
  assert.equal(ok('"a-b-c".replace("-", "+")'), "a+b+c"); // 全局，非只替换首个
  assert.equal(ok('"abc".replace("x", "y")'), "abc"); // 未命中原样返回
  // 替换文本内的 `$&`/`$1` 保持字面量（split/join 实现的可观察后果，非 replaceAll 展开）
  assert.equal(ok('"ab".replace("a", "$&z")'), "$&zb");
  // 被替换子串为空串 → 类型错误（不提供 JS「每字符间插入」的反直觉行为）
  assert.equal(rowErr('"ab".replace("", "x")', BASE_RULES.propertyTypeMismatch).target, "replace");
  // 参数须为 string
  rowErr('"ab".replace(1, "x")', BASE_RULES.propertyTypeMismatch);
});

test("BASE-EXPR-003: string.repeat 非负整数 + 分配前预检", () => {
  assert.equal(ok('"ab".repeat(3)'), "ababab");
  assert.equal(ok('"ab".repeat(0)'), "");
  rowErr('"ab".repeat(-1)', BASE_RULES.propertyTypeMismatch);
  rowErr('"ab".repeat(1.5)', BASE_RULES.propertyTypeMismatch);
  rowErr('"ab".repeat("3")', BASE_RULES.propertyTypeMismatch);
  // 超预算在**构造之前**被拦（1e9 字符若先分配会 OOM）：抛 BaseBudgetError 上抛，不转行级
  assert.throws(
    () => run('"ab".repeat(1000000000)'),
    (e: unknown) => isBaseBudgetError(e),
  );
});

test("BASE-EXPR-003: string.reverse 按 code point 反转（不拆代理对）", () => {
  assert.equal(ok('"abc".reverse()'), "cba");
  assert.equal(ok('"".reverse()'), "");
  // 代理对（U+1F600）整体搬运：按 UTF-16 code unit 反转会产出非法字符串
  const reversed = ok('"a😀b".reverse()');
  assert.equal(reversed, "b😀a");
  assert.equal(ok('"状态ab".reverse()'), "ba态状");
});

test("BASE-EXPR-003: string.slice 负索引/越界钳制沿用 JS 语义", () => {
  assert.equal(ok('"abcdef".slice(2)'), "cdef");
  assert.equal(ok('"abcdef".slice(1, 3)'), "bc");
  assert.equal(ok('"abcdef".slice(-2)'), "ef");
  assert.equal(ok('"abcdef".slice(2, -1)'), "cde");
  assert.equal(ok('"abcdef".slice(10)'), ""); // 越界钳制，不报错
  assert.equal(ok('"abcdef".slice(3, 1)'), ""); // end < start
  rowErr('"abc".slice(1.5)', BASE_RULES.propertyTypeMismatch);
  rowErr('"abc".slice("1")', BASE_RULES.propertyTypeMismatch);
});

test("BASE-EXPR-003: string.split 返回 list（空分隔符逐 code unit）", () => {
  assert.deepEqual(ok('"a,b,c".split(",")'), ["a", "b", "c"]);
  assert.deepEqual(ok('"abc".split("")'), ["a", "b", "c"]);
  assert.deepEqual(ok('"abc".split("-")'), ["abc"]); // 未命中 → 单元素
  assert.deepEqual(ok('"".split(",")'), [""]);
  rowErr('"a,b".split(1)', BASE_RULES.propertyTypeMismatch);
});

test("BASE-EXPR-003: string.title 词首大写词余小写（暂定口径，待 oracle）", () => {
  assert.equal(ok('"hello world".title()'), "Hello World");
  assert.equal(ok('"HELLO wORLD".title()'), "Hello World"); // 词余强制小写
  assert.equal(ok('"  a  b  ".title()'), "  A  B  "); // 空白原样保留
  assert.equal(ok('"".title()'), "");
  // 幂等：title(title(x)) == title(x)
  assert.equal(ok('"foo bar".title().title()'), "Foo Bar");
});

test("BASE-EXPR-003: string.isEmpty 只看长度（不 trim）", () => {
  assert.equal(ok('"".isEmpty()'), true);
  assert.equal(ok('" ".isEmpty()'), false);
  assert.equal(ok('"a".isEmpty()'), false);
});

// ---------------------------------------------------------------------------
// number 分派组（BASE-EXPR-005）——本片新增组，此前 number 只能命中 "any" 组
// ---------------------------------------------------------------------------

test("BASE-EXPR-005: number 组 abs/ceil/floor 可分派", () => {
  assert.equal(ok("(0 - 3).abs()"), 3);
  assert.equal(ok("3.abs()"), 3);
  assert.equal(ok("1.2.ceil()"), 2);
  assert.equal(ok("1.8.floor()"), 1);
  assert.equal(ok("(0 - 1.2).ceil()"), -1);
  assert.equal(ok("(0 - 1.2).floor()"), -2);
});

test("BASE-EXPR-005: number.toFixed 返回 string 且 digits 受 JS 定义域约束", () => {
  assert.equal(ok("1.005.toFixed(2)"), "1.00"); // IEEE 754 边界原样暴露，不做十进制修正
  assert.equal(ok("2.5.toFixed()"), "3");
  assert.equal(ok("1.0.toFixed(3)"), "1.000");
  assert.equal(typeof ok("1.0.toFixed(1)"), "string"); // 与 round 返 number 区分
  rowErr("1.0.toFixed(101)", BASE_RULES.propertyTypeMismatch); // 越界前置拦成行级错误
  rowErr("1.0.toFixed(-1)", BASE_RULES.propertyTypeMismatch);
});

test("BASE-EXPR-005: number.isEmpty 恒 false（0 是有值的 0）", () => {
  assert.equal(ok("0.isEmpty()"), false);
  assert.equal(ok("1.isEmpty()"), false);
  // 属性缺失走既有 MISSING 传播路径（any 组无 isEmpty → 返回 MISSING），不由 number 组覆盖
  assert.equal(ok("missingProp.isEmpty()"), MISSING);
});

test("BASE-SUM-001: round 迁入 number 组后语义不变、非 number receiver 报类型不支持", () => {
  assert.equal(ok("1.2345.round(2)"), 1.23);
  assert.equal(ok("1.5.round()"), 2);
  // 迁组后的可观察变化：rule 不变，message 由「参数类型错误」变为「类型 X 不支持方法」
  const e = rowErr('"x".round()', BASE_RULES.propertyTypeMismatch);
  assert.match(e.message, /类型 string 不支持方法 "round"/u);
});

test("BASE-EXPR-005: number 组不吞掉非 number 方法的类型诊断", () => {
  // number 有独立分派组后，`5.contains("a")` 仍须落「类型不支持」而非命中 string 实现
  const e = rowErr('5.contains("a")', BASE_RULES.propertyTypeMismatch);
  assert.match(e.message, /类型 number 不支持方法 "contains"/u);
  // any 组回退未被新组破坏
  assert.equal(ok("5.toString()"), "5");
  assert.equal(ok('5.isType("number")'), true);
});

// ---------------------------------------------------------------------------
// list 组（BASE-EXPR-004）
// ---------------------------------------------------------------------------

test("BASE-EXPR-004: list.reverse 返回新列表，不原地改 receiver", () => {
  assert.deepEqual(ok("[1, 2, 3].reverse()"), [3, 2, 1]);
  assert.deepEqual(ok("[].reverse()"), []);
  // 关键不变量：receiver 可能是行的 note 属性数组，原地 reverse 会污染行状态
  const row = makeRow({ items: [1, 2, 3] });
  assert.deepEqual(ok("items.reverse()", row), [3, 2, 1]);
  assert.deepEqual(ok("items", row), [1, 2, 3], "reverse 不得改动行上的原数组");
  assert.deepEqual(row.note["items"], [1, 2, 3], "原始 frontmatter 对象同样不得被改动");
});

test("BASE-EXPR-004: list.slice 与 string.slice 同口径", () => {
  assert.deepEqual(ok("[1, 2, 3, 4].slice(1)"), [2, 3, 4]);
  assert.deepEqual(ok("[1, 2, 3, 4].slice(1, 3)"), [2, 3]);
  assert.deepEqual(ok("[1, 2, 3, 4].slice(-2)"), [3, 4]);
  assert.deepEqual(ok("[1, 2].slice(9)"), []);
  rowErr("[1, 2].slice(1.5)", BASE_RULES.propertyTypeMismatch);
  // 同名不同组：string 与 list 各有独立实现，互不串（registry 键为 receiver:name）
  assert.equal(ok('"1234".slice(1, 3)'), "23");
});

// ---------------------------------------------------------------------------
// global max / min（BASE-EXPR-005）
// ---------------------------------------------------------------------------

test("BASE-EXPR-005: max/min 变长 number 参数", () => {
  assert.equal(ok("max(1, 5, 3)"), 5);
  assert.equal(ok("min(1, 5, 3)"), 1);
  assert.equal(ok("max(7)"), 7); // 单参
  assert.equal(ok("min(0 - 2, 0 - 5)"), -5);
  // 不收单个 list 参（官方签名是变长数值；不外扩 containsAll 那种糖）
  rowErr("max([1, 2])", BASE_RULES.propertyTypeMismatch);
  rowErr('max(1, "2")', BASE_RULES.propertyTypeMismatch);
  // arity 0 由 evaluator 先验拦下
  rowErr("max()", BASE_RULES.propertyTypeMismatch);
});

// ---------------------------------------------------------------------------
// 渲染类：白名单内但显式拒绝
// ---------------------------------------------------------------------------

test("渲染类函数报 base/unsupported-feature 而非 unknown-function", () => {
  for (const src of ['html("<b>x</b>")', 'image("a.png")', 'icon("check")', "html()"]) {
    const e = rowErr(src, BASE_RULES.unsupportedFeature);
    assert.match(e.message, /无头查询内核/u);
  }
  const e = rowErr('"<b>".escapeHTML()', BASE_RULES.unsupportedFeature);
  assert.equal(e.target, "escapeHTML");
  // escapeHTML 挂 string 组：非 string receiver 仍应得「类型不支持」这条正确诊断
  const mismatch = rowErr("5.escapeHTML()", BASE_RULES.propertyTypeMismatch);
  assert.match(mismatch.message, /类型 number 不支持方法 "escapeHTML"/u);
});

test("random() 显式拒绝：与字节稳定保证冲突（2026-07-28 用户拍板）", () => {
  const e = rowErr("random()", BASE_RULES.unsupportedFeature);
  assert.equal(e.target, "random");
  assert.match(e.message, /字节稳定/u);
  // 拒绝理由与渲染类不同：诊断消息必须说清是「契约冲突」而非「不渲染」
  assert.doesNotMatch(e.message, /渲染/u);
});

test("渲染类函数名进白名单：文法/浅扫描不再报 unknown-function", () => {
  for (const name of ["html", "image", "icon", "escapeHTML", "random"]) {
    assert.ok(BASE_FUNCTION_NAMES.has(name), `${name} 应在名字单一真相源内`);
  }
  // 白名单外的名字仍被浅扫描拒绝（不因本片放宽）
  assert.ok(!BASE_FUNCTION_NAMES.has("markdown"));
});

// ---------------------------------------------------------------------------
// 注册表一致性（模块加载期自检的可读版断言）
// ---------------------------------------------------------------------------

/** 某函数名在注册表里的全部挂载组（升序，供同名多组断言）。 */
function groupsOf(name: string): string[] {
  return BASE_FUNCTION_REGISTRY.filter((e) => e.name === name)
    .map((e) => e.receiver)
    .toSorted();
}

test("注册表与名字真相源一一对齐，且同名多组各自独立", () => {
  const names = new Set(BASE_FUNCTION_REGISTRY.map((e) => e.name));
  assert.deepEqual(
    [...BASE_FUNCTION_NAMES].filter((n) => !names.has(n)),
    [],
    "BASE_FUNCTION_NAMES 中每个名字都必须有注册项",
  );
  assert.deepEqual(
    [...names].filter((n) => !BASE_FUNCTION_NAMES.has(n)),
    [],
    "注册表不得有名字真相源之外的条目",
  );
  // 同名多组：slice/reverse 各有 string+list 两组，isEmpty 有 string/number/list/object 四组
  assert.deepEqual(groupsOf("slice"), ["list", "string"]);
  assert.deepEqual(groupsOf("reverse"), ["list", "string"]);
  assert.deepEqual(groupsOf("isEmpty"), ["list", "number", "object", "string"]);
  assert.deepEqual(groupsOf("round"), ["number"]);
});

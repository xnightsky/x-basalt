/**
 * Bases 无头引擎 P1 求值层测试：值语义 + 函数白名单 + 预算解释器。
 *
 * 合成 BaseRow（不碰 SQLite）单测；每号独立用例（注释标编号，可追溯至
 * docs/testing/2026-07-22-bases-scenario-matrix.md §4/§7）：
 * BASE-EXPR-001/003/004/005、BASE-FILE-002/003/004/005、BASE-PROP-001/002/003（求值半段）、
 * BASE-PROP-004（暂定口径锁定，待 oracle）、BASE-SEC-001（求值层）、预算（operations/collection）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
  type BaseFileValue,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseValue,
  type BaseValueObject,
} from "../src/base/index.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

/** 合成 file 运行时值（测试默认值覆盖即可）。 */
function makeFile(over: Partial<Parameters<typeof createFileValue>[0]> = {}): BaseFileValue {
  return createFileValue({
    name: "Note.md",
    basename: "Note",
    path: "Projects/Note.md",
    folder: "Projects",
    ext: ".md",
    size: 100,
    ctime: 1_700_000_000_000,
    mtime: 1_700_000_100_000,
    properties: {},
    tags: [],
    links: [],
    ...over,
  });
}

/** 合成一行：note 为 frontmatter 原始对象；file.properties 与 note 同源（经 wrapValue 包装）。 */
function makeRow(
  note: Record<string, unknown> = {},
  fileOver: Partial<Parameters<typeof createFileValue>[0]> = {},
): BaseRow {
  return {
    note,
    file: makeFile({ properties: wrapValue(note) as BaseValueObject, ...fileOver }),
  };
}

/** 解析必须成功（求值层测试不覆盖文法错误，解析失败即测试写错）。 */
function parse(src: string): BaseExpr {
  const r = parseBaseExpression(src, MAX_NODES);
  assert.deepEqual(r.errors, [], `解析应成功: ${src}`);
  assert.ok(r.expr !== undefined);
  return r.expr;
}

interface EvalOutcome {
  value: BaseValue;
  errors: BaseRowErrorInfo[];
}

/** 求值并收集行级错误（不 throw 行级错误；预算错误仍 throw）。 */
function run(
  src: string,
  row: BaseRow = makeRow(),
  limits: BaseExecutionLimits = DEFAULT_BASE_EXECUTION_LIMITS,
): EvalOutcome {
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

// BASE-EXPR-001：比较运算允许组合正确、类型错误明确
test("BASE-EXPR-001: ==/!= typed equality（数字 ≠ 数字字符串，list 递归）", () => {
  assert.equal(ok("1 == 1"), true);
  assert.equal(ok('1 == "1"'), false); // 数字不与数字字符串隐式相等（设计 §8.3）
  assert.equal(ok("true == 1"), false);
  assert.equal(ok("null == null"), true);
  assert.equal(ok("[1, [2, 3]] == [1, [2, 3]]"), true); // list 元素递归
  assert.equal(ok('[1] == ["1"]'), false);
  assert.equal(ok("[1, 2] != [1, 3]"), true);
  const row = makeRow({ a: { x: 1, y: [2] }, b: { y: [2], x: 1 } });
  assert.equal(ok("a == b", row), true); // key 顺序无关
});

test("BASE-EXPR-001: < > <= >= 数值与字符串（ISO 日期字符串可比较）", () => {
  assert.equal(ok("1 < 2"), true);
  assert.equal(ok("2 <= 2"), true);
  assert.equal(ok("3 > 2"), true);
  assert.equal(ok("3 >= 4"), false);
  assert.equal(ok('"a" < "b"'), true);
  // P1 无 Date 类型：ISO 日期字符串按 UTF-16 code unit 字典序可比较
  assert.equal(ok('"2026-01-01" < "2026-01-02"'), true);
  assert.equal(ok('"2026-12-31" > "2026-01-01"'), true);
});

test('BASE-EXPR-001: 类型错误明确（1 < "a"、boolean/list 不参与有序比较）', () => {
  const e1 = rowErr('1 < "a"', BASE_RULES.propertyTypeMismatch);
  assert.match(e1.message, /有序比较/);
  rowErr("true < false", BASE_RULES.propertyTypeMismatch);
  rowErr("[1] < [2]", BASE_RULES.propertyTypeMismatch);
  rowErr("null < 1", BASE_RULES.propertyTypeMismatch);
});

// BASE-EXPR-003：string 方法
test("BASE-EXPR-003: string contains/containsAll/containsAny/startsWith/endsWith/lower/trim", () => {
  const row = makeRow({ s: "  Hello World  " });
  assert.equal(ok('s.contains("World")', row), true);
  assert.equal(ok('s.contains("world")', row), false); // contains 大小写敏感
  assert.equal(ok('s.containsAll("Hello", "World")', row), true);
  assert.equal(ok('s.containsAll(["Hello", "Nope"])', row), false); // 单 list 参数形态
  assert.equal(ok('s.containsAny("Nope", "World")', row), true);
  assert.equal(ok('s.containsAny(["Nope"])', row), false);
  assert.equal(ok('s.trim().startsWith("Hello")', row), true); // 方法链
  assert.equal(ok('s.trim().endsWith("World")', row), true);
  assert.equal(ok('s.lower().contains("hello")', row), true);
  assert.equal(ok("s.trim()", row), "Hello World");
});

test("BASE-EXPR-003: string 方法参数类型错误明确", () => {
  rowErr("s.contains(1)", BASE_RULES.propertyTypeMismatch, makeRow({ s: "a" }));
  rowErr('s.containsAll("a", 2)', BASE_RULES.propertyTypeMismatch, makeRow({ s: "a" }));
  rowErr("n.contains(1)", BASE_RULES.propertyTypeMismatch, makeRow({ n: 5 })); // number 无 contains
});

// BASE-EXPR-004：list/object 方法
test("BASE-EXPR-004: list contains/containsAll/containsAny 用 typed equality", () => {
  const row = makeRow({ xs: [1, "a", null] });
  assert.equal(ok("xs.contains(1)", row), true);
  assert.equal(ok('xs.contains("1")', row), false); // typed equality：数字 ≠ 数字字符串
  assert.equal(ok("xs.contains(null)", row), true);
  assert.equal(ok("xs.containsAll(1, null)", row), true);
  assert.equal(ok('xs.containsAll([1, "missing"])', row), false);
  assert.equal(ok('xs.containsAny("missing", "a")', row), true);
  assert.equal(ok("[].containsAny([])", row), false); // 空 needle 集：any=false（自建冻结口径）
  assert.equal(ok("xs.containsAll([])", row), true); // 空 needle 集：all=true
});

test("BASE-EXPR-004: isEmpty（list/object）与 keys/values", () => {
  const row = makeRow({ xs: [], ys: [1], obj: { a: 1, b: 2 }, empty: {} });
  assert.equal(ok("xs.isEmpty()", row), true);
  assert.equal(ok("ys.isEmpty()", row), false);
  assert.equal(ok("obj.isEmpty()", row), false);
  assert.equal(ok("empty.isEmpty()", row), true);
  assert.deepEqual(ok("obj.keys()", row), ["a", "b"]);
  assert.deepEqual(ok("obj.values()", row), [1, 2]);
  rowErr("xs.keys()", BASE_RULES.propertyTypeMismatch, row); // list 无 keys 方法
});

// BASE-EXPR-005：if / list / number
test("BASE-EXPR-005: if 三分支与 lazy（未选分支不求值，暂定待 oracle）", () => {
  const row = makeRow({ status: "done" });
  assert.equal(ok('if(status == "done", "yes", "no")', row), "yes");
  assert.equal(ok('if(status == "todo", "yes", "no")', row), "no");
  // lazy 证明：未选分支含必然类型错误（1 < "a"），若被求值会上报行级错误
  assert.equal(ok('if(false, 1 < "a", "ok")', row), "ok");
  assert.equal(ok('if(true, "ok", 1 < "a")', row), "ok");
});

test("BASE-EXPR-005: arity 错误明确", () => {
  rowErr("if(true, 1)", BASE_RULES.propertyTypeMismatch);
  rowErr("number(1, 2)", BASE_RULES.propertyTypeMismatch);
  rowErr("s.trim(1)", BASE_RULES.propertyTypeMismatch, makeRow({ s: "a" }));
});

test("BASE-EXPR-005: number 转换与失败冻结为行级类型错误", () => {
  assert.equal(ok("number(42)"), 42);
  assert.equal(ok('number("3.5")'), 3.5);
  assert.equal(ok('number(" 42 ")'), 42); // trim 后整体可解析
  assert.equal(ok('number("-7")'), -7);
  rowErr('number("12px")', BASE_RULES.propertyTypeMismatch);
  rowErr('number("")', BASE_RULES.propertyTypeMismatch);
  rowErr("number(true)", BASE_RULES.propertyTypeMismatch);
  rowErr("number(null)", BASE_RULES.propertyTypeMismatch);
  rowErr("number([1])", BASE_RULES.propertyTypeMismatch);
});

test("BASE-EXPR-005: list(...) 构造与 isType/toString", () => {
  assert.deepEqual(ok('list(1, "a", null)'), [1, "a", null]);
  assert.deepEqual(ok("list()"), []);
  // isType/isTruthy/toString 属 any 方法组（设计 §9），按方法形态调用
  const row = makeRow({ s: "a", n: 1, xs: [1], nil: null, b: true });
  assert.equal(ok('s.isType("string")', row), true);
  assert.equal(ok('n.isType("string")', row), false);
  assert.equal(ok('xs.isType("list")', row), true);
  assert.equal(ok('nil.isType("null")', row), true);
  rowErr('n.isType("date")', BASE_RULES.propertyTypeMismatch, row); // 未知类型名 → 类型错误
  assert.equal(ok("s.toString()", row), "a");
  assert.equal(ok("n.toString()", row), "1");
  assert.equal(ok("b.toString()", row), "true");
  assert.equal(ok("nil.toString()", row), ""); // null → ""（P1 冻结口径）
  rowErr("xs.toString()", BASE_RULES.propertyTypeMismatch, row); // list 不支持 toString
});

// BASE-FILE-002：inFolder
test("BASE-FILE-002: inFolder 命中目录本身及子目录、不命中前缀同名目录", () => {
  const sub = makeRow({}, { folder: "Projects/Sub" });
  assert.equal(ok('file.inFolder("Projects")', sub), true); // 父目录命中
  assert.equal(ok('file.inFolder("Projects/Sub")', sub), true); // 目录本身命中
  assert.equal(ok('file.inFolder("Projects2")', sub), false); // 前缀同名不命中
  assert.equal(ok('file.inFolder("projects")', sub), false); // 大小写敏感（口径固定）
  const direct = makeRow({}, { folder: "Projects" });
  assert.equal(ok('file.inFolder("Projects")', direct), true);
  assert.equal(ok('file.inFolder("Projects/Sub")', direct), false);
});

// BASE-FILE-003：hasTag
test("BASE-FILE-003: hasTag 精确或嵌套前缀、大小写不敏感", () => {
  const row = makeRow({}, { tags: ["area", "area/x", "Work"] });
  assert.equal(ok('file.hasTag("area")', row), true); // 精确
  assert.equal(ok('file.hasTag("AREA")', row), true); // 大小写不敏感（口径固定）
  assert.equal(ok('file.hasTag("area/x")', row), true); // 嵌套完整路径
  assert.equal(ok('file.hasTag("work")', row), true);
  assert.equal(ok('file.hasTag("are")', row), false); // 非 `/` 边界前缀不命中
  assert.equal(ok('file.hasTag("x")', row), false); // 嵌套尾部不反向命中
  assert.equal(ok('file.hasTag("missing")', row), false);
});

// BASE-FILE-004：hasProperty
test("BASE-FILE-004: hasProperty 只判键存在，不把 falsy 值当缺失", () => {
  const row = makeRow({ status: false, zero: 0, empty: "", n: null });
  assert.equal(ok('file.hasProperty("status")', row), true); // false 不误判缺失
  assert.equal(ok('file.hasProperty("zero")', row), true);
  assert.equal(ok('file.hasProperty("empty")', row), true);
  assert.equal(ok('file.hasProperty("n")', row), true); // 显式 null 也算存在
  assert.equal(ok('file.hasProperty("missing")', row), false);
  assert.equal(ok('file.hasProperty("__proto__")', row), false); // 禁键视为不存在
});

// BASE-FILE-005：hasLink（qualified/bare 两分支独立）
test("BASE-FILE-005: hasLink bare 分支（linkKey 小写 basename 匹配）", () => {
  const row = makeRow({}, { links: ["Folder/Target.md", "Other"] });
  assert.equal(ok('file.hasLink("Target")', row), true); // basename + 去扩展名
  assert.equal(ok('file.hasLink("target")', row), true); // 大小写不敏感
  assert.equal(ok('file.hasLink("Target.md")', row), true); // 可带扩展名
  assert.equal(ok('file.hasLink("Other")', row), true);
  assert.equal(ok('file.hasLink("Missing")', row), false);
});

test("BASE-FILE-005: hasLink qualified 分支（含 / 时 pathKey 精确匹配）", () => {
  const row = makeRow({}, { links: ["Folder/Target.md", "Archive/Target.md"] });
  assert.equal(ok('file.hasLink("Folder/Target")', row), true);
  assert.equal(ok('file.hasLink("folder/target")', row), true); // pathKey 小写
  assert.equal(ok('file.hasLink("Archive/Target")', row), true); // 同名异目录各自命中
  assert.equal(ok('file.hasLink("Other/Target")', row), false); // 不串味
  assert.equal(ok('file.hasLink("Target")', row), true); // bare 回退仍按 basename
});

// BASE-PROP-001/002/003（求值半段）
test("BASE-PROP-001: status 与 note.status 同义", () => {
  const row = makeRow({ status: "done" });
  assert.equal(ok("status", row), "done");
  assert.equal(ok("note.status", row), "done");
  assert.equal(ok("status == note.status", row), true);
});

test('BASE-PROP-002: note["Review Status"] 带空格属性可访问', () => {
  const row = makeRow({ "Review Status": "ok" });
  assert.equal(ok('note["Review Status"]', row), "ok");
});

test("BASE-PROP-003: Unicode 属性名可读取", () => {
  const row = makeRow({ 状态: "好" });
  assert.equal(ok("状态", row), "好");
  assert.equal(ok('note["状态"]', row), "好");
  assert.equal(ok('file.hasProperty("状态")', row), true);
});

// BASE-PROP-004（oracle runbook ① · §4.1，Obsidian 1.12.7 实测冻结）：
// equality 上 **MISSING 与 null 合并**——`X == null` 对「没有该属性」的行同样成立。
// 此前实现区分二者（`missing == null` 为 false），会静默少算行；区分能力保留在 hasProperty。
test("BASE-PROP-004(oracle ①): missing == null 为真，键存在性仍可区分", () => {
  const row = makeRow({ n: null });
  assert.equal(ok("n == null", row), true); // 显式 null
  assert.equal(ok("missing == null", row), true); // ← 合并：缺失属性也判 true
  assert.equal(ok("missing != null", row), false); // != 是 == 的取反，一并翻转
  assert.equal(ok("missing == missing2", row), true); // 两个缺失属性相等
  assert.equal(ok("n == missing", row), true); // 显式 null 与缺失相等
  // 区分二者的唯一入口是键存在性（不受值是不是 null 影响）。
  assert.equal(ok('file.hasProperty("n")', row), true);
  assert.equal(ok('file.hasProperty("missing")', row), false);
  // isType("null") **有意不跟随**：官方观察只覆盖 `==`，未覆盖 isType，不外推。
  assert.equal(ok('n.isType("null")', row), true);
  assert.equal(ok('missing.isType("null")', row), false);
  assert.equal(ok("missing.deep.path", row), MISSING); // MISSING 传播不报错
  assert.equal(ok('missing.contains("a")', row), MISSING); // MISSING 上方法调用传播
});

// BASE-PROP-004：truthiness 暂定口径锁定（待 oracle）
test("BASE-PROP-004: truthiness 暂定 falsy 六项 + truthy 反例（待 oracle）", () => {
  const row = makeRow({
    n: null,
    f: false,
    zero: 0,
    empty: "",
    xs: [],
    one: 1,
    s: "a",
    ys: [0],
    obj: {},
  });
  // falsy 六项：MISSING / null / false / 0 / "" / 空列表
  assert.equal(ok("!missing", row), true);
  assert.equal(ok("!n", row), true);
  assert.equal(ok("!f", row), true);
  assert.equal(ok("!zero", row), true);
  assert.equal(ok("!empty", row), true);
  assert.equal(ok("!xs", row), true);
  // truthy 反例：非零数 / 非空串 / 非空列表（含 falsy 元素也算非空）/ 空对象
  assert.equal(ok("!one", row), false);
  assert.equal(ok("!s", row), false);
  assert.equal(ok("!ys", row), false);
  assert.equal(ok("!obj", row), false);
  assert.equal(ok("missing.isTruthy()", row), false);
  assert.equal(ok("one.isTruthy()", row), true);
});

test("BASE-EXPR-002 求值半段: && / || 短路（另一侧类型错误不触发）", () => {
  assert.equal(ok('false && (1 < "a")'), false);
  assert.equal(ok('true || (1 < "a")'), true);
  const { value, errors } = run('true && (1 < "a")');
  assert.equal(value, MISSING); // 非短路侧仍求值，类型错误按契约返回 MISSING
  assert.equal(errors.length, 1);
});

// BASE-SEC-001：属性访问白名单拒绝（求值层）
test("BASE-SEC-001: __proto__/constructor/prototype 与 index 形态全部拒绝", () => {
  const row = makeRow({ x: { a: 1 } });
  const e1 = rowErr("x.__proto__", BASE_RULES.unknownProperty, row);
  assert.match(e1.message, /安全白名单拒绝/);
  rowErr("x.constructor", BASE_RULES.unknownProperty, row);
  rowErr("x.prototype", BASE_RULES.unknownProperty, row);
  rowErr('x["constructor"]', BASE_RULES.unknownProperty, row); // index 形态同款拒绝
  rowErr("constructor", BASE_RULES.unknownProperty, row); // note 根层禁键
});

// file property 读取与未知属性
test("file property 清单读取 + 未知 file 属性行级错误", () => {
  const row = makeRow({ s: 1 }, { size: 42 });
  assert.equal(ok("file.name", row), "Note.md");
  assert.equal(ok("file.basename", row), "Note");
  assert.equal(ok("file.path", row), "Projects/Note.md");
  assert.equal(ok("file.folder", row), "Projects");
  assert.equal(ok("file.ext", row), ".md");
  assert.equal(ok("file.size", row), 42);
  assert.equal(ok("file.ctime", row), 1_700_000_000_000);
  assert.equal(ok("file.properties.s", row), 1);
  assert.deepEqual(ok("file.tags", makeRow({}, { tags: ["a"] })), ["a"]);
  const e = rowErr("file.foo", BASE_RULES.unknownProperty, row);
  assert.equal(e.target, "foo");
  rowErr("formula.x", BASE_RULES.unsupportedFeature, row); // P2 能力显式拒绝
  rowErr("this.x", BASE_RULES.dynamicContextRequired, row); // 无显式 context
});

// member/index：越界 MISSING、string 不支持、list 索引类型
test("member/index：越界与类型边界", () => {
  const row = makeRow({ xs: [10, 20], obj: { a: 1 }, s: "abc" });
  assert.equal(ok("xs[0]", row), 10);
  assert.equal(ok("xs[5]", row), MISSING); // list 越界 → MISSING
  assert.equal(ok('obj["a"]', row), 1);
  assert.equal(ok('obj["b"]', row), MISSING); // 对象缺 key → MISSING
  rowErr("s[0]", BASE_RULES.propertyTypeMismatch, row); // string 不支持 index（P1）
  rowErr("s.length", BASE_RULES.propertyTypeMismatch, row); // string 不允许 member
  rowErr('xs["0"]', BASE_RULES.propertyTypeMismatch, row); // list 索引须为整数
});

// 预算：operations 耗尽与 maxCollectionItems 超限
test("预算: operations 耗尽抛 BaseBudgetError（深 && 链）", () => {
  const limits = { ...DEFAULT_BASE_EXECUTION_LIMITS, maxOperations: 5 };
  const expr = parse("1 == 1 && 2 == 2 && 3 == 3 && 4 == 4");
  assert.throws(() => evaluateExpression(expr, makeRow(), { limits }), isBaseBudgetError);
});

test("预算: list 元素比较计入 operations（大 list 相等比较耗尽）", () => {
  // 节点 3 次（binary + 两个 property）+ 10 对元素比较 = 13 次操作，上限 8 必耗尽
  const limits = { ...DEFAULT_BASE_EXECUTION_LIMITS, maxOperations: 8 };
  const expr = parse("xs == ys");
  const row = makeRow({ xs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], ys: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.throws(() => evaluateExpression(expr, row, { limits }), isBaseBudgetError);
});

test("预算: maxCollectionItems 超限（list(...) 参数数 / keys() 结果数）", () => {
  const limits = { ...DEFAULT_BASE_EXECUTION_LIMITS, maxCollectionItems: 2 };
  assert.throws(
    () => evaluateExpression(parse("list(1, 2, 3)"), makeRow(), { limits }),
    isBaseBudgetError,
  );
  assert.throws(
    () =>
      evaluateExpression(parse("obj.keys()"), makeRow({ obj: { a: 1, b: 2, c: 3 } }), { limits }),
    isBaseBudgetError,
  );
});

test("预算: 耗尽信号不被 onRowError 吞掉（绝不返回部分结果）", () => {
  const limits = { ...DEFAULT_BASE_EXECUTION_LIMITS, maxOperations: 3 };
  const errors: BaseRowErrorInfo[] = [];
  assert.throws(
    () =>
      evaluateExpression(parse("1 == 1 && 2 == 2 && 3 == 3"), makeRow(), {
        limits,
        onRowError: (e) => errors.push(e),
      }),
    isBaseBudgetError,
  );
  assert.deepEqual(errors, []); // 预算错误不行级化
});

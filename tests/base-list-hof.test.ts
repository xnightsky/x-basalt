/**
 * Bases 无头引擎 P2b 片一测试：list 高阶方法（BASE-LIST-001）+ 迭代预算（BASE-SEC-005）。
 *
 * 覆盖：filter/map/reduce 的隐式 value/index/acc 作用域语义（含遮蔽同名 note 属性、
 * 嵌套 HOF 作用域栈隔离、空列表行为）；flat/sort/unique/join 的普通 impl 路径；
 * tiny limits 下预算耗尽抛 BaseBudgetError（不返回部分结果）；旧 snake_case 白名单自检。
 *
 * 合成 BaseRow（不碰 SQLite）单测，模式同 tests/base-evaluator.test.ts；
 * 编号可追溯至 docs/testing/2026-07-22-bases-scenario-matrix.md §4。
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

/** 覆盖既有默认预算的局部字段。 */
function withLimits(over: Partial<BaseExecutionLimits>): BaseExecutionLimits {
  return { ...DEFAULT_BASE_EXECUTION_LIMITS, ...over };
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

// BASE-LIST-001：filter 的 value/index 语义（index 从 0 起）
test("BASE-LIST-001: filter 按 truthy 保留，隐式 value/index（index 从 0）", () => {
  assert.deepEqual(ok("[10, 20, 30].filter(value > 15)"), [20, 30]);
  assert.deepEqual(ok("[10, 20, 30].filter(index > 0)"), [20, 30]);
  assert.deepEqual(ok("[10, 20, 30].filter(index == 0)"), [10]);
  // truthy 口径与外层一致：非空字符串保留、0/空串丢弃
  assert.deepEqual(ok("[1, 0, 2].filter(value)"), [1, 2]);
  assert.deepEqual(ok('["a", "", "b"].filter(value)'), ["a", "b"]);
});

// BASE-LIST-001：map 收集每次求值结果，value/index 同时可用
test("BASE-LIST-001: map 逐元素求值收集（value 与 index 同时在作用域）", () => {
  assert.deepEqual(ok("[1, 2, 3].map(value * 2)"), [2, 4, 6]);
  assert.deepEqual(ok("[5, 6, 7].map(value + index)"), [5, 7, 9]);
  assert.deepEqual(ok('["a", "b"].map(index)'), [0, 1]);
});

// BASE-LIST-001：reduce 的 acc 语义（初值 = 第二参数，逐元素累积）
test("BASE-LIST-001: reduce 的 acc 逐元素累积（init 先求值一次）", () => {
  assert.equal(ok("[1, 2, 3].reduce(acc + value, 0)"), 6);
  // acc 逐元素更新：sum(value * index) = 0 + 20 + 60 = 80
  assert.equal(ok("[10, 20, 30].reduce(acc + value * index, 0)"), 80);
  // init 为表达式，在元素作用域外先求值一次
  assert.equal(ok("[1, 2].reduce(acc + value, 10 * 2)"), 23);
});

// BASE-LIST-001：作用域遮蔽——note 恰好有同名 value 属性时 HOF 内取作用域、HOF 外取属性
test("BASE-LIST-001: 作用域变量遮蔽同名 note 属性（HOF 外保持 note 属性语义）", () => {
  const row = makeRow({ value: 999, index: 888, acc: 777 });
  // HOF 内：value/index 取隐式作用域，不取 note 属性
  assert.deepEqual(ok("[1, 2].map(value)", row), [1, 2]);
  assert.deepEqual(ok("[1, 2].map(index)", row), [0, 1]);
  assert.equal(ok("[1, 2].reduce(acc + value, 0)", row), 3);
  // HOF 外：裸 value/index/acc 无特殊化，保持 note 属性语义
  assert.equal(ok("value", row), 999);
  assert.equal(ok("index", row), 888);
  assert.equal(ok("acc", row), 777);
  // HOF 内访问其他 note 属性不受影响（作用域未命中走既有解析）
  const row2 = makeRow({ factor: 10 });
  assert.deepEqual(ok("[1, 2].map(value * factor)", row2), [10, 20]);
});

// BASE-LIST-001：嵌套 HOF——内层作用域遮蔽外层同名键（栈式隔离）
test("BASE-LIST-001: 嵌套 HOF 作用域栈（map 里 filter/map，内层遮蔽外层）", () => {
  // 内层 filter 的 value 是内层列表元素（100/1），不是外层 map 的 value
  assert.deepEqual(ok("[1, 2, 3].map([100, 1].filter(value > 50))"), [[100], [100], [100]]);
  // 内层 map 的 index 同样是内层序号
  assert.deepEqual(ok('[["a", "b"], ["c"]].map(value.map(index))'), [[0, 1], [0]]);
  // 链式（非嵌套作用域）：filter 结果再 map
  assert.deepEqual(ok("[1, 2, 3].filter(value > 1).map(value * 2)"), [4, 6]);
});

// BASE-LIST-001：空列表行为——filter→[]、map→[]、reduce→init
test("BASE-LIST-001: 空列表行为（filter→[]、map→[]、reduce→init）", () => {
  assert.deepEqual(ok("[].filter(value > 0)"), []);
  assert.deepEqual(ok("[].map(value)"), []);
  assert.equal(ok("[].reduce(acc + value, 42)"), 42);
  // reduce 的 init 即使在空列表下也已求值（元素作用域外），类型任意
  assert.deepEqual(ok('[].reduce(acc, ["x"])'), ["x"]);
});

// BASE-LIST-001：arity 校验（filter/map = 1，reduce = 2）
test("BASE-LIST-001: HOF arity 校验（缺参/多参 → 行级类型错误）", () => {
  rowErr("[1].filter()", BASE_RULES.propertyTypeMismatch);
  rowErr("[1].map(value, value)", BASE_RULES.propertyTypeMismatch);
  rowErr("[1].reduce(acc)", BASE_RULES.propertyTypeMismatch);
  rowErr("[1].reduce(acc, 0, 0)", BASE_RULES.propertyTypeMismatch);
});

// BASE-LIST-001：flat 默认一层 / depth=2 / depth=0 / 非 list 元素原样保留
test("BASE-LIST-001: flat 默认一层、depth=2、depth=0、非 list 元素保留", () => {
  assert.deepEqual(ok("[[1, 2], [3, [4]]].flat()"), [1, 2, 3, [4]]);
  assert.deepEqual(ok("[[1, 2], [3, [4]]].flat(2)"), [1, 2, 3, 4]);
  assert.deepEqual(ok("[[1, 2], [3, [4]]].flat(0)"), [
    [1, 2],
    [3, [4]],
  ]);
  assert.deepEqual(ok('[1, [2], "a"].flat()'), [1, 2, "a"]);
});

// BASE-LIST-001：flat depth 须非负整数，否则行级类型错误
test("BASE-LIST-001: flat depth 非负整数校验（负数/小数/非 number 报错）", () => {
  rowErr("[[1]].flat(-1)", BASE_RULES.propertyTypeMismatch);
  rowErr("[[1]].flat(1.5)", BASE_RULES.propertyTypeMismatch);
  rowErr('[[1]].flat("2")', BASE_RULES.propertyTypeMismatch);
});

// BASE-LIST-001：sort 升序（number / string）；混合类型报错；null 暂定恒排最后（待 oracle）
test("BASE-LIST-001: sort 升序（number/string），混合类型报错，null 排最后", () => {
  assert.deepEqual(ok("[3, 1, 2].sort()"), [1, 2, 3]);
  assert.deepEqual(ok('["b", "a", "c"].sort()'), ["a", "b", "c"]);
  // 混合类型（number vs string）→ 行级类型错误
  rowErr('[1, "a"].sort()', BASE_RULES.propertyTypeMismatch);
  // boolean 不可比 → 行级类型错误
  rowErr("[true, false].sort()", BASE_RULES.propertyTypeMismatch);
  // 暂定口径（待 oracle）：null 元素恒排最后（沿用 sortKeyCompare 的空值口径）
  assert.deepEqual(ok("[2, null, 1].sort()"), [1, 2, null]);
});

// BASE-LIST-001：unique 去重（primitive + list 元素 typedEqual 递归），保留首现、顺序稳定
test("BASE-LIST-001: unique typedEqual 去重（含 list 元素递归），保序留首现", () => {
  assert.deepEqual(ok("[1, 2, 1, 3, 2].unique()"), [1, 2, 3]);
  assert.deepEqual(ok('["b", "a", "b"].unique()'), ["b", "a"]);
  // list 元素按 typedEqual 递归比较（1 ≠ "1"）
  assert.deepEqual(ok("[[1, 2], [1, 2], [3]].unique()"), [[1, 2], [3]]);
  assert.deepEqual(ok('[1, "1", 1].unique()'), [1, "1"]);
});

// BASE-LIST-001：join 默认 separator / 指定 separator / 非法元素报错
test("BASE-LIST-001: join 默认/指定 separator，非法元素与非法 separator 报错", () => {
  assert.equal(ok('["a", "b", "c"].join()'), "abc");
  assert.equal(ok('[1, 2, 3].join("-")'), "1-2-3");
  // number/boolean 元素经 String() 转换
  assert.equal(ok('[true, false].join(",")'), "true,false");
  // 非法元素（null / list / object）→ 行级类型错误
  rowErr('["a", null].join()', BASE_RULES.propertyTypeMismatch);
  rowErr('[["a"]].join()', BASE_RULES.propertyTypeMismatch);
  // separator 非 string → 行级类型错误
  rowErr('["a"].join(1)', BASE_RULES.propertyTypeMismatch);
});

// BASE-SEC-005：maxOperations 耗尽——大列表 HOF 迭代抛 BaseBudgetError，不返回部分结果
test("BASE-SEC-005: maxOperations 耗尽（迭代 + 元素求值扣减）→ BaseBudgetError", () => {
  // 列表元素数小于 maxCollectionItems，但迭代次数 + 节点求值远超 maxOperations
  const src = `[${Array.from({ length: 50 }, (_, i) => i).join(", ")}].map(value + 1)`;
  assert.throws(
    () => run(src, makeRow(), withLimits({ maxOperations: 20 })),
    (e) => isBaseBudgetError(e),
    "预算耗尽必须抛 BaseBudgetError（不返回部分结果）",
  );
});

// BASE-SEC-005：maxCollectionItems 耗尽——map/filter 结果列表超限抛 BaseBudgetError
test("BASE-SEC-005: maxCollectionItems 耗尽（HOF 结果列表超限）→ BaseBudgetError", () => {
  // note 属性列表不受 list 字面量预算约束，专测 HOF 结果侧硬上限
  const row = makeRow({ nums: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.throws(
    () => run("nums.map(value)", row, withLimits({ maxCollectionItems: 5 })),
    (e) => isBaseBudgetError(e),
  );
  assert.throws(
    () => run("nums.filter(value > 0)", row, withLimits({ maxCollectionItems: 5 })),
    (e) => isBaseBudgetError(e),
  );
});

// BASE-SEC-005：maxCallDepth 耗尽——嵌套 HOF 深度超限抛 BaseBudgetError
test("BASE-SEC-005: maxCallDepth 耗尽（嵌套 HOF）→ BaseBudgetError", () => {
  // 外层 map 占深度 1，内层 map 占深度 2；上限 1 → 内层调用处耗尽
  assert.throws(
    () => run("[1].map([2].map(value))", makeRow(), withLimits({ maxCallDepth: 1 })),
    (e) => isBaseBudgetError(e),
  );
  // 同表达式在默认预算下正常求值（对照：深度检查不误伤）
  assert.deepEqual(ok("[1].map([2].map(value))"), [[2]]);
});

// 白名单自检：旧 snake_case（如 flat_map）→ unknown-function（P0 浅扫描与 parser 同名單一真相源）
test("白名单自检: 旧 snake_case flat_map → base/unknown-function", () => {
  const r = parseBaseExpression("[1, 2].flat_map(value)", MAX_NODES);
  assert.equal(r.expr, undefined);
  assert.ok(
    r.errors.some((e) => e.rule === BASE_RULES.unknownFunction && e.target === "flat_map"),
    `应产 base/unknown-function 诊断: ${JSON.stringify(r.errors)}`,
  );
});

// === BASE-LIST-001 e2e 半段：HOF 经 engine 全链路（片一遗留缺口补钉） ===
//
// fixture：tests/fixtures/bases/p1/vault + views/hof.base；建库模式同 tests/base-engine.test.ts。
// 标签 ground truth：仅 Alpha 有 tags（frontmatter [area] + 行内 #area/x）。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { BaseEngine } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const e2eVault = fileURLToPath(new URL("./fixtures/bases/p1/vault", import.meta.url));
const e2eBase = join(e2eVault, "views", "hof.base");
let e2eDir: string;
let e2eDb: string;
let e2eEngine: BaseEngine;

before(async () => {
  e2eDir = mkdtempSync(join(tmpdir(), "x-basalt-hof-e2e-"));
  e2eDb = join(e2eDir, "index.db");
  const idx = new VaultIndexer({ vaultPath: e2eVault, dbPath: e2eDb });
  await idx.rebuild();
  idx.close();
  e2eEngine = new BaseEngine();
});
after(() => {
  e2eEngine?.close();
  rmSync(e2eDir, { recursive: true, force: true });
});

test("BASE-LIST-001(e2e): filter 中 map+contains 作用于 file.tags（命中恰 Alpha）", () => {
  const r = e2eEngine.query({ basePath: e2eBase, view: "by-tag", dbPath: e2eDb, vaultRoots: [e2eVault] });
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha.md"],
  );
  assert.equal(r.total, 1);
});

test("BASE-LIST-001(e2e): formula 中 reduce 计数（Alpha=2、其余=0），sort DESC 生效", () => {
  const r = e2eEngine.query({ basePath: e2eBase, view: "tag-count", dbPath: e2eDb, vaultRoots: [e2eVault] });
  assert.equal(r.rows[0]?.["file.name"], "Alpha.md");
  assert.equal(r.rows[0]?.["formula.tagcount"], 2);
  for (const row of r.rows.slice(1)) assert.equal(row["formula.tagcount"], 0);
});

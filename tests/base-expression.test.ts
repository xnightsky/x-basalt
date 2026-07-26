/**
 * Bases 无头引擎 P1 表达式文法层测试：BASE-EXPR-001/002、BASE-PROP-001/002/003（文法层半段）、
 * BASE-SEC-002（文法层）、BASE-DOC-008（文法层半段）。
 * P2a 增量（文件末段）：BASE-FORM-001 文法半段（算术优先级/一元负号/duration 字面量/today/now）。
 *
 * 每号独立用例（注释标编号，可追溯至 docs/testing/2026-07-22-bases-scenario-matrix.md §4/§7）；
 * 优先级/结合性断言用去 offset 的形状投影（shape），位置断言单独抽查 offset。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  DEFAULT_BASE_EXECUTION_LIMITS,
  parseBaseExpression,
  type BaseExpr,
  type BaseExpressionParseError,
} from "../src/base/index.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

/** 解析必须成功：无错误且 expr 存在。 */
function ok(src: string): BaseExpr {
  const r = parseBaseExpression(src, MAX_NODES);
  assert.deepEqual(r.errors, []);
  assert.ok(r.expr !== undefined, `应产出 AST: ${src}`);
  return r.expr;
}

/** 解析必须失败：有错误且不返回半截 AST。 */
function err(src: string, maxNodes = MAX_NODES): BaseExpressionParseError[] {
  const r = parseBaseExpression(src, maxNodes);
  assert.ok(r.errors.length > 0, `应产出错误: ${src}`);
  assert.equal(r.expr, undefined, "errors 非空时不应返回 AST");
  return r.errors;
}

/** 去 offset 的 AST 形状投影：优先级/结合性断言只关心结构，不关心位置。 */
function shape(e: BaseExpr): unknown {
  switch (e.kind) {
    case "literal":
      return { kind: "literal", value: e.value };
    case "list":
      return { kind: "list", items: e.items.map(shape) };
    case "property":
      return { kind: "property", base: e.base, path: e.path };
    case "member":
      return { kind: "member", target: shape(e.target), name: e.name };
    case "index":
      return { kind: "index", target: shape(e.target), index: shape(e.index) };
    case "call":
      return {
        kind: "call",
        name: e.name,
        receiver: e.receiver === null ? null : shape(e.receiver),
        args: e.args.map(shape),
      };
    case "not":
      return { kind: "not", arg: shape(e.arg) };
    case "neg":
      return { kind: "neg", arg: shape(e.arg) };
    case "duration":
      return { kind: "duration", amount: e.amount, unit: e.unit };
    case "binary":
      return { kind: "binary", op: e.op, left: shape(e.left), right: shape(e.right) };
  }
}

const prop = (path: string[], base: "note" | "file" | "formula" | "this" = "note") => ({
  kind: "property",
  base,
  path,
});
const lit = (value: null | boolean | number | string) => ({ kind: "literal", value });

// BASE-EXPR-001（文法层）：== != < > <= >= 均解析为正确 binary 节点
test("BASE-EXPR-001: 六个比较运算符解析为正确 binary 节点", () => {
  for (const op of ["==", "!=", "<", ">", "<=", ">="] as const) {
    const e = ok(`a ${op} 1`);
    assert.equal(e.kind, "binary");
    if (e.kind !== "binary") return;
    assert.equal(e.op, op);
    assert.deepEqual(shape(e.left), prop(["a"]));
    assert.deepEqual(shape(e.right), lit(1));
    // offset 取最左 token（= left.offset）
    assert.equal(e.offset, 0);
  }
});

// BASE-EXPR-002：! && || 与括号的优先级/结合性（设计 §7.3）
test("BASE-EXPR-002: 优先级与结合性符合设计 §7.3", () => {
  // && 先于 ||：`a && b || c` → `(a&&b)||c`
  assert.deepEqual(shape(ok("a && b || c")), {
    kind: "binary",
    op: "||",
    left: { kind: "binary", op: "&&", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 对称方向：`a || b && c` → `a||(b&&c)`
  assert.deepEqual(shape(ok("a || b && c")), {
    kind: "binary",
    op: "||",
    left: prop(["a"]),
    right: { kind: "binary", op: "&&", left: prop(["b"]), right: prop(["c"]) },
  });
  // 一元 ! 高于 ==：`!a == b` → `(!a)==b`
  assert.deepEqual(shape(ok("!a == b")), {
    kind: "binary",
    op: "==",
    left: { kind: "not", arg: prop(["a"]) },
    right: prop(["b"]),
  });
  // 比较高于相等：`a < b == c` → `(a<b)==c`
  assert.deepEqual(shape(ok("a < b == c")), {
    kind: "binary",
    op: "==",
    left: { kind: "binary", op: "<", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 同级左结合：`a == b == c` → `(a==b)==c`
  assert.deepEqual(shape(ok("a == b == c")), {
    kind: "binary",
    op: "==",
    left: { kind: "binary", op: "==", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 括号改优先级：`a && (b || c)`；括号本身不产节点
  assert.deepEqual(shape(ok("a && (b || c)")), {
    kind: "binary",
    op: "&&",
    left: prop(["a"]),
    right: { kind: "binary", op: "||", left: prop(["b"]), right: prop(["c"]) },
  });
  // 连续取反：`!!a` → not(not(a))
  assert.deepEqual(shape(ok("!!a")), { kind: "not", arg: { kind: "not", arg: prop(["a"]) } });
});

// 字面量（语法真相源 §4.3）：null / boolean / number / 单双引号字符串（含转义解码）/ list 嵌套
test("字面量：null/boolean/number/字符串转义/list 嵌套", () => {
  assert.deepEqual(shape(ok("null")), lit(null));
  assert.deepEqual(shape(ok("true")), lit(true));
  assert.deepEqual(shape(ok("false")), lit(false));
  assert.deepEqual(shape(ok("42")), lit(42));
  assert.deepEqual(shape(ok("3.14")), lit(3.14));
  // 双引号转义：\" \\ \' \n \t 全部解码
  assert.deepEqual(shape(ok(String.raw`"a\nb\tc\"d\\e\'f"`)), lit("a\nb\tc\"d\\e'f"));
  // 单引号转义
  assert.deepEqual(shape(ok(String.raw`'it\'s'`)), lit("it's"));
  // list 字面量嵌套（含 null 与字符串）
  assert.deepEqual(shape(ok('[1, [2, "a"], null]')), {
    kind: "list",
    items: [lit(1), { kind: "list", items: [lit(2), lit("a")] }, lit(null)],
  });
  // 空 list
  assert.deepEqual(shape(ok("[]")), { kind: "list", items: [] });
});

// BASE-PROP-001（文法层半段）：`status` 与 `note.status` 同义，均 base=note path=[status]
test("BASE-PROP-001: 裸属性与 note. 显式引用同义", () => {
  assert.deepEqual(shape(ok("status")), prop(["status"]));
  assert.deepEqual(shape(ok("note.status")), prop(["status"]));
});

// BASE-PROP-002（文法层半段）：`note["Review Status"]` 带空格属性名
test('BASE-PROP-002: note["…"] 带空格属性名进入 property.path', () => {
  const e = ok('note["Review Status"]');
  assert.deepEqual(shape(e), prop(["Review Status"]));
});

// BASE-PROP-003（文法层半段）：Unicode 属性名 `状态` / `note["状态"]`
test("BASE-PROP-003: Unicode 属性名可解析", () => {
  assert.deepEqual(shape(ok("状态")), prop(["状态"]));
  assert.deepEqual(shape(ok('note["状态"]')), prop(["状态"]));
  // 关键字前缀标识符不被吞成关键字（longer_alt）：`notebook` 是属性名而非 note + book
  assert.deepEqual(shape(ok("notebook")), prop(["notebook"]));
});

// file 根引用与只读成员/索引访问（语法真相源 §4.1/§4.3）
test("file 属性引用、member 与 index 访问", () => {
  assert.deepEqual(shape(ok("file.name")), prop(["name"], "file"));
  // `file.properties.x` → property(file,[properties]) + member x
  assert.deepEqual(shape(ok("file.properties.x")), {
    kind: "member",
    target: prop(["properties"], "file"),
    name: "x",
  });
  // 索引访问：`note.scores[0]`
  assert.deepEqual(shape(ok("note.scores[0]")), {
    kind: "index",
    target: prop(["scores"]),
    index: lit(0),
  });
  // formula / this 语法上接受（evaluator 阶段才拒绝，计划「关键取舍」#4）
  assert.deepEqual(shape(ok("formula.age")), prop(["age"], "formula"));
  assert.deepEqual(shape(ok("this.file")), prop(["file"], "this"));
});

// 白名单调用（语法真相源 §4.4）：全局函数 / 方法 / file 方法
test("白名单调用：if 全局、contains 方法、hasTag file 方法", () => {
  // 全局函数：receiver=null
  assert.deepEqual(shape(ok("if(a, b, c)")), {
    kind: "call",
    name: "if",
    receiver: null,
    args: [prop(["a"]), prop(["b"]), prop(["c"])],
  });
  // 方法调用：receiver 为属性值
  assert.deepEqual(shape(ok('status.contains("x")')), {
    kind: "call",
    name: "contains",
    receiver: prop(["status"]),
    args: [lit("x")],
  });
  // file 方法：`.hasTag(` 不得被吞进 file 的属性路径（rootRef GATE）
  assert.deepEqual(shape(ok('file.hasTag("area")')), {
    kind: "call",
    name: "hasTag",
    receiver: prop([], "file"),
    args: [lit("area")],
  });
  // 链式 postfix：方法返回值的只读成员
  const chain = ok('file.name.lower().contains("a")');
  assert.equal(chain.kind, "call");
  if (chain.kind === "call") {
    assert.equal(chain.name, "contains");
    assert.equal(chain.receiver?.kind, "call");
  }
});

// BASE-SEC-002（文法层）：任意标识符调用拒绝；eval/new Function 不存在
test("BASE-SEC-002: 白名单外调用产 unknown-function，源码无 eval/new Function", () => {
  // 任意标识符调用 → unknown-function，offset 指向名字起点，target=名字
  const es1 = err("foo(1)");
  assert.equal(es1.length, 1);
  assert.equal(es1[0]?.rule, "base/unknown-function");
  assert.equal(es1[0]?.offset, 0);
  assert.equal(es1[0]?.target, "foo");
  // 带前导空白时 offset 仍指向名字
  const es2 = err("  foo(1)");
  assert.equal(es2[0]?.offset, 2);
  // 方法调用同样核对白名单
  const es3 = err("status.evil(1)");
  assert.equal(es3[0]?.rule, "base/unknown-function");
  assert.equal(es3[0]?.target, "evil");
  // 源码层面不存在 eval / new Function（动态代码执行面为零）
  for (const f of ["../src/base/parser.ts", "../src/base/tokens.ts"]) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    assert.ok(!/\beval\s*\(/.test(src), `${f} 不得出现 eval(`);
    assert.ok(!/new\s+Function/.test(src), `${f} 不得出现 new Function`);
  }
});

// BASE-DOC-008（文法层半段）：旧 snake_case 函数报 unknown-function，不静默迁移
test("BASE-DOC-008: 旧 snake_case 函数 contains_all 报 unknown-function", () => {
  const es = err('contains_all(tags, "x")');
  assert.equal(es.length, 1);
  assert.equal(es[0]?.rule, "base/unknown-function");
  assert.equal(es[0]?.target, "contains_all");
});

// 字符串字面量内的 `foo(` 不误报 unknown-function（与 P0 浅扫描口径一致）
test("字符串内容不触发 unknown-function 误报", () => {
  const e = ok('"foo(1)" == status');
  assert.deepEqual(shape(e), {
    kind: "binary",
    op: "==",
    left: lit("foo(1)"),
    right: prop(["status"]),
  });
});

// 语法错误：expression-syntax 带 offset（未闭合字符串 / 缺右操作数 / DQL 的 `=` / 多余 token）
test("语法错误：expression-syntax 定位到出错位置", () => {
  // 未闭合字符串：词法错误，offset 指向字符串起点（`a == ` 共 5 字符，引号在 5）
  const es1 = err('a == "unclosed');
  assert.equal(es1[0]?.rule, "base/expression-syntax");
  assert.equal(es1[0]?.offset, 5);
  // 缺右操作数：EOF 是合成 token、无真实位置，如实降级为 0（不伪造）
  const es2 = err("a ==");
  assert.equal(es2[0]?.rule, "base/expression-syntax");
  assert.equal(es2[0]?.offset, 0);
  // DQL 的单 `=` 在 Bases 是词法错误（两套文法独立，计划「关键取舍」#3）
  const es3 = err("a = b");
  assert.equal(es3[0]?.rule, "base/expression-syntax");
  assert.equal(es3[0]?.offset, 2);
  // 多余 token：不允许半截表达式静默截断
  const es4 = err('a "trailing"');
  assert.equal(es4[0]?.rule, "base/expression-syntax");
  assert.equal(es4[0]?.offset, 2);
  // 空表达式
  const es5 = err("");
  assert.equal(es5[0]?.rule, "base/expression-syntax");
});

// 预算（计划「关键取舍」#9）：AST 节点数超 maxNodes → execution-budget
test("预算：节点数超限产 execution-budget，不返回部分 AST", () => {
  // `a && b && c && d` = 7 个节点（4 属性 + 3 二元）；maxNodes=3 在第 4 个节点处耗尽
  const es = err("a && b && c && d", 3);
  assert.equal(es.length, 1);
  assert.equal(es[0]?.rule, "base/execution-budget");
  assert.equal(typeof es[0]?.offset, "number");
});

// 预算：嵌套深度硬上限 128 防栈溢出（括号不产节点，节点预算挡不住，须独立深度计数）
test("预算：超深括号嵌套在深度上限处拒绝，进程不栈溢出", () => {
  // 128 层以内正常解析（maxNodes 抬高，隔离节点预算干扰）
  const deep128 = "(".repeat(128) + "a" + ")".repeat(128);
  const r = parseBaseExpression(deep128, 1_000_000);
  assert.deepEqual(r.errors, []);
  assert.ok(r.expr !== undefined);
  // 129 层 → execution-budget（不是 RangeError 崩溃）
  const deep129 = "(".repeat(129) + "a" + ")".repeat(129);
  const es = err(deep129, 1_000_000);
  assert.equal(es.length, 1);
  assert.equal(es[0]?.rule, "base/execution-budget");
  // 极端深度同样被预算拦截而非崩溃（本用例能跑完即主断言）
  const deep5000 = "(".repeat(5000) + "a" + ")".repeat(5000);
  const es2 = err(deep5000, 1_000_000);
  assert.equal(es2[0]?.rule, "base/execution-budget");
});

// ===== P2a 增量：文法扩展（BASE-FORM-001 文法半段；求值接线属下一片）=====

// BASE-FORM-001（文法半段）：算术优先级 `* /` > `+ -` > 比较/相等，同级左结合
test("BASE-FORM-001: 算术优先级与结合性", () => {
  // `a + b * c` → `a + (b*c)`
  assert.deepEqual(shape(ok("a + b * c")), {
    kind: "binary",
    op: "+",
    left: prop(["a"]),
    right: { kind: "binary", op: "*", left: prop(["b"]), right: prop(["c"]) },
  });
  // 括号改优先级：`(a + b) * c`
  assert.deepEqual(shape(ok("(a + b) * c")), {
    kind: "binary",
    op: "*",
    left: { kind: "binary", op: "+", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 同级左结合：`a - b - c` → `(a-b)-c`
  assert.deepEqual(shape(ok("a - b - c")), {
    kind: "binary",
    op: "-",
    left: { kind: "binary", op: "-", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 算术高于比较：`a + b < c` → `(a+b)<c`
  assert.deepEqual(shape(ok("a + b < c")), {
    kind: "binary",
    op: "<",
    left: { kind: "binary", op: "+", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
  // 对称方向：`a < b * c` → `a < (b*c)`
  assert.deepEqual(shape(ok("a < b * c")), {
    kind: "binary",
    op: "<",
    left: prop(["a"]),
    right: { kind: "binary", op: "*", left: prop(["b"]), right: prop(["c"]) },
  });
  // 算术高于相等：`1 + 2 == 3` → `(1+2)==3`
  assert.deepEqual(shape(ok("1 + 2 == 3")), {
    kind: "binary",
    op: "==",
    left: { kind: "binary", op: "+", left: lit(1), right: lit(2) },
    right: lit(3),
  });
  // 除法与乘法同级左结合：`a / b * c` → `(a/b)*c`
  assert.deepEqual(shape(ok("a / b * c")), {
    kind: "binary",
    op: "*",
    left: { kind: "binary", op: "/", left: prop(["a"]), right: prop(["b"]) },
    right: prop(["c"]),
  });
});

// BASE-FORM-001（文法半段）：一元负号（与 `!` 同级，高于乘除）
test("BASE-FORM-001: 一元负号 neg 节点", () => {
  // `-42` → neg(lit 42)，offset 指向负号
  const e = ok("-42");
  assert.deepEqual(shape(e), { kind: "neg", arg: lit(42) });
  assert.equal(e.offset, 0);
  // `-(a + b)` → neg(binary +)
  assert.deepEqual(shape(ok("-(a + b)")), {
    kind: "neg",
    arg: { kind: "binary", op: "+", left: prop(["a"]), right: prop(["b"]) },
  });
  // 叠合：`--a` → neg(neg(a))
  assert.deepEqual(shape(ok("--a")), { kind: "neg", arg: { kind: "neg", arg: prop(["a"]) } });
  // 一元高于乘除：`-a * b` → `(neg a) * b`
  assert.deepEqual(shape(ok("-a * b")), {
    kind: "binary",
    op: "*",
    left: { kind: "neg", arg: prop(["a"]) },
    right: prop(["b"]),
  });
  // 与 ! 同级混用：`-!a` → neg(not(a))
  assert.deepEqual(shape(ok("-!a")), { kind: "neg", arg: { kind: "not", arg: prop(["a"]) } });
});

// BASE-FORM-001（文法半段）：duration 字面量各单位单复数形态（单位归一为单数枚举）
test("BASE-FORM-001: duration 字面量单位表（单/复数）", () => {
  const units = [
    "millisecond",
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "year",
  ] as const;
  for (const unit of units) {
    // 单数形态
    assert.deepEqual(shape(ok(`1${unit}`)), { kind: "duration", amount: 1, unit });
    // 复数形态 → 归一同枚单数
    assert.deepEqual(shape(ok(`2${unit}s`)), { kind: "duration", amount: 2, unit });
  }
  // 小数数值
  assert.deepEqual(shape(ok("1.5hours")), { kind: "duration", amount: 1.5, unit: "hour" });
  // offset 指向 token 起点
  const e = ok("a == 3days");
  if (e.kind === "binary" && e.right.kind === "duration") {
    assert.equal(e.right.offset, 5);
  } else {
    assert.fail("应为 binary == duration");
  }
});

// BASE-FORM-001（文法半段）：duration 与数字/标识符的词法边界
test("BASE-FORM-001: duration 词法边界（1day vs 1 day vs day vs 1dayfoo）", () => {
  // 裸 `day` 是标识符（note property 简写），不是 duration
  assert.deepEqual(shape(ok("day")), prop(["day"]));
  // `1day` 是 duration 单 token
  assert.deepEqual(shape(ok("1day")), { kind: "duration", amount: 1, unit: "day" });
  // `1 day`（含空白）不是 duration：数字 + 标识符两个 token，语法错误（多余 token）
  const es1 = err("1 day");
  assert.equal(es1[0]?.rule, "base/expression-syntax");
  // `1dayfoo` 不静默截成 `1day` + `foo`：整体词法回退后同样语法错误
  const es2 = err("1dayfoo");
  assert.equal(es2[0]?.rule, "base/expression-syntax");
  // duration 可参与运算：`(now() - file.ctime) / 1day` 官方示例形态可解析
  const formula = ok("(now() - file.ctime) / 1day");
  assert.equal(formula.kind, "binary");
  if (formula.kind === "binary") assert.equal(formula.op, "/");
});

// BASE-FORM-001 / FORM-006（文法半段）：today()/now() 在白名单内、可解析为全局调用
test("BASE-FORM-001: today()/now() 解析为白名单全局调用", () => {
  for (const name of ["today", "now"] as const) {
    assert.deepEqual(shape(ok(`${name}()`)), { kind: "call", name, receiver: null, args: [] });
  }
});

// P2a 不回归抽查：含新运算符字符的旧形态语义不变（`!=` 不被 `-` 截断、比较链不变）
test("P2a 不回归：含 - 字符的旧表达式形态不变", () => {
  // `a != -1` 是 P2a 新增一元负号场景；旧形态 `a != b` 必须不受影响
  assert.deepEqual(shape(ok("a != b")), {
    kind: "binary",
    op: "!=",
    left: prop(["a"]),
    right: prop(["b"]),
  });
  // 旧比较链：`!a && b < c` 结构不变
  assert.deepEqual(shape(ok("!a && b < c")), {
    kind: "binary",
    op: "&&",
    left: { kind: "not", arg: prop(["a"]) },
    right: { kind: "binary", op: "<", left: prop(["b"]), right: prop(["c"]) },
  });
});

/**
 * Bases file/link 互转测试（2026-07-28 覆盖率片三，计划 docs/plans/2026-07-28-bases-functions.md）。
 *
 * 覆盖：global 构造 `file(path)` / `link(target, display?)`、`link.asFile()`（新增 link 分派组）、
 * `file.asLink(display?)` / `file.linksTo(x)`（BASE-FILE-001/005、BASE-TYPE-006），
 * 以及**文法增量**：`file` 是关键字 token，`file(...)` 调用形态由 parser 的 rootRef 分支支持——
 * 本文件同时锁定「`file.name` / 裸 `file` 的既有行为不回归」。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_RULES,
  DEFAULT_BASE_EXECUTION_LIMITS,
  MISSING,
  createFileValue,
  createFileResolver,
  evaluateExpression,
  isFileValue,
  isLinkValue,
  parseBaseExpression,
  toOutputValue,
  wrapValue,
  type BaseExpr,
  type BaseFileValue,
  type BaseRow,
  type BaseRowErrorInfo,
  type BaseValue,
  type BaseValueObject,
} from "../src/base/index.js";

const MAX_NODES = DEFAULT_BASE_EXECUTION_LIMITS.maxExpressionNodes;

function makeFile(path: string, links: readonly string[] = []): BaseFileValue {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return createFileValue({
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    path,
    folder: slash === -1 ? "" : path.slice(0, slash),
    ext: dot === -1 ? "" : name.slice(dot),
    size: 10,
    ctime: 0,
    mtime: 0,
    properties: {},
    tags: [],
    links,
  });
}

/** 合成行集：Alpha 出链指向 Beta 与 Notes/Gamma。 */
const DATASET: BaseRow[] = [
  { note: {}, file: makeFile("Notes/Gamma.md") },
  { note: {}, file: makeFile("Projects/Alpha.md", ["Beta", "Notes/Gamma.md"]) },
  { note: {}, file: makeFile("Projects/Beta.md") },
];
const RESOLVER = createFileResolver(DATASET);

function makeRow(note: Record<string, unknown> = {}, file = DATASET[1]?.file): BaseRow {
  return {
    note,
    file: createFileValue({
      ...(file as BaseFileValue),
      properties: wrapValue(note) as BaseValueObject,
    }),
  };
}

function parse(src: string): BaseExpr {
  const r = parseBaseExpression(src, MAX_NODES);
  assert.deepEqual(r.errors, [], `解析应成功: ${src}`);
  assert.ok(r.expr !== undefined);
  return r.expr;
}

/** 求值；`withResolver=false` 模拟自定义汇总语境（不注入行集解析器）。 */
function run(
  src: string,
  row: BaseRow = makeRow(),
  withResolver = true,
): { value: BaseValue; errors: BaseRowErrorInfo[] } {
  const errors: BaseRowErrorInfo[] = [];
  const value = evaluateExpression(parse(src), row, {
    limits: DEFAULT_BASE_EXECUTION_LIMITS,
    ...(withResolver ? { resolveFile: (t: string) => RESOLVER.resolve(t) } : {}),
    onRowError: (e) => errors.push(e),
  });
  return { value, errors };
}

function ok(src: string, row: BaseRow = makeRow()): BaseValue {
  const { value, errors } = run(src, row);
  assert.deepEqual(errors, [], `不应有行级错误: ${src}`);
  return value;
}

function rowErr(src: string, rule: string, withResolver = true): BaseRowErrorInfo {
  const { value, errors } = run(src, makeRow(), withResolver);
  assert.equal(value, MISSING, `行级错误后应返回 MISSING: ${src}`);
  assert.equal(errors.length, 1, `应恰好上报一次: ${src}`);
  assert.equal(errors[0]?.rule, rule);
  return errors[0] as BaseRowErrorInfo;
}

// ---------------------------------------------------------------------------
// 文法增量：file(...) 调用形态（file 是关键字 token）
// ---------------------------------------------------------------------------

test("文法：file(...) 可解析为全局调用，且根引用形态零回归", () => {
  // 新增：调用形态
  const call = parse('file("a.md")');
  assert.equal(call.kind, "call");
  assert.equal((call as Extract<BaseExpr, { kind: "call" }>).name, "file");
  assert.equal((call as Extract<BaseExpr, { kind: "call" }>).receiver, null);
  // 既有：根引用 + 属性路径 + 方法调用，全部不变
  assert.equal(parse("file.name").kind, "property");
  assert.equal(parse("file").kind, "property");
  assert.equal(parse('file.hasTag("area")').kind, "call");
  assert.equal(parse('file["name"]').kind, "property");
  // note(/formula(/this( 走同一分支但名字不在白名单 → unknown-function（与任意未知标识符同口径）
  for (const src of ['note("x")', 'formula("x")', 'this("x")']) {
    const r = parseBaseExpression(src, MAX_NODES);
    assert.equal(r.errors[0]?.rule, BASE_RULES.unknownFunction, src);
    assert.equal(r.errors.length, 1, src);
  }
});

// ---------------------------------------------------------------------------
// global file() / link()
// ---------------------------------------------------------------------------

test("BASE-FILE-001: file(path) 三级解析（精确 path / pathKey / bare basename）", () => {
  assert.equal(ok('file("Projects/Alpha.md").path'), "Projects/Alpha.md"); // 精确
  assert.equal(ok('file("projects/alpha").path'), "Projects/Alpha.md"); // pathKey（去扩展名 + 小写）
  assert.equal(ok('file("Beta").path'), "Projects/Beta.md"); // bare basename
  assert.ok(isFileValue(ok('file("Beta")')));
  // 幂等
  assert.equal(ok('file(file("Beta")).path'), "Projects/Beta.md");
  // 解析不到 → MISSING（不伪造空 file 值）；投影时才塌成 null
  assert.equal(ok('file("Nope.md")'), MISSING);
  assert.equal(toOutputValue(ok('file("Nope.md")')), null);
  // 参数类型
  rowErr("file(1)", BASE_RULES.propertyTypeMismatch);
});

test("BASE-TYPE-006: link() 输出形状与悬空链接口径（纯值构造，不解析行集）", () => {
  assert.deepEqual(toOutputValue(ok('link("Projects/Alpha.md")')), {
    type: "link",
    path: "projects/alpha",
  });
  assert.deepEqual(toOutputValue(ok('link("Alpha", "阿尔法")')), {
    type: "link",
    path: "alpha",
    display: "阿尔法",
  });
  // 悬空链接合法（wikilink 本就允许指向不存在的文件）——与 file() 的「解析不到 → MISSING」有意不同
  assert.ok(isLinkValue(ok('link("完全不存在")')));
  // link(file) / link(link) 可写；给 display 则换显示文本
  assert.deepEqual(toOutputValue(ok('link(file("Beta"))')), {
    type: "link",
    path: "projects/beta",
  });
  assert.deepEqual(toOutputValue(ok('link(link("Alpha"), "别名")')), {
    type: "link",
    path: "alpha",
    display: "别名",
  });
  rowErr("link(1)", BASE_RULES.propertyTypeMismatch);
});

// ---------------------------------------------------------------------------
// link.asFile() / file.asLink() / file.linksTo()
// ---------------------------------------------------------------------------

test("BASE-TYPE-006: link.asFile() 解析到行集，悬空 → MISSING", () => {
  assert.equal(ok('link("Projects/Alpha.md").asFile().path'), "Projects/Alpha.md");
  assert.equal(ok('link("Beta").asFile().path'), "Projects/Beta.md", "bare wikilink 也能解析");
  assert.equal(ok('link("完全不存在").asFile()'), MISSING);
  // frontmatter 里的 wikilink 值天然是 link → 可直接 asFile
  assert.equal(ok("ref.asFile().path", makeRow({ ref: "[[Beta]]" })), "Projects/Beta.md");
});

test("BASE-TYPE-006: file.asLink(display?) 用完整路径作 target", () => {
  assert.deepEqual(toOutputValue(ok("file.asLink()")), {
    type: "link",
    path: "projects/alpha",
  });
  assert.deepEqual(toOutputValue(ok('file.asLink("显示名")')), {
    type: "link",
    path: "projects/alpha",
    display: "显示名",
  });
  // 往返：file → link → file
  assert.equal(ok("file.asLink().asFile().path"), "Projects/Alpha.md");
  rowErr("file.asLink(1)", BASE_RULES.propertyTypeMismatch);
});

test("BASE-FILE-005: file.linksTo 与 hasLink 同一匹配口径，入参类型更宽", () => {
  // 行 = Alpha，出链 ["Beta", "Notes/Gamma.md"]
  for (const target of ["Beta", "beta", "Projects/Beta.md", "Notes/Gamma.md", "Gamma"]) {
    const viaLinksTo = ok(`file.linksTo("${target}")`);
    const viaHasLink = ok(`file.hasLink("${target}")`);
    assert.equal(viaLinksTo, viaHasLink, `两函数对 "${target}" 必须一致`);
  }
  assert.equal(ok('file.linksTo("Beta")'), true);
  assert.equal(ok('file.linksTo("Notes/Gamma.md")'), true);
  assert.equal(ok('file.linksTo("Projects/Gamma.md")'), false, "qualified 分支须精确匹配目录");
  assert.equal(ok('file.linksTo("完全不存在")'), false);
  // 增量能力：收 link / file 值（hasLink 只收 string）
  assert.equal(ok('file.linksTo(link("Beta"))'), true);
  // file 入参走**解析**而非文本匹配——Alpha 里写的是 bare `[[Beta]]`，而 file("Beta").path
  // 是 "Projects/Beta.md"；若按文本匹配会进 qualified 分支比 pathKey，明明链上了却判 false。
  assert.equal(ok('file.linksTo(file("Beta"))'), true);
  assert.equal(ok('file.linksTo(file("Notes/Gamma.md"))'), true);
  // 解析语义的反面：Gamma 不链任何东西
  const gammaRow = makeRow({}, DATASET[0]?.file);
  assert.equal(ok('file.linksTo(file("Beta"))', gammaRow), false);
  rowErr("file.linksTo(1)", BASE_RULES.propertyTypeMismatch);
});

// ---------------------------------------------------------------------------
// 解析器缺省语境（自定义汇总的 values 作用域）
// ---------------------------------------------------------------------------

test("无行集解析器时 file()/asFile() 报 unsupported-feature，不静默 MISSING", () => {
  const e = rowErr('file("Beta")', BASE_RULES.unsupportedFeature, false);
  assert.match(e.message, /当前求值上下文不提供/u);
  rowErr('link("Beta").asFile()', BASE_RULES.unsupportedFeature, false);
  // link() 是纯值构造，不需要解析器 → 该语境下照常可用
  const { value, errors } = run('link("Beta")', makeRow(), false);
  assert.deepEqual(errors, []);
  assert.ok(isLinkValue(value));
});

test("link 分派组不吞掉其它诊断，也不外露内部字段", () => {
  const e = rowErr('link("A").contains("x")', BASE_RULES.propertyTypeMismatch);
  assert.match(e.message, /类型 link 不支持方法 "contains"/u);
  assert.equal(ok('link("A").isTruthy()'), true); // any 组回退未破坏
  rowErr('link("A").path', BASE_RULES.propertyTypeMismatch); // 内部字段仍不可访问
  rowErr('"A".asFile()', BASE_RULES.propertyTypeMismatch); // 非 link receiver
});

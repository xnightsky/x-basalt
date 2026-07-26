/**
 * Bases 无头引擎 P0 文档层测试：BASE-DOC-001..009 + BASE-SEC-007/008。
 *
 * 每号独立用例（注释标编号，可追溯至 docs/testing/2026-07-22-bases-scenario-matrix.md §3/§7）；
 * 位置断言一律用 fixture 实际行列（probe 实测后硬编码）。
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadBaseDocument, selectView } from "../src/base/index.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/bases", import.meta.url));
const MINIMAL = join(FIXTURES, "minimal");
const INVALID = join(FIXTURES, "invalid");
const SECURITY = join(FIXTURES, "security");

/** 以 fixture 目录为 vault root 加载 .base（路径统一走 loadBaseDocument 的越界检查）。 */
function load(root: string, rel: string) {
  return loadBaseDocument({ basePath: join(root, rel), vaultRoots: [root] });
}

// BASE-DOC-001：最小合法 .base，只有一个 table view → 成功解析，首 view 成为默认 view
test("BASE-DOC-001: 最小合法 .base 解析成功且首 view 为默认 view", () => {
  const doc = load(MINIMAL, "views/projects.base");
  assert.deepEqual(doc.diagnostics, []);
  assert.equal(doc.path, "views/projects.base");
  assert.equal(doc.views.length, 1);
  const view = doc.views[0];
  assert.equal(view?.type, "table");
  assert.equal(view?.name, "All");
  assert.equal(view?.limit, 10);
  assert.deepEqual(view?.order, ["file.name", "status"]);
  assert.equal(doc.filters?.kind, "expr");

  // 未指定 view → views[0]（BASE-VIEW-001 的文档层半段）
  assert.equal(selectView(doc).view?.name, "All");
  // 指定存在的 view → 命中且无新诊断
  const named = selectView(doc, "All");
  assert.equal(named.view?.name, "All");
  assert.deepEqual(named.diagnostics, []);
});

// BASE-DOC-002：非法 YAML → 诊断含 .base 文件、完整文件 line/column，执行终止
test("BASE-DOC-002: 非法 YAML 产 base/invalid-yaml（完整文件位置）且执行终止", () => {
  const doc = load(INVALID, "bad-yaml.base");
  assert.equal(doc.views.length, 0);
  assert.equal(doc.diagnostics.length, 1);
  const d = doc.diagnostics[0];
  assert.equal(d?.rule, "base/invalid-yaml");
  assert.equal(d?.severity, "error");
  assert.equal(d?.file, "bad-yaml.base");
  assert.equal(d?.line, 4);
  assert.equal(d?.column, 1);
});

// BASE-DOC-003：views 缺失或为空 → base/view-required，不猜空 view
test("BASE-DOC-003: views 缺失/空数组均产 base/view-required", () => {
  const missing = load(INVALID, "no-views.base");
  assert.equal(missing.views.length, 0);
  const d1 = missing.diagnostics.find((x) => x.rule === "base/view-required");
  assert.equal(d1?.severity, "error");
  assert.equal(d1?.line, 1);
  assert.equal(d1?.column, 1);

  const empty = load(INVALID, "empty-views.base");
  assert.equal(empty.views.length, 0);
  const d2 = empty.diagnostics.find((x) => x.rule === "base/view-required");
  assert.equal(d2?.severity, "error");
  // 空数组场景定位到 views key（第 2 行，第 1 行是注释）
  assert.equal(d2?.line, 2);
  assert.equal(d2?.column, 1);
});

// BASE-DOC-004：两个同名 view → base/duplicate-view-name，按规范拒绝歧义选择
test("BASE-DOC-004: 同名 view 产 base/duplicate-view-name 并定位到重名 name 值", () => {
  const doc = load(INVALID, "duplicate-view.base");
  const d = doc.diagnostics.find((x) => x.rule === "base/duplicate-view-name");
  assert.equal(d?.severity, "error");
  assert.equal(d?.target, "All");
  assert.equal(d?.line, 6);
  assert.equal(d?.column, 11);
});

// BASE-DOC-005：指定不存在的 view → base/view-not-found，列出可用名称建议
test("BASE-DOC-005: 指定不存在 view 产 base/view-not-found 且 suggestions 列可用名", () => {
  const doc = load(MINIMAL, "views/projects.base");
  assert.deepEqual(doc.diagnostics, []);
  const { view, diagnostics } = selectView(doc, "Nope");
  assert.equal(view, undefined);
  assert.equal(diagnostics.length, 1);
  const d = diagnostics[0];
  assert.equal(d?.rule, "base/view-not-found");
  assert.equal(d?.severity, "error");
  assert.equal(d?.file, "views/projects.base");
  // 定位到 views key（第 3 行；1=注释 2=filters）
  assert.equal(d?.line, 3);
  assert.equal(d?.column, 1);
  assert.deepEqual(d?.suggestions, ["All"]);
});

// BASE-DOC-006：未知顶层 key → warning 并保留原值；不影响已知字段执行
test("BASE-DOC-006: 未知顶层 key 产 warning 且原值保留、view 正常解析", () => {
  const doc = load(INVALID, "unknown-top-key.base");
  assert.equal(doc.unknownKeys["x-custom"], "keep-me");
  assert.equal(doc.views.length, 1);
  const d = doc.diagnostics.find((x) => x.reason === "unknown_top_level_key");
  assert.equal(d?.severity, "warning");
  assert.equal(d?.target, "x-custom");
  assert.equal(d?.line, 2);
  assert.equal(d?.column, 1);
  // 除该 warning 外无 error（已知字段执行不受影响）
  assert.equal(doc.diagnostics.filter((x) => x.severity === "error").length, 0);
});

// BASE-DOC-007：未知 view type / 插件 view → base/unsupported-view-type，不按 table 猜测
test("BASE-DOC-007: 插件 view type 产 base/unsupported-view-type；cards 产 unsupported-feature", () => {
  const plugin = load(INVALID, "plugin-view.base");
  const d1 = plugin.diagnostics.find((x) => x.rule === "base/unsupported-view-type");
  assert.equal(d1?.severity, "error");
  assert.equal(d1?.target, "kanban");
  assert.equal(d1?.line, 3);
  assert.equal(d1?.column, 11);
  assert.deepEqual(d1?.suggestions, ["table"]);
  // view 仍按原 type 记录（不猜 table），是否拒绝执行由调用方决定
  assert.equal(plugin.views[0]?.type, "kanban");

  // 已知但未支持的 cards/list/map → base/unsupported-feature（error）
  const cards = load(INVALID, "cards-view.base");
  const d2 = cards.diagnostics.find((x) => x.rule === "base/unsupported-feature");
  assert.equal(d2?.severity, "error");
  assert.equal(d2?.target, "cards");
  assert.equal(d2?.line, 3);
  assert.equal(d2?.column, 11);
});

// BASE-DOC-008：旧版 snake_case 函数 → 带表达式位置的 unknown-function，不静默迁移
test("BASE-DOC-008: snake_case 函数产 base/unknown-function（表达式位置），字符串内 foo( 不误报", () => {
  const doc = load(INVALID, "snake-case-function.base");
  // 恰一条诊断：字符串字面量 "foo(1)" 内的 `foo(` 不得误报
  assert.equal(doc.diagnostics.length, 1);
  const d = doc.diagnostics[0];
  assert.equal(d?.rule, "base/unknown-function");
  assert.equal(d?.severity, "error");
  assert.equal(d?.target, "contains_all");
  // 位置 = YAML scalar 起点 + 表达式 UTF-16 offset（fixture 第 6 行 filters 值内）
  assert.equal(d?.line, 6);
  assert.equal(d?.column, 39);
});

// BASE-DOC-009：超深递归 filter 对象 → 在深度预算处拒绝，不能栈溢出
test("BASE-DOC-009: 33 层 and 嵌套在 maxFilterDepth=32 处产 base/execution-budget 且不崩溃", () => {
  const doc = load(INVALID, "deep-filter.base");
  const d = doc.diagnostics.find((x) => x.rule === "base/execution-budget");
  assert.equal(d?.severity, "error");
  assert.equal(d?.reason, "filter_depth");
  assert.equal(d?.line, 37);
  assert.equal(d?.column, 131);
  // 文档其余部分照常解析（view 存在），进程未栈溢出即为本用例主断言
  assert.equal(doc.views[0]?.name, "Deep");
});

// filter children 顺序回归（无矩阵编号，结构不变量）：and 多子节点保持 YAML 声明顺序。
// validateFilter 用 LIFO 显式栈遍历，若正序入栈会导致 children 反转——本用例锁定该回归。
test("filter children 顺序回归：and 子节点保持 YAML 声明顺序", () => {
  const doc = load(MINIMAL, "views/ordered.base");
  assert.deepEqual(doc.diagnostics, []);
  const filter = doc.filters;
  assert.equal(filter?.kind, "and");
  if (filter?.kind !== "and") return;
  const exprs = filter.children.map((c) => (c.kind === "expr" ? c.expr : ""));
  assert.deepEqual(exprs, ['status == "first"', 'status == "second"', 'status == "third"']);
});

// BASE-SEC-007：YAML alias bomb → 安全 schema + alias 预算强制终止
test("BASE-SEC-007: alias bomb 被 maxYamlAliases 预算拒绝（base/execution-budget）", () => {
  const doc = load(SECURITY, "alias-bomb.base");
  assert.equal(doc.views.length, 0);
  const d = doc.diagnostics.find((x) => x.rule === "base/execution-budget");
  assert.equal(d?.severity, "error");
  assert.equal(d?.reason, "yaml_alias_limit");
  assert.equal(d?.file, "alias-bomb.base");
});

// BASE-SEC-008：.base 路径越出 vault → 在文件读取前拒绝 path traversal
test("BASE-SEC-008: `..` 越界与绝对路径绕出均在读取前拒绝（base/path-outside-vault）", () => {
  // `..` 相对路径越界
  const rel = loadBaseDocument({
    basePath: join(INVALID, "..", "minimal", "views", "projects.base"),
    vaultRoots: [INVALID],
  });
  assert.equal(rel.views.length, 0);
  assert.equal(rel.diagnostics.length, 1);
  assert.equal(rel.diagnostics[0]?.rule, "base/path-outside-vault");
  assert.equal(rel.diagnostics[0]?.severity, "error");
  assert.equal(rel.diagnostics[0]?.reason, "outside_vault");

  // 绝对路径绕出（存在于文件系统、但不在声明的 vaultRoots 内）
  const abs = loadBaseDocument({
    basePath: join(MINIMAL, "views", "projects.base"),
    vaultRoots: [SECURITY],
  });
  assert.equal(abs.views.length, 0);
  assert.equal(abs.diagnostics.length, 1);
  assert.equal(abs.diagnostics[0]?.rule, "base/path-outside-vault");
  assert.equal(abs.diagnostics[0]?.severity, "error");
});

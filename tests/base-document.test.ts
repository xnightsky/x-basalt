/**
 * Bases 无头引擎 P0 文档层测试：BASE-DOC-001..009 + BASE-SEC-007/008。
 *
 * 每号独立用例（注释标编号，可追溯至 docs/testing/2026-07-22-bases-scenario-matrix.md §3/§7）；
 * 位置断言一律用 fixture 实际行列（probe 实测后硬编码）。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadBaseDocument, parseBaseSource, selectView } from "../src/base/index.js";

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

// ---------- 2026-07-27 code review 修复批次的回归用例 ----------
// 共同点：这些都是「静默通过」类缺陷——旧实现不产诊断，靠断言诊断存在才锁得住。

// 设计 §5 必填字段：view 缺 type → error（缺失与未知 type 同口径，均不按 table 猜测）
test("设计 §5: view 缺少必填 type 产 base/invalid-schema（不按 table 猜测）", () => {
  const doc = load(INVALID, "missing-view-type.base");
  const d = doc.diagnostics.find((x) => x.reason === "missing_view_type");
  assert.equal(d?.rule, "base/invalid-schema");
  assert.equal(d?.severity, "error");
  assert.equal(d?.target, "type");
  assert.deepEqual(d?.suggestions, ["table"]);
  // 回归点：旧实现校验只在 `case "type"` 分支内，键整个缺失时一条分支都不跑 → 零诊断。
  assert.ok(
    doc.diagnostics.some((x) => x.severity === "error"),
    "缺 type 的 view 必须产 error，否则 engine 会照 table 执行完",
  );
});

// 设计 §5 必填字段：view 缺 name → 每个 view 各一条 error（且不因 name="" 撞成重名）
test("设计 §5: view 缺少必填 name 产 base/invalid-schema（逐 view 一条，不误报重名）", () => {
  const doc = load(INVALID, "missing-view-name.base");
  const missing = doc.diagnostics.filter((x) => x.reason === "missing_view_name");
  assert.equal(missing.length, 2, "两个无名 view 各产一条");
  assert.equal(missing[0]?.rule, "base/invalid-schema");
  assert.equal(missing[0]?.severity, "error");
  // 回归点：旧实现两个 view 都拿到 name=""，既不报缺失也不进 seenNames，重名判定被绕过。
  assert.deepEqual(
    doc.diagnostics.filter((x) => x.rule === "base/duplicate-view-name"),
    [],
    "空名不应误报为重名（重名判定只对非空名生效）",
  );
});

// 设计 §5 结构记录：order/sort 的非法项报错而非静默丢弃
test("设计 §5: order 非字符串项 / sort 非 map 项 / sort 空 property 均产 error，不静默丢弃", () => {
  const doc = load(INVALID, "bad-order-sort-items.base");
  const reasons = doc.diagnostics.filter((x) => x.severity === "error").map((x) => x.reason);
  assert.ok(reasons.includes("non_string_item"), `order 非字符串项：${reasons.join(",")}`);
  assert.ok(reasons.includes("non_map_sort_item"), `sort 非 map 项：${reasons.join(",")}`);
  assert.ok(reasons.includes("empty_sort_property"), `sort 空 property：${reasons.join(",")}`);
  // 合法项仍照常记录（报错不等于整段丢弃）。
  assert.deepEqual(doc.views[0]?.order, ["file.name"]);
  assert.deepEqual(doc.views[0]?.sort, [{ property: "status", direction: "ASC" }]);
});

// BASE-SEC-008 延伸：Windows 盘符大小写不得导致合法路径被安全门假阳拒绝
//
// 翻转路径中**首个字母**的大小写：Windows 大小写不敏感 → 等价路径；
// POSIX 上是另一个（不存在的）目录。不能翻转首字符——POSIX 绝对路径首字符是 `/`，翻转它是 no-op。
function flipFirstLetter(p: string): string {
  const idx = p.search(/[a-zA-Z]/);
  assert.ok(idx >= 0, `fixture 路径应含字母：${p}`);
  const ch = p[idx] as string;
  return (
    p.slice(0, idx) +
    (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) +
    p.slice(idx + 1)
  );
}

test("BASE-SEC-008: vault 根盘符大小写不同不误判越界（Windows 大小写不敏感）", () => {
  const base = join(MINIMAL, "views", "projects.base");
  // 两个变体：根路径首字母（Windows 上即盘符）+ 目录段首字母——后者覆盖盘符之外组件的
  // 大小写不敏感（win32 resolve 不做任何大小写归一，整条路径的等价性都靠 isPathInside 归一）。
  const variants = [
    flipFirstLetter(MINIMAL),
    join(dirname(MINIMAL), flipFirstLetter(basename(MINIMAL))),
  ];
  for (const flipped of variants) {
    const doc = loadBaseDocument({ basePath: base, vaultRoots: [flipped] });
    if (process.platform === "win32") {
      assert.deepEqual(
        doc.diagnostics.filter((x) => x.rule === "base/path-outside-vault"),
        [],
        `Windows 下 ${flipped} 与 ${MINIMAL} 指向同一目录，不得判越界`,
      );
      assert.equal(doc.views.length, 1);
    } else {
      // POSIX 大小写敏感：翻转后确实是别的路径，仍应拒绝（本用例在此平台锁「不误放行」）。
      assert.equal(doc.diagnostics[0]?.rule, "base/path-outside-vault");
    }
  }
});

// BASE-DATA-004 文档层半段：多根下 .base 主键与行 file.path 同一套命名空间键
test("BASE-DATA-004: 多根 vault 下 doc.path 带 <根目录名>/ 前缀，单根保持无前缀", () => {
  const multi = loadBaseDocument({
    basePath: join(MINIMAL, "views", "projects.base"),
    vaultRoots: [MINIMAL, INVALID],
  });
  // 回归点：旧实现只做 relative(root, abs)，多根时 .base 缺命名空间前缀，
  // 而同一结果里行的 file.path（indexer 经 resolveVaultLayout 写入）是带前缀的。
  assert.equal(multi.path, "minimal/views/projects.base");
  // 单根形态字节级不变（向后兼容）。
  const single = loadBaseDocument({
    basePath: join(MINIMAL, "views", "projects.base"),
    vaultRoots: [MINIMAL],
  });
  assert.equal(single.path, "views/projects.base");
});

// 多根目录名冲突：无法判定归属，拒绝执行但如实报原因（不混成「路径越界」）
test("设计 §5: vault 多根目录名冲突时拒绝执行且 reason 不伪装成 outside_vault", () => {
  const doc = loadBaseDocument({
    basePath: join(MINIMAL, "views", "projects.base"),
    vaultRoots: [MINIMAL, join(FIXTURES, "..", "bases", "minimal")],
  });
  // 同一目录去重后是单根，不算冲突——此处应正常解析。
  assert.equal(doc.path, "views/projects.base");
});

// === 动态 base 第一步：parseBaseSource（DB-1，计划 2026-08-03-bases-dynamic-stdin.md） ===
// 把「取 source（文件模式：越界+stat+readFileSync）」与「解析 source（YAML→BaseDocument）」拆开；
// parseBaseSource 是纯解析入口（不碰 fs），file 参数为诊断/结果的展示名（文件模式传 rel，stdin 传 <stdin>）。

// DB-1a：同 source 经 parseBaseSource 与经 loadBaseDocument 产出等价（同 file 名时 views/diagnostics 完全一致）
test("DB-1a: parseBaseSource 与 loadBaseDocument 同 file 名时产出等价", () => {
  const rel = "views/projects.base";
  const source = readFileSync(join(MINIMAL, rel), "utf8");
  const viaFile = loadBaseDocument({ basePath: join(MINIMAL, rel), vaultRoots: [MINIMAL] });
  const viaSource = parseBaseSource(source, { file: rel });
  assert.equal(viaSource.path, rel);
  assert.deepEqual(viaSource.views, viaFile.views);
  assert.deepEqual(viaSource.diagnostics, viaFile.diagnostics);
  assert.deepEqual(viaSource.unknownKeys, viaFile.unknownKeys);
  assert.deepEqual(viaSource.viewsSpan, viaFile.viewsSpan);
});

// DB-1a：非法 YAML 经 parseBaseSource 产出与文件模式同 rule/位置，仅 file 字段为传入名
// DB-1b：虚拟文件名 <stdin> 穿透到 doc.path 与全部诊断 file 字段
// DB-1c：纯字符串入参无路径越界语义（不查 vaultRoots），path-outside-vault 只在文件模式出现
test("DB-1b/c: parseBaseSource 虚拟名 <stdin> 穿透诊断且不触发路径越界", () => {
  const source = readFileSync(join(INVALID, "bad-yaml.base"), "utf8");
  const doc = parseBaseSource(source, { file: "<stdin>" });
  assert.equal(doc.path, "<stdin>");
  assert.equal(doc.views.length, 0);
  assert.equal(doc.diagnostics.length, 1);
  const d = doc.diagnostics[0];
  assert.equal(d?.rule, "base/invalid-yaml");
  assert.equal(d?.severity, "error");
  assert.equal(d?.file, "<stdin>");
  // 位置与文件模式一致（BASE-DOC-002 探针实测值）
  assert.equal(d?.line, 4);
  assert.equal(d?.column, 1);
  // 无任何 path-outside-vault（纯解析入口根本没有 vault 概念）
  assert.ok(!doc.diagnostics.some((x) => x.rule === "base/path-outside-vault"));
});

// DB-1a：合法文档的表达式浅扫描 / filter 结构等完整校验链在 parseBaseSource 中同样生效
// （用 invalid fixture 里带表达式错误的 .base 验证诊断链一致）
test("DB-1a: parseBaseSource 完整校验链（表达式浅扫描）与文件模式一致", () => {
  const rel = "snake-case-function.base";
  const absPath = join(INVALID, rel);
  const source = readFileSync(absPath, "utf8");
  const viaFile = loadBaseDocument({ basePath: absPath, vaultRoots: [INVALID] });
  const viaSource = parseBaseSource(source, { file: rel });
  assert.deepEqual(viaSource.diagnostics, viaFile.diagnostics);
  // 诊断链确实生效：含 unknown-function error（BASE-DOC-008 语义）
  assert.ok(
    viaSource.diagnostics.some((x) => x.rule === "base/unknown-function" && x.severity === "error"),
  );
});

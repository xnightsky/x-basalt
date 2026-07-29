/**
 * Bases 无头引擎 P2b 片三端到端测试：view groupBy 分组 + summaries 汇总。
 *
 * 建库模式照 tests/base-engine.test.ts：VaultIndexer rebuild 到临时库 → close → BaseEngine 只读查询。
 * 每个场景编号独立 test() 并在注释标号（计划 docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md
 * 片三 #8-#11；设计 §13）：
 * - BASE-GROUP-001：标量分组键、组序（ASC/DESC）、组内稳定顺序、missing 键成组（排最后，暂定）；
 * - GROUP-002（暂定拒绝，待 oracle）：list/tag 分组键 → base/unsupported-feature + 空结果；
 * - BASE-SUM-001：15 个内置汇总逐名断言；混合类型跳过、全部跳过 → null；
 *   计算集 = **limit 后**行集（2026-07-29 oracle⑧(b) 跟官方，原「limit 前全量」已翻）；
 * - SUM-002（暂定，待 oracle）：顶层自定义汇总 values.mean().round(3)；values 越权 → MISSING 口径；
 * - 未知汇总名 → base/unknown-function；groupBy/summaries 结构非法 → base/invalid-schema；
 * - 字符串拼接（arithAdd string+string 小修正）e2e。
 *
 * fixture：tests/fixtures/bases/p2/group/vault（6 篇 .md + views/，独立 vault，不动 p1/p2 既有）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_RULES, BaseEngine, type BaseQueryResult } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p2/group/vault", import.meta.url));

/** .base 文件绝对路径（engine 内部 resolve + 越界检查，测试直接给绝对路径）。 */
function baseFile(name: string): string {
  return join(vaultPath, "views", name);
}

let tmpDir: string;
let dbPath: string;
let engine: BaseEngine;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-group-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close(); // 关闭写连接（checkpoint WAL），引擎只读打开
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

/** 单根查询便捷入口（指定 view 名）。 */
function query(base: string, view?: string): BaseQueryResult {
  return engine.query({ basePath: baseFile(base), view, dbPath, vaultRoots: [vaultPath] });
}

/** 结果中的 error 级诊断（主路径断言其为空）。 */
function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** 结果的诊断 rule 列表（按出现顺序）。 */
function rulesOf(r: BaseQueryResult): string[] {
  return r.diagnostics.map((d) => d.rule);
}

// ---------- BASE-GROUP-001：标量分组 ----------

// BASE-GROUP-001：组序 ASC + 组内按 view sort（priority DESC）稳定；顶层 rows 平铺不变
test("BASE-GROUP-001: 标量分组键，组序 ASC，组内 view sort 稳定，顶层 rows 平铺", () => {
  const r = query("group-asc.base", "byStatusAsc");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 6);
  assert.equal(r.rows.length, 6); // 顶层 rows 平铺行为不变（向后兼容）
  assert.ok(r.groups !== undefined);
  // 组序：active < done < paused（字符串 ASC）
  assert.deepEqual(
    r.groups.map((g) => g.key),
    ["active", "done", "paused"],
  );
  // 组内行序 = priority DESC（active：Tagger 5、Beta 2、Alpha 1；done：Gamma 3、Delta 2）
  assert.deepEqual(
    r.groups[0]?.rows.map((row) => row["file.name"]),
    ["Tagger.md", "Beta.md", "Alpha.md"],
  );
  assert.deepEqual(
    r.groups[1]?.rows.map((row) => row["file.name"]),
    ["Gamma.md", "Delta.md"],
  );
  assert.deepEqual(
    r.groups[2]?.rows.map((row) => row["file.name"]),
    ["Epsilon.md"],
  );
  // groups 内 rows 与顶层 rows 同一投影形状
  assert.equal(r.groups[0]?.rows[0]?.["priority"], 5);
  // 未配置 summaries → 字段缺省
  assert.equal(r.summaries, undefined);
});

// BASE-GROUP-001：组序 DESC（组键比较整体取反，沿用顶层 sort 既有口径）
test("BASE-GROUP-001: 组序 DESC（paused/done/active）", () => {
  const r = query("group-asc.base", "byStatusDesc");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["paused", "done", "active"],
  );
});

// BASE-GROUP-001：无显式 sort 时组内按 file.path ASC；default-sort-tiebreak info 照常
test("BASE-GROUP-001: 无显式 sort，组内 file.path ASC 兜底", () => {
  const r = query("group-asc.base", "byStatusDescNoSort");
  assert.deepEqual(errorsOf(r), []);
  assert.ok(rulesOf(r).includes(BASE_RULES.defaultSortTiebreak));
  assert.deepEqual(
    r.groups?.find((g) => g.key === "active")?.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
});

// BASE-GROUP-001：missing 分组键成组（序列化 key=null），暂定排最后
test("BASE-GROUP-001: missing 分组键成组并排最后（暂定口径）", () => {
  const r = query("group-missing.base", "byArea");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["back", "front", null], // missing 键排最后（sortKeyCompare 空值组口径，暂定待 oracle）
  );
  const missingGroup = r.groups?.[2];
  assert.deepEqual(
    missingGroup?.rows.map((row) => row["file.name"]),
    ["Epsilon.md", "Tagger.md"], // 无显式 sort → file.path ASC
  );
});

// GROUP-002（2026-07-28 覆盖率片五落地；暂定口径，待 oracle）：list 分组键**扇出**
test("GROUP-002: list 分组键扇出——一行进入其每个元素的组", () => {
  const r = query("group-list.base", "byTags");
  assert.deepEqual(errorsOf(r), []);
  // 只有 Tagger 有 tags: [x, y] → 进 x 与 y 两组；其余 5 篇 tags 缺失 → MISSING 组（排最后）
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["x", "y", null],
  );
  assert.deepEqual(
    r.groups?.[0]?.rows.map((row) => row["file.name"]),
    ["Tagger.md"],
  );
  assert.deepEqual(
    r.groups?.[1]?.rows.map((row) => row["file.name"]),
    ["Tagger.md"],
  );
  assert.equal(r.groups?.[2]?.rows.length, 5);
  // 顶层 rows 仍是平铺一份（扇出只影响 groups）——契约不变
  assert.equal(r.total, 6);
  assert.equal(r.rows.length, 6);
  // 扇出的代价：组内行数之和 > rows.length（已在 BaseQueryResult.groups 契约声明）
  const summed = r.groups?.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(summed, 7);
});

test("GROUP-002: 扇出跨行重叠 + 行内重复元素去重", () => {
  // list(status, area)：status 值跨行重叠，area 部分行缺失（MISSING 也是一个键）
  const r = query("group-list.base", "byMulti");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["active", "back", "done", "front", "paused", null],
  );
  assert.deepEqual(
    r.groups?.find((g) => g.key === "active")?.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
  // 行内重复元素去重：list(status, status) 不得把同一行塞进同一组两次
  const dup = query("group-list.base", "byDup");
  assert.deepEqual(errorsOf(dup), []);
  assert.deepEqual(
    dup.groups?.find((g) => g.key === "active")?.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
  assert.equal(
    dup.groups?.reduce((n, g) => n + g.rows.length, 0),
    dup.rows.length,
    "每行恰好一个键 → 组内行数之和等于 rows.length",
  );
});

test("GROUP-002: 空 list 键视同 MISSING，不静默丢行", () => {
  const r = query("group-list.base", "byEmpty");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    [null],
  );
  assert.equal(r.groups?.[0]?.rows.length, 6, "全部 6 行都在，未被丢弃");
});

test("GROUP-002: link 是标量键（按路径感知相等分组，组序按归一 path）", () => {
  const r = query("group-list.base", "byLink");
  assert.deepEqual(errorsOf(r), []);
  // link(status)：status 缺失的行 link() 报类型错误 → MISSING 键；其余按归一 path 定序
  assert.deepEqual(
    r.groups?.map((g) => (g.key === null ? null : (g.key as { path: string }).path)),
    ["active", "done", "paused"],
  );
  assert.deepEqual(
    r.groups?.[0]?.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
  // 每行恰好一个键（link 不扇出）
  assert.equal(
    r.groups?.reduce((n, g) => n + g.rows.length, 0),
    r.rows.length,
  );
});

// groupBy 结构非法（direction 非 ASC/DESC）→ base/invalid-schema（error）+ 空结果
test("BASE-GROUP-001: groupBy 结构非法 → base/invalid-schema", () => {
  const r = query("group-bad-schema.base", "bad");
  assert.ok(errorsOf(r).some((e) => e.startsWith(`${BASE_RULES.invalidSchema}: `)));
  assert.equal(r.total, 0);
  assert.deepEqual(r.rows, []);
});

// ---------- BASE-SUM-001：15 个内置汇总 ----------

// BASE-SUM-001：number 组 Average/Min/Max/Sum/Range/Median/Stddev（score=[10,20,30]，missing 跳过）
test("BASE-SUM-001: number 内置汇总（Average/Min/Max/Sum/Range/Median/Stddev）", () => {
  assert.equal(query("summaries-builtin.base", "average").summaries?.["score"], 20);
  assert.equal(query("summaries-builtin.base", "min").summaries?.["score"], 10);
  assert.equal(query("summaries-builtin.base", "max").summaries?.["score"], 30);
  assert.equal(query("summaries-builtin.base", "sum").summaries?.["score"], 60);
  assert.equal(query("summaries-builtin.base", "range").summaries?.["score"], 20); // max-min
  assert.equal(query("summaries-builtin.base", "median").summaries?.["score"], 20);
  // Stddev 为总体标准差（除以 n）：sqrt(((10-20)²+(20-20)²+(30-20)²)/3) = sqrt(200/3)
  const stddev = query("summaries-builtin.base", "stddev").summaries?.["score"];
  assert.ok(typeof stddev === "number");
  assert.ok(Math.abs(stddev - Math.sqrt(200 / 3)) < 1e-12);
});

// BASE-SUM-001：date 组 Earliest/Latest/Range（Range 输出 Duration → number 毫秒）
test("BASE-SUM-001: date 内置汇总（Earliest/Latest/Range）", () => {
  assert.deepEqual(query("summaries-builtin.base", "earliest").summaries?.["due"], {
    type: "date",
    value: "2026-07-20",
  });
  assert.deepEqual(query("summaries-builtin.base", "latest").summaries?.["due"], {
    type: "date",
    value: "2026-08-05",
  });
  // latest - earliest = 16 天 = 16 × 86400000 毫秒（DurationValue 经 toOutputValue → number）
  assert.equal(query("summaries-builtin.base", "dateRange").summaries?.["due"], 16 * 86_400_000);
});

// BASE-SUM-001：boolean 组 Checked/Unchecked（done=[true,false,true,false,true,缺失]）
test("BASE-SUM-001: boolean 内置汇总（Checked/Unchecked）", () => {
  assert.equal(query("summaries-builtin.base", "checked").summaries?.["done"], 3);
  assert.equal(query("summaries-builtin.base", "unchecked").summaries?.["done"], 2);
});

// BASE-SUM-001：any 组 Empty/Filled/Unique（area=[front,back,front,back,缺失,缺失]）
test("BASE-SUM-001: any 内置汇总（Empty/Filled/Unique）", () => {
  assert.equal(query("summaries-builtin.base", "empty").summaries?.["area"], 2);
  assert.equal(query("summaries-builtin.base", "filled").summaries?.["area"], 4);
  // Unique 为 typedEqual 去重计数：front/back/MISSING 三个唯一值
  //（MISSING 只等于 MISSING，计为一个唯一值；暂定口径，与 typedEqual 一致）。
  assert.equal(query("summaries-builtin.base", "unique").summaries?.["area"], 3);
});

// BASE-SUM-001：混合类型跳过（rating=[1,2,"high"] → Average 只计 number）与全部跳过 → null
test("BASE-SUM-001: 混合类型跳过与全部跳过 → null", () => {
  const mixed = query("summaries-builtin.base", "mixedSkip");
  assert.deepEqual(errorsOf(mixed), []);
  assert.equal(mixed.summaries?.["rating"], 1.5); // (1+2)/2；"high" 与 missing 跳过
  const skipped = query("summaries-builtin.base", "allSkipped");
  assert.deepEqual(errorsOf(skipped), []);
  assert.equal(skipped.summaries?.["ghost"], null); // 无任何行有 ghost → 全部跳过 → null
});

// BASE-SUM-001：计算集 = **limit 后**（2026-07-29 oracle⑧(b) 跟官方）。
// 原用例锁的是「limit 前全量」，官方 summary-custom-limited（limit 1）entries=1 证伪，故翻。
test("BASE-SUM-001: 汇总计算集为 limit 后行集（limit=2 → 只汇总前两行）", () => {
  const r = query("summaries-builtin.base", "limitAfter");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.rows.length, 2);
  assert.equal(r.total, 6, "total 仍是 filter 后 limit 前行数，不随汇总口径变");
  // sort score ASC → Alpha(10)/Beta(20)；30 ≠ 60（limit 前全量）≠ 10（只取首行）
  assert.equal(r.summaries?.["score"], 30);
});

// ---------- SUM-002（暂定，待 oracle）：顶层自定义汇总 ----------

// SUM-002（暂定）：官方示例形态 values.mean().round(3) 被 view 引用 → 正确值
test("SUM-002: 顶层自定义汇总 values.mean().round(3)（暂定口径）", () => {
  const r = query("summaries-custom.base", "custom");
  assert.deepEqual(errorsOf(r), []);
  // values = score 跨行非空值 [10,20,30]（null/MISSING 剔除，暂定）；mean=20，round(3)=20
  assert.equal(r.summaries?.["score"], 20);
});

// SUM-002（暂定）：values 越权（引用 file.name）→ 无行上下文，MISSING 口径可观察（结果 null）
test("SUM-002: 自定义汇总 values 越权 → MISSING → 结果 null（暂定口径）", () => {
  const r = query("summaries-custom.base", "customBadScope");
  assert.deepEqual(errorsOf(r), []); // MISSING 非错误：无诊断，结果静默为 null（暂定，注释标）
  assert.equal(r.summaries?.["score"], null);
});

// groupBy 与 summaries 同现：顶层仍产出一份（此 view 无 limit，limit 前后行集相同）
test("BASE-SUM-001: groupBy 与 summaries 同现，顶层汇总仍产出一份", () => {
  const r = query("summaries-custom.base", "withGroup");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["active", "done", "paused"],
  );
  assert.equal(r.summaries?.["score"], 20); // Average(10,20,30)；无 limit 故不受⑧(b) 影响
});

// SUM-002 收口（2026-07-28 覆盖率片五）：groupBy 同现时补组级汇总 groups[].summaries
test("SUM-002: 组级汇总 groups[].summaries（计算集 = 该组 limit 后的行）", () => {
  const r = query("summaries-custom.base", "withGroup");
  assert.deepEqual(errorsOf(r), []);
  // score：Alpha 10 / Beta 20（active）；Gamma 30 / Delta 无（done）；Epsilon 无（paused）
  // Tagger 无 score，也在 active 组 → active 的 Average 仍是 (10+20)/2（missing 被内置汇总跳过）
  const byKey = new Map(r.groups?.map((g) => [g.key, g.summaries]));
  assert.equal(byKey.get("active")?.["score"], 15);
  assert.equal(byKey.get("done")?.["score"], 30);
  assert.equal(byKey.get("paused")?.["score"], null, "组内全部跳过 → null（同顶层口径）");
  // 顶层 summaries 与组级并存（顶层 = 整个 limit 后行集 20，组级 = 各组自己的子集）
  assert.equal(r.summaries?.["score"], 20);
});

// ⑧(b) 收益锁定（2026-07-29）：limit 同现时顶层与组级计算集统一，不再分裂
test("BASE-SUM-001: groupBy + limit + summaries → 顶层与组级同为 limit 后行集", () => {
  const r = query("summaries-custom.base", "withGroupLimited");
  assert.deepEqual(errorsOf(r), []);
  // sort score ASC + limit 2 → Alpha(active,10)/Beta(active,20)；done/paused 组被 limit 掉
  assert.equal(r.rows.length, 2);
  assert.deepEqual(
    r.groups?.map((g) => g.key),
    ["active"],
    "limit 后只剩 active 组的行，其余组不成组",
  );
  const active = r.groups?.[0]?.summaries?.["score"];
  assert.equal(active, 15, "组级 Average(10,20)");
  assert.equal(
    r.summaries?.["score"],
    15,
    "顶层同为 limit 后行集 → 与组级一致；旧口径此处为 20（全量 Average(10,20,30)）",
  );
});

// 未知汇总名 → base/unknown-function（error）+ 空结果
test("BASE-SUM-001: 未知汇总名 → base/unknown-function", () => {
  const r = query("summaries-unknown.base", "unknown");
  const errors = errorsOf(r);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.startsWith(`${BASE_RULES.unknownFunction}: `));
  assert.ok(errors[0]?.includes("DefinitelyNotASummary"));
  assert.equal(r.total, 0);
  assert.equal(r.summaries, undefined);
});

// view summaries 结构非法（非 map）→ base/invalid-schema（error）+ 空结果
test("BASE-SUM-001: view summaries 结构非法 → base/invalid-schema", () => {
  const r = query("summaries-bad-schema.base", "bad");
  assert.ok(errorsOf(r).some((e) => e.startsWith(`${BASE_RULES.invalidSchema}: `)));
  assert.equal(r.total, 0);
});

// ---------- 字符串拼接（P2b 片三小修正：arithAdd string + string）----------

// "a" + "b" e2e：投影表达式中 string + string → 拼接（官方示例 formatted_price 形态）
test("字符串拼接: 投影中 string + string → 拼接", () => {
  const r = query("concat.base", "concat");
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.total, 6);
  assert.equal(r.rows[0]?.['"pre-" + status'], "pre-active"); // file.name ASC 首行 Alpha
  assert.equal(r.rows[2]?.['"pre-" + status'], "pre-done"); // Gamma
});

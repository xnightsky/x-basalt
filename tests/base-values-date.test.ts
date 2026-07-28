/**
 * Bases P2a typed runtime values 测试（值层半段，文法半段在 base-expression.test.ts）：
 * - BASE-FORM-001 值层半段：算术允许矩阵 / duration 换算 / 除零；
 * - BASE-FORM-006 值层半段：today()/now() 注入固定 clock 的确定性；
 * - BASE-TYPE-005 暂定机制半段：date vs datetime 跨精度按 epoch（待 oracle 冻结）；
 * - BASE-TYPE-006 暂定机制半段：frontmatter wikilink 字符串 → Link value（待 oracle 冻结）。
 *
 * 每号独立用例（注释标编号）；本片不接 evaluator，直接测 values.ts 纯函数与注册表 impl。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BaseTypeError,
  MISSING,
  arithAdd,
  arithDiv,
  arithMul,
  arithNeg,
  arithSub,
  compareValues,
  createDateValue,
  createDurationValue,
  isDateValue,
  isDurationValue,
  isLinkValue,
  lookupBaseFunction,
  parseDateLike,
  parseWikilinkValue,
  sortKeyCompare,
  sortKeyCompareDirected,
  toOutputValue,
  typedEqual,
  type BaseFunctionContext,
} from "../src/base/index.js";

/** 固定时钟（FORM-006 口径：注入后重复运行结果完全一致）。 */
const FIXED = new Date(Date.UTC(2026, 6, 27, 10, 30, 45, 123));
const fixedCtx: BaseFunctionContext = {
  checkCollectionSize: () => {},
  spendElementCompare: () => {},
  clock: () => new Date(FIXED.getTime()),
};

const DAY_MS = 86_400_000;

// BASE-TYPE-005（暂定机制半段）：parseDateLike 严格 ISO 推断各形态
test("parseDateLike：date / datetime / 时区各形态", () => {
  // date 形态 → 当日 UTC 00:00
  const d = parseDateLike("2026-07-27");
  assert.ok(d !== undefined && isDateValue(d));
  assert.equal(d.precision, "date");
  assert.equal(d.epochMs, Date.UTC(2026, 6, 27));
  // datetime 无秒
  const t1 = parseDateLike("2026-07-27T10:30");
  assert.ok(t1 !== undefined);
  assert.equal(t1.precision, "datetime");
  assert.equal(t1.epochMs, Date.UTC(2026, 6, 27, 10, 30));
  // datetime 带秒
  const t2 = parseDateLike("2026-07-27T10:30:45");
  assert.equal(t2?.epochMs, Date.UTC(2026, 6, 27, 10, 30, 45));
  // Z 后缀与无时区同口径（拍板：naive 按 UTC 解释）
  const t3 = parseDateLike("2026-07-27T10:30:45Z");
  assert.equal(t3?.epochMs, t2?.epochMs);
  // ±hh:mm 时区偏移：+08:00 → epoch 减 8 小时
  const t4 = parseDateLike("2026-07-27T10:30+08:00");
  assert.equal(t4?.epochMs, Date.UTC(2026, 6, 27, 2, 30));
  // 负偏移：-05:30 → epoch 加 5.5 小时
  const t5 = parseDateLike("2026-07-27T10:30-05:30");
  assert.equal(t5?.epochMs, Date.UTC(2026, 6, 27, 16, 0));
});

// BASE-TYPE-005（暂定机制半段）：非法/不补零/非字符串一律 undefined（不猜）
test("parseDateLike：非法形态拒绝", () => {
  for (const bad of [
    "2026-13-40", // 月份/日越界
    "2026-02-30", // 日历不存在的日（Date.UTC 滚动溢出须被回验拒绝）
    "2026-1-1", // 非补零
    "2026-07-27T25:00", // 小时越界
    "2026-07-27T10:61", // 分钟越界
    "2026-07-27 10:30", // 空格分隔（非 T）
    "2026-07-27T10:30:45.123", // 毫秒形态不在严格子集内
    "hello",
    "",
  ]) {
    assert.equal(parseDateLike(bad), undefined, `应拒绝: ${bad}`);
  }
  // 非字符串输入
  assert.equal(parseDateLike(42), undefined);
  assert.equal(parseDateLike(null), undefined);
  assert.equal(parseDateLike(undefined), undefined);
});

// BASE-FORM-001（值层半段）：duration 单位毫秒换算（month=30day、year=365day 固定约定）
test("duration 换算：单位表与 month/year 固定约定", () => {
  assert.equal(createDurationValue(1, "millisecond").ms, 1);
  assert.equal(createDurationValue(1, "second").ms, 1_000);
  assert.equal(createDurationValue(1, "minute").ms, 60_000);
  assert.equal(createDurationValue(1, "hour").ms, 3_600_000);
  assert.equal(createDurationValue(1, "day").ms, DAY_MS);
  assert.equal(createDurationValue(1, "week").ms, 7 * DAY_MS);
  assert.equal(createDurationValue(1, "month").ms, 30 * DAY_MS); // 固定约定
  assert.equal(createDurationValue(1, "year").ms, 365 * DAY_MS); // 固定约定
  assert.equal(createDurationValue(2.5, "day").ms, 2.5 * DAY_MS);
});

// BASE-FORM-001（值层半段）：算术允许矩阵逐条（+）
test("算术矩阵：arithAdd 允许组合", () => {
  assert.equal(arithAdd(1, 2), 3);
  const date = createDateValue("date", Date.UTC(2026, 6, 27));
  const day = createDurationValue(1, "day");
  // date + duration → 同精度 date
  const r1 = arithAdd(date, day);
  assert.ok(isDateValue(r1) && r1.precision === "date");
  assert.equal(r1.epochMs, Date.UTC(2026, 6, 28));
  // duration + datetime → 同精度 datetime（交换律）
  const dt = createDateValue("datetime", Date.UTC(2026, 6, 27, 10, 30));
  const r2 = arithAdd(day, dt);
  assert.ok(isDateValue(r2) && r2.precision === "datetime");
  assert.equal(r2.epochMs, Date.UTC(2026, 6, 28, 10, 30));
  // duration + duration
  const r3 = arithAdd(day, createDurationValue(2, "hour"));
  assert.ok(isDurationValue(r3));
  assert.equal(r3.ms, DAY_MS + 2 * 3_600_000);
  // P2b 片三：string + string → 拼接（官方示例 formatted_price 形态）
  assert.equal(arithAdd("a", "b"), "ab");
  assert.equal(arithAdd("", "x"), "x");
});

// BASE-FORM-001（值层半段）：算术允许矩阵逐条（-）
test("算术矩阵：arithSub 允许组合", () => {
  assert.equal(arithSub(5, 2), 3);
  const date = createDateValue("date", Date.UTC(2026, 6, 27));
  const day = createDurationValue(1, "day");
  // date - duration → 同精度 date
  const r1 = arithSub(date, day);
  assert.ok(isDateValue(r1) && r1.epochMs === Date.UTC(2026, 6, 26));
  // duration - duration
  const r2 = arithSub(day, createDurationValue(1, "hour"));
  assert.ok(isDurationValue(r2) && r2.ms === DAY_MS - 3_600_000);
  // datetime - datetime → duration（epoch 差）
  const t1 = createDateValue("datetime", Date.UTC(2026, 6, 27, 10, 30));
  const t0 = createDateValue("datetime", Date.UTC(2026, 6, 26, 10, 30));
  const r3 = arithSub(t1, t0);
  assert.ok(isDurationValue(r3) && r3.ms === DAY_MS);
  // date - date → duration
  const r4 = arithSub(createDateValue("date", Date.UTC(2026, 6, 28)), date);
  assert.ok(isDurationValue(r4) && r4.ms === DAY_MS);
  // 跨精度 date - datetime → duration（暂定按 epoch，待 oracle BASE-TYPE-005）
  const r5 = arithSub(t1, date);
  assert.ok(isDurationValue(r5) && r5.ms === 10.5 * 3_600_000);
});

// BASE-FORM-001（值层半段）：算术允许矩阵逐条（* / 与一元负）
test("算术矩阵：arithMul / arithDiv / arithNeg 允许组合", () => {
  const day = createDurationValue(1, "day");
  assert.equal(arithMul(2, 3), 6);
  // duration * number / number * duration
  const m1 = arithMul(day, 2);
  assert.ok(isDurationValue(m1) && m1.ms === 2 * DAY_MS);
  const m2 = arithMul(2, day);
  assert.ok(isDurationValue(m2) && m2.ms === 2 * DAY_MS);
  assert.equal(arithDiv(7, 2), 3.5);
  // duration / number
  const d1 = arithDiv(day, 2);
  assert.ok(isDurationValue(d1) && d1.ms === DAY_MS / 2);
  // 一元负：number 与 duration（拍板允许负 duration）
  assert.equal(arithNeg(5), -5);
  const n1 = arithNeg(day);
  assert.ok(isDurationValue(n1) && n1.ms === -DAY_MS);
});

// BASE-FORM-001（值层半段）：除零 → BaseTypeError（行级类型错误），不产 Infinity
test("算术矩阵：除零抛 BaseTypeError", () => {
  assert.throws(() => arithDiv(1, 0), BaseTypeError);
  assert.throws(() => arithDiv(createDurationValue(1, "day"), 0), BaseTypeError);
});

// BASE-FORM-001（值层半段）：矩阵外组合一律 BaseTypeError（不静默强转）
test("算术矩阵：拒绝组合抛 BaseTypeError", () => {
  const date = createDateValue("date", Date.UTC(2026, 6, 27));
  const day = createDurationValue(1, "day");
  assert.throws(() => arithAdd("a", 1), BaseTypeError); // string + number
  assert.throws(() => arithAdd(1, "a"), BaseTypeError); // number + string（P2b 片三：拼接仅限双侧 string）
  assert.throws(() => arithAdd(date, date), BaseTypeError); // date + date
  assert.throws(() => arithSub(day, date), BaseTypeError); // duration - date
  assert.throws(() => arithMul(date, 2), BaseTypeError); // date * number
  // duration / duration：P2a 片二改为允许（→ 无量纲 number 比值，
  // 官方示例 `(now() - file.ctime) / 1day` 必需）；除零仍拒绝。
  const ratio = arithDiv(createDurationValue(2, "day"), day);
  assert.equal(ratio, 2);
  assert.throws(() => arithDiv(day, createDurationValue(0, "day")), BaseTypeError);
  assert.throws(() => arithDiv(date, 2), BaseTypeError); // date / number
  assert.throws(() => arithNeg("a"), BaseTypeError); // -string
  assert.throws(() => arithNeg(date), BaseTypeError); // -date
  assert.throws(() => arithAdd(null, 1), BaseTypeError); // null + number
});

// BASE-TYPE-005（暂定机制半段）：typedEqual 的 Date/Duration/Link 扩展
test("typedEqual：date/duration/link 扩展", () => {
  const d1 = createDateValue("date", Date.UTC(2026, 6, 27));
  const d2 = createDateValue("date", Date.UTC(2026, 6, 27));
  const d3 = createDateValue("date", Date.UTC(2026, 6, 28));
  assert.ok(typedEqual(d1, d2));
  assert.ok(!typedEqual(d1, d3));
  // 跨精度（date vs datetime）同 epoch 暂定相等——待 oracle BASE-TYPE-005 冻结
  const dt = createDateValue("datetime", Date.UTC(2026, 6, 27));
  assert.ok(typedEqual(d1, dt));
  // duration 按毫秒：`1day` == `24hours`
  assert.ok(typedEqual(createDurationValue(1, "day"), createDurationValue(24, "hour")));
  assert.ok(!typedEqual(createDurationValue(1, "day"), createDurationValue(1, "week")));
  // link 按归一 path（大小写/扩展名不敏感）+ subpath；display 不影响相等
  const l1 = parseWikilinkValue("[[Folder/Note|别名]]");
  const l2 = parseWikilinkValue("[[folder/note.md]]");
  assert.ok(l1 !== undefined && l2 !== undefined);
  assert.ok(typedEqual(l1, l2));
  const l3 = parseWikilinkValue("[[Folder/Note#Section]]");
  assert.ok(l3 !== undefined);
  assert.ok(!typedEqual(l1, l3)); // subpath 不同
  // link 与 string 不相等（类型不同）
  assert.ok(!typedEqual(l1, "folder/note"));
});

// BASE-TYPE-005（暂定机制半段）：compareValues / sortKeyCompare 扩展
test("compareValues：date/duration 可比，link 与混合类型抛 BaseTypeError", () => {
  const d1 = createDateValue("date", Date.UTC(2026, 6, 27));
  const d2 = createDateValue("datetime", Date.UTC(2026, 6, 28));
  // date ↔ datetime 跨精度暂定按 epoch 可比（待 oracle BASE-TYPE-005）
  assert.equal(compareValues(d1, d2), -1);
  assert.equal(compareValues(d2, d1), 1);
  assert.equal(compareValues(d1, createDateValue("date", Date.UTC(2026, 6, 27))), 0);
  // duration 按毫秒
  assert.equal(compareValues(createDurationValue(1, "day"), createDurationValue(24, "hour")), 0);
  assert.equal(compareValues(createDurationValue(1, "day"), createDurationValue(1, "week")), -1);
  // number 与 DateValue 不可直接比较
  assert.throws(() => compareValues(1, d1), BaseTypeError);
  assert.throws(() => compareValues(d1, 1), BaseTypeError);
  // string 与 DateValue 不可比较（推断后的品牌值不再按字符串字典序）
  assert.throws(() => compareValues("2026-07-27", d1), BaseTypeError);
  // link 不可比
  const link = parseWikilinkValue("[[Note]]");
  assert.ok(link !== undefined);
  assert.throws(() => compareValues(link, link), BaseTypeError);
});

// BASE-TYPE-005（暂定机制半段）：sortKeyCompare——date/duration 入排序组，link 排序报错
test("sortKeyCompare：date/duration 排序组与 link 拒绝", () => {
  const d1 = createDateValue("date", Date.UTC(2026, 6, 27));
  const d2 = createDateValue("date", Date.UTC(2026, 6, 28));
  assert.equal(sortKeyCompare(d1, d2), -1);
  assert.equal(sortKeyCompare(createDurationValue(1, "week"), createDurationValue(1, "day")), 1);
  // number 与 date 混排：确定性分组（rank 差），不抛（排序口径，非比较语义）
  assert.ok(sortKeyCompare(1, d1) < 0); // number 组在 date 组前
  assert.ok(sortKeyCompare(d1, "a") > 0); // date 组在 string 组后
  // link 排序 → BaseTypeError（下一片 engine 转行级错误）
  const link = parseWikilinkValue("[[Note]]");
  assert.ok(link !== undefined);
  assert.throws(() => sortKeyCompare(link, link), BaseTypeError);
});

// oracle runbook ②（BASE-RESULT-002，官方 1.12.7 冻结）：方向只作用于可比值，
// 空值组恒最后——sortKeyCompareDirected 存在的唯一理由就是替掉调用方的 `-c` 取反。
test("sortKeyCompareDirected：空值组恒最后（DESC 不翻转），可比值随方向", () => {
  // 可比值：方向生效。
  assert.equal(sortKeyCompareDirected(1, 2, "ASC"), -1);
  assert.equal(sortKeyCompareDirected(1, 2, "DESC"), 1);
  // 空值 vs 可比值：两个方向下空值都在后。
  for (const dir of ["ASC", "DESC"] as const) {
    assert.equal(sortKeyCompareDirected(null, 1, dir), 1, `null 在后（${dir}）`);
    assert.equal(sortKeyCompareDirected(1, null, dir), -1, `null 在后（${dir}）`);
    assert.equal(sortKeyCompareDirected(MISSING, "a", dir), 1, `missing 在后（${dir}）`);
    assert.equal(sortKeyCompareDirected("a", MISSING, dir), -1, `missing 在后（${dir}）`);
    // 不可比较类型（boolean/list/object/file）与空值同组，同样恒最后。
    assert.equal(sortKeyCompareDirected(true, 1, dir), 1, `boolean 在后（${dir}）`);
    // 两侧都空 → 0（由调用方的 file.path tie-break 兜底）。
    assert.equal(sortKeyCompareDirected(null, MISSING, dir), 0);
  }
  // link 仍不参与排序（方向不改变这条）。
  const link = parseWikilinkValue("[[Note]]");
  assert.ok(link !== undefined);
  assert.throws(() => sortKeyCompareDirected(link, 1, "DESC"), BaseTypeError);
});

// BASE-TYPE-006（暂定机制半段）：parseWikilinkValue 三形态 + 非 wikilink 串
test("parseWikilinkValue：[[target]] / [[target|display]] / [[target#subpath]]", () => {
  // 形态一：裸 target（path 归一：POSIX + 去扩展名 + 小写）
  const l1 = parseWikilinkValue("[[Note]]");
  assert.ok(l1 !== undefined && isLinkValue(l1));
  assert.equal(l1.path, "note");
  assert.equal(l1.target, "Note");
  assert.equal(l1.display, undefined);
  assert.equal(l1.subpath, undefined);
  // 形态二：带 display
  const l2 = parseWikilinkValue("[[Folder/Note|别名]]");
  assert.ok(l2 !== undefined);
  assert.equal(l2.path, "folder/note");
  assert.equal(l2.display, "别名");
  // 形态三：带 subpath（heading 与 block 引用）
  const l3 = parseWikilinkValue("[[Note#Section]]");
  assert.ok(l3 !== undefined);
  assert.equal(l3.subpath, "Section");
  const l4 = parseWikilinkValue("[[Note#^block-id]]");
  assert.ok(l4 !== undefined);
  assert.equal(l4.subpath, "^block-id");
  // 组合：target + subpath + display
  const l5 = parseWikilinkValue("[[Folder/Note#Sec|显示]]");
  assert.ok(l5 !== undefined);
  assert.equal(l5.path, "folder/note");
  assert.equal(l5.subpath, "Sec");
  assert.equal(l5.display, "显示");
});

// BASE-TYPE-006（暂定机制半段）：非 wikilink 整串一律 undefined
test("parseWikilinkValue：非 wikilink 串拒绝", () => {
  for (const bad of [
    "plain",
    "[Note]", // 单方括号
    "[[Note]] extra", // 尾随文本（必须整串恰为一个 wikilink）
    "prefix [[Note]]",
    "[[ ]]", // 空 target
    "[[#heading]]", // 同文锚点（target 为空，暂不接受）
    "[[Note]extra]",
    "",
  ]) {
    assert.equal(parseWikilinkValue(bad), undefined, `应拒绝: ${bad}`);
  }
});

// 输出序列化（P2a 计划「关键取舍」#2/#9）：稳定 JSON 形状、无品牌泄漏
test("toOutputValue：date/datetime/duration/link 序列化形状", () => {
  // date → { type: "date", value: "YYYY-MM-DD" }
  assert.deepEqual(toOutputValue(createDateValue("date", Date.UTC(2026, 6, 27))), {
    type: "date",
    value: "2026-07-27",
  });
  // datetime → { type: "datetime", value: ISO }
  assert.deepEqual(toOutputValue(createDateValue("datetime", Date.UTC(2026, 6, 27, 10, 30, 45))), {
    type: "datetime",
    value: "2026-07-27T10:30:45.000Z",
  });
  // duration → number 毫秒（P2a 无 duration 输出形状约定，拍板直出毫秒）
  assert.equal(toOutputValue(createDurationValue(1, "day")), DAY_MS);
  // link → { type: "link", path, display?, subpath? }
  const link = parseWikilinkValue("[[Folder/Note#Sec|别名]]");
  assert.ok(link !== undefined);
  assert.deepEqual(toOutputValue(link), {
    type: "link",
    path: "folder/note",
    display: "别名",
    subpath: "Sec",
  });
  // 无品牌泄漏：序列化结果 JSON 中不出现内部字段/品牌
  const json = JSON.stringify({
    d: toOutputValue(createDateValue("datetime", Date.UTC(2026, 6, 27))),
    l: toOutputValue(link),
  });
  assert.ok(!json.includes("epochMs"), "不得泄漏 epochMs");
  assert.ok(!json.includes("base."), "不得泄漏品牌 symbol 描述");
});

// BASE-FORM-006（值层半段）：today()/now() 注册表条目 + 注入固定 clock 的确定性
test("today()/now()：注册表条目与注入 clock 确定性", () => {
  const today = lookupBaseFunction("today", "global");
  const now = lookupBaseFunction("now", "global");
  assert.ok(today !== undefined && now !== undefined);
  assert.deepEqual(today.arity, { min: 0, max: 0 });
  assert.deepEqual(now.arity, { min: 0, max: 0 });
  // today → date（当日 UTC 00:00）
  const t1 = today.impl(null, [], fixedCtx, today);
  assert.ok(isDateValue(t1) && t1.precision === "date");
  assert.equal(t1.epochMs, Date.UTC(2026, 6, 27));
  // now → datetime（注入时钟原样）
  const n1 = now.impl(null, [], fixedCtx, now);
  assert.ok(isDateValue(n1) && n1.precision === "datetime");
  assert.equal(n1.epochMs, FIXED.getTime());
  // 同一固定 clock 重复调用结果完全一致（FORM-006 字节稳定口径的值层半段）
  const t2 = today.impl(null, [], fixedCtx, today);
  const n2 = now.impl(null, [], fixedCtx, now);
  assert.ok(typedEqual(t1, t2));
  assert.ok(typedEqual(n1, n2));
  assert.deepEqual(toOutputValue(t1), toOutputValue(t2));
  assert.deepEqual(toOutputValue(n1), toOutputValue(n2));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applySets, coerceForProfile, diffProfile, prefillTrivial } from "../src/meta/apply.js";
import { splitDocument } from "../src/meta/document.js";
import { getMeta } from "../src/meta/operations.js";
import { getProfile } from "../src/meta/profiles.js";

// === MW3.2 apply 纯函数：diff / 机械预填 / 按 profile 类型转值 / 消费者 kwargs（top-up）===
// 计划：docs/plans/2026-06-28-meta-derive-profiles.md（pkm-note 为第一推荐，作主例）

const PKM = getProfile("pkm-note");
const WIKI = getProfile("llm-wiki");
const CTX = {
  birthtime: new Date("2026-01-01T00:00:00Z"),
  mtime: new Date("2026-06-28T10:30:00Z"),
  body: "# H\n\nbody\n",
};
const docOf = (content: string) => splitDocument(content).doc;

test("MW3.2 Given 空 frontmatter When diffProfile(pkm-note) Then 按角色分组 present/missing", () => {
  const d = diffProfile(docOf("---\n---\nbody\n"), PKM);
  assert.deepEqual(d.present, []);
  assert.deepEqual(d.missing.required, []); // pkm-note 无必填
  assert.deepEqual(d.missing.recommended, ["tags", "created", "modified"]);
  assert.deepEqual(d.missing.optional, ["aliases", "cssclasses", "status"]);
});

test("MW3.2 Given 已有 tags/created When diffProfile Then 计入 present", () => {
  const d = diffProfile(docOf("---\ntags: [x]\ncreated: y\n---\nb\n"), PKM);
  assert.deepEqual(d.present, ["tags", "created"]);
  assert.ok(!d.missing.recommended.includes("tags"));
  assert.ok(!d.missing.recommended.includes("created"));
});

test("MW3.2 Given 空 doc When prefillTrivial Then 只补 created/modified、不碰语义字段", () => {
  const doc = docOf("---\n---\nbody\n");
  const filled = prefillTrivial(doc, PKM, CTX);
  assert.deepEqual(filled, ["created", "modified"]);
  assert.equal(getMeta(doc, "created"), "2026-01-01T00:00:00Z"); // birthtime
  assert.equal(getMeta(doc, "modified"), "2026-06-28T10:30:00Z"); // mtime
  assert.equal(getMeta(doc, "tags"), undefined); // 语义字段不机械补
  assert.equal(getMeta(doc, "status"), undefined);
});

test("MW3.2 Given 机械字段已有 When prefillTrivial Then 跳过已有、二次幂等", () => {
  const doc = docOf("---\ncreated: keep\n---\nbody\n");
  assert.deepEqual(prefillTrivial(doc, PKM, CTX), ["modified"]); // created 已有→跳过
  assert.equal(getMeta(doc, "created"), "keep");
  assert.deepEqual(prefillTrivial(doc, PKM, CTX), []); // 二次无补
});

test("MW3.2 Given profile 字段类型 When coerceForProfile Then 按类型转值", () => {
  assert.deepEqual(coerceForProfile(PKM, "tags", "a, b ,c"), ["a", "b", "c"]); // list 拆
  assert.equal(coerceForProfile(PKM, "status", "draft"), "draft"); // string
  assert.equal(coerceForProfile(PKM, "created", "2026-01-01"), "2026-01-01"); // datetime→字符串
  assert.equal(coerceForProfile(PKM, "priority", "3"), 3); // 额外 key → auto → number
  assert.equal(coerceForProfile(PKM, "pinned", "true"), true); // 额外 key → auto → bool
});

test("MW3.2 Given 消费者 kwargs When applySets Then 缺则补、已有则覆盖（显式权威）、按类型转", () => {
  const doc = docOf("---\ntags: [keep]\n---\nbody\n");
  const r = applySets(doc, PKM, { tags: "new", status: "active", aliases: "别名 一,别名二" });
  assert.deepEqual(r.overridden, ["tags"]); // 已有→被覆盖
  assert.deepEqual(r.filled, ["status", "aliases"]); // 原本缺→新补
  assert.deepEqual(getMeta(doc, "tags"), ["new"]); // 覆盖为新值（list 拆）
  assert.equal(getMeta(doc, "status"), "active");
  assert.deepEqual(getMeta(doc, "aliases"), ["别名 一", "别名二"]); // list 拆（别名可含空格）
});

// === MW3.2.1 refresh-derived 开关：内容派生字段可重算，创建时间恒定，--set 显式值优先 ===

test("MW3.2.1 Given 内容派生字段已有、未开 refresh When prefillTrivial Then 仍跳过（回归保障）", () => {
  const doc = docOf("---\ntimestamp: old\nsha256: oldhash\n---\nbody\n");
  const filled = prefillTrivial(doc, WIKI, CTX);
  assert.ok(!filled.includes("timestamp"));
  assert.ok(!filled.includes("sha256"));
  assert.equal(getMeta(doc, "timestamp"), "old");
  assert.equal(getMeta(doc, "sha256"), "oldhash");
});

test("MW3.2.1 Given 内容派生字段已有、refresh=true When prefillTrivial Then 重算覆盖", () => {
  const doc = docOf("---\ntimestamp: old\nsha256: oldhash\n---\nbody\n");
  const filled = prefillTrivial(doc, WIKI, CTX, { refresh: true });
  assert.ok(filled.includes("timestamp"));
  assert.ok(filled.includes("sha256"));
  assert.equal(getMeta(doc, "timestamp"), "2026-06-28T10:30:00Z");
  assert.notEqual(getMeta(doc, "sha256"), "oldhash");
});

test("MW3.2.1 Given 创建时间字段已有、refresh=true When prefillTrivial Then 仍不重算（恒定）", () => {
  const doc = docOf("---\ncreated: keep\nmodified: old\n---\nbody\n");
  const filled = prefillTrivial(doc, PKM, CTX, { refresh: true });
  assert.ok(filled.includes("modified"));
  assert.ok(!filled.includes("created"));
  assert.equal(getMeta(doc, "created"), "keep");
  assert.equal(getMeta(doc, "modified"), "2026-06-28T10:30:00Z");
});

test("MW3.2.1 Given --set 字段在 protect 中、refresh=true When prefillTrivial Then 永不写入/重算", () => {
  const doc = docOf("---\ntimestamp: old\n---\nbody\n");
  const filled = prefillTrivial(doc, WIKI, CTX, { refresh: true, protect: new Set(["timestamp"]) });
  assert.ok(!filled.includes("timestamp"));
  assert.equal(getMeta(doc, "timestamp"), "old");
});

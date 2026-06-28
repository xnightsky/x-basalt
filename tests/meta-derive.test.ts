import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { deriveValue } from "../src/meta/derive.js";
import { getProfile, listProfiles } from "../src/meta/profiles.js";

// === MW3.1 profiles（模板+规范）+ derive（机械预填来源）===
// 计划：docs/plans/2026-06-28-meta-derive-profiles.md
// derive 只做"无需判断"的机械字段：birthtime / mtime / sha256-body；语义字段不机械补（交消费者）。

test("MW3.1 Given mtime When deriveValue Then 输出去毫秒的 ISO 字符串", () => {
  const d = new Date("2026-06-28T10:30:00.123Z");
  assert.equal(deriveValue("mtime", { birthtime: d, mtime: d, body: "" }), "2026-06-28T10:30:00Z");
});

test("MW3.1 Given 可靠 birthtime When deriveValue Then 用 birthtime；不可靠（晚于 mtime/为0）回退 mtime", () => {
  const birth = new Date("2026-01-01T00:00:00Z");
  const mod = new Date("2026-06-28T10:30:00Z");
  // birthtime 早于 mtime → 用 birthtime
  assert.equal(
    deriveValue("birthtime", { birthtime: birth, mtime: mod, body: "" }),
    "2026-01-01T00:00:00Z",
  );
  // birthtime 晚于 mtime（不可靠）→ 回退 mtime
  assert.equal(
    deriveValue("birthtime", { birthtime: mod, mtime: birth, body: "" }),
    "2026-01-01T00:00:00Z",
  );
  // birthtime 为 epoch 0（不可靠）→ 回退 mtime
  assert.equal(
    deriveValue("birthtime", { birthtime: new Date(0), mtime: mod, body: "" }),
    "2026-06-28T10:30:00Z",
  );
});

test("MW3.1 Given 正文 When deriveValue sha256-body Then 对正文算 sha256 hex（64 位）", () => {
  const body = "# Title\n\nsome body text\n";
  const ctx = { birthtime: new Date(0), mtime: new Date(0), body };
  const got = deriveValue("sha256-body", ctx) as string;
  assert.equal(got, createHash("sha256").update(body, "utf8").digest("hex"));
  assert.equal(got.length, 64);
  assert.notEqual(got, deriveValue("sha256-body", { ...ctx, body: body + "x" }));
});

test("MW3.1 Given pkm-note（第一推荐）When getProfile Then 字段角色/derive 标注正确", () => {
  const p = getProfile("pkm-note");
  const by = Object.fromEntries(p.fields.map((f) => [f.key, f]));
  assert.equal(by.created?.derive, "birthtime");
  assert.equal(by.modified?.derive, "mtime");
  assert.equal(by.tags?.role, "recommended");
  assert.equal(by.tags?.derive, undefined); // 语义字段不机械补
  assert.equal(by.aliases?.type, "list");
  assert.ok(p.summary.length > 0 && p.extras.length > 0 && p.source.length > 0);
});

test("MW3.1 Given llm-wiki（第二套）When getProfile Then derive 标注正确", () => {
  const by = Object.fromEntries(getProfile("llm-wiki").fields.map((f) => [f.key, f]));
  assert.equal(by.type?.role, "required");
  assert.equal(by.type?.derive, undefined);
  assert.equal(by.timestamp?.derive, "mtime");
  assert.equal(by.sha256?.derive, "sha256-body");
});

test("MW3.1 Given 未知 profile When getProfile Then 报错并列可用名", () => {
  assert.throws(() => getProfile("nope"), /未知 profile.*pkm-note/s);
});

test("MW3.1 Given ssg-blog（第三套）When getProfile Then derive 标注正确", () => {
  const by = Object.fromEntries(getProfile("ssg-blog").fields.map((f) => [f.key, f]));
  assert.equal(by.pubDate?.role, "required");
  assert.equal(by.pubDate?.derive, "birthtime");
  assert.equal(by.updatedDate?.derive, "mtime");
  assert.equal(by.title?.role, "required");
  assert.equal(by.title?.derive, undefined); // 语义字段不机械补
  assert.equal(by.draft?.type, "boolean");
});

test("MW3.1 Given listProfiles Then pkm-note 居首（第一推荐）、含 llm-wiki / ssg-blog（共 3 套）", () => {
  const names = listProfiles().map((p) => p.name);
  assert.equal(names[0], "pkm-note");
  assert.deepEqual(names.toSorted(), ["llm-wiki", "pkm-note", "ssg-blog"]);
});

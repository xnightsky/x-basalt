import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSafety } from "../../src/chat/safety.js";

test("wrap：用固定 nonce 包裹，含起止边界", () => {
  const s = makeSafety({ nonce: "N1" });
  const w = s.wrap("hello");
  assert.match(w, /<<VAULT_DATA N1>>/);
  assert.match(w, /<<END_VAULT_DATA N1>>/);
  assert.match(w, /hello/);
});

test("truncate：未超长原样返回", () => {
  const s = makeSafety({ maxChars: 100 });
  assert.equal(s.truncate("abc"), "abc");
});

test("truncate：超长截断并标注已截断字符数", () => {
  const s = makeSafety({ maxChars: 5 });
  const out = s.truncate("0123456789"); // 10 字符
  assert.match(out, /^01234/);
  assert.match(out, /已截断 5 字符/);
});

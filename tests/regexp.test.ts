import assert from "node:assert/strict";
import { test } from "node:test";
import { safeRegexpMatch } from "../src/query/regexp.js";

// === 自建实现: regexmatch 安全匹配（S2.23 ReDoS 缓解）单测 ===

test("S2.23 基本匹配命中/不命中", () => {
  assert.equal(safeRegexpMatch("^A", "Alpha"), 1);
  assert.equal(safeRegexpMatch("^A", "Beta"), 0);
  assert.equal(safeRegexpMatch("\\d+", "abc123"), 1);
});

test("S2.23 null/undefined/非法正则不抛错（返回 0）", () => {
  assert.equal(safeRegexpMatch("^A", null), 0);
  assert.equal(safeRegexpMatch("^A", undefined), 0);
  assert.equal(safeRegexpMatch("(unclosed", "x"), 0);
});

test("S2.23 ReDoS 缓解：超长 value 直接拒绝（不进入指数回溯）", () => {
  // 经典 ReDoS：(a+)+$ + 大量 a 后接不匹配字符 → 朴素引擎指数回溯。
  const evil = "(a+)+$";
  const longInput = `${"a".repeat(50000)}X`;
  // 超 MAX_VALUE，直接返回 0；若未缓解此调用会卡死。
  assert.equal(safeRegexpMatch(evil, longInput), 0);
});

test("S2.23 超长 pattern 拒绝", () => {
  assert.equal(safeRegexpMatch("a".repeat(300), "aaa"), 0);
});

test("S2.23 限内输入即使有回溯也快速完成", () => {
  assert.equal(safeRegexpMatch("(a+)+$", "aaaab"), 0);
  assert.equal(safeRegexpMatch("(a+)+$", "aaaa"), 1);
});

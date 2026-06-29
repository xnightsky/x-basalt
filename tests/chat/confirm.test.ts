import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { makeConfirm, type WritePreview } from "../../src/chat/confirm.js";

const P: WritePreview = { kind: "single", label: "set x → a.md", diff: "x: 1" };

test("yes=true → 恒 true，不读输入", async () => {
  const c = makeConfirm({ yes: true, isTTY: true });
  assert.equal(await c(P), true);
});

test("非 TTY → 恒 false（防脚本静默改库）", async () => {
  const c = makeConfirm({ yes: false, isTTY: false });
  assert.equal(await c(P), false);
});

test("TTY 输入 y → true", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const c = makeConfirm({ yes: false, isTTY: true, input, output });
  const p = c(P);
  input.write("y\n");
  assert.equal(await p, true);
});

test("TTY 输入 n → false", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const c = makeConfirm({ yes: false, isTTY: true, input, output });
  const p = c(P);
  input.write("n\n");
  assert.equal(await p, false);
});

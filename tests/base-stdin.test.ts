/**
 * 动态 base 第一步：stdin 读取（DB-3a，计划 2026-08-03-bases-dynamic-stdin.md）。
 * 读流到 EOF 成字符串——`.base` 定义整体来自管道，边读边解析会让解析器拿到残缺文档。
 */

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { readStdinText } from "../src/base/stdin.js";

test("DB-3a: 分片到达的流读到 EOF 后整体返回", async () => {
  const stream = Readable.from(["views:\n  - typ", "e: table\n  - na", "me: All\n"]);
  assert.equal(await readStdinText(stream), "views:\n  - type: table\n  - name: All\n");
});

test("DB-3a: Buffer 分片按 utf8 解码", async () => {
  const stream = Readable.from([Buffer.from("views:", "utf8"), Buffer.from(" []", "utf8")]);
  assert.equal(await readStdinText(stream), "views: []");
});

test("DB-3a: 空输入返回空串（不报错）", async () => {
  const stream = Readable.from([]);
  assert.equal(await readStdinText(stream), "");
});

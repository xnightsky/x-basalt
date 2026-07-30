import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { assertPipedStdin, parsePathList, readPathList } from "../src/orchestrator/sources.js";

// === 原生管道（stdin）源（spec §8.3）===
// 计划：docs/plans/2026-07-30-pipe-closure.md PC-4。
// 契约：读到 EOF → 按行 trim、跳空行与 `#` 注释 → vault 相对路径；不猜 JSON（结构化输入交 jq）。
// stdin 是「源接入」，与 `--pipe`（管道定义）正交——本文件不涉任何管道参数。

test("PC-4a Given 多行路径 When parsePathList Then 逐行取相对路径", () => {
  assert.deepEqual(parsePathList("A.md\npkm/B.md\n"), ["A.md", "pkm/B.md"]);
});

test("PC-4a Given 空行与 # 注释 When parsePathList Then 跳过", () => {
  assert.deepEqual(parsePathList("A.md\n\n# 注释\n   \n#另一条\nB.md"), ["A.md", "B.md"]);
});

test("PC-4a Given 行首尾空白与 CRLF When parsePathList Then trim 归一", () => {
  assert.deepEqual(parsePathList("  A.md  \r\nB.md\r\n"), ["A.md", "B.md"]);
});

test("PC-4a Given 含空格的文件名 When parsePathList Then 整行即一个路径（不按空格切）", () => {
  assert.deepEqual(parsePathList("my note.md\n"), ["my note.md"]);
});

test("PC-4a Given 空输入 When parsePathList Then 空列表（不报错）", () => {
  assert.deepEqual(parsePathList(""), []);
  assert.deepEqual(parsePathList("\n\n"), []);
});

test("PC-4a Given JSON 输入 When parsePathList Then 不猜结构（原样成行，交由下游按路径处理）", () => {
  // 单一职责：结构化输入应先用 jq 抽路径，此处不内置 JSON 解析。
  assert.deepEqual(parsePathList('{"rows":[]}'), ['{"rows":[]}']);
});

test("PC-4a Given 分片到达的流 When readPathList Then 读到 EOF 再整体解析", async () => {
  const stream = Readable.from(["A.m", "d\npk", "m/B.md\n"]);
  assert.deepEqual(await readPathList(stream), ["A.md", "pkm/B.md"]);
});

test("PC-4a Given Buffer 分片 When readPathList Then 按 utf8 解码", async () => {
  const stream = Readable.from([Buffer.from("笔记.md\n", "utf8")]);
  assert.deepEqual(await readPathList(stream), ["笔记.md"]);
});

test("PC-4a Given stdin 是交互终端 When assertPipedStdin Then 报错不挂起", () => {
  assert.throws(() => assertPipedStdin(true), /--stdin/);
  assert.doesNotThrow(() => assertPipedStdin(false));
  assert.doesNotThrow(() => assertPipedStdin(undefined)); // 管道时 isTTY 为 undefined
});

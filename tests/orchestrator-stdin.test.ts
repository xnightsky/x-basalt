import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  assertPathsInVault,
  assertPipedStdin,
  parsePathList,
  readPathList,
} from "../src/orchestrator/sources.js";

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

// === C1：stdin 路径 vault 边界校验（安全对抗）===
// 计划：docs/plans/2026-07-30-pipe-closure.md PC-6。
// 背景：`..` 归一化或根外绝对路径会经 layout.toAbs 逃出 vault 根，写动作可改写 vault 外文件。
// 口径：「逃出根」声明期报错并列出非法行；「不存在的相对路径」不算非法（仍由动作层上报 failed）。

test("C1 Given 相对路径 .. 越出根 When assertPathsInVault Then 报错并列出非法行", () => {
  assert.throws(() => assertPathsInVault(["a/b.md", "../outside.md"], ["/vault"]), /outside\.md/);
});

test("C1 Given 绝对路径指向根外 When assertPathsInVault Then 报错", () => {
  assert.throws(() => assertPathsInVault(["/etc/x.md"], ["/vault"]), /\/etc\/x\.md/);
});

test("C1 Given 嵌套 a/../../x.md 归一化后越界 When assertPathsInVault Then 报错", () => {
  assert.throws(() => assertPathsInVault(["a/../../x.md"], ["/vault"]), /a\/\.\.\/\.\.\/x\.md/);
});

test("C1 Given 多条越界行 When assertPathsInVault Then 错误全部列出", () => {
  assert.throws(
    () => assertPathsInVault(["../a.md", "/abs/b.md"], ["/vault"]),
    (err: unknown) => {
      const msg = (err as Error).message;
      return msg.includes("../a.md") && msg.includes("/abs/b.md");
    },
  );
});

test("C1 Given 合法相对路径与根内路径 When assertPathsInVault Then 通过", () => {
  assert.doesNotThrow(() => assertPathsInVault(["a/b.md", "c.md"], ["/vault"]));
  // 根内徘徊的 ..（不归一出根）合法；根内绝对路径合法
  assert.doesNotThrow(() => assertPathsInVault(["a/../b.md", "/vault/d.md"], ["/vault"]));
});

test("C1 Given 多根 When assertPathsInVault Then 逐根校验（落在任一根内即合法）", () => {
  const roots = ["/v/alpha", "/v/beta"];
  assert.doesNotThrow(() => assertPathsInVault(["/v/beta/x.md", "a.md"], roots));
  assert.throws(() => assertPathsInVault(["/v/gamma/x.md"], roots), /gamma/);
});

import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
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
// 测试根的形态对齐生产不变量「roots 已 resolve」（win32 下 `resolve("/vault")` = `D:\vault`——
// 裸写 POSIX 风格 "/vault" 会把「根未 resolve」与「门本身判错」两种失败混在一起）。

const VAULT = resolve("/vault");

test("C1 Given 相对路径 .. 越出根 When assertPathsInVault Then 报错并列出非法行", () => {
  assert.throws(() => assertPathsInVault(["a/b.md", "../outside.md"], [VAULT]), /outside\.md/);
});

test("C1 Given 绝对路径指向根外 When assertPathsInVault Then 报错", () => {
  assert.throws(() => assertPathsInVault([resolve("/etc/x.md")], [VAULT]), /x\.md/);
});

test("C1 Given 嵌套 a/../../x.md 归一化后越界 When assertPathsInVault Then 报错", () => {
  assert.throws(() => assertPathsInVault(["a/../../x.md"], [VAULT]), /a\/\.\.\/\.\.\/x\.md/);
});

test("C1 Given 多条越界行 When assertPathsInVault Then 错误全部列出", () => {
  assert.throws(
    () => assertPathsInVault(["../a.md", resolve("/abs/b.md")], [VAULT]),
    (err: unknown) => {
      const msg = (err as Error).message;
      return msg.includes("../a.md") && msg.includes("b.md");
    },
  );
});

test("C1 Given 合法相对路径与根内路径 When assertPathsInVault Then 通过", () => {
  assert.doesNotThrow(() => assertPathsInVault(["a/b.md", "c.md"], [VAULT]));
  // 根内徘徊的 ..（不归一出根）合法；根内绝对路径合法
  assert.doesNotThrow(() => assertPathsInVault(["a/../b.md", join(VAULT, "d.md")], [VAULT]));
});

test("C1 Given 多根 When assertPathsInVault Then 逐根校验（落在任一根内即合法）", () => {
  const roots = [resolve("/v/alpha"), resolve("/v/beta")];
  assert.doesNotThrow(() => assertPathsInVault([join(roots[1]!, "x.md"), "a.md"], roots));
  assert.throws(() => assertPathsInVault([join(resolve("/v/gamma"), "x.md")], roots), /gamma/);
});

test("C1 Given 根内绝对路径的正斜杠/盘符小写变体 When assertPathsInVault Then 不误判越界（win32 形态）", () => {
  // 生产回归：用户从 Git Bash 喂正斜杠路径（D:/vault/x.md）或盘符小写（d:\vault\x.md），
  // 旧 startsWith(root + sep) 实现因分隔符/大小写把合法路径误判越界、整条 run --stdin 被拒。
  const fwd = join(VAULT, "x.md").replaceAll(sep, "/"); // 正斜杠形态（win32 下 Git Bash 常见）
  assert.doesNotThrow(() => assertPathsInVault([fwd], [VAULT]));
  if (process.platform === "win32") {
    const ch = VAULT[0] as string; // 盘符字母
    const flipped =
      (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + VAULT.slice(1);
    assert.doesNotThrow(() => assertPathsInVault([join(flipped, "x.md")], [VAULT]));
  }
});

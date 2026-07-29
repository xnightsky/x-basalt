import assert from "node:assert/strict";
import { test } from "node:test";
import { register, resolve } from "../src/orchestrator/registry.js";
import type { Op } from "../src/orchestrator/types.js";

// === CO-R1 算子注册表：注册 / 解析 / 错误报告（设计：docs/design/pipeline-op-model.md §3.3）===
// 测试使用假 Op，不碰真实 indexer/meta。

function fakeOp(name: string): Op {
  return {
    name,
    write: false,
    rowwise: true,
    async run() {
      return { rows: [], failed: [] };
    },
  };
}

test("CO-R1 注册后能 resolve 无参算子", () => {
  register("index", (_p) => fakeOp("index"));
  assert.equal(resolve("index").name, "index");
});

test("CO-R1 resolve 带参数正确切分并传给 factory", () => {
  let captured: string = "UNSET";
  register("apply", (p) => {
    captured = p;
    return fakeOp("apply");
  });
  resolve("apply llm-wiki");
  assert.equal(captured, "llm-wiki");
});

test("CO-R1 resolve 支持多段参数（含 `=`）", () => {
  let captured: string = "UNSET";
  register("set", (p) => {
    captured = p;
    return fakeOp("set");
  });
  resolve("set type=note");
  assert.equal(captured, "type=note");
});

test("CO-R1 未注册算子报错且错误信息含已注册名单", () => {
  register("a", (_p) => fakeOp("a"));
  register("b", (_p) => fakeOp("b"));

  assert.throws(
    () => resolve("unknown"),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("未知操作"));
      assert.ok(err.message.includes("a"));
      assert.ok(err.message.includes("b"));
      return true;
    },
  );
});

test("CO-R1 重复注册同名算子后覆盖生效", () => {
  register("dup", (_p) => fakeOp("first"));
  assert.equal(resolve("dup").name, "first");

  register("dup", (_p) => fakeOp("second"));
  assert.equal(resolve("dup").name, "second");
});

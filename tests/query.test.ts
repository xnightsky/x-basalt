import assert from "node:assert/strict";
import { test } from "node:test";
import { DataviewEngine } from "../src/query/index.js";

test("DataviewEngine 可实例化", () => {
  assert.ok(new DataviewEngine(":memory:"));
});

test(
  "LIST/TABLE + FROM + WHERE + SORT + LIMIT 端到端主路径",
  { todo: "阶段 3 实现 tokenizer→ast→sql 与执行" },
  () => {
    // 阶段 3：对样例 vault 索引执行 DQL，断言 type/columns/rows
  },
);

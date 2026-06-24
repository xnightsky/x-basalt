import assert from "node:assert/strict";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";

test("VaultIndexer 可实例化", () => {
  assert.ok(new VaultIndexer({ vaultPath: "tests/fixtures/sample-vault", dbPath: ":memory:" }));
});

test(
  "rebuild 后 files/links/tags/tasks 行数与反向链接正确",
  { todo: "阶段 2 实现 VaultIndexer.rebuild 与 schema" },
  () => {
    // 阶段 2：对样例 vault rebuild，断言行数与 inlinks/outlinks 实时 JOIN 结果
  },
);

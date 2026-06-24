import assert from "node:assert/strict";
import { test } from "node:test";
import { VaultParser } from "../src/parser/index.js";
import { isAssetEmbed, linkKey } from "../src/utils/path.js";

test("VaultParser 可实例化", () => {
  assert.ok(new VaultParser());
});

test("linkKey：去扩展名 + 小写 basename", () => {
  assert.equal(linkKey("Folder/Note"), "note");
  assert.equal(linkKey("image.PNG"), "image");
});

test("isAssetEmbed：区分资源嵌入与笔记嵌入", () => {
  assert.equal(isAssetEmbed("image.png"), true);
  assert.equal(isAssetEmbed("video.mp4"), true);
  assert.equal(isAssetEmbed("Note"), false);
  assert.equal(isAssetEmbed("Note.md"), false);
});

test(
  "解析样例文件的 wikilink/tag/callout/task/highlight/blockRef 并去重",
  { todo: "阶段 1 实现 VaultParser.parse" },
  () => {
    // 阶段 1：读取 tests/fixtures/sample-vault/*.md，断言各类节点与同文件 wikilink 去重
  },
);

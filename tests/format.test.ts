import assert from "node:assert/strict";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import { toYaml } from "../src/format.js";

// === M4.2: CLI 输出 YAML 用 `yaml` 包（修手写 toYaml 键不转义 C5）===
// 验证手段：toYaml 的输出能被 YAML 解析器原样读回（往返一致）——手写序列化对特殊键做不到。

test("M4.2 Given 含特殊字符的键（: 与空格）When 序列化 Then 输出为合法 YAML 且往返一致（修 C5）", () => {
  const data = { "key:with:colons": 1, "with space": "v", "#hash": true, normal: "ok" };
  assert.deepEqual(parseYaml(toYaml(data)), data);
});

test("M4.2 Given 含特殊字符的字符串值 When 序列化 Then 往返一致", () => {
  const data = { onChange: "echo {file}: done #now", note: "a: b" };
  assert.deepEqual(parseYaml(toYaml(data)), data);
});

test("M4.2 Given 嵌套对象/数组/null When 序列化 Then 往返一致", () => {
  const data = { a: [1, 2, { b: "x" }], c: { d: null }, e: [] };
  assert.deepEqual(parseYaml(toYaml(data)), data);
});

test("M4.2 Given parse 输出形态（节点数组）When 序列化 Then 往返一致", () => {
  const nodes = [
    { type: "wikilink", target: "Projects/Alpha", alias: "别名" },
    { type: "tag", value: "area/work" },
  ];
  assert.deepEqual(parseYaml(toYaml(nodes)), nodes);
});

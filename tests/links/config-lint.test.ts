import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLintConfig } from "../../src/config.js";

test("parseLintConfig: 挑 ignore.paths/targets/rules", () => {
  const cfg = parseLintConfig({
    ignore: {
      paths: ["archive/**", 123],
      targets: ["http://*"],
      rules: { "links/no-broken-link": ["legacy/**", 5], bad: "x" },
    },
  });
  assert.deepEqual(cfg.ignore?.paths, ["archive/**"]);
  assert.deepEqual(cfg.ignore?.targets, ["http://*"]);
  assert.deepEqual(cfg.ignore?.rules?.["links/no-broken-link"], ["legacy/**"]);
  assert.deepEqual(cfg.ignore?.rules?.bad, []);
});

test("parseLintConfig: 非对象 → 空", () => {
  assert.deepEqual(parseLintConfig(null), {});
  assert.deepEqual(parseLintConfig("x"), {});
});

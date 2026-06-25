import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SkillRecall } from "../src/skill/index.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

test("list 含内置 obsidian-base-spec", () => {
  const names = new SkillRecall().list().map((s) => s.name);
  assert.ok(names.includes("obsidian-base-spec"), "应列出内置 skill");
});

test("recall 按 trigger 模糊召回内置规范", () => {
  const recall = new SkillRecall();
  for (const kw of ["wikilink", "dataview", "callout", "TAG"]) {
    const hits = recall.recall(kw).map((s) => s.name);
    assert.ok(hits.includes("obsidian-base-spec"), `关键字 ${kw} 应召回 obsidian-base-spec`);
  }
});

test("recall 命中 rules 详情可用", () => {
  const hits = new SkillRecall().recall("wikilink");
  const spec = hits.find((s) => s.name === "obsidian-base-spec");
  assert.ok(spec, "应召回到规范");
  assert.ok(Array.isArray(spec.rules) && spec.rules.length > 0, "规范应含 rules");
  assert.ok(
    spec.rules.every((r) => typeof r.pattern === "string" && typeof r.description === "string"),
  );
});

test("无命中返回空数组", () => {
  assert.deepEqual(new SkillRecall().recall("zzz-not-a-trigger-xyz"), []);
});

test("外部 skill 目录为空时仍降级召回内置兜底", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "x-basalt-skill-"));
  tmpDirs.push(emptyDir);
  const recall = new SkillRecall({ skillPath: emptyDir });
  assert.ok(
    recall.list().some((s) => s.name === "obsidian-base-spec"),
    "空目录也应有内置兜底",
  );
  assert.ok(recall.recall("frontmatter").some((s) => s.name === "obsidian-base-spec"));
});

test("CLI 自我说明书可召回（usage/help/命令名/中文触发器）", () => {
  const recall = new SkillRecall();
  for (const kw of ["usage", "help", "watch", "说明书"]) {
    assert.ok(
      recall.recall(kw).some((s) => s.name === "x-basalt-usage"),
      `关键字 ${kw} 应召回 x-basalt-usage`,
    );
  }
});

test("说明书与基础规范在外部空目录下均兜底可召回", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "x-basalt-skill-"));
  tmpDirs.push(emptyDir);
  const names = new SkillRecall({ skillPath: emptyDir }).list().map((s) => s.name);
  assert.ok(names.includes("obsidian-base-spec"), "兜底应含基础规范");
  assert.ok(names.includes("x-basalt-usage"), "兜底应含自我说明书");
});

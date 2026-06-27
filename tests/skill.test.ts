import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SkillRecall } from "../src/skill/index.js";

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** 在临时目录写若干最小 skill（name+triggers+占位 rules），返回目录路径。 */
function makeSkillDir(skills: { name: string; triggers: string[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-skill-rank-"));
  tmpDirs.push(dir);
  for (const s of skills) {
    writeFileSync(
      join(dir, `${s.name}.json5`),
      JSON.stringify({ name: s.name, triggers: s.triggers, rules: [{ pattern: "x", description: "d" }] }),
    );
  }
  return dir;
}

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

// === M4.1 召回换 Fuse.js：模糊容错 + 相关性排序（子串匹配做不到的能力）===

test("M4.1 Given 拼写近似的关键字 When 召回 Then 仍模糊命中（容错）", () => {
  const recall = new SkillRecall();
  // 子串匹配会漏掉这些拼写错；Fuse 的编辑距离应召回。
  for (const kw of ["wikilnk", "callot", "frontmater"]) {
    assert.ok(
      recall.recall(kw).some((s) => s.name === "obsidian-base-spec"),
      `拼写近似 ${kw} 应模糊召回 obsidian-base-spec`,
    );
  }
});

test("M4.1 Given 多个 skill When 召回 Then 最相关者排首位（相关性排序）", () => {
  const dir = makeSkillDir([
    { name: "alpha-notes", triggers: ["alpha", "note", "memo"] },
    { name: "beta-tasks", triggers: ["beta", "task", "todo"] },
  ]);
  const recall = new SkillRecall({ skillPath: dir });
  assert.equal(recall.recall("alpha")[0]?.name, "alpha-notes", "alpha 应排 alpha-notes 首位");
  assert.equal(recall.recall("beta")[0]?.name, "beta-tasks", "beta 应排 beta-tasks 首位");
});

test("M4.1 Given 触发器前缀 When 召回 Then 命中（front→frontmatter）", () => {
  assert.ok(new SkillRecall().recall("front").some((s) => s.name === "obsidian-base-spec"));
});

test("M4.1 Given 与任何触发器都不沾边的垃圾串 When 召回 Then 仍返回空（阈值不放水）", () => {
  assert.deepEqual(new SkillRecall().recall("zzz-not-a-trigger-xyz"), []);
});

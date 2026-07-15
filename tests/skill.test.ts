import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { SkillRecall } from "../src/skill/index.js";
import { renderSkill, renderSkillList } from "../src/skill/render.js";

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
      JSON.stringify({
        name: s.name,
        triggers: s.triggers,
        rules: [{ pattern: "x", description: "d" }],
      }),
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

// === 2026-07-15 P2：中文查询召回率（触发词中文别名 + description/rules 参与匹配）===

test("P2 中文概念词召回 obsidian-base-spec（标签/双链/任务/嵌入/内联字段）", () => {
  const recall = new SkillRecall();
  for (const kw of ["标签", "双链", "任务", "嵌入", "内联字段", "块引用", "标注"]) {
    assert.ok(
      recall.recall(kw).some((s) => s.name === "obsidian-base-spec"),
      `中文关键字「${kw}」应召回 obsidian-base-spec`,
    );
  }
});

test("P2 中文短语（含空格/多词）也能召回", () => {
  const recall = new SkillRecall();
  assert.ok(
    recall.recall("双向链接 语法").some((s) => s.name === "obsidian-base-spec"),
    "「双向链接 语法」应召回 obsidian-base-spec",
  );
});

test("P2 不放水：与规范无关的中文串仍返回空", () => {
  // vault 内并无「前端单元测试」相关规范，返回空是正确的（阈值不放水召回无关 skill）。
  assert.deepEqual(new SkillRecall().recall("前端单元测试"), []);
});

test("P2 不放水：无关多词短语（含泛化词 规范/注意事项）经切词仍不误召回", () => {
  // 首跑逐字复发的 query：多词切词后「规范」等泛化词绝不能撞上 obsidian-base-spec（否则重演召回失真）。
  assert.deepEqual(new SkillRecall().recall("前端单元测试 unittest 注意事项 规范"), []);
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
      recall.recall(kw).some((s) => s.name === "core"),
      `关键字 ${kw} 应召回 core`,
    );
  }
});

test("说明书与基础规范在外部空目录下均兜底可召回", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "x-basalt-skill-"));
  tmpDirs.push(emptyDir);
  const names = new SkillRecall({ skillPath: emptyDir }).list().map((s) => s.name);
  assert.ok(names.includes("obsidian-base-spec"), "兜底应含基础规范");
  assert.ok(names.includes("core"), "兜底应含自我说明书");
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

// === 档二：get（按名取完整）/ all / resolvedDir / list-description / renderer ===

test("get 按名取完整 skill（含 rules）", () => {
  const def = new SkillRecall().get("obsidian-base-spec");
  assert.ok(def, "应取到内置 skill");
  assert.equal(def.name, "obsidian-base-spec");
  assert.ok(Array.isArray(def.rules) && def.rules.length > 0, "应含 rules");
});

test("get 不存在的名返回 undefined", () => {
  assert.equal(new SkillRecall().get("zzz-no-such-skill"), undefined);
});

test("all 含两个内置 skill", () => {
  const names = new SkillRecall().all().map((s) => s.name);
  assert.ok(names.includes("obsidian-base-spec"), "应含基础规范");
  assert.ok(names.includes("core"), "应含自我说明书");
});

test("resolvedDir 显式 skillPath 时返回该目录", () => {
  const dir = makeSkillDir([{ name: "x", triggers: ["x"] }]);
  assert.equal(new SkillRecall({ skillPath: dir }).resolvedDir(), dir);
});

test("resolvedDir 默认返回内置 skills-data 目录", () => {
  assert.equal(basename(new SkillRecall().resolvedDir()), "skills-data");
});

test("list 项含顶层 description（内置 skill 已补 description）", () => {
  const obs = new SkillRecall().list().find((s) => s.name === "obsidian-base-spec");
  assert.ok(obs, "应列出内置 skill");
  assert.ok(
    typeof obs.description === "string" && obs.description.length > 0,
    "list 项应带非空 description",
  );
});

test("renderSkill 把 name/description/pattern/examples 渲染为可读文本", () => {
  const md = renderSkill({
    name: "demo-skill",
    description: "演示用 skill",
    triggers: ["demo"],
    rules: [{ pattern: "P1", description: "规则一说明", examples: ["ex-uno"] }],
  });
  assert.match(md, /demo-skill/, "含 name");
  assert.match(md, /演示用 skill/, "含 description");
  assert.match(md, /P1/, "含 rule pattern");
  assert.match(md, /规则一说明/, "含 rule description");
  assert.match(md, /ex-uno/, "含 example");
});

test("renderSkillList 渲染 name 与 description 列表", () => {
  const text = renderSkillList([
    { name: "a-skill", triggers: [], description: "甲说明" },
    { name: "b-skill", triggers: [], description: "乙说明" },
  ]);
  assert.match(text, /a-skill/);
  assert.match(text, /甲说明/);
  assert.match(text, /b-skill/);
  assert.match(text, /乙说明/);
});

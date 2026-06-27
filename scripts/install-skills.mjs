#!/usr/bin/env node
// 把 skills-def/<name>/（含 SKILL.md）安装到 .claude/skills/<name>/。
//
// 默认：装「项目」技能（frontmatter scope != global）到仓库 .claude/skills/——开发本仓用，已 gitignore。
// --global：装「全局」技能（frontmatter scope: global）到 ~/.claude/skills/——供任意 AI 召回、学会用 x-basalt CLI。
// 据 scope 分流，避免开发用的 biz-* 技能污染用户全局。
//
// 纯 Node、跨平台、无第三方依赖。真相源在 skills-def/。

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "skills-def");
const isGlobal = process.argv.includes("--global");
const destDir = isGlobal ? join(homedir(), ".claude", "skills") : join(root, ".claude", "skills");

if (!existsSync(srcDir)) {
  console.error(`✗ skills-def 不存在：${srcDir}`);
  process.exit(1);
}

/** 从 SKILL.md frontmatter 取 scope（默认 project）。纯正则，避免引 YAML 依赖。 */
function skillScope(skillMd) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(skillMd, "utf8"));
  if (!fm) return "project";
  const m = /^scope:\s*(\S+)/m.exec(fm[1]);
  return m ? m[1].trim() : "project";
}

mkdirSync(destDir, { recursive: true });

let installed = 0;
for (const name of readdirSync(srcDir)) {
  const srcSkill = join(srcDir, name);
  if (!statSync(srcSkill).isDirectory()) continue; // 跳过 README.md 等文件
  const skillMd = join(srcSkill, "SKILL.md");
  if (!existsSync(skillMd)) continue; // 必须含 SKILL.md
  // --global 只装 scope:global；默认只装非 global（项目开发技能）。
  if (isGlobal !== (skillScope(skillMd) === "global")) continue;
  const dest = join(destDir, name);
  rmSync(dest, { recursive: true, force: true }); // 覆盖旧安装产物
  cpSync(srcSkill, dest, { recursive: true });
  console.log(`✓ 安装 skill: ${name}`);
  installed++;
}

console.log(`完成：安装 ${installed} 个 skill 到 ${destDir}${isGlobal ? "（全局）" : ""}`);

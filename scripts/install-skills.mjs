#!/usr/bin/env node
// 把 skills-def/<name>/（含 SKILL.md）安装到 .claude/skills/<name>/。
// 纯 Node、跨平台、无第三方依赖。真相源在 skills-def/，安装产物已 gitignore。

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "skills-def");
const destDir = join(root, ".claude", "skills");

if (!existsSync(srcDir)) {
  console.error(`✗ skills-def 不存在：${srcDir}`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

let installed = 0;
for (const name of readdirSync(srcDir)) {
  const srcSkill = join(srcDir, name);
  if (!statSync(srcSkill).isDirectory()) continue; // 跳过 README.md 等文件
  if (!existsSync(join(srcSkill, "SKILL.md"))) continue; // 必须含 SKILL.md
  const dest = join(destDir, name);
  rmSync(dest, { recursive: true, force: true }); // 覆盖旧安装产物
  cpSync(srcSkill, dest, { recursive: true });
  console.log(`✓ 安装 skill: ${name}`);
  installed++;
}

console.log(`完成：安装 ${installed} 个 skill 到 .claude/skills/`);

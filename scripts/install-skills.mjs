#!/usr/bin/env node
// 把 skills-def/<组>/<name>/（含 SKILL.md）安装到 .claude/skills/<name>/ 与 .agents/skills/<name>/。
//
// 按「目录组」分流（对齐 x-kb 思路，但按受众/去向取名）：
//   --global：装 cli/ 组 —— 消费侧「入口 skill」（如何用 x-basalt CLI），到 ~/.claude/skills 与 ~/.agents/skills，跨仓可见。
//   默认    ：装 dev/ 组 —— 开发侧 biz-* skill（写/审 x-basalt 自身代码时召回），到仓库 .claude/skills 与 .agents/skills（已 gitignore）。
// 目录即分流依据，避免开发用的 biz-* 污染用户全局；同时装到 .claude 与 .agents 两根，兼容不同 AI 运行时的 skill 发现路径。
//
// 纯 Node、跨平台、无第三方依赖。真相源在 skills-def/{cli,dev}/。

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isGlobal = process.argv.includes("--global");
// 源组与目标根一一对应：cli/ → 家目录（全局），dev/ → 仓库根（本仓）。
const group = isGlobal ? "cli" : "dev";
const srcDir = join(root, "skills-def", group);
const base = isGlobal ? homedir() : root;
const destDirs = [join(base, ".claude", "skills"), join(base, ".agents", "skills")];

if (!existsSync(srcDir)) {
  console.error(`✗ 源目录不存在：${srcDir}`);
  process.exit(1);
}

// <组>/ 下每个含 SKILL.md 的子目录 = 一个 skill。
const skills = readdirSync(srcDir).filter((name) => {
  const srcSkill = join(srcDir, name);
  if (!statSync(srcSkill).isDirectory()) return false; // 跳过 INSTALL.md 等文件
  return existsSync(join(srcSkill, "SKILL.md")); // 必须含 SKILL.md
});

for (const destDir of destDirs) {
  mkdirSync(destDir, { recursive: true });
  for (const name of skills) {
    const dest = join(destDir, name);
    rmSync(dest, { recursive: true, force: true }); // 覆盖旧安装产物
    cpSync(join(srcDir, name), dest, { recursive: true });
  }
  console.log(`✓ 安装 ${skills.length} 个 skill 到 ${destDir}`);
}

console.log(
  `完成（${group} 组${isGlobal ? "，全局" : ""}）：${skills.join("、") || "（无匹配 skill）"}`,
);

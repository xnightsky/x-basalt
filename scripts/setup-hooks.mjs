#!/usr/bin/env node
// 接线本地 git 门禁：把 git 的 core.hooksPath 指向受版本控制的 .githooks/。
// 由 package.json 的 "prepare" 在 pnpm install 时自动调用；非 git 环境
// （如从 npm registry 安装 tarball，无 .git）静默跳过，不破坏安装。
// 纯 Node、跨平台、无第三方依赖（与 install-skills.mjs 同款）。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 仅在 git 工作树内接线；.git 可能是目录（普通仓库）或文件（worktree），existsSync 均可判定。
if (!existsSync(join(root, ".git"))) {
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
  console.log(
    "✓ 本地 git 门禁已接线：core.hooksPath → .githooks（pre-push 跑 typecheck+test+lint）",
  );
} catch {
  // git 不可用或配置失败：不阻断安装，仅提示手动接线方式。
  console.warn(
    "! 跳过 git hooks 接线（git 不可用？）。如需本地门禁请手动执行：git config core.hooksPath .githooks",
  );
}

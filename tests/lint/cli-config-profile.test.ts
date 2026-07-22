import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// P3b：CLI `lint --profile <config-profile>` 端到端（子进程真 CLI）。
// config profile 经 X_BASALT_DIR 注入的临时 .x-basalt/config.yaml 声明（含 extends/enums/同名覆盖）。
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.2。

const CLI = join(process.cwd(), "src", "cli.ts");

/** 跑 CLI，baseDir 作 X_BASALT_DIR（其下 config.yaml 提供项目配置）。 */
function run(args: string[], baseDir: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, X_BASALT_DIR: baseDir },
    });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", code: err.status ?? 1 };
  }
}

/** 建临时基目录（含 config.yaml）+ 临时 vault，返回二者路径。 */
function setup(configYaml: string, files: Record<string, string>): { base: string; vault: string } {
  const base = mkdtempSync(join(tmpdir(), "lint-cfgprof-base-"));
  writeFileSync(join(base, "config.yaml"), configYaml);
  const vault = mkdtempSync(join(tmpdir(), "lint-cfgprof-vault-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(vault, name), content);
  return { base, vault };
}

test("config profile extends 内置 + enum：非法值 → 退出 1 + metadata/enum-invalid", () => {
  const { base, vault } = setup(
    "profiles:\n  my-wiki:\n    extends: llm-wiki\n    enums:\n      type: [note, person]\n",
    { "a.md": "---\ntype: gadget\n---\n# a\n" },
  );
  try {
    const { stdout, code } = run(["lint", vault, "--profile", "my-wiki", "--format", "json"], base);
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout) as Array<{ rule: string; target?: string }>;
    assert.equal(parsed[0]?.rule, "metadata/enum-invalid");
    assert.equal(parsed[0]?.target, "type");
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});

test("config profile：合法 → 退出 0 + []", () => {
  const { base, vault } = setup(
    "profiles:\n  my-wiki:\n    extends: llm-wiki\n    enums:\n      type: [note, person]\n",
    { "a.md": "---\ntype: note\n---\n# a\n" },
  );
  try {
    const { stdout, code } = run(["lint", vault, "--profile", "my-wiki", "--format", "json"], base);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});

test("同名 config 覆盖内置：llm-wiki 被重定义为 required customfield", () => {
  // 内置 llm-wiki 只 required type；同名 config 覆盖后 required=customfield。
  // 文件有 type 无 customfield：若走内置应 0，走 config 应报 customfield 缺失。
  const { base, vault } = setup("profiles:\n  llm-wiki:\n    required: [customfield]\n", {
    "a.md": "---\ntype: note\n---\n# a\n",
  });
  try {
    const { stdout, code } = run(
      ["lint", vault, "--profile", "llm-wiki", "--format", "json"],
      base,
    );
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout) as Array<{ rule: string; target?: string }>;
    assert.equal(parsed[0]?.rule, "metadata/required-missing");
    assert.equal(parsed[0]?.target, "customfield");
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
  }
});

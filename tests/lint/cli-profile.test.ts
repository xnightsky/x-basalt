import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = join(process.cwd(), "src", "cli.ts");
function run(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf8",
    });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", code: err.status ?? 1 };
  }
}

test("lint --profile llm-wiki：缺 required → 退出码 1 + metadata/required-missing JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-prof-"));
  try {
    writeFileSync(join(root, "bad.md"), "---\ntitle: X\n---\n# no type\n");
    const { stdout, code } = run(["lint", root, "--profile", "llm-wiki", "--format", "json"]);
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout) as Array<{ rule: string; target?: string }>;
    assert.equal(parsed[0]?.rule, "metadata/required-missing");
    assert.equal(parsed[0]?.target, "type");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint --profile llm-wiki：required 齐全 → 退出码 0 + []", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-prof-ok-"));
  try {
    writeFileSync(join(root, "a.md"), "---\ntype: note\n---\n# a\n");
    const { stdout, code } = run(["lint", root, "--profile", "llm-wiki", "--format", "json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint --rules metadata 无 --profile → 报错退出（非 0）", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-prof-bad-"));
  try {
    const { code } = run(["lint", root, "--rules", "metadata"]);
    assert.notEqual(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

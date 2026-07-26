import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("lint --rules links --format json：断链退出码 1 + 诊断与 links check 同构", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-"));
  try {
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "Alpha.md"), "# Alpha");
    writeFileSync(join(root, "notes", "Index.md"), ["[[Alpha]]", "[[Ghost]]"].join("\n"));
    const lint = run(["lint", root, "--rules", "links", "--format", "json"]);
    const links = run(["links", "check", root, "--format", "json"]);
    assert.equal(lint.code, 1);
    assert.deepEqual(JSON.parse(lint.stdout), JSON.parse(links.stdout));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint：--rules 省略 → 默认 links；无断链退出码 0 + JSON []", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-ok-"));
  try {
    writeFileSync(join(root, "A.md"), "# A\n无链接");
    const { stdout, code } = run(["lint", root, "--format", "json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lint：未知规则 → 报错退出（非 0）", () => {
  const root = mkdtempSync(join(tmpdir(), "lint-cli-bad-"));
  try {
    const { code } = run(["lint", root, "--rules", "metadata"]);
    assert.notEqual(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

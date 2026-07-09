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

test("links check: 断链退出码 1 + JSON 输出", () => {
  const root = mkdtempSync(join(tmpdir(), "links-cli-"));
  try {
    writeFileSync(join(root, "A.md"), "[[Ghost]]");
    const { stdout, code } = run(["links", "check", root, "--format", "json"]);
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout) as Array<{ reason: string }>;
    assert.equal(parsed[0]?.reason, "not_found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("links check: 全有效退出码 0", () => {
  const root = mkdtempSync(join(tmpdir(), "links-cli-ok-"));
  try {
    writeFileSync(join(root, "A.md"), "# A");
    writeFileSync(join(root, "B.md"), "[[A]]");
    // links check 用 [vault...] 位置参数（对齐 index/scan），非 --vault option
    const { code } = run(["links", "check", root]);
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

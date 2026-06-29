import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";

function run(args: string[]) {
  const e = { ...process.env };
  delete e.AI_GATEWAY_API_KEY; // 模拟未配置
  // Windows 下 pnpm 是 .cmd，execFileSync 直接 spawn "pnpm" 会 ENOENT，需走 cmd /c。
  const isWin = platform() === "win32";
  const cmd = isWin ? "cmd" : "pnpm";
  const cmdArgs = isWin ? ["/c", "pnpm", "exec", "tsx", "src/cli.ts", ...args] : ["exec", "tsx", "src/cli.ts", ...args];
  try {
    const stdout = execFileSync(cmd, cmdArgs, { env: e, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e2 = err as { status: number; stdout: string; stderr: string };
    return { code: e2.status ?? 1, stdout: e2.stdout ?? "", stderr: e2.stderr ?? "" };
  }
}

test("无 key：核心命令 parse 正常工作", () => {
  const r = run(["parse", "tests/fixtures/sample-vault/Index.md"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[|\{/); // AST JSON
});

test("无 key：chat 友好退出（码非 0，无栈）", () => {
  const r = run(["chat", "hi"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /未配置 AI/);
  assert.doesNotMatch(r.stderr, /at .*\(.*:\d+:\d+\)/); // 无 stack trace
});

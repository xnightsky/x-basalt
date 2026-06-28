import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// === CO-G2 编排器 CLI 端到端（run 命令）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；以 subprocess 跑真实 cli.ts。
// 核心编排逻辑已在 orchestrator-*.test 单测；此处只验「CLI 装配 + 配置 pipelines + 报告 + 退出码」。

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");

function run(
  args: string[],
  env: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** 建临时 vault + .x-basalt/config.yaml（定义 pipelines），返回 {vault, baseDir, db}。 */
function setup(
  configYaml: string,
  files: Record<string, string>,
): { vault: string; baseDir: string; db: string } {
  const vault = mkdtempSync(join(tmpdir(), "xb-ocli-"));
  const baseDir = join(vault, ".x-basalt");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, "config.yaml"), configYaml);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(vault, n), c);
  return { vault, baseDir, db: join(baseDir, "index.db") };
}

test("CO-G2 Given idx 管道 When run（scan 源）Then 落库并报告 total=1", () => {
  const { vault, baseDir, db } = setup(
    "pipelines:\n  idx:\n    actions: [index]\n    dryRun: true\n",
    {
      "a.md": "---\ntags: [pkm]\n---\nA\n",
    },
  );
  try {
    const r = run(["run", "idx", "--vault", vault, "--db", db, "--json"], {
      X_BASALT_DIR: baseDir,
    });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.total, 1);
    assert.equal(report.failed.length, 0);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CO-G2 Given 未知管道 When run Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("pipelines:\n  idx:\n    actions: [index]\n", {});
  try {
    const r = run(["run", "nope", "--vault", vault], { X_BASALT_DIR: baseDir });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /未知管道/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CO-G2 Given --where DQL 手动源 When run Then 只处理命中文件", () => {
  const { vault, baseDir, db } = setup(
    "pipelines:\n  p:\n    actions: [parse]\n    dryRun: true\n",
    {
      "a.md": "---\ntags: [pkm]\n---\nA\n",
      "b.md": "B\n",
    },
  );
  try {
    const idx = run(["index", vault, "--db", db], { X_BASALT_DIR: baseDir });
    assert.equal(idx.status, 0, idx.stderr);
    const r = run(
      ["run", "p", "--where", "LIST FROM #pkm", "--vault", vault, "--db", db, "--json"],
      {
        X_BASALT_DIR: baseDir,
      },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

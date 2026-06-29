import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// === 编排器 CLI 端到端（统一 --pipe 模型）===
// 计划：docs/plans/2026-06-29-change-orchestration.md ；设计：spec §8（--pipe k=v + use + --apply）。
// 以 subprocess 跑真实 cli.ts；核心编排逻辑已在 orchestrator-*.test 单测，此处验「--pipe 解析 + 三命令源 + --apply 闸 + 退出码」。

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

/** 建临时 vault + .x-basalt/config.yaml，返回 {vault, baseDir, db}。 */
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

test("CLI Given --pipe use=<name>（配置引用，scan 源）Then 落库并报告 total=1", () => {
  const { vault, baseDir, db } = setup("pipelines:\n  idx:\n    actions: [index]\n", {
    "a.md": "---\ntags: [pkm]\n---\nA\n",
  });
  try {
    const r = run(["run", "--pipe", "use=idx", "--vault", vault, "--db", db, "--json"], {
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

test("CLI Given --pipe actions=<内联>（免配置，scan 源）Then total=1", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "# A\n" });
  try {
    const r = run(["run", "--pipe", "actions=index", "--vault", vault, "--db", db, "--json"], {
      X_BASALT_DIR: baseDir,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given scan --pipe use=<name>（一次性 scan 源编排）Then total=1", () => {
  const { vault, baseDir, db } = setup("pipelines:\n  idx:\n    actions: [index]\n", {
    "a.md": "---\ntags: [pkm]\n---\nA\n",
  });
  try {
    const r = run(["scan", "--pipe", "use=idx", vault, "--db", db, "--json"], {
      X_BASALT_DIR: baseDir,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given --pipe use=未知 Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("pipelines:\n  idx:\n    actions: [index]\n", {});
  try {
    const r = run(["run", "--pipe", "use=nope", "--vault", vault], { X_BASALT_DIR: baseDir });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /未知管道/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given run 无 --pipe（缺动作）Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(["run", "--vault", vault], { X_BASALT_DIR: baseDir });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /管道动作|actions/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given --pipe where=DQL（手动源）Then 只处理命中文件", () => {
  const { vault, baseDir, db } = setup("{}\n", {
    "a.md": "---\ntags: [pkm]\n---\nA\n",
    "b.md": "B\n",
  });
  try {
    const idx = run(["index", vault, "--db", db], { X_BASALT_DIR: baseDir });
    assert.equal(idx.status, 0, idx.stderr);
    const r = run(
      [
        "run",
        "--pipe",
        "actions=parse",
        "--pipe",
        "where=LIST FROM #pkm",
        "--vault",
        vault,
        "--db",
        db,
        "--json",
      ],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given --pipe actions=normalize Then 默认 dry-run 不落盘，--apply 落盘", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "---\ntag: x\n---\nbody\n" });
  try {
    const before = readFileSync(join(vault, "a.md"), "utf8");
    // 默认 dry-run：scan 源（库空→a.md added）跑 normalize，但不落盘
    const dry = run(
      ["run", "--pipe", "actions=normalize", "--vault", vault, "--db", db, "--json"],
      {
        X_BASALT_DIR: baseDir,
      },
    );
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(readFileSync(join(vault, "a.md"), "utf8"), before, "dry-run 不应改文件");
    // --apply：落盘 tag→tags
    const apply = run(
      ["run", "--pipe", "actions=normalize", "--apply", "--vault", vault, "--db", db, "--json"],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(readFileSync(join(vault, "a.md"), "utf8"), /tags:/, "--apply 应落盘 tag→tags");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

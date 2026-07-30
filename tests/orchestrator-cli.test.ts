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
  input?: string,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    // 给 input 即让子进程 stdin 成管道（isTTY=undefined），用于测 --stdin 原生管道源。
    ...(input === undefined ? {} : { input }),
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

test("CLI Given --pipe actions=apply Then 默认 dry-run 不落盘，--apply 落盘", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "---\n---\n# A\n正文\n" });
  try {
    const before = readFileSync(join(vault, "a.md"), "utf8");
    const dry = run(
      ["run", "--pipe", "actions=apply pkm-note", "--vault", vault, "--db", db, "--json"],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(readFileSync(join(vault, "a.md"), "utf8"), before, "dry-run 不应改文件");

    const apply = run(
      [
        "run",
        "--pipe",
        "actions=apply pkm-note",
        "--apply",
        "--vault",
        vault,
        "--db",
        db,
        "--json",
      ],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(readFileSync(join(vault, "a.md"), "utf8"), /created:/, "--apply 应落盘补 created");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given --pipe rename + if-exists=overwrite Then 冲突策略经 CLI 生效", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "---\ntag: x\ntags: y\n---\nbody\n" });
  try {
    const r = run(
      [
        "run",
        "--pipe",
        "actions=rename tag tags",
        "--pipe",
        "if-exists=overwrite",
        "--apply",
        "--vault",
        vault,
        "--db",
        db,
        "--json",
      ],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(vault, "a.md"), "utf8");
    assert.match(content, /tags: x/);
    assert.doesNotMatch(content, /tag:/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("CLI Given --pipe if-exists=非法值 Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(
      ["run", "--pipe", "actions=parse", "--pipe", "if-exists=bogus", "--vault", vault],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /if-exists/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

// === PC-1/PC-2/PC-3/PC-4：管道收尾（计划 docs/plans/2026-07-30-pipe-closure.md）===
// 校验点：参数校验落到命令面（拼错/非法值不静默）、补全的内联参数生效、set 列表值、--stdin 原生管道源。

test("PC-1c Given --pipe key 拼错 Then 报错退出码 1（不静默丢过滤条件）", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(["run", "--pipe", "actions=parse", "--pipe", "wehre=LIST", "--vault", vault], {
      X_BASALT_DIR: baseDir,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /未知 --pipe key/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-1b Given --pipe on=非法事件类型 Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(["run", "--pipe", "actions=parse", "--pipe", "on=modified", "--vault", vault], {
      X_BASALT_DIR: baseDir,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /on/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-1b Given --pipe concurrency=非数 Then 报错退出码 1", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(
      ["run", "--pipe", "actions=parse", "--pipe", "concurrency=abc", "--vault", vault],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /concurrency/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-2a Given --pipe debounce= 内联 Then 被接受（曾只能走配置段）", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "A\n" });
  try {
    const r = run(
      [
        "run",
        "--pipe",
        "actions=parse",
        "--pipe",
        "debounce=50,500",
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

test("PC-2a Given --pipe on-busy=restart Then 报「尚未实现」退出码 1（不静默按 queue 跑）", () => {
  const { vault, baseDir } = setup("{}\n", {});
  try {
    const r = run(
      ["run", "--pipe", "actions=parse", "--pipe", "on-busy=restart", "--vault", vault],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /尚未实现/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-3a Given --pipe actions=\"set k=[a, b],index\" Then 列表值落盘且括号内逗号不切碎", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "---\n---\nbody\n" });
  try {
    const r = run(
      [
        "run",
        "--pipe",
        "actions=set tags=[pkm, note],index",
        "--apply",
        "--vault",
        vault,
        "--db",
        db,
        "--json",
      ],
      { X_BASALT_DIR: baseDir },
    );
    assert.equal(r.status, 0, r.stderr);
    const content = readFileSync(join(vault, "a.md"), "utf8");
    assert.match(content, /tags:\s*\n\s*- pkm\s*\n\s*- note/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-4b Given run --stdin 喂文件列表 Then 作手动源（跳空行与 # 注释）", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" });
  try {
    const r = run(
      ["run", "--stdin", "--pipe", "actions=parse", "--vault", vault, "--db", db, "--json"],
      { X_BASALT_DIR: baseDir },
      "a.md\n\n# 注释：跳过\nb.md\n",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 2); // c.md 未在列表里 → 不处理
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-4b Given run --stdin 空输入 Then total=0 且不挂起", () => {
  const { vault, baseDir, db } = setup("{}\n", { "a.md": "A\n" });
  try {
    const r = run(
      ["run", "--stdin", "--pipe", "actions=parse", "--vault", vault, "--db", db, "--json"],
      { X_BASALT_DIR: baseDir },
      "",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 0);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("PC-4b Given run --stdin 同时给 where= Then stdin 供源、where 退化为语义过滤", () => {
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
        "--stdin",
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
      "a.md\nb.md\n",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).total, 1); // stdin 给两个，where 只留 a.md
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

// === C1：stdin 路径穿越对抗（安全）===
// `../outside.md` 经 toAbs 归一化会逃出 vault 根，--apply 下写动作可改写 vault 外文件。
// 口径：声明期报错（exit 1）并列出非法行，vault 外文件不被改写。

test("C1 Given run --stdin 喂 ../ 越界路径 + --apply Then 报错退出码 1 且 vault 外文件不被改写", () => {
  const parent = mkdtempSync(join(tmpdir(), "xb-ocli-c1-"));
  const vault = join(parent, "vault");
  const baseDir = join(vault, ".x-basalt");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, "config.yaml"), "{}\n");
  const outside = join(parent, "outside.md");
  writeFileSync(outside, "---\n---\n原内容\n");
  writeFileSync(join(vault, "a.md"), "A\n");
  try {
    const r = run(
      [
        "run",
        "--stdin",
        "--pipe",
        "actions=set x=y",
        "--apply",
        "--vault",
        vault,
        "--db",
        join(baseDir, "index.db"),
      ],
      { X_BASALT_DIR: baseDir },
      "../outside.md\n",
    );
    assert.equal(r.status, 1, "越界路径应声明期失败");
    assert.match(r.stderr, /\.\.\/outside\.md/, "错误应列出非法行");
    assert.equal(readFileSync(outside, "utf8"), "---\n---\n原内容\n", "vault 外文件不得被改写");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("C1 Given run --stdin 喂根外绝对路径 Then 报错退出码 1", () => {
  const parent = mkdtempSync(join(tmpdir(), "xb-ocli-c1-"));
  const vault = join(parent, "vault");
  const baseDir = join(vault, ".x-basalt");
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, "config.yaml"), "{}\n");
  const outside = join(parent, "outside.md");
  writeFileSync(outside, "原内容\n");
  try {
    const r = run(
      [
        "run",
        "--stdin",
        "--pipe",
        "actions=parse",
        "--vault",
        vault,
        "--db",
        join(baseDir, "index.db"),
      ],
      { X_BASALT_DIR: baseDir },
      `${outside}\n`,
    );
    assert.equal(r.status, 1, "根外绝对路径应声明期失败");
    assert.match(r.stderr, /outside\.md/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// I1：stdin + where= 时不存在路径不再裸崩（warn 剔除，真实文件照常过滤）。

test("I1 Given run --stdin 含不存在路径且带 where= Then 不裸崩：ghost 被剔除并 warn、真实文件走 where 过滤", () => {
  const { vault, baseDir, db } = setup("{}\n", {
    "a.md": "---\ntags: [pkm]\n---\nA\n",
    "b.md": "B\n",
  });
  try {
    const r = run(
      [
        "run",
        "--stdin",
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
      "ghost.md\na.md\nb.md\n",
    );
    assert.equal(r.status, 0, `不应 exit 1 裸崩：${r.stderr}`);
    assert.match(r.stderr, /ghost\.md/, "warn 应指出被剔除的路径");
    assert.equal(JSON.parse(r.stdout).total, 1, "ghost 剔除 + where 只留 a.md");
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

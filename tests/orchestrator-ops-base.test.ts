/**
 * base 算子端到端测试（片二第三个只读算子）。
 *
 * 设计：docs/design/pipeline-op-model.md §3.2（Op/OpOutcome 签名）、§4（算子清单 base 行）、
 * §5（数据传递：formula 计算列喂给下游）、D11（空批不短路）。
 *
 * 测试风格参照 tests/orchestrator-ops-query.test.ts。
 * .base 文件是纯 YAML，有顶层 `views:` 列表（与 tests/fixtures/bases/ 下 fixture 一致）。
 * view 的 order 必须含 file.path 以便算子映射行路径；缺失时算子显式报错（Op-B8）。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { registerBuiltinOps } from "../src/orchestrator/ops.js";
import { resolve } from "../src/orchestrator/registry.js";
import { Orchestrator } from "../src/orchestrator/engine.js";
import { resolveVaultLayout } from "../src/utils/path.js";
import type { Op, OpContext, Row } from "../src/orchestrator/types.js";

// === 模块级初始化 ===
registerBuiltinOps();

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-ob-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

// ---------------------------------------------------------------------------
// Op-B1 base 作源（空入参）：产出行数与 view 命中一致；fields 含 formula 计算列值
// ---------------------------------------------------------------------------
test("Op-B1 Given base 作源（空入参）When run Then 产出行与 view 命中一致且 fields 含 formula 计算列", async () => {
  const dir = mkVault({
    // .base 是纯 YAML，顶层 formulas + views
    "tasks.base": `formulas:
  urgency: priority * 2
views:
  - type: table
    name: overdue
    filters: 'status == "pending"'
    order:
      - file.path
      - file.name
      - status
      - formula.urgency
`,
    "a.md": "---\nstatus: pending\npriority: 3\n---\n# Task A\n",
    "b.md": "---\nstatus: done\npriority: 5\n---\n# Task B\n",
    "c.md": "---\nstatus: pending\npriority: 1\n---\n# Task C\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md", "c.md"]) await indexer.update(f);

    const baseOp = resolve("base tasks.base#overdue") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };
    const result = await baseOp.run([], ctx);

    // error 级诊断不应使算子 failed
    const errorDiags = result.failed.filter((f) => f.op === "base");
    assert.equal(errorDiags.length, 0, `不应有 failed 诊断：${JSON.stringify(errorDiags)}`);

    // overdue view filter: status == "pending" → a.md, c.md
    assert.equal(result.rows.length, 2, "overdue view 应产出 2 行");
    const paths = result.rows.map((r) => r.path).toSorted();
    assert.deepEqual(paths, ["a.md", "c.md"]);

    // 验证 formula 计算列 formula.urgency 存在且有值
    const aRow = result.rows.find((r) => r.path === "a.md")!;
    assert.ok(aRow, "a.md 应在结果中");
    assert.equal(aRow.fields["file.name"], "a.md");
    assert.equal(aRow.fields["status"], "pending");
    // formula.urgency = priority * 2: a.md priority=3 → 6
    assert.equal(aRow.fields["formula.urgency"], 6, "formula.urgency 应为 6 (3*2)");

    const cRow = result.rows.find((r) => r.path === "c.md")!;
    assert.ok(cRow, "c.md 应在结果中");
    assert.equal(cRow.fields["file.name"], "c.md");
    // formula.urgency = priority * 2: c.md priority=1 → 2
    assert.equal(cRow.fields["formula.urgency"], 2, "formula.urgency 应为 2 (1*2)");

    // b.md 不应出现（status=done）
    assert.equal(
      result.rows.find((r) => r.path === "b.md"),
      undefined,
      "b.md 不应在结果中",
    );
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B2 base 作转换（非空入参）：过滤上游行 + 同名键上游优先
// ---------------------------------------------------------------------------
test("Op-B2 Given base 作转换（非空入参）When run Then 过滤上游行且同名键上游优先", async () => {
  const dir = mkVault({
    "tasks.base": `formulas:
  urgency: priority * 2
views:
  - type: table
    name: overdue
    filters: 'status == "pending"'
    order:
      - file.path
      - file.name
      - status
      - formula.urgency
`,
    "a.md": "---\nstatus: pending\npriority: 3\n---\n# Task A\n",
    "b.md": "---\nstatus: done\npriority: 5\n---\n# Task B\n",
    "c.md": "---\nstatus: pending\npriority: 1\n---\n# Task C\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md", "c.md"]) await indexer.update(f);

    const baseOp = resolve("base tasks.base#overdue") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };

    // 上游行：三行都传入，带上游 fields（status 故意设不同值验证上游优先）
    const input: Row[] = [
      { path: "a.md", fields: { remark: "from-upstream", status: "upstream-win" } },
      { path: "b.md", fields: { remark: "origin" } },
      { path: "c.md", fields: { remark: "nope" } },
    ];
    const result = await baseOp.run(input, ctx);

    // 只保留 a.md、c.md（status == "pending"）
    assert.equal(result.failed.length, 0);
    assert.equal(result.rows.length, 2);
    const paths = result.rows.map((r) => r.path).toSorted();
    assert.deepEqual(paths, ["a.md", "c.md"]);

    // a.md: upstream 的 status 不应被 base 列值覆盖
    const aRow = result.rows.find((r) => r.path === "a.md")!;
    assert.equal(aRow.fields.remark, "from-upstream");
    assert.equal(aRow.fields.status, "upstream-win"); // 上游优先
    assert.ok("formula.urgency" in aRow.fields, "aRow 应有 formula.urgency");

    // c.md: 上游没有 status，base 列值应出现
    const cRow = result.rows.find((r) => r.path === "c.md")!;
    assert.equal(cRow.fields.remark, "nope");
    assert.equal(cRow.fields.status, "pending"); // base 列值

    // b.md 被过滤
    assert.equal(
      result.rows.find((r) => r.path === "b.md"),
      undefined,
    );
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B3 .base 有 error 级诊断（如 schema 非法）→ 进 failed 且不抛出
// ---------------------------------------------------------------------------
test("Op-B3 Given .base 文件 schema 非法 When run Then 进 failed 且不抛出异常", async () => {
  const dir = mkVault({
    "bad.base": `views: []
`,
    "a.md": "# A\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");

    const baseOp = resolve("base bad.base") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };

    // 作源
    {
      const result = await baseOp.run([], ctx);
      assert.equal(result.rows.length, 0);
      assert.ok(result.failed.length > 0, "schema 非法应进 failed");
      assert.equal(result.failed[0]!.op, "base");
      assert.ok(result.failed[0]!.error.length > 0);
    }

    // 作转换：行原样透传 + failed
    {
      const result = await baseOp.run([{ path: "a.md", fields: {} }], ctx);
      assert.equal(result.rows.length, 1, "转换模式应透传行");
      assert.ok(result.failed.length > 0, "转换模式也应报 failed");
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B4 markdown-only 的 warning 级诊断不进 failed
// ---------------------------------------------------------------------------
test("Op-B4 Given markdown-only warning 诊断 When run Then 不进 failed", async () => {
  const dir = mkVault({
    "good.base": `views:
  - type: table
    name: all
    order:
      - file.path
      - file.name
`,
    "a.md": "# A\n",
    "b.md": "# B\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md"]) await indexer.update(f);

    const baseOp = resolve("base good.base") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };

    const result = await baseOp.run([], ctx);

    // 作源应成功产出行（warning 不应使算子失败）
    assert.equal(result.rows.length, 2);
    // 检查 failed 中不应有任何 base 算子产生的条目（warning 不进 failed）
    const baseFailed = result.failed.filter((f) => f.op === "base");
    assert.equal(baseFailed.length, 0, "warning 诊断不应进 failed");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B5 ctx.vaultRoots/dbPath 缺失 → 记进 failed 且错误信息清晰
// ---------------------------------------------------------------------------
test("Op-B5 Given ctx 缺失 vaultRoots/dbPath When base run Then 记进 failed 且错误信息清晰", async () => {
  const dir = mkVault({ "a.md": "# A\n" });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");

    const baseOp = resolve("base tasks.base") as Op;

    // 缺失 vaultRoots 和 dbPath
    {
      const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
      const result = await baseOp.run([], ctx);
      assert.equal(result.rows.length, 0);
      assert.ok(result.failed.length > 0);
      assert.ok(
        result.failed[0]!.error.includes("vaultRoots") ||
          result.failed[0]!.error.includes("dbPath"),
        `报错应提及 vaultRoots/dbPath：${result.failed[0]!.error}`,
      );
    }

    // 作转换时
    {
      const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
      const result = await baseOp.run([{ path: "a.md", fields: {} }], ctx);
      assert.equal(result.rows.length, 1, "转换模式应透传行");
      assert.ok(result.failed.length > 0);
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B6 .base 指向不存在的文件 → error 诊断进 failed
// ---------------------------------------------------------------------------
test("Op-B6 Given .base 文件不存在 When run Then error 诊断进 failed", async () => {
  const dir = mkVault({
    "a.md": "# A\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");

    const baseOp = resolve("base nonexistent.base") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };
    const result = await baseOp.run([], ctx);

    assert.equal(result.rows.length, 0);
    assert.ok(result.failed.length > 0, "不存在的 .base 文件应进 failed");
    assert.equal(result.failed[0]!.op, "base");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-BE2E 端到端：经 Orchestrator.runManual 执行含 base 的管道
// ---------------------------------------------------------------------------
test("Op-BE2E Given runManual 含 index+base 管道 When run Then 端到端执行成功且 engine 被关闭", async () => {
  const dir = mkVault({
    "tasks.base": `views:
  - type: table
    name: all
    order:
      - file.path
      - file.name
      - status
`,
    "a.md": "---\nstatus: active\n---\n# A\n",
    "b.md": "---\nstatus: draft\n---\n# B\n",
  });
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    const report = await orch.runManual(
      {
        actions: ["index", "base tasks.base#all"],
        dryRun: false,
      },
      { paths: ["a.md", "b.md"] },
    );

    assert.ok(report.steps, "应有 steps 流水");
    assert.equal(report.steps.length, 2);
    assert.equal(report.steps[0]!.op, "index");
    assert.equal(report.steps[1]!.op, "base");

    // index 步不应有失败
    assert.equal(report.steps[0]!.failed.length, 0);

    // base 步应产出行
    assert.equal(report.steps[1]!.failed.length, 0, "base 不应有 failed");
    assert.ok(
      report.steps[1]!.rowsOut >= 2,
      `base 应产出 >=2 行，实为 ${report.steps[1]!.rowsOut}`,
    );

    // 验证 indexer 可正常 close（没有泄漏 BaseEngine 连接）
    const verifyIdx = new VaultIndexer({ vaultPath: dir, dbPath });
    try {
      await verifyIdx.update("a.md");
    } finally {
      verifyIdx.close();
    }
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-BD11 regression：空 routed 下 base 作源仍产出行（D11：空批不短路）
// ---------------------------------------------------------------------------
test("Op-BD11 Given 空事件批 + runManual When base 作源 Then 仍产出行（D11 regression）", async () => {
  const dir = mkVault({
    "tasks.base": `views:
  - type: table
    name: all
    order:
      - file.path
      - file.name
`,
    "a.md": "# A\n",
    "b.md": "# B\n",
  });
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    // 先建索引，让 DB 有数据
    await orch.runManual({ actions: ["index"], dryRun: false }, { paths: ["a.md", "b.md"] });

    // 用空路径源跑 base 管道（routed 为空，vaultRoots/dbPath 仍须供给）
    const report = await orch.runManual(
      { actions: ["base tasks.base#all"], dryRun: false },
      { paths: [] },
    );

    // base 应作为源产出行，不应报任何错误
    assert.ok(report.steps, "应有 steps 流水");
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0]!.op, "base");
    assert.ok(
      report.steps[0]!.rowsOut >= 2,
      `base 作源应产出 >=2 行，实为 ${report.steps[0]!.rowsOut}`,
    );
    assert.equal(report.steps[0]!.failed.length, 0, "base 不应有 failed");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B8 view 未投影 file.path → 显式报错（与 query 算子同一规则），不退化为空 path
// ---------------------------------------------------------------------------
test("Op-B8 Given view 的 order 不含 file.path When run Then 显式报错并提示补法", async () => {
  const dir = mkVault({
    // order 里没有 file.path——BaseEngine 不会把它投影进结果行
    "nopath.base": `views:
  - type: table
    name: all
    order:
      - file.name
`,
    "a.md": "# A\n",
    "b.md": "# B\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md"]) await indexer.update(f);

    const baseOp = resolve("base nopath.base#all") as Op;
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };

    // 作源：0 行 + 一条 failed，错误信息点名 file.path 与补法
    {
      const result = await baseOp.run([], ctx);
      assert.equal(result.rows.length, 0, "缺 file.path 不得产出行（尤其不得产出空 path 行）");
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0]!.op, "base");
      assert.ok(
        result.failed[0]!.error.includes("file.path"),
        `报错应点名 file.path：${result.failed[0]!.error}`,
      );
    }

    // 作转换：每行各记一条 failed
    {
      const input: Row[] = [
        { path: "a.md", fields: {} },
        { path: "b.md", fields: {} },
      ];
      const result = await baseOp.run(input, ctx);
      assert.equal(result.rows.length, 0);
      assert.equal(result.failed.length, 2);
      assert.ok(result.failed.every((f) => f.error.includes("file.path")));
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B7 base 缺省 view（不传 #viewName）：取 views[0]
// ---------------------------------------------------------------------------
test("Op-B7 Given base 不传 #viewName When run Then 缺省取 views[0]", async () => {
  const dir = mkVault({
    // 两个 view 都在同一个 YAML 的 views 列表里
    "multi.base": `views:
  - type: table
    name: first
    filters: 'status == "active"'
    order:
      - file.path
      - file.name
  - type: table
    name: second
    filters: 'status == "draft"'
    order:
      - file.path
      - file.name
`,
    "a.md": "---\nstatus: active\n---\n# A\n",
    "b.md": "---\nstatus: draft\n---\n# B\n",
  });
  const vaultRoots = [dir];
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md"]) await indexer.update(f);

    const baseOp = resolve("base multi.base") as Op; // 不传 viewName
    const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true, vaultRoots, dbPath };
    const result = await baseOp.run([], ctx);

    // 缺省取 views[0] = "first"，filter: status=="active" → 只应返回 a.md
    assert.equal(result.failed.length, 0);
    assert.equal(result.rows.length, 1, "缺省 view 应只返回 views[0] 的行");
    assert.equal(result.rows[0]!.path, "a.md");
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-B9 多根 vault：base 产出行 path = 索引主键（D14 显式断言）
// ---------------------------------------------------------------------------
test("Op-B9 Given 多根 vault When base 作源 Then 行 path 与索引主键零冲突（根名命名空间）", async () => {
  const a = mkdtempSync(join(tmpdir(), "xb-ob-a-"));
  const b = mkdtempSync(join(tmpdir(), "xb-ob-b-"));
  writeFileSync(
    join(a, "tasks.base"),
    `views:
  - type: table
    name: overdue
    filters: 'status == "pending"'
    order:
      - file.path
      - file.name
      - status
`,
  );
  writeFileSync(join(a, "a.md"), "---\nstatus: pending\n---\n# A\n");
  writeFileSync(join(b, "b.md"), "---\nstatus: pending\n---\n# B\n");
  writeFileSync(join(b, "c.md"), "---\nstatus: done\n---\n# C\n");
  const vaultRoots = [a, b];
  const dbPath = join(a, "i.db");
  const indexer = new VaultIndexer({ vaultPath: [a, b], dbPath });
  try {
    for (const f of [join(a, "a.md"), join(b, "b.md"), join(b, "c.md")]) {
      await indexer.update(f);
    }

    // .base 在根 a 内：算子参数用 `<根目录名>/tasks.base#view` 命名空间写法
    const baseOp = resolve(`base ${basename(a)}/tasks.base#overdue`) as Op;
    const ctx: OpContext = { indexer, dryRun: true, vaultRoots, dbPath };
    const result = await baseOp.run([], ctx);

    assert.equal(result.failed.length, 0, `不应有 failed：${JSON.stringify(result.failed)}`);
    // 跨根命中的两篇：行 path 必须是 `<根目录名>/<相对>` 命名空间键
    const expected = [`${basename(a)}/a.md`, `${basename(b)}/b.md`].toSorted();
    const actual = result.rows.map((r) => r.path).toSorted();
    assert.deepEqual(actual, expected);
    // 与 layout.toKey 同一键函数，写侧 toAbs 是其逆（零冲突不变量）
    const layout = resolveVaultLayout(vaultRoots);
    assert.deepEqual(
      actual,
      [layout.toKey(join(a, "a.md")), layout.toKey(join(b, "b.md"))].toSorted(),
    );
  } finally {
    indexer.close();
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

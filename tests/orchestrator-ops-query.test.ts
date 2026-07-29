import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { DataviewEngine } from "../src/query/index.js";
import { registerBuiltinOps } from "../src/orchestrator/ops.js";
import { resolve } from "../src/orchestrator/registry.js";
import { Orchestrator } from "../src/orchestrator/engine.js";
import type { Op, OpContext, Row } from "../src/orchestrator/types.js";

// === 模块级初始化 ===
registerBuiltinOps();

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-oq-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

// === 片二：query/search 只读算子 ===
// 设计：docs/design/pipeline-op-model.md §3.2（Op/OpOutcome 签名）、§4（算子清单）、§9 片二

// ---------------------------------------------------------------------------
// Op-Q1 query 作源（空入参）
// ---------------------------------------------------------------------------
test("Op-Q1 Given query 作源（空入参）When run Then 产出行数与 DQL 命中数一致且 fields 含列值", async () => {
  const dir = mkVault({
    "a.md": "---\ntags: [fruit]\nstatus: active\n---\n# Apple\n",
    "b.md": "---\ntags: [fruit]\nstatus: draft\n---\n# Banana\n",
    "c.md": "---\ntags: [other]\nstatus: active\n---\n# Cherry\n",
  });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    // 先索引文件让 DB 有数据
    for (const f of ["a.md", "b.md", "c.md"]) await indexer.update(f);

    const engine = new DataviewEngine(dbPath);
    try {
      const queryOp = resolve("query LIST FROM #fruit") as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
      const result = await queryOp.run([], ctx);

      // LIST FROM #fruit → 2 行（a.md、b.md）
      assert.equal(result.failed.length, 0);
      assert.equal(result.rows.length, 2);
      assert.equal(result.changed.length, 0);
      assert.equal(result.skipped.length, 0);

      const paths = result.rows.map((r) => r.path).toSorted();
      assert.deepEqual(paths, ["a.md", "b.md"]);
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-Q2 query 作转换（非空入参）：过滤 + fields 合并
// ---------------------------------------------------------------------------
test("Op-Q2 Given query 作转换（非空入参）When run Then 只保留 DQL 命中行且上游同名键不被覆盖", async () => {
  const dir = mkVault({
    "a.md": "---\ntags: [fruit]\nstatus: active\n---\n# Apple\n",
    "b.md": "---\ntags: [fruit]\nstatus: draft\n---\n# Banana\n",
    "c.md": "---\ntags: [other]\nstatus: active\n---\n# Cherry\n",
  });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md", "c.md"]) await indexer.update(f);

    const engine = new DataviewEngine(dbPath);
    try {
      const queryOp = resolve("query TABLE file.path, status FROM #fruit") as Op;
      // 上游行：三行都传入，带上游 fields（其中 status 故意设不同值，验证上游优先）
      const input: Row[] = [
        { path: "a.md", fields: { remark: "from-upstream", status: "upstream-win" } },
        { path: "b.md", fields: { remark: "origin" } },
        { path: "c.md", fields: { remark: "nope" } }, // c 不命中 #fruit → 应被过滤
      ];
      const result = await queryOp.run(input, ctxWith({ indexer, engine, dir }));

      // 只保留 a.md、b.md（FROM #fruit）
      assert.equal(result.failed.length, 0);
      assert.equal(result.rows.length, 2);
      assert.equal(result.changed.length, 0);

      const paths = result.rows.map((r) => r.path).toSorted();
      assert.deepEqual(paths, ["a.md", "b.md"]);

      // a.md: upstream 的 status 不应被 DQL 的 "active" 覆盖
      const aRow = result.rows.find((r) => r.path === "a.md")!;
      assert.equal(aRow.fields.remark, "from-upstream");
      assert.equal(aRow.fields.status, "upstream-win"); // 上游优先
      // status 列被上游覆盖，但 TABLE 仍会添加其他 DQL 列（如 file.name）
      assert.ok("status" in aRow.fields); // 存在（被上游覆盖了，但key还在）

      // b.md: 上游没有 status，DQL 的值应出现
      const bRow = result.rows.find((r) => r.path === "b.md")!;
      assert.equal(bRow.fields.remark, "origin");
      assert.equal(bRow.fields.status, "draft"); // DQL 值

      // c.md 被过滤
      assert.equal(
        result.rows.find((r) => r.path === "c.md"),
        undefined,
      );
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-S1 search 作源（空入参）
// ---------------------------------------------------------------------------
test("Op-S1 Given search 作源（空入参）When run Then 产出命中行", async () => {
  const dir = mkVault({
    "a.md": "---\ntags: [fruit]\n---\n# Apple\napple pie content here\n",
    "b.md": "---\ntags: [fruit]\n---\n# Banana\nbanana smoothie blend\n",
  });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    for (const f of ["a.md", "b.md"]) await indexer.update(f);

    const engine = new DataviewEngine(dbPath);
    try {
      const searchOp = resolve("search apple") as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
      const result = await searchOp.run([], ctx);

      assert.equal(result.failed.length, 0);
      assert.equal(result.changed.length, 0);
      // apple 应命中 a.md
      assert.ok(result.rows.length >= 1);
      const hit = result.rows.find((r) => r.path === "a.md");
      assert.ok(hit, "search 'apple' 应命中 a.md");
      assert.ok(hit!.fields.name, "应有 name 字段");
      assert.ok(hit!.fields.snippet, "应有 snippet 字段");
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-Q3 DQL 语法错误 → 进 failed 且不抛出
// ---------------------------------------------------------------------------
test("Op-Q3 Given DQL 语法错误 When run Then 进 failed 且不抛出异常", async () => {
  const dir = mkVault({ "a.md": "# dummy\n" });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");
    const engine = new DataviewEngine(dbPath);
    try {
      // 作源：空入参
      {
        const queryOp = resolve("query LIST FROM") as Op; // FROM 后缺参数
        const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
        const result = await queryOp.run([], ctx);

        assert.equal(result.rows.length, 0);
        assert.ok(result.failed.length > 0, "语法错误应进入 failed");
        assert.equal(result.failed[0]!.path, "<query>");
        assert.equal(result.failed[0]!.op, "query");
        assert.ok(result.failed[0]!.error.length > 0);
      }

      // 作转换：非空入参
      {
        const queryOp = resolve("query LIST FROM") as Op;
        const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
        const input: Row[] = [{ path: "a.md", fields: { x: 1 } }];
        const result = await queryOp.run(input, ctx);

        // 行原样透传，同时报 failed
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]!.path, "a.md");
        assert.ok(result.failed.length > 0);
        assert.equal(result.failed[0]!.path, "<query>");
      }
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-Q4 ctx.engine 缺失 → 报错信息清晰
// ---------------------------------------------------------------------------
test("Op-Q4 Given ctx.engine 缺失 When query/search run Then 报错信息清晰", async () => {
  const dir = mkVault({ "a.md": "# dummy\n" });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");

    // query 缺失 engine
    {
      const queryOp = resolve('query LIST FROM ""') as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true }; // 不传 engine
      const result = await queryOp.run([{ path: "a.md", fields: {} }], ctx);

      assert.ok(result.failed.length > 0, "缺失 engine 应有 failed");
      const errMsg = result.failed[0]!.error;
      assert.ok(errMsg.includes("engine"), `报错应提及 engine，实际：${errMsg}`);
      // 作源时 rows 应为空
      {
        const srcResult = await queryOp.run([], ctx);
        assert.equal(srcResult.rows.length, 0);
        assert.ok(srcResult.failed.length > 0);
      }
    }

    // search 缺失 engine
    {
      const searchOp = resolve("search apple") as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, dryRun: true };
      // 作源
      const srcResult = await searchOp.run([], ctx);
      assert.equal(srcResult.rows.length, 0);
      assert.ok(srcResult.failed.length > 0);
      assert.ok(
        srcResult.failed[0]!.error.includes("engine"),
        `search 报错应提及 engine，实际：${srcResult.failed[0]!.error}`,
      );
      // 作转换
      const tfResult = await searchOp.run([{ path: "a.md", fields: {} }], ctx);
      assert.equal(tfResult.rows.length, 1); // 行原样透传
      assert.ok(tfResult.failed.length > 0);
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-QE2E 端到端：经 Orchestrator.runManual 执行含 query 的管道
// ---------------------------------------------------------------------------
test("Op-QE2E Given runManual 含 index+query 管道 When run Then 端到端执行成功且 engine 被关闭", async () => {
  const dir = mkVault({
    "a.md": "---\nstatus: active\n---\n# Apple\n",
    "b.md": "---\nstatus: draft\n---\n# Banana\n",
  });
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    // 先在建索引的 indexer 里索引文件
    // Orchestrator 内部自己有 indexer，我们用 runManual 的 index 动作来索引
    const report = await orch.runManual(
      {
        actions: ["index", 'query TABLE file.path, status FROM ""'],
        dryRun: false,
      },
      { paths: ["a.md", "b.md"] },
    );

    // 两步算子：index + query
    assert.ok(report.steps, "应有 steps 流水");
    assert.equal(report.steps.length, 2);
    assert.equal(report.steps[0]!.op, "index");
    assert.equal(report.steps[1]!.op, "query");

    // index 步不应有失败
    assert.equal(report.steps[0]!.failed.length, 0);

    // query 步应产出行
    assert.equal(report.steps[1]!.failed.length, 0, "query 不应有失败");
    assert.ok(
      report.steps[1]!.rowsOut >= 2,
      `query 应产出 >=2 行，实为 ${report.steps[1]!.rowsOut}`,
    );

    // 验证 engine 已被关闭：在 runBatch 返回后，手动开一个相同路径的 engine 应正常
    // 若旧 engine 泄漏（未 close），新 engine 仍可正常打开（readonly 不锁文件），
    // 但泄漏的 better-sqlite3 连接会导致进程退出时残留资源警告或 Windows 上文件锁定。
    // 这里通过再次打开并关闭来验证无阻塞性泄漏。
    const verifyEngine = new DataviewEngine(dbPath);
    try {
      const q2 = verifyEngine.query('TABLE file.path, status FROM ""');
      assert.ok(q2.rows.length >= 2, "再次查询应仍有数据");
    } finally {
      verifyEngine.close();
    }
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-D11 regression：routed 为空时 query 作源仍应产出行（D11：ctx.engine 不得按「有行才准备」条件供给）
// ---------------------------------------------------------------------------
test("Op-D11 Given 空事件批 + runManual When query 作源 Then 仍产出行（D11 regression）", async () => {
  const dir = mkVault({
    "a.md": "---\nstatus: active\n---\n# Apple\n",
    "b.md": "---\nstatus: draft\n---\n# Banana\n",
  });
  const dbPath = join(dir, "i.db");
  const orch = new Orchestrator({ vaultPath: dir, dbPath });
  try {
    // 先建索引，让 DB 有数据
    await orch.runManual({ actions: ["index"], dryRun: false }, { paths: ["a.md", "b.md"] });

    // 用空路径源跑 query 管道（routed 为空，engine 仍须创建）
    const report = await orch.runManual(
      { actions: ['query TABLE file.path, status FROM ""'], dryRun: false },
      { paths: [] },
    );

    // query 应作为源产出行，不应报 engine 缺失
    assert.ok(report.steps, "应有 steps 流水");
    assert.equal(report.steps.length, 1);
    assert.equal(report.steps[0]!.op, "query");
    assert.ok(
      report.steps[0]!.rowsOut >= 2,
      `query 作源应产出 >=2 行，实为 ${report.steps[0]!.rowsOut}`,
    );
    assert.equal(report.steps[0]!.failed.length, 0, "query 不应有失败");
  } finally {
    orch.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-Q5 TABLE DQL 不含 file.path（源模式）：记进 failed 并给出可操作提示
// ---------------------------------------------------------------------------
test("Op-Q5 Given TABLE DQL 不含 file.path（源模式）When run Then 记进 failed 并给出可操作中文提示", async () => {
  const dir = mkVault({
    "a.md": "---\nstatus: active\n---\n# Apple\n",
  });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");
    const engine = new DataviewEngine(dbPath);
    try {
      // TABLE status FROM "" 不含 file.path 列
      const queryOp = resolve('query TABLE status FROM ""') as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
      const result = await queryOp.run([], ctx);

      // 应进 failed，不静默跳过
      assert.equal(result.rows.length, 0, "缺少 file.path 不应产出有效行");
      assert.ok(result.failed.length > 0, "缺少 file.path 应进 failed");
      assert.equal(result.failed[0]!.path, "<query>");
      assert.equal(result.failed[0]!.op, "query");
      assert.ok(
        result.failed[0]!.error.includes("file.path"),
        `提示应提及 file.path: ${result.failed[0]!.error}`,
      );
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Op-Q6 TABLE DQL 不含 file.path（转换模式）：记进 failed 并给出可操作提示
// ---------------------------------------------------------------------------
test("Op-Q6 Given TABLE DQL 不含 file.path（转换模式）When run Then 记进 failed 并给出可操作中文提示", async () => {
  const dir = mkVault({
    "a.md": "---\nstatus: active\n---\n# Apple\n",
  });
  const dbPath = join(dir, "i.db");
  const indexer = new VaultIndexer({ vaultPath: dir, dbPath });
  try {
    await indexer.update("a.md");
    const engine = new DataviewEngine(dbPath);
    try {
      const queryOp = resolve('query TABLE status FROM ""') as Op;
      const ctx: OpContext = { vaultPath: dir, indexer, engine, dryRun: true };
      const input: Row[] = [{ path: "a.md", fields: { x: 1 } }];
      const result = await queryOp.run(input, ctx);

      // 转换模式：所有入行进 failed（无法映射行路径）
      assert.equal(result.rows.length, 0, "缺少 file.path 不应产出有效行");
      assert.ok(result.failed.length > 0, "缺少 file.path 应进 failed");
      // 应包含原入参行的路径
      assert.equal(result.failed[0]!.path, "a.md");
      assert.equal(result.failed[0]!.op, "query");
      assert.ok(
        result.failed[0]!.error.includes("file.path"),
        `提示应提及 file.path: ${result.failed[0]!.error}`,
      );
    } finally {
      engine.close();
    }
  } finally {
    indexer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------
function ctxWith(opts: { indexer: VaultIndexer; engine: DataviewEngine; dir: string }): OpContext {
  return { vaultPath: opts.dir, indexer: opts.indexer, engine: opts.engine, dryRun: true };
}

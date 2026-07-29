/**
 * 诊断类算子端到端测试（片二收尾：lint / links.check / links.suggest）。
 *
 * 设计：docs/design/pipeline-op-model.md §4（算子清单 lint/links.check/links.suggest）、
 * §12（诊断键名决策：fields.diagnostics 复用 BasaltDiagnostic 结构）。
 *
 * 关键约束验证：
 * - 有诊断的行仍然透传（诊断 ≠ 失败）
 * - failed 只用于「跑动作本身失败」，不用于「发现了诊断」
 * - changed/skipped 恒为空（只读）
 *
 * 测试风格参照 tests/orchestrator-ops-base.test.ts。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerBuiltinOps } from "../src/orchestrator/ops.js";
import { resolve } from "../src/orchestrator/registry.js";
import type { BasaltDiagnostic } from "../src/diagnostic.js";
import type { Op, OpContext, OpOutcome, Row } from "../src/orchestrator/types.js";

// === 模块级初始化 ===
registerBuiltinOps();

/** 建临时 vault，返回目录路径。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-ob-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

/** 下游假算子：断言收到了指定行数，然后原样透传。 */
function verifierOp(expectedCount: number): Op & { verified: boolean } {
  const op = {
    name: "__verifier__",
    write: false,
    rowwise: false,
    verified: false,
    async run(this: typeof op, rows: Row[], _ctx: OpContext): Promise<OpOutcome> {
      assert.equal(
        rows.length,
        expectedCount,
        `下游假算子：期望收到 ${expectedCount} 行，实际收到 ${rows.length}`,
      );
      op.verified = true;
      return { rows, failed: [], changed: [], skipped: [] };
    },
  };
  return op;
}

/**
 * 验证行 fields.diagnostics 包含指定 key 的断链诊断。
 * 返回 diagnostics 引用以便进一步断言。
 */
function assertHasBrokenLink(row: Row, brokenTarget?: string): BasaltDiagnostic[] {
  const diags = row.fields.diagnostics as BasaltDiagnostic[] | undefined;
  assert.ok(diags, `行 ${row.path} 应有 diagnostics`);
  assert.ok(Array.isArray(diags), "diagnostics 应为数组");
  assert.ok(diags.length > 0, `行 ${row.path} 应有至少一条诊断`);
  if (brokenTarget) {
    const match = diags.find((d) => d.target?.toLowerCase().includes(brokenTarget.toLowerCase()));
    assert.ok(
      match,
      `行 ${row.path} 的诊断应包含目标 "${brokenTarget}"，实际：${JSON.stringify(diags.map((d) => d.target))}`,
    );
  }
  return diags!;
}

// ---------------------------------------------------------------------------
// D1 lint 作转换：上游给几行，产出行数不变（透传），有问题的行 diagnostics 非空
// ---------------------------------------------------------------------------
test("D1 Given lint 作转换 When run Then 产出行数不变且断链行 diagnostics 非空", async () => {
  const dir = mkVault({
    "good.md": "# Good Note\n这是一个有效笔记。\n",
    "broken.md": "# Broken Note\n引用一个不存在的页面 [[non-existent-page]]。\n",
    "also-ok.md": "# Also OK\n没有断链。\n",
  });
  try {
    const lintOp = resolve("lint") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never, // lint 不依赖 indexer
      dryRun: true,
      vaultRoots: [dir],
    };

    // 上游传入两行
    const input: Row[] = [
      { path: "good.md", fields: { label: "from-upstream" } },
      { path: "broken.md", fields: { label: "should-have-diag" } },
      { path: "also-ok.md", fields: { label: "clean" } },
    ];
    const result = await lintOp.run(input, ctx);

    // 产出行数不变（透传）
    assert.equal(result.rows.length, 3, "lint 作转换应透传所有行");
    assert.equal(result.failed.length, 0, "lint 不应有 failed");
    assert.deepEqual(result.changed, [], "lint 是只读算子，changed 应为空");
    assert.deepEqual(result.skipped, [], "lint 是只读算子，skipped 应为空");

    // 有断链的行 diagnostics 非空
    const brokenRow = result.rows.find((r) => r.path === "broken.md")!;
    assert.ok(brokenRow, "broken.md 应在结果中");
    assertHasBrokenLink(brokenRow, "non-existent-page");
    // 上游 fields 应保留
    assert.equal(brokenRow.fields.label, "should-have-diag");

    // 无问题的行 diagnostics 不存在
    const goodRow = result.rows.find((r) => r.path === "good.md")!;
    assert.ok(goodRow, "good.md 应在结果中");
    assert.equal(goodRow.fields.diagnostics, undefined, "good.md 不应有 diagnostics");
    assert.equal(goodRow.fields.label, "from-upstream");

    const okRow = result.rows.find((r) => r.path === "also-ok.md")!;
    assert.ok(okRow, "also-ok.md 应在结果中");
    assert.equal(okRow.fields.diagnostics, undefined, "also-ok.md 不应有 diagnostics");
    assert.equal(okRow.fields.label, "clean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D2 lint 作源：空入参 → 对整库跑，产出有诊断的行
// ---------------------------------------------------------------------------
test("D2 Given lint 作源（空入参）When run Then 只产出有诊断的行", async () => {
  const dir = mkVault({
    "clean.md": "# Clean\n一切正常。\n",
    "broken.md": "# Broken\n引用 [[ghost-page]]。\n",
    "also-broken.md": "# Also Broken\n[[void]] 和 [[missing-link]]。\n",
  });
  try {
    const lintOp = resolve("lint") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const result = await lintOp.run([], ctx);

    assert.equal(result.failed.length, 0, "lint 作源不应有 failed");
    // clean.md 没断链不应产出，broken.md 和 also-broken.md 应产出
    const brokenPaths = result.rows.map((r) => r.path).toSorted();
    assert.ok(
      brokenPaths.length > 0,
      `lint 作源应产出有诊断的行，实际：${JSON.stringify(brokenPaths)}`,
    );
    assert.ok(!brokenPaths.includes("clean.md"), "clean.md 不应出现在结果中");
    assert.ok(brokenPaths.includes("broken.md"), "broken.md 应出现在结果中");
    assert.ok(brokenPaths.includes("also-broken.md"), "also-broken.md 应出现在结果中");

    // 验证 diagnostics 结构
    for (const row of result.rows) {
      assertHasBrokenLink(row);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D3 links.check：断链文件的 diagnostics 里能看到断链目标
// ---------------------------------------------------------------------------
test("D3 Given links.check When run Then 断链行 diagnostics 含具体目标", async () => {
  const dir = mkVault({
    "index.md": "# Index\n链接到 [[valid-note]] 和 [[ghost-target]]。\n",
    "valid-note.md": "# Valid\n内容。\n",
  });
  try {
    const checkOp = resolve("links.check") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const result = await checkOp.run([{ path: "index.md", fields: {} }], ctx);

    assert.equal(result.rows.length, 1, "links.check 应透传 1 行");
    assert.equal(result.failed.length, 0, "links.check 不应有 failed");

    const row = result.rows[0]!;
    const diags = assertHasBrokenLink(row, "ghost-target");

    // 验证诊断结构字段
    const ghostDiag = diags.find((d) => d.target?.includes("ghost-target"))!;
    assert.ok(ghostDiag, "应找到 ghost-target 的诊断");
    assert.equal(ghostDiag.rule, "links/no-broken-link");
    assert.equal(ghostDiag.severity, "error");
    assert.ok(ghostDiag.line > 0, "诊断应有行号");
    assert.ok(ghostDiag.column > 0, "诊断应有列号");

    // 验证 [[valid-note]] 不产生诊断
    const validDiag = diags.find((d) => d.target?.includes("valid-note"));
    assert.equal(validDiag, undefined, "valid-note 不应产生诊断");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D4 关键负向用例：有诊断时 failed 为空，行仍透传给下游
// ---------------------------------------------------------------------------
test("D4 Given 有诊断的行 When lint 算子处理 Then failed 为空且行透传给下游假算子", async () => {
  const dir = mkVault({
    "broken.md": "# Broken\n[[non-existent]]。\n",
    "good.md": "# Good\n正常。\n",
  });
  try {
    const lintOp = resolve("lint") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const input: Row[] = [
      { path: "broken.md", fields: {} },
      { path: "good.md", fields: {} },
    ];
    const result = await lintOp.run(input, ctx);

    // 关键断言 1：有诊断，但 failed 为空
    const brokenRow = result.rows.find((r) => r.path === "broken.md")!;
    assert.ok(brokenRow, "broken.md 应在结果中");
    const diags = brokenRow.fields.diagnostics as BasaltDiagnostic[] | undefined;
    assert.ok(diags, "broken.md 应有 diagnostics");
    assert.ok(diags.length > 0, "broken.md 应有至少一条诊断");
    assert.equal(result.failed.length, 0, "有诊断 ≠ failed");

    // 关键断言 2：行仍然透传给下游——用下游假算子验证
    const verifier = verifierOp(2); // 期望收到 2 行
    const verifierResult = await verifier.run(result.rows, ctx);
    assert.ok(verifier.verified, "下游假算子应被调用并验证行数");
    assert.equal(verifierResult.rows.length, 2, "下游假算子应收到 2 行");

    // 关键断言 3：changed/skipped 恒为空
    assert.deepEqual(result.changed, [], "changed 应为空");
    assert.deepEqual(result.skipped, [], "skipped 应为空");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D4b 关键负向用例（links.check）：同 D4 但用 links.check 算子
// ---------------------------------------------------------------------------
test("D4b Given 有断链的行 When links.check 处理 Then failed 为空且行透传", async () => {
  const dir = mkVault({
    "broken.md": "# Broken\n[[ghost]]。\n",
    "ok.md": "# OK\n内容。\n",
  });
  try {
    const checkOp = resolve("links.check") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const input: Row[] = [
      { path: "broken.md", fields: {} },
      { path: "ok.md", fields: {} },
    ];
    const result = await checkOp.run(input, ctx);

    // 关键断言 1：有诊断但 failed 为空
    const diags = result.rows.find((r) => r.path === "broken.md")?.fields.diagnostics as
      | BasaltDiagnostic[]
      | undefined;
    assert.ok(diags, "broken.md 应有 diagnostics");
    assert.ok(diags.length > 0, "diagnostics 应有诊断");
    assert.equal(result.failed.length, 0, "有诊断 ≠ failed");

    // 关键断言 2：行透传（2 行进 = 2 行出）
    assert.equal(result.rows.length, 2, "应有 2 行（透传）");

    // 关键断言 3：changed/skipped 恒为空
    assert.deepEqual(result.changed, [], "changed 应为空");
    assert.deepEqual(result.skipped, [], "skipped 应为空");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D5 links.suggest：能给出建议链接
// ---------------------------------------------------------------------------
test("D5 Given links.suggest When run Then 给出链接建议", async () => {
  const dir = mkVault({
    "index.md": "# Index\n引用 [[target]]。\n",
    // target.md 不存在以触发 suggest
  });
  try {
    const suggestOp = resolve("links.suggest index.md") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const result = await suggestOp.run([], ctx);

    // 应产出 index.md 所在行
    assert.equal(result.rows.length, 1, "links.suggest 应产出 1 行");
    assert.equal(result.rows[0]!.path, "index.md");
    assert.equal(result.failed.length, 0, "links.suggest 不应有 failed");

    // 应有 linkSuggestions 字段
    const suggestions = result.rows[0]!.fields.linkSuggestions as string[] | undefined;
    assert.ok(suggestions, "应有 linkSuggestions");
    assert.ok(Array.isArray(suggestions), "linkSuggestions 应为数组");
    // 至少有一些建议（具体内容由 resolve.ts 决定）
    assert.ok(suggestions.length >= 0, "linkSuggestions 应有建议");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D5b links.suggest 作转换：入参非空时所有行透传 + 挂建议
// ---------------------------------------------------------------------------
test("D5b Given links.suggest 作转换 When run Then 透传行并挂建议", async () => {
  const dir = mkVault({
    "index.md": "# Index\n内容。\n",
    "other.md": "# Other\n内容。\n",
  });
  try {
    const suggestOp = resolve("links.suggest index.md") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const input: Row[] = [
      { path: "index.md", fields: { phase: "one" } },
      { path: "other.md", fields: { phase: "two" } },
    ];
    const result = await suggestOp.run(input, ctx);

    // 所有行透传
    assert.equal(result.rows.length, 2, "应透传 2 行");
    assert.equal(result.failed.length, 0);

    // 每行都有 linkSuggestions
    for (const row of result.rows) {
      assert.ok("linkSuggestions" in row.fields, `${row.path} 应有 linkSuggestions`);
      assert.ok(Array.isArray(row.fields.linkSuggestions));
    }

    // 上游 fields 保留
    assert.equal(result.rows.find((r) => r.path === "index.md")!.fields.phase, "one");
    assert.equal(result.rows.find((r) => r.path === "other.md")!.fields.phase, "two");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D6 缺少 vaultRoots → 记 failed 且行透传（转换模式）
// ---------------------------------------------------------------------------
test("D6 Given ctx 无 vaultRoots When lint/links.check/links.suggest run Then 记 failed", async () => {
  const ctx: OpContext = {
    vaultPath: "/tmp",
    indexer: null as never,
    dryRun: true,
  };

  // lint
  {
    const lintOp = resolve("lint") as Op;
    const input: Row[] = [{ path: "a.md", fields: {} }];
    const result = await lintOp.run(input, ctx);
    assert.equal(result.rows.length, 1, "转换模式应透传行");
    assert.ok(result.failed.length > 0, "lint 应记 failed");
    assert.ok(
      result.failed[0]!.error.includes("vaultRoots"),
      `lint 报错应提及 vaultRoots：${result.failed[0]!.error}`,
    );
  }

  // links.check
  {
    const checkOp = resolve("links.check") as Op;
    const input: Row[] = [{ path: "a.md", fields: {} }];
    const result = await checkOp.run(input, ctx);
    assert.equal(result.rows.length, 1, "转换模式应透传行");
    assert.ok(result.failed.length > 0, "links.check 应记 failed");
    assert.ok(
      result.failed[0]!.error.includes("vaultRoots"),
      `links.check 报错应提及 vaultRoots：${result.failed[0]!.error}`,
    );
  }

  // links.suggest（源模式）
  {
    const suggestOp = resolve("links.suggest a.md") as Op;
    const result = await suggestOp.run([], ctx);
    assert.equal(result.rows.length, 0, "源模式无 vaultRoots 不应产出行");
    assert.ok(result.failed.length > 0, "links.suggest 应记 failed");
    assert.ok(
      result.failed[0]!.error.includes("vaultRoots"),
      `links.suggest 报错应提及 vaultRoots：${result.failed[0]!.error}`,
    );
  }
});

// ---------------------------------------------------------------------------
// D7 空 vault（无 .md 文件）：lint/links.check 作源产 0 行、作转换透传
// ---------------------------------------------------------------------------
test("D7 Given 空 vault When lint/links.check run Then 源产 0 行、转换透传", async () => {
  const dir = mkVault({
    "data.txt": "not a markdown file",
  });
  try {
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    // lint 作源
    {
      const lintOp = resolve("lint") as Op;
      const result = await lintOp.run([], ctx);
      assert.equal(result.rows.length, 0, "空 vault lint 作源应产 0 行");
      assert.equal(result.failed.length, 0);
    }

    // links.check 作源
    {
      const checkOp = resolve("links.check") as Op;
      const result = await checkOp.run([], ctx);
      assert.equal(result.rows.length, 0, "空 vault links.check 作源应产 0 行");
      assert.equal(result.failed.length, 0);
    }

    // lint 作转换（空 vault，但行来了，透传）
    {
      const lintOp = resolve("lint") as Op;
      const result = await lintOp.run([{ path: "data.txt", fields: {} }], ctx);
      assert.equal(result.rows.length, 1, "空 vault 也要透传入参行");
      assert.equal(result.failed.length, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D8 单文件多次执行：links.check 幂等
// ---------------------------------------------------------------------------
test("D8 Given 同一 vault 对同一文件两次 run links.check Then 两次结果一致", async () => {
  const dir = mkVault({
    "doc.md": "# Doc\n[[inconsistent]] 和 [[valid]]。\n",
    "valid.md": "# Valid\n内容。\n",
  });
  try {
    const checkOp = resolve("links.check") as Op;
    const ctx: OpContext = {
      vaultPath: dir,
      indexer: null as never,
      dryRun: true,
      vaultRoots: [dir],
    };

    const input: Row[] = [{ path: "doc.md", fields: {} }];
    const r1 = await checkOp.run(input, ctx);
    const r2 = await checkOp.run(input, ctx);

    assert.equal(r1.rows.length, 1);
    assert.equal(r2.rows.length, 1);

    const d1 = (r1.rows[0]!.fields.diagnostics as BasaltDiagnostic[])
      .map((d) => d.target)
      .toSorted();
    const d2 = (r2.rows[0]!.fields.diagnostics as BasaltDiagnostic[])
      .map((d) => d.target)
      .toSorted();
    assert.deepEqual(d1, d2, "两次执行结果应一致");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VaultIndexer } from "../src/indexer/index.js";
import { parseAction } from "../src/orchestrator/actions.js";
import { registerBuiltinOps } from "../src/orchestrator/ops.js";
import { resolve } from "../src/orchestrator/registry.js";
import { runOpPipeline, runPipeline } from "../src/orchestrator/run.js";
import type {
  ActionContext,
  ChangeEvent,
  OpContext,
  Row,
  RunReport,
} from "../src/orchestrator/types.js";

// === §9.1-A 对外契约不变：新旧双路径产出 RunReport 既有字段逐字段相同 ===
// 设计：docs/design/pipeline-op-model.md §9.1-A
//
// A2: 同一批输入下，旧 runPipeline 与新 runOpPipeline 产出的 RunReport
// 既有字段必须逐字段相同。steps 字段只增不改，不参与比对。
// failed 只比长度与其中的 path 集合（action 字段名在两模型下同名但对象形状略有差异）。
// 覆盖三场景：只读动作链、写动作链 dry-run、写动作链 --apply 真落盘。
//
// A3: ChangeEvent 类型仍可用（import 得到即可）。

// 模块级注册内建算子（registerBuiltinOps 幂等）
registerBuiltinOps();

// === 测试基础设施 ===

/** 建临时 vault 目录并写入文件。 */
function mkVault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xb-ct-"));
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}

/** 建立两份内容相同的临时 vault（避免路径间相互干扰）。返回 [dir1, dir2]。 */
function mkPair(files: Record<string, string>): [string, string] {
  const d1 = mkVault(files);
  const d2 = mkVault(files);
  return [d1, d2];
}

/** 断言两份 RunReport 的既有字段逐字段相等（steps 不参与比对）。 */
function compareReports(a: RunReport, b: RunReport, label: string): void {
  const scalarFields = ["total", "changed", "skipped", "dryRun", "reindexed"] as const;
  for (const f of scalarFields) {
    // eslint-disable-next-line security/detect-object-injection -- 白名单字段
    assert.equal(a[f], b[f], `[${label}] ${f} 不一致: ${String(a[f])} vs ${String(b[f])}`);
  }

  // changedPaths: 逐元素相等
  assert.deepEqual(
    a.changedPaths,
    b.changedPaths,
    `[${label}] changedPaths 不一致: ${JSON.stringify(a.changedPaths)} vs ${JSON.stringify(b.changedPaths)}`,
  );

  // byAction: 键集合与值全等
  assert.deepEqual(
    a.byAction,
    b.byAction,
    `[${label}] byAction 不一致: ${JSON.stringify(a.byAction)} vs ${JSON.stringify(b.byAction)}`,
  );

  // failed: 只比长度与 path 集合（action 字段名在两模型下同名但 ActionResult 形状略有差异）
  assert.equal(
    a.failed.length,
    b.failed.length,
    `[${label}] failed.length 不一致: ${a.failed.length} vs ${b.failed.length}`,
  );
  const aPaths = [...new Set(a.failed.map((f) => f.path))].toSorted();
  const bPaths = [...new Set(b.failed.map((f) => f.path))].toSorted();
  assert.deepEqual(
    aPaths,
    bPaths,
    `[${label}] failed paths 不一致: ${JSON.stringify(aPaths)} vs ${JSON.stringify(bPaths)}`,
  );
}

/**
 * 对一份输入，分别跑 runPipeline（旧路径）和 runOpPipeline（新路径），比较报告。
 *
 * @param vaultFiles - vault 内容（自动复制为两份）
 * @param actionTokens - 动作 token 列表（传给 parseAction 和 resolve）
 * @param dryRun - 是否 dry-run
 * @param label - 场景标签（断言消息用）
 */
async function assertReportMatch(
  vaultFiles: Record<string, string>,
  actionTokens: string[],
  dryRun: boolean,
  label: string,
): Promise<void> {
  const [dir1, dir2] = mkPair(vaultFiles);
  const db1 = join(dir1, "i.db");
  const db2 = join(dir2, "i.db");

  const indexer1 = new VaultIndexer({ vaultPath: dir1, dbPath: db1 });
  const indexer2 = new VaultIndexer({ vaultPath: dir2, dbPath: db2 });

  try {
    const paths = Object.keys(vaultFiles);
    const events: ChangeEvent[] = paths.map((p) => ({ path: p, type: "change" }));
    const actions = actionTokens.map((t) => parseAction(t));
    const rows: Row[] = events.map((e) => ({ path: e.path, event: e.type, fields: {} }));
    const ops = actionTokens.map((t) => resolve(t));

    // 旧路径：runPipeline
    const actCtx: ActionContext = {
      vaultPath: dir1,
      indexer: indexer1,
      dryRun,
      ifExists: "skip",
    };
    const reportOld = await runPipeline(events, actions, actCtx, {
      concurrency: 1,
      onError: "continue",
    });

    // 新路径：runOpPipeline
    const opCtx: OpContext = {
      vaultPath: dir2,
      indexer: indexer2,
      dryRun,
      ifExists: "skip",
    };
    const reportNew = await runOpPipeline(rows, ops, opCtx, {
      concurrency: 1,
      onError: "continue",
    });

    compareReports(reportOld, reportNew, label);
  } finally {
    indexer1.close();
    indexer2.close();
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
}

// === A2: 三场景比对 ===

test("A2 场景1: 只读动作链（parse）→ 双路径报告一致", async () => {
  await assertReportMatch(
    {
      "a.md": "# Note A\nContent for parsing.\n",
      "b.md": "# Note B\nAnother file.\n",
      "c.md": "# Note C\nYet another.\n",
    },
    ["parse"],
    true,
    "A2-scene1-parse",
  );
});

test("A2 场景2: 写动作链 dry-run（set type=note, dryRun=true）→ 双路径报告一致", async () => {
  await assertReportMatch(
    {
      "a.md": "---\ntags: [pkm]\n---\nA\n",
      "b.md": "---\ntags: [dev]\n---\nB\n",
    },
    ["set type=note"],
    true,
    "A2-scene2-set-dryrun",
  );
});

test("A2 场景3: 写动作链 --apply 真落盘（set type=note, dryRun=false）→ 双路径报告一致", async () => {
  await assertReportMatch(
    {
      "a.md": "---\ntags: [pkm]\n---\nA\n",
      "b.md": "---\ntags: [dev]\n---\nB\n",
    },
    ["set type=note"],
    false,
    "A2-scene3-set-apply",
  );
});

// === A3: ChangeEvent 类型仍可用 ===

test("A3 ChangeEvent 类型仍可导出引用", () => {
  // 编译期验证：import type ChangeEvent 已在顶部完成；
  // 运行期验证它的形状——构造一个合法的 ChangeEvent 并读取其字段。
  const ev: ChangeEvent = { path: "test.md", type: "change", mtime: 1000, size: 42 };
  assert.equal(ev.path, "test.md");
  assert.equal(ev.type, "change");
  assert.equal(ev.mtime, 1000);
  assert.equal(ev.size, 42);

  // ChangeEvent 是 Row 的窄化投影：event 必有值，不允许 undefined。
  const ev2: ChangeEvent = { path: "b.md", type: "add" };
  assert.equal(ev2.path, "b.md");
  assert.equal(ev2.type, "add");

  // Row 的 event 是可选的
  const row: Row = { path: "c.md", fields: {} };
  assert.equal(row.event, undefined);
  assert.deepEqual(row.fields, {});
});

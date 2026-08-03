/**
 * 2026-07-28 覆盖率片一..片四的 **端到端** 覆盖（经 BaseEngine 跑真实 SQLite 索引）。
 *
 * 为什么单开一份：那四片此前**只有求值层单测**（合成 BaseRow，不碰引擎），于是引擎侧的
 * 接线完全裸奔——变异检验证实：删掉 `engine.ts` 里 `resolveFile:` 那一行注入，
 * 880 个测试**仍然全绿**，而 `file()` / `link().asFile()` 在真实查询里已经报错。
 * 本文件补的就是「函数在真查询里确实能用」这一层，不重复单测已锁的语义细节。
 *
 * fixture：`tests/fixtures/bases/p2/group/vault/views/functions-e2e.base`。
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_RULES, BaseEngine, type BaseQueryResult } from "../src/base/index.js";
import { VaultIndexer } from "../src/indexer/index.js";

const vaultPath = fileURLToPath(new URL("./fixtures/bases/p2/group/vault", import.meta.url));
const baseFile = join(vaultPath, "views", "functions-e2e.base");

/** 固定注入时钟 2026-07-28T12:00:00Z（`relative()` 依赖它，否则结果随真实时间漂移）。 */
const FIXED_NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

let tmpDir: string;
let dbPath: string;
let engine: BaseEngine;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "x-basalt-base-fn-e2e-"));
  dbPath = join(tmpDir, "index.db");
  const idx = new VaultIndexer({ vaultPath, dbPath });
  await idx.rebuild();
  idx.close();
  engine = new BaseEngine();
});
after(() => {
  engine?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function query(view: string): BaseQueryResult {
  return engine.query({
    basePath: baseFile,
    view,
    dbPath,
    vaultRoots: [vaultPath],
    clock: () => new Date(FIXED_NOW),
  });
}

function errorsOf(r: BaseQueryResult): string[] {
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.rule}: ${d.message}`);
}

/** 唯一一行（fixture 各 view 已 filter 到 Alpha）。 */
function onlyRow(r: BaseQueryResult): Record<string, unknown> {
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.rows.length, 1);
  return r.rows[0] as Record<string, unknown>;
}

test("e2e 片一：string / number / global 叶子函数在真实查询里可用", () => {
  const row = onlyRow(query("leaf")); // Alpha：status=active、priority=1
  assert.equal(row["status.title()"], "Active");
  assert.equal(row["status.slice(0, 3)"], "act");
  assert.equal(row["status.reverse()"], "evitca");
  assert.equal(row['status.replace("act", "ACT")'], "ACTive");
  assert.deepEqual(row['file.name.split(".")'], ["Alpha", "md"]);
  assert.equal(row["status.isEmpty()"], false);
  assert.equal(row["priority.toFixed(2)"], "1.00", "toFixed 返 string，经序列化仍是 string");
  assert.equal(row["priority.abs()"], 1);
  assert.equal(row["max(priority, 2)"], 2);
  assert.equal(row["min(priority, 2)"], 1);
});

test("e2e 片四：matches 参与真实 filter", () => {
  const r = query("regex");
  assert.deepEqual(errorsOf(r), []);
  assert.deepEqual(
    r.rows.map((row) => row["file.name"]),
    ["Alpha.md", "Beta.md", "Tagger.md"],
  );
});

test("e2e 片四：非法正则落 base/invalid-regex 行级诊断，不静默当「不匹配」", () => {
  const r = query("badRegex");
  // 行级 warning（filter 语境该行按不通过）——关键是 rule 必须是 invalid-regex 而非
  // 「悄无声息地筛掉所有行」，否则用户会以为是数据问题。
  const hit = r.diagnostics.filter((d) => d.rule === BASE_RULES.invalidRegex);
  assert.ok(hit.length > 0, "必须报 base/invalid-regex");
  assert.match(hit[0]?.message ?? "", /正则语法非法/u);
  assert.deepEqual(r.rows, []);
});

test("e2e 片二：date/duration 构造与 date 方法（relative 走注入 clock）", () => {
  const row = onlyRow(query("dateFns")); // Alpha：due=2026-08-01
  assert.equal(row['date(due).format("YYYY/MM/DD")'], "2026/08/01");
  assert.equal(row['due.format("[到期] MM-DD")'], "到期 08-01");
  // oracle ⑮（2026-08-02 跟官方）：date.time() 返回 "HH:mm:ss" 字符串
  assert.equal(row['date("2026-08-01T09:30:00Z").time()'], "09:30:00");
  // clock=2026-07-28T12:00Z，due=2026-08-01T00:00Z → 相差 3.5 天 → "in 3 days"
  assert.equal(row["due.relative()"], "in 3 days");
  assert.equal(row['duration("2 hours")'], 7_200_000);
});

test("e2e 片三：file() / link().asFile() —— engine 的 resolveFile 接线兜底", () => {
  // ⚠ 这条是本文件的存在理由：删掉 engine.ts 里 `resolveFile:` 注入行后，
  // 求值层单测全绿而本用例必红（会落 base/unsupported-feature「当前求值上下文不提供」）。
  const row = onlyRow(query("fileLink"));
  assert.equal(row['file("Gamma").basename'], "Gamma");
  assert.equal(row['link("Beta").asFile().path'], "Beta.md");
  assert.deepEqual(row['file.asLink("别名")'], {
    type: "link",
    path: "alpha",
    display: "别名",
  });
  assert.equal(row['file.linksTo("Gamma")'], false, "该 fixture vault 无出链");
});

test("字节稳定不被新函数破坏：同 DB + 同 base + 同注入 clock 两次结果全等", () => {
  // relative()/today() 这类涉时函数是字节稳定的主要风险面，专门在 e2e 层再锁一次。
  for (const view of ["leaf", "dateFns", "fileLink"]) {
    assert.equal(JSON.stringify(query(view)), JSON.stringify(query(view)), view);
  }
});

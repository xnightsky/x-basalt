---
type: plan
title: KB compiler P2 · 统一诊断契约 BasaltDiagnostic + lint 壳
description: 把 links 私有诊断类型 BasaltIssue 更名为 BasaltDiagnostic 并提升为 lint/links 共用的公共稳定契约，新增最小 lint --rules links 壳共用同一诊断产物
tags:
  - plan
  - kb-compiler
  - lint
  - links
  - diagnostic
  - x-basalt
timestamp: 2026-07-22T04:08:18Z
sha256: 47de6e7f5cec97fc7fdfff6e9ed19c87841d6b3d6fd4df93fd76581411bdd5f4
---
# KB compiler P2 · 统一诊断契约 BasaltDiagnostic + lint 壳

> 状态：active · 设计真相源：[design §6](../specs/2026-07-09-kb-compiler-lint-links-design.md)。承接 P1 [`2026-07-09-kb-compiler-links-check.md`](2026-07-09-kb-compiler-links-check.md)。

**Goal:** 把 P1 落地的 links 私有诊断类型 `BasaltIssue` 更名为 `BasaltDiagnostic` 并提升为**公共稳定契约**，冻结为 `lint --format json` 的稳定输出；新增最小 `lint --rules links` 壳，与 `links check` 共用同一诊断产物。**不含** profile/schema（P3）、CI/baseline（P4）、rewrite/fix（P5）。

## Decision Log

1. **命名**：`BasaltIssue` → `BasaltDiagnostic`；`BasaltIssueSeverity` → `BasaltDiagnosticSeverity`。理由见 design §6「P2 命名决策」：对齐本仓工具链 oxc/oxlint `OxcDiagnostic` 与 LSP/TypeScript `Diagnostic`（字段形状即 LSP `Diagnostic`），并规避与 GitHub Issue 撞词（P4 规划 `--format github`）。规则 id、severity 取值、字段名不变，仅换承载名词。
2. **契约位置**：新建 `src/diagnostic.ts` 作为**中立叶子模块**（对齐 `src/config.ts` / `src/format.ts` 扁平风格）承载公共契约真相源；`src/links/types.ts` re-export `BasaltDiagnostic` 保后向兼容，并保留 links 专有 `LinkDiagnosticReason` / `TargetIndex` / `LinkFinding` / `CollectedFile`。依赖方向：`links/types → diagnostic`（叶子，无回边）、`lint/index → diagnostic + links.checkVault`，无环。
3. **reason 放宽**：公共 `reason?: string`（机器可读原因）；links 侧仍产 `LinkDiagnosticReason` 字面量（`string` 子集，赋值兼容），为 P3 metadata 规则 reason（如 `required_missing`）留共用空间。
4. **lint 壳最小面**：`x-basalt lint [vault...] --rules links --format human|json|yaml`。`--rules` 默认 `links`（当前唯一规则）；未实现规则名（如 `metadata`）定向报错、非静默忽略。内部复用 `links` 的 `checkVault`，产出 `BasaltDiagnostic[]`，排序（`file`/`line`/`column`）与退出码（有 error → 1）语义与 `links check` 一致。**不做** `--profile` / `--fix` / `--ci` / `--baseline`。

## 切口（TDD，按序，逐 Task 先失败测试后最小实现）

- [x] **Task 1 — 公共契约落 `src/diagnostic.ts` + links re-export**（✅ 2026-07-22）
  - 新建 `src/diagnostic.ts`：`BasaltDiagnostic` / `BasaltDiagnosticSeverity`（由 `DIAGNOSTIC_SEVERITIES` 派生）/ `reason?: string`，文件头注释指向 design §6、标注「公共稳定契约」。
  - `src/links/types.ts`：删本地 `BasaltIssue` 定义，改 `export type { BasaltDiagnostic } from "../diagnostic.js"`；保留 `LinkDiagnosticReason` / `TargetIndex` / `LinkFinding` / `CollectedFile`。
  - **彻底清「issue」token**（超出原计划的一致性收敛）：文件 `issue.ts`→`diagnostic.ts`、`issue.test.ts`→`diagnostic.test.ts`；类型 `BasaltIssue`→`BasaltDiagnostic`、`LinkIssueReason`→`LinkDiagnosticReason`；`toIssue`→`toDiagnostic`；变量/字段 `issues`/`issue`→`diagnostics`/`diagnostic`（含 `LinksRunResult.issues`、`cli.ts` 解构）。代码内仅存 `diagnostic.ts` 注释里刻意的「GitHub Issue」撇清词。
  - 新增 `tests/diagnostic.test.ts`：契约字段形状 + severity 单一真相源 + reason 放宽的可观察断言。
  - Verify：`pnpm run typecheck` ✓ · 35 tests pass（4 契约 + 31 links）✓ · `pnpm run lint` ✓（`format:check` 为基线噪声——oxfmt 无配置，全仓默认风格不匹配，非本次引入）。
- [x] **Task 2 — 最小 lint 壳模块 `src/lint/`**（✅ 2026-07-22）
  - `src/lint/index.ts`：`runLint(opts)` 经 `RULE_RUNNERS` 注册表分发（P2 仅 `links` → `checkVault`），rules 省略/空→默认 `["links"]`，未知 rule 定向抛错，汇总按 `file/line/column` `toSorted`，返回 `{ diagnostics, exitCode }`；导出 `LINT_RULES`。
  - `tests/lint/run.test.ts`（先失败后实现）：同构 checkVault、默认 links、无断链→0、未知规则报错。
  - Verify：`pnpm run typecheck` ✓ · `tests/lint/run.test.ts` 4 pass ✓。
- [x] **Task 3 — CLI `lint` 命令接线**（✅ 2026-07-22）
  - `src/cli.ts` 新增 `lint [vault...] --rules <list> --format <fmt>`；`--rules` 逗号分隔（默认 links），json/yaml 走 `emit`、human 走 `renderHuman`（P2 仅 links 规则，复用其人读渲染）；未知 rule 经顶层 `catch` 打印 `✗ …` 退 1。
  - `tests/lint/cli.test.ts`（先失败后实现，子进程跑真 CLI）：断链退出码 1 + JSON 与 `links check` 同构、默认 links、未知规则报错。
  - Verify：`pnpm run typecheck` ✓ · `pnpm run build` ✓ · `tests/lint/cli.test.ts` 3 pass ✓。
- [x] **Task 4 — 收口**（✅ 2026-07-22）
  - 契约对账：design / 本计划 / TODO 已同步；**`AGENTS.md` 目录结构段不补**——该段是核心管线概览（parser→indexer→query→skill→meta），同级的 `links`/`chat`/`config.ts`/`format.ts` 均未列，为保持粒度一致 `diagnostic.ts`/`lint/` 亦不列。
  - 全量门禁：`pnpm run lint` ✓ · `pnpm run typecheck` ✓ · `pnpm run build` ✓ · 全量 `pnpm test` **579 pass** ✓。
  - 端到端（built CLI）：`x-basalt lint --rules links --format json` 与 `x-basalt links check --format json` JSON 完全同构、退出码一致；human 输出、未知规则报错、空 vault→`[]` 均验。
  - **已知 follow-up（非缺陷）**：`lint` 人读复用 links 的「断链」文案，P3 接入 metadata 规则时再泛化为中性「问题/诊断」措辞。

## Verify（总）

- 逐 Task：`pnpm run typecheck` + 该 Task 直接覆盖测试；触及 `src/cli.ts` 加 `pnpm run build`。
- 收口：`pnpm run lint` + `typecheck` + `build` + 全量 `test`；记录命令、退出码、通过数、未跑项与原因。
- 端到端：临时 vault 跑 `lint --rules links --format json` 与 `links check --format json`，断言 diagnostics 同构、退出码一致。

## 真相源同步

- design §6 / §3.3 / §11 + 顶部状态行：已更名 + 记录 P2 命名决策（本轮文档提交）。
- P1 plan：已加 P2 更名 forward-note（本轮文档提交）。
- `src/diagnostic.ts` 注释已回指 design §6；`AGENTS.md` 目录结构段经评估**不补**（见 Task 4：与同级 links/chat 未列保持粒度一致）。

## 全局约束（沿用 AGENTS.md / P1）

- ESM：相对导入带 `.js` 后缀；类型导入用 `import type`。
- 项目硬约束不变：无 `obsidian` import、无 `obsidian://`、文件操作只走 `fs`；本任务纯内存 per-run，不碰 SQLite/indexer。
- 提交在当前分支（main），不新开分支；AI 提交需会话内明确授权。

---
type: plan
title: Bases P1 收口计划（CLI 薄出口 + guides）
description: 给 BaseEngine 加 x-basalt base 薄出口（稳定 JSON 契约、error 诊断 exit 1）并补 guides/querying-bases.md 等文档
tags:
  - plan
  - bases
  - cli
  - x-basalt
timestamp: 2026-07-26T17:42:59Z
sha256: 2e3845dd9f1fb37315a2e6ef9486300f88c6e86a0f2a1625663a18d8be992c82
---
# 计划：Bases P1 收口 · CLI 薄出口 + guides

> 2026-07-27 · 来源：[`../testing/2026-07-26-bases-implementation-status.md`](../testing/2026-07-26-bases-implementation-status.md) §2 末行「CLI 薄出口 + guides 补 Bases 章节」；前置 P1 计划 [`2026-07-26-bases-p1-markdown-query.md`](2026-07-26-bases-p1-markdown-query.md)（已 ✅）。
> 设计真相源：[`../specs/2026-07-22-bases-headless-engine-design.md`](../specs/2026-07-22-bases-headless-engine-design.md) §4/§11/§15（API 先于 CLI；退出码策略由本计划拍板）。

## 目标与范围

给已就位的 `BaseEngine` 加 CLI 薄出口，让用户可跑：新命令 `x-basalt base`，输出契约 = 引擎 `BaseQueryResult`（稳定 JSON），业务逻辑零落入 `src/cli.ts`。配套补齐 guides 文档。

交付物：

- `src/cli.ts`：`base` 命令注册（仅装配：参数解析 → `BaseEngine.query()` → emit → 退出码）。
- `tests/base-cli.test.ts`：subprocess 端到端（照 `tests/cli.test.ts` 模式）。
- `docs/guides/querying-bases.md`（新章）+ `docs/guides/commands.md`（命令条目）+ `docs/guides/usage.md`（能力表/目录）。
- 状态文档 §2 末行翻 ✅；本计划附验证结论。

## 非目标

- 不改 `BaseEngine` 公共 API 与任何引擎语义；不动 `src/base/` 既有文件（除非装配发现阻断性缺陷，需先回报）。
- 不做人读表格渲染（稳定 JSON 先行；表格属后续渲染层）。
- 不暴露 `contextFile`/`clock` flag（P1 不消费）；不支持 P2 语法（types.json/formulas/…）。
- 不改既有命令行为与退出码口径。

## 关键取舍（实现前拍板）

1. **命令形态**（对齐 `query`/`search` 现有约定）：
   ```
   x-basalt base <file.base> [--view <name>] [--vault <path...>] [--db <path>] [--format json|yaml]
   ```
   `<file.base>` 为 vault 内 `.base` 路径（vault 相对或绝对）；`--vault` 可省略回退配置 `vault`（`requireVault` 复用 `index` 命令同款——SEC-008 路径防线要求 vaultRoots 非空）；`--db` 默认 `.x-basalt/index.db` 可由配置覆盖；`--format` 默认 json。
2. **退出码**（设计 §11 留本计划拍板）：结果 `diagnostics` 含任一 `error` 级 → 仍输出完整 JSON 结果（rows 为空）并 `process.exitCode = 1`；仅 warning/info（md-only 恒发 warning、tie-break info）→ 退出码 0。未捕获异常沿用 `program.parseAsync` 底部 catch（✗ 消息 + 1）。
3. **JSON 即契约**：直接 `emit(result)`（BaseQueryResult 原样，`conformance: "bases-markdown-2026-07"`），不裁剪字段、不改诊断形状——`--format yaml` 走 `emit` 既有能力（与 `parse` 一致）。
4. **测试口径**：subprocess 跑真实 `src/cli.ts`；fixture 用 `tests/fixtures/bases/p1/vault`（临时库 `VaultIndexer.rebuild()` 建立，子进程以 `--db`/`--vault` 指向）；覆盖：默认 view 主路径（conformance/columns/total/rows 断言）、`--view` 命名 view、view 不存在 → exit 1 且 JSON 含 `base/view-not-found`、md-only warning 时 exit 0、CLI 两次运行输出字节一致（CLI 层 byte-stability）。
5. **guides 口径**：`querying-bases.md` 写清——支持子集（table view、filters/order/sort/limit、表达式与函数白名单）、md-only 数据集与恒发 warning、输出 JSON 契约、诊断与退出码、oracle 暂定项（指到状态文档 §3 与 runbook）；`commands.md` 加 `base` 条目；`usage.md` 能力表与章节目录补链。

## 验证口径（完成定义）

- `node --import tsx --test tests/base-cli.test.ts` 全绿；`pnpm test` 全量零回归；`pnpm run typecheck` 通过；触碰代码文件 `oxfmt --check` + `oxlint` 0 告警。
- 手跑一次 `pnpm cli -- base <fixture .base> --vault tests/fixtures/bases/p1/vault --db <临时库>` 确认真实输出。
- guides 三处更新 + 新文档过 `x-basalt meta apply llm-wiki` dogfood + `x-basalt lint --profile llm-wiki docs`。
- 状态文档 §2 末行翻 ✅ 标日期。

## 验证结论（2026-07-27）

**交付**：`src/cli.ts` 追加 `base` 命令（仅装配：`requireVault` → `BaseEngine.query()` → `emit` → error 诊断 exit 1，引擎零改动）；`tests/base-cli.test.ts`（7 个 subprocess 端到端用例：主路径/`--view`/view 不存在 exit 1/.base 不存在/越界 SEC-008/CLI 层字节稳定/`--format yaml`）；`docs/guides/querying-bases.md` 新章 + `commands.md`/`usage.md`/`README.md`/`skills-data/core.json5` 同步。

**已验证项**（全部实际运行）：

- `node --import tsx --test tests/base-cli.test.ts`：7 pass / 0 fail。
- `pnpm test` 全量：707 pass / 0 fail（零回归，含 core.json5 改动后的 skill 用例）。
- `pnpm run typecheck` 通过；`src/cli.ts` 与 `tests/base-cli.test.ts` `oxfmt --check` 通过、`oxlint` 0 告警。
- 手跑 `node --import tsx src/cli.ts base …/named.base --view active --vault tests/fixtures/bases/p1/vault --db <临时库>`：exit 0，输出 `conformance: "bases-markdown-2026-07"`、total=4、md-only warning 在列；`base --help` 选项齐全。
- 改动文档过 `x-basalt meta apply llm-wiki` dogfood + `x-basalt lint --profile llm-wiki docs`。

**未验证项**：全局安装后 `dist/cli.js` 的 `base` 命令（本机全局 x-basalt 为旧构建，需 `pnpm build` + `npm link` 刷新；属安装流程非本次改动面）。

**剩余风险**：无新增；oracle 暂定项处置不变（见 P1 计划与 runbook）。

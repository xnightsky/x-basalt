---
type: plan
title: KB compiler P3a · 内置 profile 校验（metadata/required-missing）
description: 给 lint 加 --profile <builtin>：校验内置 profile（pkm-note/llm-wiki/ssg-blog）的 required 字段是否齐全，产出 metadata/required-missing 诊断，零 config，复用 getProfile/diffProfile
tags:
  - plan
  - kb-compiler
  - lint
  - metadata
  - profile
  - x-basalt
timestamp: 2026-07-22T06:08:34Z
sha256: fa00d3f1f398c370e3a21415b632a7bb92c1ce7ed5426f1f9163747d87c9857e
---
# KB compiler P3a · 内置 profile 校验（metadata/required-missing）

> 状态：active · 设计真相源：[design §8.1](../specs/2026-07-09-kb-compiler-lint-links-design.md)。承接 P2 lint 壳 [`2026-07-22-kb-compiler-p2-diagnostic-contract.md`](2026-07-22-kb-compiler-p2-diagnostic-contract.md)。

**Goal:** 给 `lint` 加 `--profile <builtin>`：对 vault 内文档校验**内置 profile（pkm-note/llm-wiki/ssg-blog）的 required 字段是否齐全**，产出 `metadata/required-missing` 诊断。**零 config、复用 `getProfile`/`diffProfile`**。**不含** 自定义 config profile / `extends` / enum（那是 P3b）。

## Decision Log

1. **两阶段**：P3a 只做内置 profile 的 required 校验（内置 profile 只有 role、无 enum）；自定义 config profile + `extends` + enum 是 **P3b**（见 design §8.2）。
2. **复用写侧 profile 与 diff**：读侧「按 profile 查」与写侧「按 profile 补」共用 `src/meta` 的 `Profile` + `diffProfile`（一套定义两处用，dogfood），不另造 required 判定。
3. **诊断形状**：rule `metadata/required-missing`、severity `error`、`reason` = `required_missing`、`target` = 缺失字段名、位置 `line:1 column:1`（frontmatter 整体缺项，无具体行）。走 P2 lint 壳，产出 `BasaltDiagnostic`。
4. **选文件**：全 vault `.md` + 既有 `lint.ignore`（复用 links 的 `collectFiles`/`compileIgnore` 通用件；后续若第三方规则增多再抽到 `src/lint/` 共享层——本阶段不提前抽）。
5. **命令**：`lint --profile <name>`（隐含跑 metadata 规则）；亦可 `lint --rules links,metadata --profile <name>` 与 links 同壳合跑。`--profile` 缺省时 metadata 规则报「需指定 --profile」。

## 切口（TDD，按序）

- [x] **Task 1 — meta 暴露读侧 `inspectProfile(content, name): ProfileDiff`**（✅ 2026-07-22）
  - `src/meta/index.ts` 加纯函数 `inspectProfile`（`splitDocument` → `diffProfile(doc, getProfile(name))`；只读不碰 fs）。写侧 `applyProfile` 与读侧共用同一 `diffProfile`。
  - `tests/meta/inspect-profile.test.ts`（先失败后实现）：缺 type / 齐全 / 无 frontmatter / 未知 profile。
  - Verify：`pnpm run typecheck` ✓ · 4 tests ✓。
- [x] **Task 2 — metadata 规则 `src/lint/metadata.ts`**（✅ 2026-07-22）
  - `checkMetadata({ vault, profile, ignore })`：`collectFiles` → 逐篇 `inspectProfile` → 每个 `missing.required` 产 `metadata/required-missing`（severity error、reason `required_missing`、target=字段名、line:1 col:1）→ `compileIgnore` 过滤 → `toSorted`。未知 profile 前置 `getProfile` 校验（空 vault 亦报错）。
  - `tests/lint/metadata.test.ts`（先失败后实现）：缺字段报诊断 / 齐全空 / `ignore.paths` 过滤 / 未知 profile 报错。
  - Verify：`pnpm run typecheck` ✓ · 4 tests ✓。
- [x] **Task 3 — 接入 lint 壳 + CLI `--profile`**（✅ 2026-07-22）
  - `src/lint/index.ts`：`LintRunOptions` 加 `profile?`；`RULE_RUNNERS.metadata`；rules 省略时**有 profile→默认 metadata、否则 links**（保持 P2，不强改显式 rules）；metadata 选中但无 profile → 定向报错。
  - `src/cli.ts`：`lint` 加 `--profile <name>`。
  - `tests/lint/cli-profile.test.ts`（先失败后实现，子进程真 CLI）：缺 type→退出 1 + `metadata/required-missing` JSON；齐全→0 + `[]`；`--rules metadata` 无 profile→报错。
  - Verify：`pnpm run typecheck` ✓ · `pnpm run build` ✓ · 3 tests ✓。
- [x] **Task 4 — 收口**（✅ 2026-07-22）
  - **修 P2 遗留**：`lint` 人读原复用 links 的「断链」措辞，metadata 诊断被误称「断链」。新增中性 `src/lint/report.ts`（「共 N 处问题」/「✓ 未发现问题」），`lint` 命令改用之；`links check`/`suggest` 保留「断链」（该命令下准确）。`tests/lint/report.test.ts`（先失败后实现）断言不含「断链」。
  - 全量门禁：`pnpm run lint` ✓ · `typecheck` ✓ · `build` ✓ · 全量 `pnpm test` **592 pass** ✓。
  - 端到端（built CLI）：`lint --profile llm-wiki` 缺→退出 1、齐→0 + `[]`、未知 profile / `--rules metadata` 无 profile 均定向报错；`links` 默认行为不变。
  - **dogfood 发现**：本仓 `docs/plans/2026-07-02-deterministic-eval-gaps.md` 缺 required `type`（feature 自证有效；给该文档补 `type` 属独立收尾，不并入本阶段）。
  - 契约对账：design §8 / 本计划 / TODO 已同步；`AGENTS.md` 目录结构段同 P2 判定不补。

## Verify（总）

- 逐 Task：`pnpm run typecheck` + 该 Task 测试；触及 `src/cli.ts` 加 `pnpm run build`。
- 收口：lint + typecheck + build + 全量 test；记录命令/退出码/通过数/未跑项。
- 端到端：临时 vault（缺/齐全）+ 本仓 `docs/` dogfood 跑 `lint --profile llm-wiki`。

## 业界依据（信源）

「内置预设 + config `extends`/新建 + required/enum 校验」是多生态趋同范式（详见 design §8.4）。P3a 只落 required 校验；`extends`/enum/自定义 config 属 P3b。信源：

| 决策 | 信源 |
|---|---|
| frontmatter 场景 config 定义内容类型 + `extends` 继承基线（最贴） | [Front Matter CMS · Content types](https://frontmatter.codes/docs/content-creation/content-types)、[Front Matter CMS · Settings/extends](https://frontmatter.codes/docs/settings) |
| 按 glob 挂自定义 schema 校验 frontmatter + enum（lint 产出侧最贴） | [remark-lint-frontmatter-schema](https://github.com/JulianCataldo/remark-lint-frontmatter-schema) |
| `extends` 继承（子覆盖父、Base/Derived/Resulting、数组多父） | [ESLint · Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files)、[ESLint · Shareable Configs](https://eslint.org/docs/latest/extend/shareable-configs)、[stylelint-config-standard](https://github.com/stylelint/stylelint-config-standard)、[markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) |
| 生态内自定义笔记类 + 继承（`extends`/`excludes`；继承 bug=「只加不减」反面教材） | [Obsidian Metadata Menu · FileClasses](https://mdelobelle.github.io/metadatamenu/fileclasses/)、[继承 bug #600](https://github.com/mdelobelle/metadatamenu/issues/600) |
| frontmatter schema 校验、缺必填大声报错 | [Astro · Content Collections](https://docs.astro.build/en/guides/content-collections/) |
| 自定义内容模型 config | [Decap CMS · Configuration](https://decapcms.org/docs/configure-decap-cms/)、[Sanity · Schemas](https://www.sanity.io/docs/studio/schema-types) |
| `required`/`enum` 最基础两把校验、`allOf` 组合、别重造完整 schema | [JSON Schema · Combining](https://json-schema.org/understanding-json-schema/reference/combining)、[JSON Schema · enum](https://www.learnjsonschema.com/2020-12/validation/enum/) |

## 真相源同步

- design §8（两阶段 + `extends` 语义 + 业界依据）+ §11 阶段切口 + 顶部状态行：本轮文档提交已更新。
- 落地后：TODO 勾选；`src/lint/metadata.ts` 注释回指 design §8.1。

## 全局约束（沿用 AGENTS.md / P1–P2）

- ESM `.js` 后缀、`import type`；无 `obsidian` import、文件操作只走 `fs`；纯内存 per-run，不碰 SQLite/indexer。
- metadata 规则**只读**（读 frontmatter 判 required），不写 `.md`（写侧仍唯一在 `src/meta`）。
- 提交在当前分支 main，不新开分支；AI 提交需会话内明确授权。

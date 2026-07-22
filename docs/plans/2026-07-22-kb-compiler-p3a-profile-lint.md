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
timestamp: 2026-07-22T05:50:32Z
sha256: 72660b95cb97a0a20533568b3a1b406eec245afa0af9bd093d0d7ae24e26fc29
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

- [ ] **Task 1 — meta 暴露读侧 `inspectProfile(content, name): ProfileDiff`**
  - `src/meta/index.ts` 加纯函数 `inspectProfile(content: string, profileName: string): ProfileDiff`（`splitDocument(content)` → `diffProfile(doc, getProfile(name))`；不碰 fs、不写盘）。未知 profile 沿用 `getProfile` 定向报错。
  - 先写失败测试 `tests/meta/inspect-profile.test.ts`：给定缺 `type` 的 frontmatter + `llm-wiki` → `missing.required` 含 `type`；齐全 → 空。
  - Verify：`pnpm run typecheck` + 该测试。
- [ ] **Task 2 — metadata 规则 `src/lint/metadata.ts`**
  - `checkMetadata({ vault, profile, ignore }): Promise<BasaltDiagnostic[]>`：`collectFiles` 取 `.md` → 逐篇 `readFile` → `inspectProfile` → 对每个 `missing.required` 字段产 `BasaltDiagnostic`（rule/severity/reason/target/位置见 Decision 3）→ `compileIgnore` 过滤 → 按 `file/line/column` `toSorted`。
  - 先写失败测试 `tests/lint/metadata.test.ts`（临时 vault）：缺字段报诊断、齐全不报、`ignore.paths` 过滤、未知 profile 报错。
  - Verify：`pnpm run typecheck` + 该测试。
- [ ] **Task 3 — 接入 lint 壳 + CLI `--profile`**
  - `src/lint/index.ts`：`LintRunOptions` 加 `profile?: string`；`RULE_RUNNERS.metadata = (o) => checkMetadata({ vault: o.vault, profile: o.profile!, ignore: o.ignore })`；`--profile` 给了但 rules 未含 metadata → 自动并入 metadata；metadata 选中但无 profile → 定向报错。
  - `src/cli.ts`：`lint` 命令加 `--profile <name>`。
  - 先写失败测试 `tests/lint/cli-profile.test.ts`（子进程真 CLI）：`lint --profile llm-wiki` 对缺 `type` 的临时 vault 退出码 1 + JSON 含 `metadata/required-missing`；齐全退出 0。
  - Verify：`pnpm run typecheck` + `pnpm run build` + 该测试。
- [ ] **Task 4 — 收口**
  - 全量门禁（触及 cli + 跨模块）：`pnpm run lint` / `typecheck` / `build` / 全量 `pnpm test`。
  - 端到端（built CLI）：对本仓 `docs/`（已按 llm-wiki 维护）跑 `x-basalt lint --profile llm-wiki`——预期基本无 required 缺失（dogfood 自证），有则如实报。
  - 契约对账：design §8 / 本计划 / TODO；`AGENTS.md` 目录结构段同 P2 判定不补。

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

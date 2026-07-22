---
type: plan
title: KB compiler P3b · 自定义 config profile（extends + enums）
description: 给 lint 加自定义 config profiles.<name>：extends 继承（单父/子覆盖/required 并集/enums 按字段只加不减/环检测/未知父报错/同名覆盖内置）+ enums 校验，新增 metadata/enum-invalid，回退内置
tags:
  - plan
  - kb-compiler
  - lint
  - metadata
  - profile
  - x-basalt
timestamp: 2026-07-22T06:57:50Z
sha256: 45912b8f56cdd8cbe6a0515e1afee0e82e13709bfbc62456168baf153c9a0d35
---
# KB compiler P3b · 自定义 config profile（profiles.<name> + extends + enums）

> 状态：active · 设计真相源：[design §8.2](../specs/2026-07-09-kb-compiler-lint-links-design.md)。承接 P3a 内置校验 [`2026-07-22-kb-compiler-p3a-profile-lint.md`](2026-07-22-kb-compiler-p3a-profile-lint.md)。

**Goal:** 让 `.x-basalt/config.*` 能声明自定义 `profiles.<name>`——支持 `extends`（继承内置或其他 config profile）、`required`（追加）、`enums`（字段→允许值集）、`include`（glob，可选）。`lint --profile <name>`：`<name>` 是 config profile 就用之（**同名覆盖内置**），否则回退内置。新增规则 `metadata/enum-invalid`；required-missing 复用 P3a。

**不做（后置，见 design §8.3）：** `excludes`/减字段、多父数组 `extends`、`tagRules`、`domain.fromPath`、config profile 反哺写侧 `meta apply`、`--fix`（P5）、ci/baseline（P4）、完整 JSON Schema。

## Decision Log

1. **两类数据模型分层**：
   - **`ProfileConfig`（原始，config.ts）** = `{ extends?: string; required?: string[]; enums?: Record<string,string[]>; include?: string }`——`config.profiles.<name>` 的解析产物，`parseProfiles` 宽容挑键（仿 `parsePipelines`/`parseLintConfig`；畸形字段静默丢弃，不抛）。
   - **`LintProfile`（解析后，src/lint/profile.ts）** = `{ name: string; required: string[]; enums: Record<string,string[]>; include?: string }`——`extends` 合并后**可直接校验**的形状。
   - `ProfileConfig` 类型定义落 `src/lint/profile.ts`，`config.ts` `import type`（仿 `LintConfig.ignore` 从 `links/ignore` 引类型），避免 config→lint 反向依赖具体实现。
2. **解析层职责划分**：`config.ts` 只把 YAML/JSON 形状挑成 `ProfileConfig`（不解 `extends`、不校验父是否存在）。`extends` 合并 + 环检测 + 未知父报错 = **lint-run 期**（`resolveLintProfile`，src/lint/profile.ts），因为它要同时看 config profiles 和内置基线（`getProfile`）。
3. **`extends` 合并语义（design §8.2 定死）**：
   - 单父、子覆盖父。父可以是**另一个 config profile 或内置**。
   - `required` 取**并集**、`enums` **按字段合并**（同字段允许值取并集去重）——**只加不减**。
   - `include`：标量，子有则子覆盖、否则继承父（“子覆盖父”一致）。
   - **环检测**（A→B→A：链上重复名即报错，列出链）。
   - **未知父定向报错**（`extends` 指向既非 config profile 也非内置 → 明确报缺）。
   - **同名 config 覆盖内置**（对齐 ESLint local 优先）；`resolveLintProfile` 先查 config.profiles，命中即用之。
4. **内置基线只读取 required**：`resolveLintProfile('llm-wiki')`（无同名 config）→ `getProfile('llm-wiki').fields.filter(role==='required')`，`enums: {}`，`include: undefined`。内置无 enum，故内置路径与 P3a 等价（现有测试即回归护栏）。
5. **`checkMetadata` 统一**：入参加 `profiles?: Record<string,ProfileConfig>`；开头 `resolveLintProfile(profile, profiles)`（未知/环/未知父 → 前置定向报错，空 vault 亦触发）。逐文件读 frontmatter 为普通对象（新增只读 meta 原语 `readFrontmatter(content)`），两类检查：
   - **required-missing**（复用 P3a 形状）：required 字段不存在（`Object.hasOwn`，语义同 `hasMeta`）。
   - **enum-invalid**（新）：字段有值且值不在允许集。值为数组时逐元素校验（如 tags）；值 `undefined`/`null`（缺失或空）**跳过 enum**（缺失交给 required，空值不双报）。
6. **`metadata/enum-invalid` 诊断形状**：rule `metadata/enum-invalid`、severity `error`（值违规即 profile 失效，同 required）、`reason` = `enum_invalid`、`target` = 字段名（与 required 一致，可经 `lint.ignore` 收窄）、非法值写进 `message`、位置 `line:1 col:1`（frontmatter 整体，无逐字段行号，同 P3a）、`fixable: false`。
7. **`include` 文件收窄**：`resolved.include` 存在时，`collectFiles` 后按 `globToRegExp(include)` 过滤 `markdown`（复用 `src/links/ignore.ts` 的极简 glob，语义与 links ignore 一致）。`lint.ignore`（诊断级）仍照常叠加。缺省（无 include）= 全 vault + `lint.ignore`（同 P3a）。
   - **glob 语义提醒（已知、与 links ignore 一致，不在本阶段“修”）**：`docs/**/*.md` 因 `**/` 段要求至少一层子目录，不匹配顶层 `docs/a.md`；顶层用 `docs/*.md` 或 `docs/**`。
8. **`inspectProfile` 保留**：P3a 的 `src/meta` 读侧 `inspectProfile` 是合法公共读原语（带独立测试），P3b 走新 `readFrontmatter` + `resolveLintProfile` 不再经它，但不删（非死代码、写读共用 `diffProfile` 的 dogfood 链仍在）。

## 切口（TDD，按序；每步先失败测试后最小实现）

- [ ] **Task 1 — config.ts `profiles` 段**
  - `src/lint/profile.ts` 先声明 `ProfileConfig` 类型（实现在 Task 2）；`src/config.ts` 加 `BasaltConfig.profiles?`、`parseProfiles(raw)`（宽容挑 `extends`/`required`/`enums`/`include`）、`pickConfig` 接入。
  - `tests/config.test.ts` 补：解析 profiles（extends/required/enums/include）；畸形字段丢弃、非对象降级 `{}`。
  - Verify：`pnpm run typecheck` + config 测试。
- [ ] **Task 2 — `resolveLintProfile`（src/lint/profile.ts）**
  - `LintProfile` 类型 + `resolveLintProfile(name, configProfiles): LintProfile`：config-first→extends 递归合并（required 并集 / enums 按字段并集 / include 子覆盖父）；内置回退（required from role、enums {}）；环/未知父/未知名定向报错。
  - `tests/lint/profile.test.ts`：内置名 / config 新建（无 extends）/ extends 内置 / extends config 多级 / 同字段 enum 并集 / include 继承与覆盖 / 环 / 未知父 / 未知名 / 同名覆盖内置。
  - Verify：`pnpm run typecheck` + profile 测试。
- [ ] **Task 3 — `readFrontmatter` + `checkMetadata` 泛化（required + enum + include）**
  - `src/meta/index.ts` 加只读 `readFrontmatter(content): Record<string, unknown>`（`splitDocument`→`getMeta(doc)`）。
  - `src/lint/metadata.ts`：入参加 `profiles?`；`resolveLintProfile` 起手；`include` 过滤；required-missing（复用形状）+ enum-invalid（数组逐元素、null/缺失跳过）。
  - `tests/lint/metadata.test.ts` 补：enum 非法报诊断 / 合法不报 / 数组字段逐元素 / null·缺失跳过 enum / config profile 的 required / include 收窄；P3a 既有用例保持绿（回归护栏）。
  - Verify：`pnpm run typecheck` + metadata 测试。
- [ ] **Task 4 — lint 壳 + CLI 透传 config.profiles**
  - `src/lint/index.ts`：`LintRunOptions` 加 `profiles?`；`RULE_RUNNERS.metadata` 透传。
  - `src/cli.ts`：`lint` action 把 `config.profiles` 传入 `runLint`（`--profile` 已存在，无需加 flag）。
  - `tests/lint/cli-config-profile.test.ts`（子进程真 CLI，`X_BASALT_DIR` 注入含 `profiles` 的临时 config）：config profile 的 enum-invalid + required → 退出 1 + JSON；合法 → 0 + `[]`；同名覆盖内置生效。
  - Verify：`pnpm run typecheck` + `pnpm run build` + CLI 测试。
- [ ] **Task 5 — 收口**
  - 全量门禁：`pnpm run lint` + `typecheck` + `build` + 全量 `pnpm test`（触及 config.ts / cli.ts 公共契约，升级全量）。
  - 端到端（built CLI）：临时 vault + `.x-basalt/config` 自定义 profile 跑 `lint --profile <name>`（enum 违规/齐全/同名覆盖）。
  - 契约对账：design §8.2 状态行 + §8.3 + 本计划勾选 + TODO；`src/lint/metadata.ts`/`profile.ts` 注释回指 design §8.2。

## Verify（总）

- 逐 Task：`pnpm run typecheck` + 该 Task 测试；触及 `src/cli.ts` 加 `pnpm run build`。
- 收口：lint + typecheck + build + 全量 test；记录命令/退出码/通过数/未跑项。
- 端到端：临时 vault + 自定义 config profile（enum 违规 / 齐全 / 同名覆盖内置），跑 `lint --profile <name>`。

## 业界依据

沿用 design §8.4 与 P3a 计划「业界依据（信源）」段：`extends` 子覆盖父（ESLint/Stylelint/markdownlint/tsconfig）、frontmatter 场景 config 定义内容类型 + `extends` 继承基线（Front Matter CMS 最贴）、按 glob 挂 schema 校验 frontmatter + enum（remark-lint-frontmatter-schema）、自定义笔记类 + 继承（Obsidian Metadata Menu `fileClass`，其继承 bug 即“只加不减”反面教材）、`required`/`enum` 是最基础两把校验、别重造完整 schema（JSON Schema）。

## 全局约束（沿用 AGENTS.md / P1–P3a）

- ESM `.js` 后缀、`import type`；无 `obsidian` import、文件操作只走 `fs`；纯内存 per-run，不碰 SQLite/indexer。
- metadata 规则**只读**（读 frontmatter 判 required/enum），不写 `.md`（写侧仍唯一在 `src/meta`）。
- 提交在当前分支 main，不新开分支；AI 提交/push 需会话内明确授权、信息不带 trailer。

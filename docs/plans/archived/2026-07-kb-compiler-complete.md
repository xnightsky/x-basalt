---
type: plan
title: KB compiler 实现全记录（P0–P3b）
description: KB compiler 从 P0 parser 定位契约到 P3b 自定义 config profile 的六个渐进阶段汇总
status: completed
tags:
  - plan
  - kb-compiler
  - links
  - lint
  - diagnostic
  - metadata
  - profile
  - x-basalt
---

# KB compiler 实现全记录（P0–P3b）

> 合并自：P0 `2026-07-09-kb-compiler-parser-position`、P1 `2026-07-09-kb-compiler-links-check`、P2 `2026-07-22-kb-compiler-p2-diagnostic-contract`、P3a `2026-07-22-kb-compiler-p3a-profile-lint`、P3b `2026-07-22-kb-compiler-p3b-config-profile`
> 设计真相源：`docs/specs/2026-07-09-kb-compiler-lint-links-design.md`
> 全部阶段于 2026-07-22 完成落地。

---

## 整体架构

```
src/parser/         → P0 扩展：wikilink/embed 定位字段、markdownLink 节点、代码块掩码
src/links/          → P1 落地：links check / links suggest（内存 per-run，不碰 SQLite）
src/diagnostic.ts   → P2 新建：BasaltDiagnostic 公共契约
src/lint/           → P2 新建：lint 壳；P3a metadata 规则；P3b profile 解析
src/cli.ts          → 接线：links 子命令 + lint 子命令 + --rules / --profile / --format
src/config.ts       → P3b 扩展：profiles.<name> 段 + parseProfiles
src/meta/           → P3a/P3b 复用：inspectProfile / readFrontmatter
```

---

## P0 · parser 链接定位契约（2026-07-09）

### 做了什么

- wikilink / embed 节点补 `line` / `column` / `raw` 字段（完整文件行号、UTF-16 code unit 列）
- parser **不再为 links 诊断去重** wikilink（同一链接多次出现分别保留，去重移到 indexer 写库边界）
- 新增 `markdownLink` 节点覆盖 inline Markdown link / image link P0 子集
- 代码块与行内代码中的 wikilink / Markdown link / image link **不产出节点**（`maskCode` 对齐）

### 设计决策

| 决策 | 选择 |
|---|---|
| 列单位 | UTF-16 code unit（非 grapheme），与 JS 字符串索引直接换算 |
| Markdown link 范围 | 保守子集：不支持嵌套括号、reference link、复杂转义 |
| 代码块屏蔽 | 等长 `maskCode` 结果，保证列位回指原文 |

---

## P1 · links check / links suggest（2026-07-09）

### 做了什么

- 新增 `src/links/` 模块：types/scan/resolve/ignore/check/report/index
- `x-basalt links check [vault]` — 全 vault 扫描，产出带 `line`/`column` 定位的诊断
- `x-basalt links suggest <file>` — 单文件诊断 + basename 修复建议
- 白名单索引（Docusaurus 式：文件路径 Set + basename/stem Map）
- 四种诊断类型：`not_found` / `ambiguous_target` / `outside_vault` / `external_skipped`
- 支持 ignore 配置（paths / targets / rules 三种粒度）
- 输出格式：人读 + `--format json|yaml`
- 全程内存 per-run，不新增 SQLite 表、不改 indexer

### 设计决策

| 决策 | 选择 |
|---|---|
| 架构 | 纯函数式静态检查——遍历 vault 用现有 parser 现解析 |
| 索引构建 | 一次性构建，`toSorted` 字典序（精排降级未做，列 backlog）|
| 建议排序 | 同名候选按 basename 字典序（精排：同目录/README 优先未做）|
| 路径键 | 统一 POSIX `toPosix()`；链接大小写不敏感（Obsidian 语义）|

### 收敛声明（P1 有意不做）

| 未做项 | 处理方式 |
|---|---|
| 锚点/heading 校验 | 留 P1.5 |
| `tmp_path` reason | 靠 ignore.paths 覆盖 |
| suggest 精排 | 已列 backlog |
| 行内注释禁用（disable-next-line） | 已列 backlog |
| mtime 解析缓存 | 已列 backlog |
| reference link | 未支持形态作为后续扩展，不猜测 |

---

## P2 · 统一诊断契约 BasaltDiagnostic + lint 壳（2026-07-22）

### 做了什么

- P1 的 `BasaltIssue` **更名为 `BasaltDiagnostic`** 并提升为公共稳定契约
- 新文件 `src/diagnostic.ts`（不再藏于 `src/links/types.ts`）
- 新增 `src/lint/` 壳模块：`src/lint/index.ts` + `src/lint/render.ts`
- CLI 新增 `x-basalt lint --rules links` 复用同一诊断产物
- `lint --rules links --format json` 与 `links check --format json` JSON **完全同构**、退出码一致

### 设计决策

| 决策 | 选择 |
|---|---|
| 契约位置 | `src/diagnostic.ts`（非 links/ 内）|
| lint 人读文案 | 复用 links 的"断链"文案，P3 接入 metadata 后泛化 |
| AGENTS.md 目录 | 不补 `diagnostic.ts`/`lint/`——与同级 links/chat 未列保持粒度一致 |

---

## P3a · 内置 profile 校验（2026-07-22）

### 做了什么

- `meta` 模块暴露读侧 `inspectProfile(content, name): ProfileDiff`
- 新增 `src/lint/metadata.ts` 规则
  - 校验内置 profile（`pkm-note` / `llm-wiki` / `ssg-blog`）的 required 字段是否齐全
  - 产出 `metadata/required-missing` 诊断
  - **零 config**，复用 `getProfile` / `diffProfile`
- CLI `lint --profile <builtin>` 接线

### 设计决策

| 决策 | 选择 |
|---|---|
| 范围 | 只做 builtin，不碰自定义 profile（留 P3b）|
| 写权限 | 只读——metadata 规则不写 `.md`（写侧唯一在 `src/meta`）|
| 业界参考 | Front Matter CMS content types / remark-lint-frontmatter-schema / ESLint extends |

---

## P3b · 自定义 config profile extends + enums（2026-07-22）

### 做了什么

- `src/config.ts` 新增 `profiles.<name>` 段和 `parseProfiles`
- `src/lint/profile.ts` — `ProfileConfig` / `LintProfile` / `resolveLintProfile`
  - `extends` 继承（单父/子覆盖/required 并集/enums 按字段只加不减）
  - **环检测** / **未知父报错** / **同名覆盖内置**
  - `enums` 校验（`string[]` 白名单）→ `metadata/enum-invalid`
- `src/lint/metadata.ts` 泛化——required + enum + include（glob 过滤）
- CLI `lint --profile <name>` 透传 config.profiles

### extends 语义

```
继承规则：required 并集、enums 按字段子覆盖父（只加不减）
环检测：resolveLintProfile 内循环检测
未知父：报错退出 1
同名覆盖内置：config profiles.llm-wiki 替换 builtin llm-wiki
```

### 业界参考

| 信源 | 参考点 |
|---|---|
| ESLint shareable configs | `extends` 子覆盖父、环检测 |
| Front Matter CMS | content types + extends |
| Obsidian Metadata Menu | fileClass + `extends`（#600 继承 bug="只加不减"反面教材）|
| JSON Schema | `required`/`enum` 最基础两把校验 |

---

## 测试覆盖

| 模块 | 测试文件 | 用例数 |
|---|---|---|
| P0 parser | `tests/parser.test.ts` | 含定位/代码掩码 |
| P1 links check | `tests/links/*.test.ts` | 多文件 |
| P1 CLI | `tests/links/cli.test.ts` | 端到端 |
| P2 diagnostic | `tests/lint/*.test.ts` | 含同构验证 |
| P2 CLI | `tests/lint/cli.test.ts` | 端到端 |
| P3a metadata | `tests/lint/metadata.test.ts` | +13+（增量）|
| P3b config profile | `tests/config.test.ts` | +3 |
| P3b profile resolve | `tests/lint/profile.test.ts` | +10 |
| P3b CLI | `tests/lint/cli-config-profile.test.ts` | +3 |
| P3b CLI profile | `tests/lint/cli-profile.test.ts` | 端到端 |

---

## 已知限制 / Backlog

| 项 | 来源 | 优先级 |
|---|---|---|
| 锚点/heading 校验 | P1 收敛声明 | P1.5 |
| suggest 精排（同目录/README 优先）| P1 收敛声明 | 候选 |
| 行内注释禁用（disable-next-line） | P1 backlog | 候选 |
| mtime 解析缓存 | P1 backlog | 候选 |
| `tmp_path` reason（目前靠 ignore 覆盖）| P1 收敛声明 | — |
| `lint --fix` 自动修 | 未开始 | P4+ |

---

## 原始文件

本合并文档替代以下 5 份独立 plan（已归档到 `docs/plans/archived/`）：
- `2026-07-09-kb-compiler-parser-position.md`（P0）
- `2026-07-09-kb-compiler-links-check.md`（P1）
- `2026-07-22-kb-compiler-p2-diagnostic-contract.md`（P2）
- `2026-07-22-kb-compiler-p3a-profile-lint.md`（P3a）
- `2026-07-22-kb-compiler-p3b-config-profile.md`（P3b）

设计真相源仍在 `docs/specs/2026-07-09-kb-compiler-lint-links-design.md`。

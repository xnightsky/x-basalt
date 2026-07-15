---
type: spec
title: skills-def 薄入口 + cli/dev 目录分组设计
description: 把外层 x-basalt 入口 skill 改薄为触发+指路（用法导向 skills get core），并将 skills-def 按受众分 cli/(消费侧,装宿主全局) 与 dev/(biz-* 开发侧,装本仓) 的设计与实施记录。
tags:
  - skills-def
  - refactor
  - architecture
  - skill-recall
timestamp: 2026-07-15T03:33:06Z
sha256: ca07114d899b76d9bbd5be739d19abeb27257ba2414187960b05c8ac2329e701
---
# skills-def 薄入口 + cli/dev 目录分组（对齐 x-kb 思路）· 设计

> 状态：已实现（分支 `refactor/skills-def-cli-dev-thin-router`，待评审合并） · 日期：2026-07-15 · 参考：`/data/code/public/x-kb`

## 背景与现状

x-basalt 的 skill 分两套（AGENTS.md「Skills 真相源」已述）：

- **产品运行时** `skills-data/*.json5`：`SkillRecall` 加载，`x-basalt skills get/recall/list` 消费。其中 `core.json5`（`name:"core"`）是本 CLI 的**自我说明书**——命令全集、DQL 子集、meta 改写、`run` 管道、chat、配置、限制**已完整覆盖**。`skills-data/x-basalt.json5 → core.json5` 的改名**早已完成**（`loader.ts` 的 `ALWAYS_AVAILABLE = ["obsidian-base-spec","core"]`）。
- **开发侧** `skills-def/<name>/SKILL.md`：由 `install-skills.mjs` 装成 `.claude/skills/` 与 `.agents/skills/` 产物（gitignore）供 AI 运行时发现。当前含：外层入口 `x-basalt`（`scope:global`）+ 三个 `biz-*`（默认 `scope:project`）。

**问题**：外层 `skills-def/x-basalt/SKILL.md` 是一份 **95 行的胖复制**——把命令速查表、`run` 管道、meta、chat、配置、DQL 全抄了一遍，而这些在运行时 `core` 里已是权威正文。这正是 x-kb 明令避免的「二次漂移」（两处各写一份、迟早不一致）。

**x-kb 约定**（`skills-def/cli/x-kb/SKILLS.md`）：外层入口 skill **保留 CLI 名**（`x-kb`）、极薄、只做「触发 + 指路 + `x-kb skills get core`」，并明文禁止把动词表抄进本文；权威正文一律现取 `skills get core`。目录上 x-kb 分 `cli/`（装宿主全局）与 `skills/`（就地消费）两组。

## 目标

1. 外层 `x-basalt` 入口 skill **改薄**为「触发 + 指路」，用法一律导向 `x-basalt skills get core`（**保留 name `x-basalt`**，对齐 x-kb 保留 `x-kb`）。
2. `skills-def/` **目录分组**为 `cli/`（消费侧入口，装宿主全局）与 `dev/`（`biz-*` 开发侧，装本仓）。**刻意不照抄 x-kb 的 `skills/` 名**：x-kb 的 `skills/` 是消费侧领域知识（跨仓消费），而 x-basalt 的三个 `biz-*` 全是「开发本仓自身代码」时召回的开发侧 skill——按受众/去向取名 `cli/`+`dev/` 比 `skills/` 更诚实，也与仓里「开发侧业务 skill」的一贯措辞一致。
3. 修陈旧引用：`docs/guides/ai-and-skills.md` 的 `skills get x-basalt` → `skills get core`。
4. 改薄不丢信息：外层唯一未进 `core` 的 `X_BASALT_DIR` 环境变量，折进 `core.json5` 配置规则。

**非目标**：不动运行时 `skills-data/`（`core` 已改好）；不改 `core.json5` 内容组织（仅补 `X_BASALT_DIR`）；不采用 x-kb 的 `SKILLS.md` 源名约定（x-basalt 一直用 `SKILL.md`，保持不变）；不动历史 spec `docs/specs/2026-06-30-chat-skill-grounding-design.md`（它**记录**了这次改名迁移，是历史真相）。

## 方案

### 1. 目录分组

```
skills-def/
  cli/                         ← 消费侧入口（装宿主全局）
    x-basalt/SKILL.md          ← 由 skills-def/x-basalt/ 移入并改薄
  dev/                         ← 开发侧（写/审 x-basalt 自身代码时召回，装本仓）
    biz-obsidian-spec/SKILL.md ← 由 skills-def/biz-obsidian-spec/ 移入
    biz-dql-subset/SKILL.md
    biz-code-comments/SKILL.md
  README.md · INSTALL.md        ← 更新布局与安装说明
```

用 `git mv` 保留历史。

### 2. install-skills.mjs 改为按目录路由（保留现有两命令 UX）

现状：单层遍历 `skills-def/`，按 frontmatter `scope` 分流（`--global` 装 global、默认装 project）。x-basalt 与 x-kb 的关键差异：**x-kb 的 `skills/` 组不装宿主**（经 kb-routing 就地消费），而 **x-basalt 的 `biz-*` 必须装进本仓 `.claude/skills/`**（否则 Claude Code 发现不到）。故两组都要装，只是改由**目录**而非 `scope` 决定去向：

- `--global`（`skills:install:global`）：源 `skills-def/cli/` → 宿主 `~/.claude/skills/` + `~/.agents/skills/`。
- 默认（`skills:install`）：源 `skills-def/dev/` → 本仓 `.claude/skills/` + `.agents/skills/`。

两组仍各装到 `.claude` 与 `.agents` 两根。`skillScope()` 正则可删（不再靠 frontmatter 分流）；`SKILL.md` 源名不变（无 x-kb 的 SKILLS→SKILL 改名步骤）。`package.json` 的 `skills:install` / `skills:install:global` 两脚本不变，语义映射保持 1:1。

### 3. 薄化后的 `skills-def/cli/x-basalt/SKILL.md`（目标全文）

```markdown
---
name: x-basalt
description: <保留现有触发描述逐字不变>
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

本文只做「触发 + 指路」——用法真相源不在本文，一律以 `x-basalt skills get core` 现打印为准（随 CLI 版本走，不在此重抄）。

## 怎么用

1. 确认已装：`x-basalt --version`（装不上则按常规方式干活，别强用本 skill）。
2. 动手前先 `x-basalt skills get core`，按它说的做——这是「怎么用 x-basalt」的权威正文：命令全集（parse/index/scan/query/skills/meta/watch/run/chat）、变更编排管道、DQL 子集、可选 AI 的 chat、项目配置。
3. 要精确 Obsidian/DQL 语法与边界：`x-basalt skills get obsidian-base-spec`（取整篇）或 `x-basalt skills recall <关键字>`（如 wikilink/dataview/callout，模糊召回）。

**不要**在本文（或调用方 prompt 里）复制命令表、DQL 细节或选项——一律以 `x-basalt skills get core` 现打印为准，避免二次漂移。
```

`description` frontmatter 逐字保留（它是召回判据，且已含触发语「当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用」）。`scope: global` 保留（虽然新脚本按目录路由，留着无害且语义自证）。

### 4. 陈旧引用与 core 补漏

- `docs/guides/ai-and-skills.md` 第 42 行 `x-basalt skills get x-basalt` → `x-basalt skills get core`。
- `core.json5` 的「项目配置」规则补一句 `X_BASALT_DIR`（指定 `.x-basalt` 基目录，config 与 index.db 都落其下；优先级 flag > `X_BASALT_DIR` > 就近 `.x-basalt/` > 默认）——这是外层胖文本里唯一不在 `core` 的信息，改薄前先补齐。

### 5. 文档登记

- `skills-def/README.md`、`skills-def/INSTALL.md`：更新为 `cli/` + `dev/` 两组布局与「按目录路由」安装说明。
- `AGENTS.md`：§文件树（`skills-def/` 行）与「Skills 真相源」段路径由 `skills-def/<name>/` 改为 `skills-def/{cli,dev}/<name>/`，并登记 `cli/x-basalt` 入口 skill。
- `CHANGELOG.md`：加一条「skills-def 入口薄化 + cli/dev 目录分组」。

## 影响文件清单

| 文件 | 动作 |
| --- | --- |
| `skills-def/x-basalt/` → `skills-def/cli/x-basalt/` | git mv + 改薄 SKILL.md |
| `skills-def/biz-*/` → `skills-def/dev/biz-*/` | git mv（3 个） |
| `scripts/install-skills.mjs` | 改按目录路由 |
| `skills-data/core.json5` | 配置规则补 `X_BASALT_DIR` |
| `docs/guides/ai-and-skills.md` | 修 `skills get x-basalt`→`core` |
| `skills-def/README.md` · `skills-def/INSTALL.md` | 更新布局/安装说明 |
| `AGENTS.md` | 更新 skills-def 路径与登记 |
| `CHANGELOG.md` | 加一条 |

## 验收

- `pnpm run skills:install` 从 `skills-def/dev/` 装出 3 个 `biz-*` 到本仓 `.claude/skills/` 与 `.agents/skills/`。
- `pnpm run skills:install:global` 从 `skills-def/cli/` 装出 `x-basalt` 到 `~/.claude/skills/` 与 `~/.agents/skills/`。
- 薄化后 `cli/x-basalt/SKILL.md` 不含任何命令表/DQL 细节；`x-basalt skills get core` 输出仍是完整用法（含 `X_BASALT_DIR`）。
- `pnpm run test`（547 通过）、`pnpm run lint`、`pnpm run typecheck` 全绿（无测试引用 skills-def，符合预期）。`format:check` 有**预存的仓库级漂移**（16 .ts + 52 .md，与本次无关；pre-push 门禁不含 format:check）——本次所改的 `install-skills.mjs` 已确认 oxfmt-clean。
- 仓库全局 grep 无残留 `skills get x-basalt`（历史 spec 与本设计文档的元引用除外）。
```

---
type: record
title: chat grounding 初期观察与改名实施记录
description: 从 docs/design/chat-skill-grounding.md 摘出的历史章节与旧导言，保留当时证据、版本及纠偏；当前契约和未完成义务仍由来源文档维护。
tags:
  - archive
  - history
  - x-basalt
timestamp: 2026-10-02T11:25:55Z
sha256: 5aa634a21ef48190f3fde0e30ab8968d9f2dbf7652377291dd44c061e8c406ea
---
# chat grounding 初期观察与改名实施记录

> 归档于 2026-10-02；来源：[docs/design/chat-skill-grounding.md](../../design/chat-skill-grounding.md) 的下列原章节。仅保留当时过程、提案或观察，不代表当前实现；有效契约与后续义务以来源文档及根 TODO 为准。

保留来源章节的原读数、旧选择与纠偏经过；章节中的“当前”“待实施”均按原阶段基线阅读，不作为归档后的新授权。

## 1. 问题

`chat` 的模型（尤其弱模型如 `deepseek-v4-flash`）**不会稳定地自行召回规范**：

- 原始转录：模型调了 `skills_recall` 但关键词没命中（recall 是 Fuse 模糊匹配，多词/中文常召不回）→ floundered。
- 加 `skills_get` + 一条"必须先 skills_get"的提示后：**时灵时不灵**——一次先调了，另一次直接 query 跳过。

根因是 **grounding 不确定**，不是模型没能力。但反向的"启动全量注入所有 skill"（v1，把 obsidian-base-spec + x-basalt 共 14.5KB 全塞进 system）又把 chat 用不上的大块 CLI 手册也灌进去，浪费上下文。

## 2. 参考：agent-browser 怎么做的（两源对齐）

- **二进制抠出的 chat 系统提示词**（`agent-browser-win32-x64.exe` rodata）：短纪律 + 结尾 *"The following skill references describe agent-browser capabilities… Use them…"*，运行时拼接的是**短发现 stub**（"Before running any command, `skills get core`"），**不是 core 全文**。
- **deepwiki**：core **不自动注入**；模型被期望自己调 `agent-browser skills get core`（evals `context-footprint.ts` 即测此行为）；专项技能（electron/slack/…）**模型驱动按需** `skills get <name>`，由 core 里 "When to load another skill" 段引导；**无依赖声明、无门控**。

→ **agent-browser = 系统提示词里一条强力"先 `skills get core`"指令（stub）让模型自取 core；深/专项技能模型按需自取；无门控。** 之所以连 flash 都听，靠的是这条指令**显眼、强框**（"你还没有用法全文，动手前先取"），而非全文注入。

### 3.2 `requiredSkills` 软提示，**不做强门控**
每个工具的 `description` 里点名它依赖的深规范（纯引导、不拦截）：
| 工具 | 提示指向 |
|---|---|
| `query` | 构造 DQL 不确定文法 → `obsidian-base-spec` |
| `meta_set` / `meta_normalize` | 值类型/归一规则 → `obsidian-base-spec` |
| `meta_apply` | profile 语义 → `core` |
| `pipeline_run` | where=DQL → `obsidian-base-spec`；actions/steps 算子语义 → `core` |
| `parse`/`scan`/`meta_get`/`meta_unset`/`meta_rename` | 无（入参平凡） |

### 3.4 撤掉 v1 的启动全量注入
删掉 `buildSystem`/`GROUNDING_SKILLS`/启动 banner，`setup` 回到 `{model,tools}`，`runOnce/runRepl` 用 `SYSTEM_PROMPT`。`skills_get` 工具保留（取 core / obsidian-base-spec / 复读）。

## 6. 落地 blast radius（改名 `x-basalt`→`core` 的牵连）

`x-basalt` 作为 **skill 名**的引用（≠ CLI 二进制名 `x-basalt`、≠ 配置目录 `.x-basalt/`、≠ cosmiconfig 名）：
- `skills-data/x-basalt.json5` → `core.json5`：`name:"x-basalt"`→`"core"`、自引用 `skills get x-basalt`→`skills get core`、triggers 加 `"core"`（保留 `"x-basalt"` 兼容召回）、注释。
- `src/skill/loader.ts:40` `ALWAYS_AVAILABLE = ["obsidian-base-spec","x-basalt"]` → `[…,"core"]`（+ 注释 37/91）。
- `tests/skill.test.ts:73/84/134` 断言 `name === "x-basalt"` / `includes("x-basalt")` → `"core"`。
- `src/chat/index.ts`：撤注入（`"x-basalt"` 随 `GROUNDING_SKILLS` 删除）+ §3.1 指令。
- `src/chat/tools.ts`：`skills_get` 描述 `x-basalt(CLI 用法)`→`core(…)` + §3.2 软提示。

**保持不动**：`x-basalt parse/query/…` 等 CLI 用法示例、`src/cli.ts .name("x-basalt")`、`src/config.ts cosmiconfigSync("x-basalt")`、`.x-basalt/` 配置目录、`skills-def/x-basalt/SKILL.md`。

⚠️ **CLI 表面变更**：`x-basalt skills get x-basalt` → `x-basalt skills get core`（recall 仍能按触发词 `x-basalt` 召回，但精确 `get` 名变了）。

## 7. 测试

- `tests/skill.test.ts`：改名后 builtin 含 `core`（usage/help/watch/说明书 仍召回）。
- typecheck + build 通过。
- chat 实跑 `如何查询 type research 文档`：观察模型**第一步是否调 `skills_get({name:"core"})`**（A 档是否生效的关键证据）；再看是否写对 DQL。

## 整理前导言（历史上下文）

# chat 技能接地（skill grounding）设计 — v2

> 状态：已定稿，落地中。日期：2026-06-30。
> 范围：`x-basalt chat`（可选 AI 子命令）如何可靠地让模型拿到 DQL/frontmatter/CLI 规范。
> 不涉及：`skills-def/*/SKILL.md`（那是给外部 AI 驱动 CLI 的发现 stub，与本设计无关、保持不动）。

---
type: design
title: chat 技能接地（skill grounding）设计 v2
description: x-basalt chat（可选 AI 子命令）如何可靠让模型召回 DQL/frontmatter/CLI 规范：对齐 agent-browser 的系统提示词强制先取 core（模型驱动+强框、无门控）+ requiredSkills 软提示 + 两层内部 skill（core / obsidian-base-spec），含决策记录与可靠性兜底阶梯
tags:
  - design
  - chat
  - ai
  - skill
  - x-basalt
timestamp: 2026-06-30T06:41:18Z
sha256: 95b9ccb1b27f3baa4aeb6c99fb9b304d17991e7dd9ea0ccb68e709dd52a40f08
---
# chat 技能接地（skill grounding）设计 — v2

> 状态：已定稿，落地中。日期：2026-06-30。
> 范围：`x-basalt chat`（可选 AI 子命令）如何可靠地让模型拿到 DQL/frontmatter/CLI 规范。
> 不涉及：`skills-def/*/SKILL.md`（那是给外部 AI 驱动 CLI 的发现 stub，与本设计无关、保持不动）。

## 1. 问题

`chat` 的模型（尤其弱模型如 `deepseek-v4-flash`）**不会稳定地自行召回规范**：

- 原始转录：模型调了 `skills_recall` 但关键词没命中（recall 是 Fuse 模糊匹配，多词/中文常召不回）→ floundered。
- 加 `skills_get` + 一条"必须先 skills_get"的提示后：**时灵时不灵**——一次先调了，另一次直接 query 跳过。

根因是 **grounding 不确定**，不是模型没能力。但反向的"启动全量注入所有 skill"（v1，把 obsidian-base-spec + x-basalt 共 14.5KB 全塞进 system）又把 chat 用不上的大块 CLI 手册也灌进去，浪费上下文。

## 2. 参考：agent-browser 怎么做的（两源对齐）

- **二进制抠出的 chat 系统提示词**（`agent-browser-win32-x64.exe` rodata）：短纪律 + 结尾 *"The following skill references describe agent-browser capabilities… Use them…"*，运行时拼接的是**短发现 stub**（"Before running any command, `skills get core`"），**不是 core 全文**。
- **deepwiki**：core **不自动注入**；模型被期望自己调 `agent-browser skills get core`（evals `context-footprint.ts` 即测此行为）；专项技能（electron/slack/…）**模型驱动按需** `skills get <name>`，由 core 里 "When to load another skill" 段引导；**无依赖声明、无门控**。

→ **agent-browser = 系统提示词里一条强力"先 `skills get core`"指令（stub）让模型自取 core；深/专项技能模型按需自取；无门控。** 之所以连 flash 都听，靠的是这条指令**显眼、强框**（"你还没有用法全文，动手前先取"），而非全文注入。

## 3. v2 设计

照 agent-browser 对齐，四点：

### 3.1 系统提示词强制先取 `core`（模型驱动 + 强框，无门控）
`SYSTEM_PROMPT` 里放一条**显眼、stub 式**的强指令：
> 【动手前必做】你现在没有 x-basalt 的用法与 DQL 规范全文——回答任何问题、调用任何查询/写工具之前，**第一步先 `skills_get({name:"core"})`**（能力总览 + DQL 基础 + meta/pipeline）。需要精确 DQL 文法 / frontmatter 规则时再 `skills_get({name:"obsidian-base-spec"})`。别凭记忆猜语法。

### 3.2 `requiredSkills` 软提示，**不做强门控**
每个工具的 `description` 里点名它依赖的深规范（纯引导、不拦截）：
| 工具 | 提示指向 |
|---|---|
| `query` | 构造 DQL 不确定文法 → `obsidian-base-spec` |
| `meta_set` / `meta_normalize` | 值类型/归一规则 → `obsidian-base-spec` |
| `meta_apply` | profile 语义 → `core` |
| `pipeline_run` | where=DQL → `obsidian-base-spec`；actions → `core` |
| `parse`/`scan`/`meta_get`/`meta_unset`/`meta_rename` | 无（入参平凡） |

### 3.3 两层内部 skill（`skill-data/*.json5`，运行时 SkillRecall 读）
- **`core`**（由 `x-basalt.json5` 改名）：强制基线 = 能力总览 + DQL 基础 + meta/pipeline 用法。
- **`obsidian-base-spec`**：深层 DQL/frontmatter 语法，按需取。

### 3.4 撤掉 v1 的启动全量注入
删掉 `buildSystem`/`GROUNDING_SKILLS`/启动 banner，`setup` 回到 `{model,tools}`，`runOnce/runRepl` 用 `SYSTEM_PROMPT`。`skills_get` 工具保留（取 core / obsidian-base-spec / 复读）。

## 4. 为什么不选另两档（决策记录）

| 档 | 谁加载 | 确定性 | 取舍 | 结论 |
|---|---|---|---|---|
| A 纯提示（本设计采用 §3.1+§3.2） | AI | 强框下高、但非绝对 | 0 成本、最 agentic、对齐 agent-browser | **采用** |
| C 门控（工具拒绝执行直到 skill 载入） | AI | ✓ 代码强制 | 首用多一次往返、可能空转 | 否（用户定：不做强门控） |
| B engine 注入（v1） | engine 强喂 | ✓ | 0 往返但非 agentic、灌无关 token | 仅作最终兜底 |

**调研佐证**：progressive disclosure / lazy skills 是行业主线（Claude Code / Semantic Kernel / OpenAI），但激活普遍**模型驱动**；"工具声明 requiredSkills + 确定性预载"尚无成熟轮子（微软 agent-framework ADR-0021 明确把依赖/auto-load 列为 future work；OpenAI Agents SDK issue #2906 仍是 feature request）。故 requiredSkills 走**软提示**、不自造门控机制。

## 5. 可靠性风险与兜底阶梯

§3.1 是模型驱动 → **可被跳过**。早先失败是因为提示弱、埋在长 prompt；v2 靠**强框**（agent-browser 实证连 flash 都听）。若 flash 仍偶尔跳过：
1. 把 §3.1 框得更强 / 置于 prompt 最前；
2. 退而上 **C 门控**（每挡 N 次降级把规范塞进门控响应）；
3. 最终退回 **B engine 注入**。
**先以 A 实测，不行再沿阶梯下探。**

## 6. 落地 blast radius（改名 `x-basalt`→`core` 的牵连）

`x-basalt` 作为 **skill 名**的引用（≠ CLI 二进制名 `x-basalt`、≠ 配置目录 `.x-basalt/`、≠ cosmiconfig 名）：
- `skill-data/x-basalt.json5` → `core.json5`：`name:"x-basalt"`→`"core"`、自引用 `skills get x-basalt`→`skills get core`、triggers 加 `"core"`（保留 `"x-basalt"` 兼容召回）、注释。
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

## 8. 与外部 skill 的边界（务必不混）
- `skill-data/*.json5`（**内部**）：chat 运行时知识库（本设计对象）。
- `skills-def/*/SKILL.md`（**外部**）：装到全局 skills 注册表、给 Claude Code 等 AI **驱动 x-basalt CLI** 用的发现 stub。**本设计不动它。**

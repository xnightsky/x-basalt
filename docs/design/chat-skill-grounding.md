---
type: design
title: chat 技能接地（skill grounding）设计 v2
description: 当前模型驱动的 core 基线与按需专项技能，无代码门控或全量预载；旧软提示表和改名记录已归档，不保证模型遵循。
tags:
  - design
  - chat
  - ai
  - skill
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 8383644d9b6fc92db7c2d6994c7a0663a95e4d8aa6c9701ad2f3915fa3fb06cd
---
# chat 技能接地（skill grounding）设计 — v2

> 状态：当前模型驱动 grounding 已实现；初期观察与改名步骤已归档，不作为可靠性保证。依据：`src/chat/index.ts` 的 SYSTEM_PROMPT、`tools.ts` 与运行时技能数据。
> 范围：`x-basalt chat`（可选 AI 子命令）如何可靠地让模型拿到 DQL/frontmatter/CLI 规范。
> 不改外部入口与开发侧安装产物；二者的分组与路由由 skills-router 维护。

## 1. 问题

本节历史内容已归档，见[原章节](../archive/decisions/2026-06-30-chat-grounding-record.md#1-问题)。当前规则与剩余边界见本文有效章节。

## 3. v2 设计

当前规则：模型先取基线，再按任务取专项规范；不设代码门控，也不启动全量注入。

### 3.1 系统提示词强制先取 `core`（模型驱动 + 强框，无门控）
`SYSTEM_PROMPT` 里放一条**显眼、stub 式**的强指令：
> 【动手前必做】你现在没有 x-basalt 的用法与 DQL 规范全文——回答任何问题、调用任何查询/写工具之前，**第一步先 `skills_get({name:"core"})`**（能力总览 + DQL 基础 + meta/pipeline）。需要精确 DQL 文法 / frontmatter 规则时再 `skills_get({name:"obsidian-base-spec"})`。别凭记忆猜语法。

### 3.2 `requiredSkills` 软提示，**不做强门控**

当前没有旧 `query/meta_*/pipeline_run` 工具依赖表，Vault 操作只有 `cli` 执行口。工具描述与 SYSTEM_PROMPT 指路，不验证模型已加载规范。旧表见[归档](../archive/decisions/2026-06-30-chat-grounding-record.md#32-requiredskills-软提示不做强门控)。

### 3.3 两层内部 skill（`skills-data/*.json5`，运行时 SkillRecall 读）

“两层”是基线/专项的策略，不是仅有两篇文件：chat 首取 `core`，DQL/frontmatter 按需取 `obsidian-base-spec`，Bases 按需取 `bases`；其余分工通过 `skills list` 与 `skills get summary` 发现，正文不在这里复制。外部 AI 默认直接 CLI 的入口另见 `skills-def/cli/x-basalt/SKILL.md`，不能与 chat 首取 core 混为一条策略。

### 3.4 撤掉 v1 的启动全量注入

本节历史内容已归档，见[原章节](../archive/decisions/2026-06-30-chat-grounding-record.md#34-撤掉-v1-的启动全量注入)。当前规则与剩余边界见本文有效章节。

## 4. 为什么不选另两档（决策记录）

| 档 | 谁加载 | 确定性 | 取舍 | 结论 |
|---|---|---|---|---|
| A 纯提示（当前采用） | AI | 不保证遵循，可跳过 | 无宿主强制预载，取 skill 仍有往返与上下文成本 | **采用** |
| C 门控（工具拒绝执行直到 skill 载入） | AI | ✓ 代码强制 | 首用多一次往返、可能空转 | 否（用户定：不做强门控） |
| B engine 注入（v1） | engine 强喂 | ✓ | 0 往返但非 agentic、灌无关 token | 仅作最终兜底 |

**2026-06-30 原调研背景（不是本轮新核查）**：progressive disclosure / lazy skills 是行业主线（Claude Code / Semantic Kernel / OpenAI），但激活普遍**模型驱动**；"工具声明 requiredSkills + 确定性预载"尚无成熟轮子（微软 agent-framework ADR-0021 明确把依赖/auto-load 列为 future work；OpenAI Agents SDK issue #2906 仍是 feature request）。故 requiredSkills 走**软提示**、不自造门控机制。

## 5. 可靠性风险与兜底阶梯

§3.1 是模型驱动，**可被跳过**；初期观察不足以证明单一失败原因或所有模型的遵循能力。若实际反复失败，可评估以下候选，不自动执行：
1. 把 §3.1 框得更强 / 置于 prompt 最前；
2. 退而上 **C 门控**（每挡 N 次降级把规范塞进门控响应）；
3. 最终退回 **B engine 注入**。
当前保持 A；改变“不做门控/全量注入”的既有取舍须另行确认与独立验收。历史 Bases A/B 的原始证据缺口仍在根 TODO，不因提示存在就重新认证旧分数。

## 6. 落地 blast radius（改名 `x-basalt`→`core` 的牵连）

本节历史内容已归档，见[原章节](../archive/decisions/2026-06-30-chat-grounding-record.md#6-落地-blast-radius改名-x-basaltcore-的牵连)。当前规则与剩余边界见本文有效章节。

## 8. 与外部 skill 的边界（务必不混）
- `skills-data/*.json5`（**内部**）：chat 运行时知识库（本设计对象）。
- `skills-def/cli/<name>/SKILL.md` 是消费侧入口，安装到宿主全局；`skills-def/dev/<name>/SKILL.md` 是本仓开发侧规范，安装到项目。本文不改这些源文件与安装产物。

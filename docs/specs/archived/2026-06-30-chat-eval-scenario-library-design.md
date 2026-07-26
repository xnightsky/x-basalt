---
type: spec
title: chat 评估 / 场景库设计草案（对标 agent-browser evals）
description: 在兄弟目录维护项目外的 chat 真实场景/素材库，把操作失败率·撞顶率从主观体感变为可量化回归指标；选址/格式待拍板
tags:
  - spec
  - chat
  - evals
  - scenario-library
timestamp: 2026-06-30T15:43:35Z
sha256: fc55501f2f44487539705d5febf079069e8b1269dcdd3204d1570ddede589d9f
---

# chat 评估 / 场景库设计草案（对标 agent-browser evals）

> 日期：2026-06-30。状态：**设计草案 — 选址/格式待用户拍板**，本篇不实现。
> 触发：dogfood 实测 chat 痛点（操作失败率高 / 轮询撞顶停），且「需要的场景太多，不可能堆在项目仓库里」。
> 对标：`vercel-labs/agent-browser` 的 `evals/` 体系（详见 [`../research/2026-06-30-chat-gap-vs-agent-browser.md`](../research/2026-06-30-chat-gap-vs-agent-browser.md) §3）。

## 1. 目的与定位

- **沉淀真实场景**：把 dogfood 中 chat 的真实使用场景（素材）系统化收集、复用。
- **指标化痛点**：让「操作失败率」「撞顶率」「正确率」从主观体感 → **可量化、可回归**——改了重试/步数/工具后跑同一批场景，对比指标涨没涨。
- **独立于主仓**：场景量大、演化快，不污染 x-basalt 仓库；放**兄弟目录**（项目仓库同级）。

## 2. 对标 agent-browser evals（现成参照）

- **结构**：`evals/cases/*.ts` 各导出一组 `EvalCase` → `evals/run.ts` 汇总 `ALL_CASES`；判分 `evals/lib/judge.ts`、报告 `evals/lib/reporter.ts`。
- **EvalCase 字段**：`id` / `name` / `category` / `prompt`（用户任务）/ `context`（注入上下文）/ `expectedPatterns`（正则，须全中）/ `forbiddenPatterns`（正则，须全不中）/ `rubric`（可选 LLM judge 准则）。
- **category**：skill-loading / skill-selection / command-usage / context-footprint。
- **判分**：pattern 断言（expected 全中 + forbidden 全不中）+ 可选 `--judge`（LLM 打 1-5 分 + 理由）。

## 3. 设计草案（x-basalt 场景库）

### 3.1 位置（待定）

| 候选 | 说明 |
|---|---|
| **A. 新建兄弟目录 `../x-basalt-evals`**（倾向） | 专用、边界清晰、独立 git，与主仓解耦 |
| B. 并入 `../x-kb` | 复用既有知识库工作区 |
| C. 并入 `../x-promptkit` | 若 promptkit 已是 prompt/eval 基建则收编 |

### 3.2 格式（待定）

| 候选 | 取舍 |
|---|---|
| A. TS `EvalCase`（照搬 agent-browser） | 类型安全、可编程构造、judge 集成现成 |
| B. YAML（对齐项目已装 `recall-queue.schema.yaml`） | 声明式、非程序员可写、与 recall 体系统一 |

### 3.3 CaseSchema 草案（字段，格式无关）

- `id` / `name` / `category`
- `prompt`：喂给 `x-basalt chat` 的用户输入
- `fixtureVault`：场景所需样例 vault（内联或指向 fixture 目录；与 `tests/fixtures/sample-vault` 区分——那是单测用）
- `expectedTools`（可选）：期望调用的工具序列（如 `[query]` / `[meta_get, meta_set]`），用于查「有没有真调工具、调对没」
- `expectedPatterns` / `forbiddenPatterns`：输出正则断言
- `maxSteps`：本场景步数上界（用于测「撞顶率」）
- `rubric`（可选）：LLM judge 评分准则

### 3.4 category 草案（直接映射痛点）

- `tool-success`：工具调用是否成功（→ 量化**操作失败率**）
- `step-budget`：是否在 maxSteps 内完成（→ 量化**撞顶率**）
- `correctness`：DQL/meta 结果对不对
- `grounding`：是否会话首步取 `core`

### 3.5 runner 与指标

- 喂 `x-basalt chat`（单发、非 TTY 管道）→ 跑 → pattern 断言 +（可选）LLM judge。
- 输出 JSON 报告：**成功率 / 平均步数 / 撞顶率 / 各 category 通过率**。

## 4. 与项目内 `.recall` 评估体系的关系（待定）

项目已装 `recall-queue.schema.yaml` + recall-author/recall-eval skills。需定：
- **复用**其 schema/runner（统一一套评估基建），还是**另起**（chat 是端到端 AI 行为评估，recall 偏召回评分，模型可能不同）？
- 倾向：先独立最小实现验证闭环，若 schema 可复用再收敛。

## 5. 与 chat 改进的闭环

场景库是「体检仪」：chat 改进（[chat gap 篇](../research/2026-06-30-chat-gap-vs-agent-browser.md) 的 P0 重试 / 撞顶续作 / P1 新工具）→ 跑场景库 → 看失败率/撞顶率指标动没动 → 决定下一步。无场景库则改进无从验证。

## 6. 待定项汇总 + 下一步

**待拍板**：①选址（3.1）②格式（3.2）③与 .recall 关系（§4）④场景来源（建议：沉淀真实 dogfood 转录）。

**下一步**：用户拍板选址+格式 → 细化为正式 spec（含 CaseSchema 定稿 + runner 接口）→ writing-plans 出实现计划 → 实现。**本会话止于本草案。**

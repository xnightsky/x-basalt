---
type: plan
title: 统一算子模型片四：声明式步骤列表（steps/step）
description: 配置段 steps 数组 + CLI 可重复 --pipe step=<spec>，解决片二/三算子参数含逗号导致 actions= 配置面表达不出来的缺口；actions 行为逐字不变，steps 存在时优先
tags:
  - plan
  - orchestrator
  - pipeline
  - cli
timestamp: 2026-07-30T15:58:27Z
sha256: b46871605789f2d8c7086424db637d223d819e4028de97b87035a06281fb09cb
---

# 统一算子模型片四：声明式步骤列表（steps/step）

> **For agentic workers:** 用 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。
> 日期：2026-07-30 · 主题：统一算子模型片四 · 配置面
> 真相源（设计）：[`../design/pipeline-op-model.md`](../design/pipeline-op-model.md) §9 片四 + D12
> 前序：[`2026-07-30-pipe-closure.md`](2026-07-30-pipe-closure.md)（参数面收口）、TODO「统一算子模型」

**Goal:** `--pipe` 获得无分隔符的算子链表达方式：配置段 `pipelines.<name>.steps: string[]`
（一元素一算子 spec）+ CLI 可重复 `--pipe step=<spec>`（按出现顺序成链）。
`actions` 保留且行为逐字不变（D5）；`steps`/`step` 存在时优先。

**动机（真实缺口，非新语法瘾）:** 片二/三接入的算子参数天然含逗号——
`query LIST FROM "x" WHERE contains(tags, "a")`、`filter tags contains "a,b"`、`base tasks.base#view`。
`actions=` 走逗号分隔（`splitTopLevel` 只认括号不认引号），把单条 spec 劈碎后后半段被当算子名
`resolve()` → 报「未知算子」。是报错不是静默，但**能力已落地、CLI 表达不出来**。

**Architecture:** 表达层新增 `steps`，执行层只改一行消费（`engine.ts` 取 `steps ?? actions`）；
`PipelineConfig.actions` 降为可选，两个解析入口（`params.ts` / `config.ts`）统一校验
「actions 与 steps 至少一个非空」。`parsePipeFlags` 返回形状调整为 `{ kv, steps }`
以承载可重复的 `step`（原 Record 形态重复键会互相覆盖）。

**Tech Stack:** Node 22+ / TS ESM(NodeNext) / commander / node:test。

## Global Constraints（每个 task 隐含遵守）

- `actions` 既有切分行为**逐字不变**（D5 向后兼容）：`splitTopLevel` 一行不动。
- 非法参数声明期报错，不静默忽略、不静默降级。
- 一一对应不变量延伸：`step` ⟷ `steps` 经 `CONFIG_KEY_OF` 映射，命令行/配置段同能力。
- 中文注释解释「为什么/边界/副作用」。

## 原子子步（TDD）

- [x] **S4-1 类型与决策记录**：`PipelineConfig` 加 `steps?: string[]`、`actions` 降可选；
  `pipeline-op-model.md` 补 D12 + §11 验收第 5 条。
- [x] **S4-2 params（red→green）**：`PIPE_KEYS` 加 `step`；`parsePipeFlags` 返回 `{ kv, steps }`；
  `resolvePipelineParams` 组装 steps（CLI 重复 step 保序 ⟷ 基底 `steps`；与 actions 同给时 steps 优先；
  两者皆无报错指路）。测试：`tests/orchestrator-params.test.ts`（含 PIPE_KEYS 一一对应清单更新）。
- [x] **S4-3 config（red→green）**：`parsePipelines` 接受 `steps`（须字符串数组，**不做逗号切分**——
  切分正是本片要消除的病）、「至少一个非空」校验。测试：`tests/orchestrator-config.test.ts`。
- [x] **S4-4 engine 消费（red→green）**：`engine.ts` 改 `(pipeline.steps ?? pipeline.actions).map(resolve)`。
- [x] **S4-5 契约对拍（验收判据）**：`tests/orchestrator-contract.test.ts` 新增——同一算子链
  `actions` 写法 vs `steps` 写法产出 `RunReport` 既有字段逐字段相等；含逗号参数算子
  （`filter tags contains "a,b"`）在 steps 下正确、在 actions 下按既有行为报错（差异钉成契约）。
- [x] **S4-6 文档同步**：spec §8.1 表补 steps 行、`docs/use` 命令文档、`skills-data/core.json5`、
  CHANGELOG、TODO 勾除片四（含 §12 两条回写项一并处理——诊断键名「已定」回写 +
  多根 path 归一显式断言，若在片四边界内）。
- [ ] **S4-7 四门验证 + 收口**：typecheck / lint / format / 受影响测试全绿；文档元数据自举。

## 验收

- 同一算子链 `actions=` 与 `steps=` 两种写法产出同一份 `RunReport`（既有字段逐字段相等）。
- `filter tags contains "a,b"` 这类含逗号 spec 在 `steps`/`--pipe step=` 下正确执行。
- `actions` 全部既有测试**一行不改**继续通过（D5 的机械化证明）。
- 非法/歧义输入（steps 非字符串数组、actions 与 steps 皆空）声明期报错。

---
type: record
title: 统一算子模型的旧接口与实施增补记录
description: 从 docs/design/pipeline-op-model.md 摘出的历史章节与旧导言，保留当时证据、版本及纠偏；当前契约和未完成义务仍由来源文档维护。
tags:
  - archive
  - history
  - x-basalt
timestamp: 2026-10-02T11:25:55Z
sha256: f4e135389441b6e03fe7adb231b6b1d8ac608435a1711fd8c86a24d2e3afbc89
---
# 统一算子模型的旧接口与实施增补记录

> 归档于 2026-10-02；来源：[docs/design/pipeline-op-model.md](../../design/pipeline-op-model.md) 的下列原章节。仅保留当时过程、提案或观察，不代表当前实现；有效契约与后续义务以来源文档及根 TODO 为准。

保留来源章节的原读数、旧选择与纠偏经过；章节中的“当前”“待实施”均按原阶段基线阅读，不作为归档后的新授权。

### 0.1 实施记录

> **2026-07-30 增补**：动手前发现原文有两处设计缺口 + 一条假判据，已补齐并落 D6/D7/D8——
> 批算子模型下并发无处安放（§3.2.1）、`Op.run → Row[]` 表达不了逐行失败（§3.2）、
> 片一「测试全绿即迁移正确」与「要改测试」自相矛盾（§9.1）。§12 的未决问题相应从 3 条重排。
>
> **2026-07-30 二次增补（S4 实现撞出来的两条）**：D9——`OpOutcome` 漏了 `changed`/`skipped`
> 信号，不补则 `RunReport` 四个字段静默归零并连带打回 `d04d47d` 的写后刷索引；D10——§3.2.1 的
> 「切成片」与 §9.1-B 的「同时在跑的行数 ≤ concurrency」互斥，钉死为逐行领取。
> 两条都是**写代码时才暴露的设计歧义**，不是实现错误。
>
> **2026-08-02 回写（§12 收尾）**：片二遗留的两个必决项已定并落断言——D13 诊断统一挂
> `Row.fields.diagnostics`（实现早已选定，本文从「倾向」改「已定」）；D14 读源算子行 `path`
> 与索引主键同源（`layout.toKey`），新增 Op-S3 / Op-B9 显式断言，不再依赖巧合。

## 1. 要解决的问题

### 1.1 证据：能力有 9 个模块，管道只接得进 3 个

仓库里每个能力模块都已经有干净的程序化接口：

| 模块 | 程序化入口 | 进管道了吗 |
| --- | --- | --- |
| `src/indexer` | `VaultIndexer.update/removeByKey/scan` | ✅ `index` 动作 |
| `src/meta` | `editMeta`/`setMeta`/`unsetMeta`/`renameMeta`/`normalizeDoc`/`applyProfile` | ✅ 5 个动作 |
| `src/parser` | `VaultParser.parse` | ✅ `parse` 动作 |
| `src/query` | `DataviewEngine.query` | ✅ `query` 算子，可作源或转换 |
| `src/query` | `DataviewEngine.search` | ✅ `search` 算子，可作源或转换 |
| `src/base` | `BaseEngine.query` | ✅ `base` 算子，可作源或转换 |
| `src/links` | `runLinksCheck` / `runLinksSuggest` | ✅ `links.*` 算子，可作源或转换 |
| `src/lint` | `runLint` | ✅ `lint` 算子，可作源或转换 |

**能力早就在了，是编排器的接口太窄接不进来。** 这不是"再补几个动作"能解决的——`links.check` 产出诊断列表、`base` 产出带计算列的行、`search` 产出带评分的命中，**它们的产物都不是"文件路径"**，而现有管道只能流动文件路径。

### 1.2 根因：流动单位被签名锁死

```ts
// src/orchestrator/types.ts:15
interface ChangeEvent { path: string; type: EventType; mtime?: number; size?: number }

// src/orchestrator/types.ts:58
interface Action { run(ev: ChangeEvent, ctx: ActionContext): Promise<ActionResult> }
```

三个后果，互为因果：

1. **算子之间传不了数据。** 每个动作只拿到一个路径，上一个算子算出什么，下一个看不见。要传数据只能靠"都去读同一个文件"这种间接耦合。
2. **源必须是文件形状。** `base`/`search`/`links` 的行一进管道就被压扁成路径，计算列、评分、诊断全丢——所以它们干脆接不进来。
3. **角色分类产生摩擦。** 现有模型把算子硬分成"源"和"动作"两类。`base` 既像源（产出行集）又像转换（可以过滤上游行），归哪类都别扭，于是两边都没做。

## 9. 分阶段切口

| 片 | 内容 | 独立验收 | 状态 |
| --- | --- | --- | --- |
| 一 | `Row` + `Op`/`OpOutcome` 签名 + `registry`；现有动作迁到新签名 | 见 §9.1（**不是**「测试全绿」） | ✅ 已落地 |
| 二 | 接只读算子：`query` / `search` / `base` / `links.*` / `lint` | 每个算子既能当源又能当中段，各有用例 | ✅ 已落地 |
| 三 | 纯函数算子 `filter/map/limit/dedup` + `{{row.x}}` 插值 | `base → meta.set` 端到端跑通计算列传递 | ✅ 已落地 |
| 四 | 配置面：`--pipe` 支持声明式步骤列表，保留现有 kv 兼容 | 新旧两种写法产出同一份 `RunReport` | ✅ 已落地 |

四个切口已按顺序实施并分别建立回归覆盖。片一虽无直接用户可见收益，却为片二至片四提供了统一的行模型、算子契约与调度接缝；分片提交和独立验收避免了模型错误在后续能力接入时被放大。

## 整理前导言（历史上下文）

# 内置 pipeline 改造：统一算子模型

> 上游设计：[`change-orchestration.md`](../../design/change-orchestration.md)（五段流水线、动作清单、算子集）。本文记录其**已落地的执行层模型**，不替代它——脊梁（§1）、风险清单（§9）、YAGNI 边界（§11）全部沿用。
> 下游设计：[`shell-pipe-portability.md`](../../design/shell-pipe-portability.md)（多平台 shell 管道），依赖本文的算子模型，排在本文之后。

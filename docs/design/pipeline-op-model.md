---
type: design
title: 内置 pipeline 改造：统一算子模型
description: 把编排器的流动单位从文件事件升级为 Row、算子统一为批进批出单签名、调度与算子分离；让 query/search/base/links/lint 都能进管道，并为 shell 管道预留接缝。设计提案，未实现
tags:
  - design
  - orchestration
  - pipeline
  - x-basalt
timestamp: 2026-07-28T03:30:47Z
sha256: 3658462a4df64514339913705b54bc34a3bac07e75ff2d45278a8d701aef9837
---
# 内置 pipeline 改造：统一算子模型

> 上游设计：[`change-orchestration.md`](change-orchestration.md)（五段流水线、动作清单、算子集）。本文是其**执行层模型的升级提案**，不替代它——脊梁（§1）、风险清单（§9）、YAGNI 边界（§11）全部沿用。
> 下游设计：[`shell-pipe-portability.md`](shell-pipe-portability.md)（多平台 shell 管道），依赖本文的算子模型，排在本文之后。

## 0. 状态：设计提案，未实现

**代码一行不动。** 本文只冻结模型与切口，实现另行立计划（`docs/plans/`）。

现有 `x-basalt run --pipe actions=…` 的行为、契约、测试**全部保持不变**——本提案是向后兼容的扩容，不是重写。

## 1. 要解决的问题

### 1.1 证据：能力有 9 个模块，管道只接得进 3 个

仓库里每个能力模块都已经有干净的程序化接口：

| 模块 | 程序化入口 | 进管道了吗 |
| --- | --- | --- |
| `src/indexer` | `VaultIndexer.update/removeByKey/scan` | ✅ `index` 动作 |
| `src/meta` | `editMeta`/`setMeta`/`unsetMeta`/`renameMeta`/`normalizeDoc`/`applyProfile` | ✅ 5 个动作 |
| `src/parser` | `VaultParser.parse` | ✅ `parse` 动作 |
| `src/query` | `DataviewEngine.query` | ⚠️ 仅作路由谓词（`where=`），不是算子 |
| `src/query` | `DataviewEngine.search` | ❌ |
| `src/base` | `BaseEngine.query` | ❌ |
| `src/links` | `runLinksCheck` / `runLinksSuggest` | ❌ |
| `src/lint` | `runLint` | ❌ |

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

## 2. 设计脊梁（在 `change-orchestration.md` §1 之上新增两条）

1. **算子统一**：所有能力用同一个签名暴露，注册进同一张表；新增能力只写一个算子，CLI 与管道同时可用。
2. **调度可换**：调度（并发/堆积/去重/防回环/dry-run 闸）与算子彻底分离。将来把执行器换成 shell 管道或第三方 runner 时，**算子一个都不用改**。

第 2 条就是本次改造的真正目的——它是[多平台 shell 管道](shell-pipe-portability.md)的接缝。

## 3. 统一算子模型

### 3.1 流动单位：Row（文件事件降为特例）

```ts
interface Row {
  /** 索引主键形态的路径（现有 ChangeEvent.path 语义原样保留）。 */
  path: string;
  /** 文件事件类型；仅 scan/watch 源产出的行有，其余算子产出的行没有。 */
  event?: EventType;
  /** 上游算子的产物：DQL/base 的列、search 的评分、lint/links 的诊断。 */
  fields: Record<string, unknown>;
}
```

关键取舍：**`path` 保持一等字段，不塞进 `fields`。** 因为现有 `dedup`（L2 路径 LWW 折叠）、`accumulate`（debounce）、`route`（glob/DQL 路由）、防回环自产生集**全部按 `path` 工作**——`path` 留在顶层，这四套机制一行都不用改。这是本设计最重要的兼容性锚点。

`ChangeEvent` 成为 `Row` 的一个投影（`event` 有值的那种）。现有 7 个动作迁移时只是换个入参形状，语义不变。

### 3.2 算子签名：一个签名吃下四种角色

```ts
interface Op {
  name: string;
  /** 是否写 `.md`；true 才受 dry-run 安全闸约束（沿用现有 Action.write 语义）。 */
  write: boolean;
  run(rows: Row[], ctx: OpContext): Promise<Row[]>;
}
```

批进批出，一个签名覆盖全部角色，**不需要 source/transform/action/sink 四种类型**：

| 角色 | 形态 | 例子 |
| --- | --- | --- |
| 源 | `0 → N`（忽略入参） | `scan` `query` `base` `search` |
| 转换 | `N → M` | `filter` `limit` `dedup` `map` |
| 动作 | `N → N`（透传，副作用在外） | `index` `meta.set` `normalize` |
| 汇 | `N → 0`（产出报告） | `emit` |

§1.2 第 3 条的"分类摩擦"就此消失：`base` 不用回答自己是源还是动作——**忽略入参就是源，消费入参就是转换**，同一个算子两种用法。

### 3.3 单一注册表

```
src/orchestrator/registry.ts
  register(name, factory)   // 带参算子沿用现有工厂模式（apply <profile> / set k=v）
  resolve(spec) → Op
```

CLI 子命令与管道步骤**从同一张表取算子**。现在 `cli.ts` 和 `orchestrator/actions.ts` 各写一遍包装的重复就此收敛；新增能力写一个算子，两边同时可用。

### 3.4 调度层 / 算子层分离（可替换接缝）

```
调度层（不动算子就能整体替换）
  ├ 堆积 accumulate   debounce(wait/maxWait)
  ├ 去重 dedup        L2 路径 LWW + L3 事件类型折叠
  ├ 路由 route        glob / DQL 谓词 → 哪些行跑哪些算子
  ├ 并发 run          有界并发 / onBusy / onError / 超时
  └ 安全闸            dry-run（按 Op.write）、自产生写防回环
────────────────────────── 接缝：Row[] 进、Row[] 出
算子层（纯粹、可单测、与调度无关）
  └ 全部 Op
```

**将来接 shell 管道时，只是在调度层换一个"从 stdin 取 Row、往 stdout 吐 Row"的实现**，算子层零改动。这是本次改造要买的东西。

## 4. 算子清单

全部**包装现有函数**，不造新的 vault 能力——沿用 `change-orchestration.md` §7 的纪律（动作只包装，不绕过 indexer/meta 的写边界）。

| 算子 | 角色 | 包装 | 现状 |
| --- | --- | --- | --- |
| `scan` | 源 | `VaultIndexer` FS↔DB diff | 已有 |
| `watch` | 源 | chokidar | 已有 |
| `query <dql>` | 源/转换 | `DataviewEngine.query` | 提升为算子 |
| `search <text>` | 源 | `DataviewEngine.search` | 新接 |
| `base <file>#<view>` | 源/转换 | `BaseEngine.query` | 新接 |
| `links.check` / `links.suggest` | 转换 | `runLinksCheck/Suggest` | 新接 |
| `lint` | 转换 | `runLint` | 新接 |
| `parse` | 动作 | `VaultParser` | 已有 |
| `index` | 动作 | `VaultIndexer` | 已有 |
| `meta.set/unset/rename/normalize/apply` | 动作 | `src/meta` | 已有 |
| `filter <expr>` `map` `limit <n>` `dedup <key>` | 转换 | 纯函数 | 新增 |
| `emit [json\|yaml]` | 汇 | `src/format.ts` | 新接 |

## 5. 数据传递

算子之间靠 `Row.fields` 传数据，写动作用 `{{…}}` 引用：

```
base tasks.base#overdue → meta.set status={{row.next_status}}
```

`base` 的 formula 计算列直接喂给写动作——**现在完全做不到**（计算列在进管道时就被丢弃了）。

插值只读 `Row`，**不引入表达式求值器**（守 §11 的"不做任意脚本编排器"）；需要计算就用 `map` 算子或在 `.base` 的 formula 里算好。

## 6. 与现有机制的关系

| 机制 | 影响 |
| --- | --- |
| L2 路径 LWW 折叠 / L3 事件类型折叠 | **不变**（按 `path`，见 §3.1） |
| debounce(wait/maxWait) | **不变** |
| DQL 路由 / glob 路由 | **不变** |
| 自产生写防回环（`onWrite` 自产生集） | **不变**——`Op.write` 沿用 `Action.write` 语义 |
| dry-run 安全闸 | **不变**——仍按 `write` 标志拦截 |
| `RunReport` | 扩容：增加每步的行数流水，旧字段保留 |

## 7. 兼容与迁移

- `x-basalt run --pipe actions=normalize,index --apply` **原样可用**，行为不变。
- 迁移正确性的判据就是现有测试：880 用例全绿 = 语义没漂。
- `ChangeEvent` 类型保留为 `Row` 的窄化别名，不做破坏性删除。

## 8. 不做（守 `change-orchestration.md` §11）

- **不开裸 shell 算子**——算子全部是内建强类型的。本提案不是"任意脚本编排器"。
- 不做 DAG（仍是线性算子链）、不做补偿回滚、不做重试退避。
- 不做表达式求值器（§5）。
- 不引入 AI（编排器纯离线确定性）。
- 本文**不设计 stdin / shell 管道**——那是[下游文档](shell-pipe-portability.md)的事，且必须排在本文之后。

## 9. 分阶段切口

| 片 | 内容 | 独立验收 |
| --- | --- | --- |
| 一 | `Row` + `Op` 签名 + `registry`；现有 7 动作迁到新签名 | 880 测试全绿（行为不变即迁移正确） |
| 二 | 接只读算子：`query` / `search` / `base` / `links.*` / `lint` | 每个算子既能当源又能当中段，各有用例 |
| 三 | 纯函数算子 `filter/map/limit/dedup` + `{{row.x}}` 插值 | `base → meta.set` 端到端跑通计算列传递 |
| 四 | 配置面：`--pipe` 支持声明式步骤列表，保留现有 kv 兼容 | 新旧两种写法产出同一份 `RunReport` |

片一是纯重构（零功能变化），是后三片的前置；片二、片三、片四各自可停。

## 10. Decision Log

| # | 决策 | 理由 | 否决的替代方案 |
| --- | --- | --- | --- |
| D1 | 流动单位换成 `Row`，但 `path` 留一等字段 | 让 dedup/route/防回环 四套机制零改动 | 把 `path` 塞进 `fields` 做纯数据集模型——会连带重写四套已验证的机制，收益不抵风险 |
| D2 | 单一算子签名（批进批出），不分四种类型 | 消除"`base` 算什么角色"的分类摩擦（§1.2-3） | source/transform/action/sink 四接口——分类边界会一直有争议 |
| D3 | 调度与算子分离 | 将来换执行器（shell 管道/第三方 runner）只换调度层 | 调度逻辑散在算子里——会把算子焊死在当前执行模型上 |
| D4 | 插值只读不求值 | 守 §11「不做任意脚本编排器」 | 内嵌表达式求值器——身份漂移，且与 DQL/base 的表达式能力重复 |
| D5 | 向后兼容，不做破坏性重写 | 现有 `--pipe` 已在 dogfood 使用 | 直接换新语法——会打断正在用的工作流 |

## 11. 验收口径

1. 片一完成后现有 880 测试全绿，且 `--pipe actions=` 旧写法行为逐字节不变。
2. 每个新接算子有「作源」「作中段」两种用法的独立用例。
3. `base` 的 formula 计算列能经 `{{row.x}}` 抵达写动作，有端到端用例。
4. 调度层可替换性有实证：至少存在一个不经 debounce/watch 的最小执行器跑通同一条算子链。
5. dry-run 闸与防回环在新模型下仍受现有用例保护（不新增豁免）。

## 12. 未决问题

- `filter <expr>` 的表达式用什么？复用 DQL 的 WHERE 子集，还是只做字段比较？倾向后者（守 D4），但需要在片三前定。
- `links.check` / `lint` 产出的是诊断而非行，映射成 `Row` 时诊断放 `fields` 的哪个键，需要统一命名。
- 多根 vault 下 `base`/`search` 产出的行 `path` 归一到哪个命名空间——沿用 `resolveVaultLayout`，但需在片二确认没有与索引主键冲突。

---
type: design
title: 内置 pipeline 改造：统一算子模型
description: 已落地的统一 pipeline 算子模型：Row 流动单位、单一 Op 签名与调度分离；覆盖读算子、纯函数算子、steps 配置面及剩余边界
tags:
  - design
  - orchestration
  - pipeline
  - x-basalt
timestamp: 2026-08-06T23:56:25Z
sha256: c5bd7935a6f964a69560d03e2bf690b8839b3ba2651a72801f7c963c7dcad3f2
---
# 内置 pipeline 改造：统一算子模型

> 上游设计：[`change-orchestration.md`](change-orchestration.md)（五段流水线、动作清单、算子集）。本文记录其**已落地的执行层模型**，不替代它——脊梁（§1）、风险清单（§9）、YAGNI 边界（§11）全部沿用。
> 下游设计：[`shell-pipe-portability.md`](shell-pipe-portability.md)（多平台 shell 管道），依赖本文的算子模型，排在本文之后。

## 0. 状态：片一至片四已落地

本文描述当前实现，而非待实施提案。统一模型已由 `src/orchestrator/types.ts`（`Row` / `Op` / `OpOutcome`）、`run.ts`（`runOpPipeline`）、`registry.ts`、`ops.ts` 与 `ops-pure.ts` 共同承载。

| 片 | 已落地范围 | 主要验证 |
| --- | --- | --- |
| 一 | `Row`、`Op` / `OpOutcome`、统一注册表、批算子调度 | `tests/orchestrator-oppipeline.test.ts` |
| 二 | `query` / `search` / `base` / `links.*` / `lint` 读算子 | `tests/orchestrator-ops-query.test.ts`、`tests/orchestrator-ops-base.test.ts`、`tests/orchestrator-ops-diagnostics.test.ts` |
| 三 | `filter` / `map` / `limit` / `dedup` 与 `{{row.x}}` 插值 | `tests/orchestrator-ops-pure.test.ts`、`tests/orchestrator-oppipeline.test.ts` |
| 四 | 配置 `steps` 与可重复 `--pipe step=`，保留 `actions` 兼容面 | `tests/orchestrator-params.test.ts`、`tests/orchestrator-cli.test.ts` |

现有 `x-basalt run --pipe actions=…` 的对外契约保持兼容；`steps` 是面向含逗号算子参数的增量入口。`concurrency` 与 `onError` 的内部语义已按 §6 实现，并由 §9.1 的显式回归判据覆盖。

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
  /**
   * 逐行独立：该算子对每行的处理互不影响，调度层可任意切批并发（§3.2.1）。
   * false（默认，保守）= 必须看到完整批次，整批一次过（dedup/limit/emit 这类）。
   */
  rowwise: boolean;
  run(rows: Row[], ctx: OpContext): Promise<OpOutcome>;
}

/**
 * 算子产出：**行、失败、变更三者分开返回**。
 * - `failed`：调度层据此把失败行从后续算子的输入中剔除（onError=continue 的新语义，§6）——
 *   光靠 `Row[]` 表达不了「哪些行失败了」，而这正是现有「跳过该文件剩余动作」的等价物。
 * - `changed` / `skipped`：见 D9。旧模型这两个信号来自 `ActionResult.changed/skipped`，
 *   `RunReport` 的 `changed`/`skipped`/`changedPaths`/`byAction` 全部由它们聚合而来；
 *   新模型若只返回 `rows` + `failed`，这些字段会静默归零——**而 `changedPaths` 正是写后刷索引
 *   （`d04d47d`）赖以工作的输入**，归零等于把那个刚修好的缺陷再打回去。
 */
interface OpOutcome {
  rows: Row[];
  failed: OpFailure[];
  /** 本算子真正改动了的行 path（写 DB 或写 .md）。只读算子恒为空数组。 */
  changed: string[];
  /** 本算子跳过的行 path（dry-run 的写算子、或无需处理）。 */
  skipped: string[];
}

interface OpFailure {
  /** 失败行的 path（索引主键形态）。 */
  path: string;
  /** 产生失败的算子名。 */
  op: string;
  error: string;
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

> **调度层不得对空批短路**（D11，2026-07-30 片二实测撞出来）：正因为「源」的定义是
> `0 → N`、**忽略入参**，执行器**必须在 `rows` 为空时照样调用算子**。若为省开销加一句
> 「入参空则跳过本算子」，`0 → N` 这个形态就永远不可能发生——**源角色被静默取消**，
> 且表现为「0 行、退出码 0、无任何诊断」，比报错难查得多。
> 同理，算子依赖的 `ctx` 资源（如 `ctx.engine`）也**不能按「有行才准备」的条件供给**。
> 透传型算子拿到空数组自然返回空数组，代价是 O(1)，不值得为它牺牲整个源角色。

### 3.2.1 并发落在哪一层（`rowwise` 的由来）

现有执行模型是**外层并发文件、内层串行动作**（`run.ts` 的 worker 池按 `concurrency` 领事件，
每个文件内部串行跑动作链）。换成批算子后两层循环对调——外层串行跑算子、内层每个算子吃整批——
`concurrency` 就失去了原来的落点。三个选项：

| 方案 | 结论 |
| --- | --- |
| 每个算子自己实现并发 | ❌ 同一段 worker 池逻辑重复 8 次，且各算子并发口径必然漂 |
| 取消并发，全部串行 | ❌ 性能倒退，`index`/`meta.*` 这类逐文件 IO 密集的算子最吃亏 |
| **调度层按 `rowwise` 切批并发** | ✅ 采纳 |

采纳方案的规则很短：

- `rowwise: true` → 调度层用 worker 池**逐行领取**、并发调用该算子（每次 `op.run([row], ctx)`），
  **复用现有 worker 池那段代码**（`run.ts:101-112`），并发语义与今天逐字等价。
  现有 7 个动作（`index`/`parse`/`normalize`/`apply`/`set`/`unset`/`rename`）全部属此类。
- `rowwise: false` → 整批一次调用，不拆。`dedup`/`limit`/`emit` 以及任何需要看全批才能算的汇总类算子属此类。

> **为什么是「逐行领取」而不是「切成 N 片」**（2026-07-30 钉死，原文此处措辞含糊，实现时撞出来）：
> 切片方案与 §9.1-B 的判据「同时在跑的**行**数 ≤ `concurrency`」直接矛盾——真切片时同时在跑的
> 行数约等于全批，能限住的只是**片**数。两者只能二选一，选逐行领取，理由：
> ①`rowwise` 按定义就是逐行独立，批量优化空间本来就小，而真正需要批量优化的算子
> （`query`/`base`/`search` 一次查库）恰恰都是 `rowwise: false`、走整批分支，收不到切片的好处；
> ②逐行领取才是「与今天逐字等价」，而旧语义正是本片一唯一的兼容锚点。
> 代价是 N 行 = N 次调用，可接受；若将来出现「既逐行独立又值得批量优化」的算子，再引入
> 第三档（如 `chunkSize`），不在片一预留。

**默认 `false`（保守）**：新算子作者不声明就是整批一次，最多损失并发；反过来默认 `true`
则会让「其实依赖全批」的算子被静默切开，产出错误结果且难以复现。

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

已落地算子均**包装现有函数**，不造新的 vault 能力——沿用 `change-orchestration.md` §7 的纪律（动作只包装，不绕过 indexer/meta 的写边界）。`scan` / `watch` 仍是编排器的事件源接线；`emit` 尚未进入当前实现。

| 算子 | 角色 | 包装 | 现状 |
| --- | --- | --- | --- |
| `scan` | 源接线 | `VaultIndexer` FS↔DB diff | 已有；投影为初始 `Row[]` |
| `watch` | 源接线 | chokidar | 已有；经 debounce / dedup 后投影为 `Row[]` |
| `query <dql>` | 源/转换 | `DataviewEngine.query` | ✅ 已落地 |
| `search <text>` | 源/转换 | `DataviewEngine.search` | ✅ 已落地 |
| `base <file>#<view>` | 源/转换 | `BaseEngine.query` | ✅ 已落地 |
| `links.check` / `links.suggest` | 源/转换 | `runLinksCheck/Suggest` | ✅ 已落地 |
| `lint` | 源/转换 | `runLint` | ✅ 已落地 |
| `parse` | 动作 | `VaultParser` | ✅ 已包装为 Op |
| `index` | 动作 | `VaultIndexer` | ✅ 已包装为 Op |
| `meta.set/unset/rename/normalize/apply` | 动作 | `src/meta` | ✅ 已包装为 Op |
| `filter <expr>` `map` `limit <n>` `dedup <key>` | 转换 | 纯函数 | ✅ 已落地 |
| `emit [json\|yaml]` | 汇 | `src/format.ts` | 未实现；CLI 仍负责最终输出 |

## 5. 数据传递

算子之间靠 `Row.fields` 传数据，写动作用 `{{…}}` 引用：

```
base tasks.base#overdue → meta.set status={{row.next_status}}
```

`base` 的 formula 计算列可经 `Row.fields` 直接喂给写动作；`src/orchestrator/ops.ts` 的 `{{row.x}}` 插值已把这条链路落地。

插值只读 `Row`，**不引入表达式求值器**（守 §11 的"不做任意脚本编排器"）；需要计算就用 `map` 算子或在 `.base` 的 formula 里算好。

## 6. 与现有机制的关系

| 机制 | 影响 |
| --- | --- |
| L2 路径 LWW 折叠 / L3 事件类型折叠 | **不变**（按 `path`，见 §3.1） |
| debounce(wait/maxWait) | **不变** |
| DQL 路由 / glob 路由 | **不变** |
| 自产生写防回环（`onWrite` 自产生集） | **不变**——`Op.write` 沿用 `Action.write` 语义 |
| dry-run 安全闸 | **不变**——仍按 `write` 标志拦截 |
| 写后刷索引（`refreshIndex` / `reindexed`） | **不变**——仍由调度层在算子链跑完后按 `changedPaths` 刷（`d04d47d` 落地的 §6.4 另一半） |
| `concurrency` 有界并发 | **语义重定义**（§3.2.1）：从「文件间并发」变为「`rowwise` 算子的批内切片并发」。对现有 7 个动作（全 `rowwise`）逐字等价，但不再是「跨动作」的并发 |
| `onError` continue/stop | **语义重定义**（见下）：从「跳过该文件剩余**动作**」变为「失败行从后续**算子**输入中剔除」 |
| `RunReport` | 扩容：增加每步的行数流水（`steps[]`），`d04d47d` 订正的按文件口径与 `byAction`/`changedPaths`/`reindexed` 全部保留不动 |

**`onError` 的等价映射**——两种模型下含义逐条对应，不是新语义：

| | 现模型（逐文件 × 动作链） | 新模型（算子链 × 批） |
| --- | --- | --- |
| `continue` | 某动作对文件 F 失败 → 跳过 F 的剩余动作，其余文件照跑 | 某算子对行 F 失败 → F 进 `failed`、从后续算子输入中剔除，其余行照跑 |
| `stop` | 立即停止接新文件、不处理后续 | 当前算子返回后即停，不再进入下一个算子 |

差别只在一处且是**改进**：`stop` 在新模型下的中止边界是「算子之间」而非「文件之间」，
批内已经开跑的行会跑完当前算子——语义更确定，不再依赖 worker 池的领取时序。
这一条要在片一显式立用例，不能靠旧测试推断。

## 7. 兼容与迁移

- `x-basalt run --pipe actions=normalize,index --apply` **原样可用**，行为不变。
- 迁移验收不以某次总用例数作判据，而以 §9.1 的对外契约、重定义语义与安全性断言为准。
- `ChangeEvent` 类型保留为 `Row` 的窄化投影，不做破坏性删除。

## 8. 不做（守 `change-orchestration.md` §11）

- **不开裸 shell 算子**——算子全部是内建强类型的。本提案不是"任意脚本编排器"。
- 不做 DAG（仍是线性算子链）、不做补偿回滚、不做重试退避。
- 不做表达式求值器（§5）。
- 不引入 AI（编排器纯离线确定性）。
- 本文**不设计 stdin / shell 管道**——那是[下游文档](shell-pipe-portability.md)的事，且必须排在本文之后。

## 9. 分阶段切口

| 片 | 内容 | 独立验收 | 状态 |
| --- | --- | --- | --- |
| 一 | `Row` + `Op`/`OpOutcome` 签名 + `registry`；现有动作迁到新签名 | 见 §9.1（**不是**「测试全绿」） | ✅ 已落地 |
| 二 | 接只读算子：`query` / `search` / `base` / `links.*` / `lint` | 每个算子既能当源又能当中段，各有用例 | ✅ 已落地 |
| 三 | 纯函数算子 `filter/map/limit/dedup` + `{{row.x}}` 插值 | `base → meta.set` 端到端跑通计算列传递 | ✅ 已落地 |
| 四 | 配置面：`--pipe` 支持声明式步骤列表，保留现有 kv 兼容 | 新旧两种写法产出同一份 `RunReport` | ✅ 已落地 |

四个切口已按顺序实施并分别建立回归覆盖。片一虽无直接用户可见收益，却为片二至片四提供了统一的行模型、算子契约与调度接缝；分片提交和独立验收避免了模型错误在后续能力接入时被放大。

### 9.1 片一的验收记录（替换「889 测试全绿」）

原判据「现有测试全绿 = 行为不变 = 迁移正确」**不成立**：§6 已明确 `concurrency` 与 `onError`
两项语义已经重定义，相关用例已按新边界重写。验收因此拆为「对外契约不变（可机械比对）」+「内部语义显式重定义并重测」两半：

**A. 对外契约逐字不变**（不需要人判断，能机械比对）

1. `x-basalt run --pipe actions=…` 各既有写法的 stdout **逐字节相同**（快照对拍：迁移前先把
   当前输出录成 fixture，迁移后重放）。
2. `RunReport` 的既有字段（`total`/`changed`/`skipped`/`failed`/`dryRun`/`changedPaths`/
   `byAction`/`reindexed`）在同一输入下**逐字段相同**；新增的 `steps[]` 只增不改。
3. `ChangeEvent` 作为 `Row` 的窄化别名仍可用，既有类型导出不删（§7）。

**B. 重定义的语义显式立新用例**（旧用例改写，不是删除）

4. 并发：`rowwise: true` 的算子在 `concurrency=N` 下，同时在跑的行数 ≤ N（替代原「同时在跑的
   文件数 ≤ N」）；`rowwise: false` 的算子无论 `concurrency` 为何都只被调用一次。
5. `onError=continue`：某算子对部分行失败 → 这些行进 `failed` 且**不出现在后续算子的入参里**，
   其余行跑完剩余算子（替代原「跳过该文件剩余动作」）。
6. `onError=stop`：当前算子返回后即停，**不进入下一个算子**；批内已开跑的行跑完当前算子。

**C. 安全性不得借重构豁免**

7. dry-run 闸与自产生写防回环在新模型下仍受现有用例保护，**不新增任何豁免路径**（§11.5 沿用）。
8. 写后刷索引（`refreshIndex`/`reindexed`）行为不变——它在调度层按 `changedPaths` 工作，
   与算子模型正交，重构不得顺手改动它的口径（那是 `d04d47d` 刚订正过的）。

## 10. Decision Log

| # | 决策 | 理由 | 否决的替代方案 |
| --- | --- | --- | --- |
| D1 | 流动单位换成 `Row`，但 `path` 留一等字段 | 让 dedup/route/防回环 四套机制零改动 | 把 `path` 塞进 `fields` 做纯数据集模型——会连带重写四套已验证的机制，收益不抵风险 |
| D2 | 单一算子签名（批进批出），不分四种类型 | 消除"`base` 算什么角色"的分类摩擦（§1.2-3） | source/transform/action/sink 四接口——分类边界会一直有争议 |
| D3 | 调度与算子分离 | 将来换执行器（shell 管道/第三方 runner）只换调度层 | 调度逻辑散在算子里——会把算子焊死在当前执行模型上 |
| D4 | 插值只读不求值 | 守 §11「不做任意脚本编排器」 | 内嵌表达式求值器——身份漂移，且与 DQL/base 的表达式能力重复 |
| D5 | 向后兼容，不做破坏性重写 | 现有 `--pipe` 已在 dogfood 使用 | 直接换新语法——会打断正在用的工作流 |
| D6 | 并发由调度层按 `Op.rowwise` 切批实现，默认 `false` | 两层循环对调后 `concurrency` 失去落点（§3.2.1）；`rowwise` 让现有 7 动作的并发逐字等价，同时保护「必须看全批」的算子 | ①每个算子自己实现并发——同一段 worker 池重复 8 次且口径会漂；②取消并发——IO 密集算子性能倒退；③默认 `true`——依赖全批的算子被静默切开，错得难复现 |
| D7 | `Op.run` 返回 `{rows, failed}` 而非 `Row[]` | `onError=continue` 要求调度层知道**哪些行**失败以便从后续算子剔除，`Row[]` 表达不了 | ①失败编码进 `Row.fields`——污染数据面，且与 §12 诊断键名问题纠缠；②抛异常——只能表达整批失败，等于把 `continue` 降级成 `stop` |
| D8 | 片一判据换成「对外契约机械比对 + 重定义语义新立用例」 | 原判据「测试全绿=行为不变」自相矛盾：D6/D7 已决定要改那批测试 | 保留原判据——会导致要么不敢改测试（模型被旧执行语义焊死），要么改了测试却失去唯一判据 |
| D9 | `OpOutcome` 补 `changed[]` / `skipped[]` 两个 path 列表 | D7 只定了 `rows`+`failed`，漏了「哪些行真的被改了」——而 `RunReport` 的 `changed`/`skipped`/`changedPaths`/`byAction` 全靠这个信号聚合，缺了就静默归零，连带打回 `d04d47d` 的写后刷索引（它以 `changedPaths` 为输入）。S4 实现时撞出来 | ①从 `rows` 反推——无从区分「跑过没改」与「改了」；②在 `Row.fields` 里约定魔法键——污染数据面且与 §12 的诊断键名冲突；③让 engine 自己 diff 磁盘——把已知信息扔掉再花 IO 猜回来 |
| D10 | `rowwise` 并发是「逐行领取」而非「切成 N 片」 | §3.2.1 原措辞「切成片」与 §9.1-B 判据「同时在跑的**行**数 ≤ concurrency」互斥，且真正值得批量优化的算子都是 `rowwise: false` 走整批分支、收不到切片好处；逐行才是「与今天逐字等价」 | 切成 N 片——判据要改写成限制片数，失去与旧语义的等价锚点，而这是片一唯一的兼容判据 |
| D11 | 执行器**不得**对空批短路；`ctx` 资源也不得按「有行才准备」条件供给 | 「源」的定义就是 `0 → N` 忽略入参，空批跳过等于静默取消源角色，且表现为「0 行 / 退出码 0 / 无诊断」。片一未暴露是因为那 7 个动作全是 `N → N` 透传型；片二接 `query` 作源时当场撞上 | ①保留短路 + 给 `Op` 加 `source: boolean` 标志——违反 D2（不分算子类型），且分类边界的争议会回来；②保留短路 + 例外名单——每加一个源算子都要改执行器，接缝失效 |
| D12 | 片四配置面：配置段 `steps: string[]`（一元素一算子 spec，**不切分**）+ CLI 可重复 `--pipe step=<spec>`（按出现顺序成链）；存在时优先于 `actions`，`actions` 切分行为逐字不变。细化：命令行显式给出链（`step` 或 `actions` 任一形态）时**整体覆盖基底链**，基底的另一形态不沿用——否则用户显式写的 `actions=` 会被基底 `steps` 静默吞掉。**`actions` 不下线**：它是简单链的紧凑写法（dogfood 在用），与 `steps` 长期并存，执行层同一行消费；若未来退役须证明「存量可无损改写 + 双口径持续误用」并走 breaking 流程 | 片二/三算子参数天然含逗号（DQL、`contains "a,b"`、`.base#view`），逗号分隔面把单条 spec 劈碎、后半段被当算子名报错——能力已落地但 CLI 表达不出来，这是片四的真实动机 | ①给 `splitTopLevel` 加引号感知——shell 已先剥过一层引号，CLI 拿到的串里引号语义不可靠，且改动 `actions` 既有切分行为违反 D5；②算子参数禁逗号——削已落地的能力；③退役 `actions` 只留 `steps`——破坏 dogfood 存量（违反 D5），且简单链失去紧凑写法 |
| D13 | `links.check` / `lint` 的诊断统一挂 `Row.fields.diagnostics`，类型复用 `src/lint/report.ts` 的 `BasaltDiagnostic[]`，不另造形状；源模式一行一文件、转换模式按行路径合并 | §12 片二必决项：写第一个诊断类算子前必须拍死。实现已按此落地（`src/orchestrator/ops.ts` `diagnosticsToRows`，lint/links.check 共用），本文回写从「倾向」改「已定」 | ①键名用单数 `diagnostic`——数组语义被键名否定；②再包一层 `{ items }`——与既有诊断结构两套形状；③塞 `Row.failed`——那是执行失败语义，会污染 `onError=continue` 的行剔除 |
| D14 | 读源算子（`query`/`search`/`base`）行 `path` = 索引主键（`layout.toKey`：单根 POSIX 相对，多根 `<根目录名>/<相对>`），与写侧 `toAbs` 互逆 | §12 片二必决项：多根下不归一，读侧行 path 与写动作 / 索引键对不上，路由与防回环会静默失配。`query`/`search` 本就透传 DB 键、`base` 的 `file.path` 也来自索引键（`src/base/source.ts`），零换算天然一致；显式断言 Op-S3 / Op-B9，不再依赖「片二跑通」的巧合 | ①读侧自行 `relative(root, abs)` 重算——单根与旧键一致、多根丢命名空间前缀，两套键并存；②行 path 返回绝对路径——泄露物理位置且与索引键不可比；③给 `Row` 加第二套键字段——污染行模型，路由 / 防回环 / 写动作全部要跟着改 |

## 11. 验收记录

1. 片一按 **§9.1 的 A/B/C 八条**完成验收（原「889 测试全绿」已作废，理由见 D8）。
2. `query` / `search` / `base` / `links.*` / `lint` 均有作源或作中段的独立测试，适用时两种角色均覆盖。
3. `base` 的 formula 计算列可经 `{{row.x}}` 抵达写动作，并有端到端测试。
4. `runOpPipeline` 作为不经 debounce/watch 的最小执行器，已实证运行同一条算子链。
5. `actions` 与 `steps` 的兼容、含逗号参数的 `steps` 行为以及 `RunReport` 字段对拍均有回归覆盖（D12）。
6. dry-run 闸、自产生写防回环与写后刷索引仍由既有及新增测试保护，未增加豁免路径。

## 12. 当前边界与后续项

- `filter <expr>` 已按字段比较实现；不复用 DQL WHERE 子集，也不引入新的表达式求值器（D4）。
- `emit` 汇算子尚未实现；当前由 CLI 负责最终输出，避免在本轮额外扩展数据面。
- `onBusy=restart` / `ignore` 仍未实现：需要为执行器接入 `AbortSignal` 协作取消，见根 `TODO.md` 的变更编排器余项。
- 多平台 stdin/stdout shell 管道仍由下游 [`shell-pipe-portability.md`](shell-pipe-portability.md) 单独定义；本模型保留其调度接缝，但不把裸 shell 算子并入当前范围。

---
type: plan
status: done
title: 管道写后索引新鲜度 + 报告口径订正
description: 修复 run 管道写动作落盘后不刷索引导致「成功回执与验证通道互相矛盾」，附 DQL 缺查询头定向引导、RunReport 改按文件计数，以及列举类回答凭空补齐的提示词纪律
tags:
  - plan
  - orchestrator
  - query
  - chat
timestamp: 2026-08-06T23:59:45Z
sha256: 7bc12ad24330b372c3a31db1e365810c6ec74960ff8e1ead698139277d61b7b4
---
# 管道写后索引新鲜度 + 报告口径订正

## 背景（dogfood 实测坐实）

用自然语言驱动一次批量补字段（`pipeline_run actions=["set type=note"] where=...`），
实测轨迹如下：

```
pipeline_run {actions:["set type=note"], where:'FROM "inbox" WHERE type = null'}
  → 报错：Expecting: one of these possible Token sequences: [List][Table][Task] but found 'FROM'
pipeline_run {actions:["set type=note"], where:'LIST FROM "inbox" WHERE type = null'}
  → {total:28, changed:28, skipped:0, failed:[]}      ← 明确成功
query 'LIST FROM "inbox" WHERE type = null'
  → total: 28                                          ← 却说一篇没改
scan → {modified: 28}                                  ← 盘上确实改了
pipeline_run {actions:["index"]} → 28
query → total: 0                                       ← 现在才对
```

**核心问题**：`run` 的写动作落盘后**不刷新索引**，于是管道自己报 `changed:28`，
而验证它的正规手段（`query` 读索引）说「一篇没改」。**工具的成功回执与验证通道互相矛盾**——
任何调用方（人或 AI）都会不信、去重验，白白多走 `query → scan → run(index) → query` 四步。

引擎里其实**已经有**索引新鲜度纪律，但只做了一半：`runBatch` 在 `where` 过滤**之前**
会先把候选落库（§6.4，避免按陈旧索引选错），**写完之后却没有对称地刷回去**。

## 目标

1. **F1（主因）**：写动作落盘后，自动把改动过的文件刷进索引 —— 补上 §6.4 纪律缺的另一半。
2. **F2**：`where` 只接受完整 DQL（`LIST/TABLE/TASK` 开头），裸 `FROM ...` 报的是 chevrotain
   原生 token 期望列表，不指方向。改为定向引导（同 `LIKE → contains` 的既有做法）。
3. **F3**：`RunReport.changed/skipped` 数的是**动作结果数**而非文件数，与 `total`（文件数）
   不同单位 —— `set,index` 两动作跑 28 个文件会报 `total:28 / changed:56`，`changed > total` 是荒谬的。
4. **F4**：`skills-data/core.json5` 与 `docs/use/` 补「写后索引即过期 / 现已自动刷新」的说明。

## 范围与影响

| 文件 | 改动 |
|---|---|
| `src/query/parser.ts` | F2 定向报错 |
| `src/orchestrator/types.ts` | `RunReport` 加 `changedPaths`/`byAction`/`reindexed`；`PipelineConfig` 加 `refreshIndex` |
| `src/orchestrator/run.ts` | F3 按文件聚合 + 产出 `changedPaths`/`byAction` |
| `src/orchestrator/engine.ts` | F1 写后刷索引 |
| `src/chat/tools.ts` | `pipeline_run` 回传新字段 + 描述说明 |
| `src/cli.ts` | `--pipe refresh-index=false` 开关 |
| `skills-data/core.json5`、`docs/use/` | F4 |

**契约变更（需说明）**：`RunReport.changed/skipped` 语义由「动作结果数」改为「文件数」，
与 `total` 同单位。原口径的信息不丢——挪到新增的 `byAction`（分动作改动计数）。
现有测试断言的都是单动作场景（两种口径同值），不受影响。

**默认值取舍**：F1 **默认开启**（含 CLI `--apply`），提供 `refresh-index=false` opt-out。
理由：留着不刷 = 落盘后索引静默与磁盘不一致，是「静默错」；重复刷索引只是多花一点时间，是「贵一点但对」。
既有「先批量写、最后统一 index」的用法不会因此出错（索引更新幂等），只是那次统一 index 变成空跑。

## 验收（已全部达成，2026-07-30）

- ✅ `run --apply --pipe actions="set type=note" --pipe where=…` 之后**立刻** `query` 即为新值：
  `✓ run run：28 文件 / 28 改动 / 0 跳过 / 0 失败 / 28 已刷索引` → `query` 返回 0（修前返回 28）。
- ✅ 裸 `FROM …` 作 `where`：`✗ DQL 语法错误 (位置 0): DQL 语句必须以 LIST / TABLE / TASK 开头，
  不能直接从 FROM 起头。在前面补一个查询头即可，例：LIST FROM "inbox" WHERE type = null`
- ✅ `changed` 按文件计（`changed <= total`），`byAction` 保留分动作明细。
- ✅ 四门全绿：lint / typecheck / **test 911 passed 0 failed** / build；`format:check` 亦绿。
- ✅ 新增 13 条用例：`S2.24 ×5`（缺查询头定向引导，含「非句首不误伤」负例）、
  `CO-E1 ×2`（报告按文件计 + byAction）、`CO-F2 ×4`（写后刷索引 / opt-out / 自带 index 不重复刷 / dry-run 不刷）。
  其中 `refreshIndex:false` 那条**刻意断言索引保持陈旧**——把修前的错误行为钉成 opt-out 的已知代价。

### 端到端复核（行为评估侧）

同一条「批量补 type」任务，修前 **12/12 轮撞顶**、14 次工具调用、147K token
（`pipeline_run` 连发 4 次反复重验）；修后 **3-4/12 轮、2-3 次调用**、不再撞顶。

## 追加：列举类回答的凭空补齐（同批修复）

复核时另外撞见一个更严重的问题：让 chat 列全某目录 72 篇笔记的路径，它一次 `list` 就拿到了
完整正确的 72 条，却输出一份分月份、格式工整、结尾写「合计 72 条，全部列出完毕」的清单，
**其中 17 条（24%）是编的**——照抄前 55 条后按命名规律「续写」到承诺的条数。
比截断危险得多：截断看得出没列全，这个看起来完全可信。

修法：SYSTEM_PROMPT 补一条通用纪律（不硬编码答案）——列具体条目只能逐条转写工具返回原文，
不得改写 / 按命名规律推演补齐 / 为凑数编造；条目多先翻页取全，列不全就如实说「只列前 N 条、共 M 条」。

**验证**：修后连跑两次，均 **72/72 逐条属实、0 捏造 0 漏列**（按真实文件系统逐条核对，
不只看断言是否变绿）。全量行为评估 23/23 通过、无回归，平均 token 由 23.2K 降到 17.4K。

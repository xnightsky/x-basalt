---
type: plan
title: Bases code review 修复批次
description: P0..P2b 收口后评审发现的四类静默失败（view 必填字段/order-sort 丢项）与两处资源模型缺口（查询级操作数总额/解析缓存无界）及其修复与回归用例
tags:
  - plan
  - bases
  - code-review
  - x-basalt
timestamp: 2026-07-27T02:39:59Z
sha256: dd348ef3a6b26d707487c8a8e672a6981d8ee824338c07113cfaf39304c19152
---
# Bases 无头引擎 code review 修复批次（P0..P2b 收口后）

> 范围：对 `0b667b5..129f9ec`（Bases 内核 + 测试 + CLI + oracle fixture + 文档）做代码与架构评审后，
> 修复其中的正确性缺陷、跨平台缺陷、资源模型缺口与文档漂移。不含新特性，不动 P3 范围。

## 背景

P0..P2b 全量落地后做了一次完整评审。模块分层、安全面（无 eval / 固定 SQL / own-property 白名单 /
多层预算）与「不猜争议语义」的纪律均无问题；发现的是四类**静默失败**与两处资源模型缺口——
共同特征是「不报错、看起来正常」，靠既有用例锁不住。

## 修复项

### 1. view 必填字段校验只在「键存在时」触发（正确性）

`validateView` 的校验全在 `for (pair of item.items)` 的 `switch(key)` 里，键**整个缺失**时一条
分支都不跑。后果：

- 缺 `type` → `type=""`、零诊断，engine 照 table 执行完。与 `unsupported-view-type`
  「未知 type 不按 table 猜测」的硬口径直接矛盾——**未知**会拒，**缺失**反而放行。
- 缺 `name` → `name=""`、零诊断，且不进 `seenNames`，两个无名 view 同时逃过重名判定。

**改法**：必填项校验移到 key 循环之外统一做；`name` 的空值/重名判定合并到同一出口
（`nameSpan ?? span` 定位）。

### 2. vault 越界防线在盘符大小写不同时假阳（跨平台正确性）

`abs.startsWith(resolvedRoot + sep)` 大小写敏感。Windows 下 `--vault d:\vault` 配 cwd 解析出的
`D:\vault\...` 会判 `base/path-outside-vault`——**合法路径被安全门拒绝**，且错误信息指向完全
错误的方向。小写盘符不是构造场景（git-bash / 环境变量 / 复制粘贴都产生它）。

**改法**：`src/utils/path.ts` 新增导出原语 `isPathInside(abs, root)`，Windows 下按
`toLowerCase()` 归一后做分隔符边界前缀匹配；`isStrictlyUnder` / `ownerOf` / `toAbs` 三处
既有 `startsWith` 一并复用它（同一口径，避免第四份实现）。

> 范围扩大声明：本项改到了 `src/utils/path.ts` 这一跨模块公共契约。理由是该文件里的三处
> 判定与 base 的越界防线是同一语义，只修 base 一处等于留下三份会漂移的实现；对 indexer /
> 编排器而言这是正向修复（此前 Windows 下大小写不同的根会漏索引）。故本批次按「完成定义」
> 升级到全量 test。

### 3. 多根 vault 下 `.base` 主键缺命名空间前缀（契约一致性）

`resolveInsideVault` 自行 `relative(root, abs)`，不带 indexer 的 `<根目录名>/` 命名空间。
同一个 `BaseQueryResult` 里因此有两套键：`base` / 诊断 `file` = `views/x.base`，而行
`file.path` = `vault/Alpha.md`。P0 注释把它记为「命名空间 keying 属 P1」，P1 收口时没回来补。

**改法**：根集合与 rel 主键一律经 `resolveVaultLayout`（indexer 写 `files.path` 用的同一个
函数）计算，顺带获得去重 / 剔子根 / 目录名冲突检测。单根形态字节级不变（向后兼容）。
多根目录名冲突不再混报「路径越界」，而是如实给 `reason: invalid_vault_roots`。

### 4. `maxOperations` 是「每行每表达式」而非查询总额（资源模型）

`evaluateExpression` 每次调用新建计数器，engine 逐行逐列调用它。实际最坏总量
= `maxRows(1e5) × 列数 × maxOperations(1e6)` ≈ 1e11，且无墙钟上限——对抗输入只要让每行
都恰好烧到单次上限，就能在「预算从未耗尽」的前提下把查询拖到不可用。`types.ts` 的注释
写的是「求值操作数**总**预算」，与实现口径不符。

**改法**：新增 `maxTotalOperations`（默认 `50_000_000`）与查询级共享计数器
`BaseSharedOperationBudget`；engine 每次 query 建一份，传给该次查询的全部行/列求值。
engine 侧 groupBy 分桶与 summaries 迭代原本各自新建 `maxOperations` 额度的计数器，
一并并入同一份总额（否则等于给同一次查询开了三份额度）。`maxOperations` 的注释同步
改为「单次表达式求值上限」。

### 5. 表达式解析缓存无界（资源）

`EXPR_PARSE_CACHE` 是模块级 `Map`，key 含表达式原文，无淘汰、生命周期 = 进程。CLI 一次性
调用无感，长驻进程（chat REPL / 未来 watch）里随会话累计的 `.base` 数量单调增长。

**改法**：512 条上限的 LRU（命中 `delete`+`set` 挪队尾，避免被一串一次性表达式挤成 FIFO）。

### 6. `order` / `sort` 非法项静默丢弃（一致性）

`parseStringSeq` 丢非字符串项、`parseSort` 跳过非 map 项与空 `property`，均无诊断——
`order: [file.name, 42]` 会少投影一列且无从察觉。与全仓「不静默」原则冲突。

**改法**：三类非法项各产 `base/invalid-schema` error（`reason` 分别为 `non_string_item` /
`non_map_sort_item` / `empty_sort_property`）；合法项仍照常记录。

### 7. 二元运算字符串升级的 `+` 语境登记为待 oracle

`upgradeStringOperand` 对全部非短路二元运算生效，`+` 也不例外，故
`"2026-01-01" + " 备注"` 报类型错误而非走 string+string 拼接。属「一致性优先」的自觉取舍，
但此前未进待校正清单。**改法**：注释补完整理由 + 登记进 implementation-status.md §3。

### 8. 小项

- engine 的五处求值上下文（filter / sort / 投影 / groupBy / summaries 目标列）逐字重复，
  其中 `formulaAccessorFor(row)` 被判定与取值各调一次 → 收敛为单个 `rowEvalContext`
  装配函数（漏传任一字段都是静默行为差异，收在一处才锁得住）。
- `findFormulaCycle` 的 `.toSorted()[0] as string`：不变量被破时 `cur` 变 `undefined`
  → 死循环。补显式 throw（比死循环好查）。
- `validateViews` 的 JSDoc 与 `function` 挤在同一行 → 格式化。

## 验收

- `pnpm run typecheck` = 0；`oxlint src tests` = 0；改动文件 `oxfmt --check` 干净。
- `tests/base-*.test.ts`：168 → **175**（新增 7 条回归用例）。
- 全量 `tests/**/*.test.ts`：**789 全绿**（因触及 `utils/path.ts` 跨模块契约而升级到全量）。

新增回归用例（均针对「旧实现零诊断」的静默失败，靠断言诊断存在才锁得住）：

| 用例 | 锁定项 |
| ---- | ---- |
| 设计 §5: view 缺少必填 type | #1 缺 type 不按 table 猜测 |
| 设计 §5: view 缺少必填 name | #1 逐 view 一条 + 不误报重名 |
| 设计 §5: order/sort 非法项 | #6 三类非法项各产 error，合法项仍记录 |
| BASE-SEC-008: 盘符大小写 | #2 Windows 不假阳 / POSIX 不误放行 |
| BASE-DATA-004: 多根 doc.path | #3 多根带前缀、单根无前缀 |
| 执行预算: maxTotalOperations | #4 跨行累计耗尽，且默认额度下同查询正常 |

新增 fixture：`tests/fixtures/bases/invalid/{missing-view-type,missing-view-name,bad-order-sort-items}.base`。

## 输出契约变更（需下游知悉）

1. **多根** vault 下 `BaseQueryResult.base` 与诊断 `file` 改为带 `<根目录名>/` 前缀。
   单根不变。修的是「同一结果两套键」，属对齐 indexer 而非新约定。
2. 缺 `type` / 缺 `name` 的 `.base` 由「静默执行」变为 **error + 空结果**（CLI exit 1）。
   收紧动作：此前能跑的这类 `.base` 现在会报错——但它们本就不该被当 table 执行。
3. 新增 `BaseExecutionLimits.maxTotalOperations`（`Partial` 覆盖，既有调用方不受影响）。

## 未做 / 遗留

- **仓库级 `oxfmt --check .` 不可通过**：`tests/fixtures/.../vault-invalid-json/types.json`
  是**故意非法**的 JSON（BASE-TYPE-003 fixture），oxfmt 解析即报错中止；排除 fixtures 后
  仍有 158 个文件从未被 oxfmt 覆盖（80 个 md + 73 个 ts）。`.oxlintrc.json` 已 ignore
  `tests/fixtures/**`，oxfmt 没有对应配置（它只认 `.gitignore` / `.prettierignore`）。
  属既有状况、影响面全仓，不并入本批次——需单独决定「是否全仓格式化 + 怎么让 fixtures 豁免」。
- P1 无 SQL 下推（全表读 + 内存过滤）：`maxRows=100k` 时是全量 frontmatter JSON.parse +
  wrapValue，内存峰值可观。属设计 §10 既定取舍，基准数据支持当前规模，不在本批次动。
- `document.ts` 1100+ 行承担路径 / IO / YAML / schema / filter / formulas / summaries 七件事，
  schema 校验可拆子模块。属结构优化，无正确性影响，不在修复批次内做。

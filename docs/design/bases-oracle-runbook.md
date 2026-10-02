---
type: testing
title: Bases P1 争议语义官方 oracle 操作手册
description: 维护版本化 oracle 的前置、内部路径核查、强制重算与收敛判据、重跑条件和红线；两轮观察另留归档，最新文档不等于新 App 实测。
tags:
  - testing
  - bases
  - oracle
  - conformance
timestamp: 2026-10-02T12:14:45Z
sha256: d8055013ac6422058327df3bae26fdc2a57f697998280088b46518579065f590
---
# Bases P1 争议语义官方 oracle 操作手册（runbook）

> 2026-07-27 起草 · 2026-07-28 执行完毕 · 协议真相源：[`2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md) §8（本手册是其逐步具体化，不替代协议）。
> 用途：把「暂定口径」跑一遍官方 oracle，校正 x-basalt 语义与锁定测试。
> **取证方式**：官方 App/CLI 的受控串行 oracle，不进入产品运行时。本手册保留方法，版本化结果另留归档；本轮未启动官方 App 或重新取证。
>
> 关于 `AGENTS.md`「严禁引入 Electron / Puppeteer / Playwright 等 GUI 自动化工具」：那条约束的对象是**产品依赖**——x-basalt 本身仍是零 GUI 依赖的纯 Node CLI，取证用的是 Obsidian 官方 CLI 且不进产品依赖树。本手册初版写的「项目硬约束禁 GUI 自动化，只能人工串行」把约束对象搞错了，是 §0.1 那次误判的一部分。

## 0. 状态：✅ 已执行（2026-07-28，Obsidian 1.12.7；2026-08-02/03 第二轮，Obsidian 1.13.4）

**首轮 26 个 view 两次一致；第二轮 38 + 49 view 两次一致（无 `implementation-defined`）。
版本化读数见[两轮观察归档](../archive/research/2026-07-28-bases-oracle-observations.md#4-观察记录2026-07-28--obsidian-1127--26-view-全部两次一致)，当前校正与未知项见 [bases-vs-official](bases-vs-official.md) 和[兼容账本](query-compatibility-ledger.md)。**

### 0.1 推翻了什么（原暂缓决策的三条依据，两条不成立）

本节历史内容已归档，见[原章节](../archive/research/2026-07-28-bases-oracle-observations.md#01-推翻了什么原暂缓决策的三条依据两条不成立)。当前规则与剩余边界见本文有效章节。

### 0.2 取证路径

历史 1.12.7 / 1.13.4 的取证路径使用已运行 App 的官方 CLI `eval` 读取下列内部对象；内部路径不属于稳定公开协议，新版本必须重新核对：

```
app.workspace.activeLeaf.view.controller
  ├── getQueryViewNames()          列出该 .base 的全部 view
  ├── selectView("<view名>")        切 view
  ├── .view.rows[].entry.file.path  该 view filter+sort+limit 之后的最终行集
  ├── .view.groups                  groupBy 分桶
  ├── .view.footerSummary.cells     汇总行（renderedValue / entries）
  └── .errors                       求值错误
```

旧基线的 `base:query file= view= format=json` 曾返回空、退出码 0，因此当时改用 `eval`。这是指定版本的观察，不是官方命令永远不可用的判断；新取证须先验证公开入口，再决定是否读取内部对象。

取证时的三个坑（都会静默产出错误数据，不会报错）：

1. **`selectView` 后不能立刻读。** `viewName` 立刻变成新值，但 `view.rows` 要等异步重算——只等名字会读到**上一个 view 的行集**，整份结果错位一格（`empty-and`/`empty-or`/`empty-not` 三连最明显：错位版给出 12/12/0，正确值是 12/0/12）。判据要用「rows 连续两轮不变」。
2. **「连跑两次」不能直接调两次。** 已停在该 view 上时 `selectView` 是空操作，第二次会立刻命中缓存返回，两次必然相同——稳定性检查形同虚设。要绕到另一个 view 再切回，强制重算。
3. **汇总是懒计算的。** `renderedPlaceholder === true` 时读到的 `null` 不是结果，要等它算完。

### 0.3 重跑条件

App、CLI、fixture 或争议输入变化时重新固定版本和指纹，按协议定点/整批重跑，不把最新文档当新读数。fixture 文件数会改变默认行集；在复用旧基线时只向已有 `.base` 加 view，新增文件后必须重建相关行数预期。

## 1. 语义清单与官方结论（①..⑨ 已冻结，2026-07-28）

本节历史内容已归档，见[原章节](../archive/research/2026-07-28-bases-oracle-observations.md#1-语义清单与官方结论①⑨-已冻结2026-07-28)。当前规则与剩余边界见本文有效章节。

## 2. 前置

1. Obsidian ≥ 1.12，设置 → 通用里打开「命令行界面」（`%APPDATA%\obsidian\obsidian.json` 里可见 `"cli": true`）。
2. 把 `tests/fixtures/bases/oracle/` **整个目录复制为独立 vault**——不能直接开主仓 fixture：Obsidian 会在 vault 根建 `.obsidian/`，那会污染仓库。
3. vault 里**只能有 fixture 的文件**。官方默认数据集连 `.base` 自身都算行，多一个残留的试验文件就多一行，结论不可复现。
4. 记录版本与 fixture 指纹随观察记录留档：
   - `git hash-object tests/fixtures/bases/oracle/views/*.base tests/fixtures/bases/oracle/notes/*.md`
5. 用 Obsidian 打开该 vault（这一步是人工的，见 §3）。

## 3. 执行（可脚本化，不必人工逐个点）

**按所固定 fixture 的 view 清单遍历**：按 §0.2 的路径 `getQueryViewNames()` → `selectView()` → 读 `view.rows` / `view.groups` / `view.footerSummary`，逐 view 走一遍即可。

要求两条（沿用协议 §8 第 7 条）：

1. 每个 view **连跑两次**，结果不一致即标 `implementation-defined`，不得靠单次观察冻结强结论。**注意 §0.2 的坑 2**——直接调两次会命中缓存，必须绕到另一个 view 再切回强制重算，否则这道检查形同虚设。
2. 读取前确认已收敛（§0.2 坑 1、坑 3），否则会读到上一个 view 的行集或未算完的汇总。

首次人工打开独立 fixture vault，预先确认 App 已就绪；不调用 URI 切库，不引入 GUI 自动化工具或运行时依赖。旧切库实验仅作历史背景。

view 清单（26 个）：truthiness.base × 8（truthy-missing / truthy-explicit-null / truthy-empty-string / truthy-zero / truthy-false / truthy-empty-list / eq-missing-null / eq-explicit-null-null）、sort-null.base × 2（sort-asc / sort-desc）、if-lazy.base × 2（if-lazy / if-lazy-false-branch）、empty-filter.base × 3（empty-and / empty-or / empty-not）、types.base × 7（date-eq-literal / date-lt-datetime / datetime-lt-date / link-eq-wikilink / link-projection，P2a 新增；concat-plain-string / concat-date-string，2026-07-27 review 新增；样本 CaseE）、group-summary.base × 4（group-by-tags / group-by-list-prop / summary-custom / summary-custom-limited，P2b 新增，样本 CaseF 与 CaseB/C）。

## 4. 观察记录（2026-07-28 · Obsidian 1.12.7 · 26 view 全部两次一致）

本节历史内容已归档，见[原章节](../archive/research/2026-07-28-bases-oracle-observations.md#4-观察记录2026-07-28--obsidian-1127--26-view-全部两次一致)。当前规则与剩余边界见本文有效章节。

## 6. 红线

- 原始 App 输出**不是** x-basalt 公共 API；结论必须人工审查后才转期望快照。
- 某 view 两次结果不一致 → 标 `implementation-defined`：维持 x-basalt 口径并注释「官方不稳定」，测试只锁自一致性。（旧首轮 26 view 的报告未触发，不代表新版本或新输入。）
- 取证跑不通时不猜测补齐——维持暂定口径，状态文档保持 ⏸。
- **行数相同 ≠ 口径一致**：`empty-or` 两边都是 0 行，但官方是逻辑恒假、x-basalt 是报错返回空。判定前先看诊断与列值。

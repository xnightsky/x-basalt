---
type: plan
title: DQL / Bases 兼容范围局部调研
description: 官方接口、本项目即时查询与模型差异的局部事实审计及文档校正；不授权生产功能实施。
tags:
  - plan
  - research
  - dql
  - bases
  - x-basalt
status: done
timestamp: 2026-10-01T18:20:57Z
sha256: afbd07bed136555f816063f939762c5eecef607820e7d488e354bfc3dfbbb588
---
# DQL / Bases 兼容范围局部调研

> 状态：done（调研与文档校正收口，不是功能实施计划）。
> 上游：[业界调研](../../research/2026-09-30-agent-knowledge-industry-landscape.md)、[根 TODO](../../../TODO.md)。

## 背景

2026-09-30 的讨论要求复核双路线的历史理由：官方 Bases 的任务/数据模型和程序化入口是否存在实际缺口，x-basalt 如何解除查询定义必须落盘的限制，以及 DQL/Bases 是否仍承担不同任务。用户对复杂任务处理与外部 AI 委托 chat 的观察另行保留，不把本轮等同检索或 Agent 改造。

已发现当前使用指南遗漏 stdin，且列表分组描述与实现冲突。兼容判断以源码、可执行测试及固定版本的一手信源为准；历史 oracle 不外推为当前官方版本结果。

## 范围 / 非目标

- 核实官方 Bases / Dataview 的表达能力、输入入口、公开 API 和部署约束，区分不同层次。
- 检查本项目 DQL 子集、Bases source/stdin 与已声明差异；建立能力/入口矩阵。
- 发布带信源的局部报告，校正直接影响判断的当前说明，刷新元数据。
- 不改生产代码、依赖版本、数据库契约、接口或模块保留策略；不运行 Obsidian App/GUI，不引入 Obsidian 包/类型或 Dataview 执行层。
- 不把“官方 CLI 未公开 raw-query 参数”外推为“所有官方途径都必须先落独立 .base 文件”。

## 分阶段切口

1. **事实核查**：官方一手资料与本仓代码/历史决策分开取证，记录版本与未知项。
2. **局部对照**：验证即时查询、任务行、inline fields、FLATTEN、计算列/汇总、附件数据集与路径入口的实际差异；不把 DQL 当完整 SQL。
3. **报告与同步**：给出保留/扩展/不跟随的条件化建议，更新受影响文档与待办；方案仍待用户决定。

## Decision Log

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-10-01 | 先做局部调研，不预设合并或削减路线 | 用户要求核实双路线的实际理由 |
| 2026-10-01 | 官方资料调查与本仓核查分工 | 避免重复阅读；父代理承担验证、综合与发布 |
| 2026-10-01 | 输入入口与表达能力分别比较 | stdin 能解除落盘要求，但不会自动改变查询语言能力 |
| 2026-10-01 | 原生绑定只做 rebuild | 上次忽略安装脚本留下 SQLite 绑定缺失；`pnpm rebuild better-sqlite3` 恢复，未改版本/lockfile |
| 2026-10-01 | 保留双路线作为条件化建议 | 同库验证模型差异；不替用户决定缩减或升级范围 |
| 2026-10-01 | R08/R09 只登记待修复 | 本轮是能力审计，不扩大为生产代码修复 |

## Evidence

- 当前入口：[`src/cli.ts`](../../../src/cli.ts)、[`src/base/engine.ts`](../../../src/base/engine.ts)、[`tests/base-stdin.test.ts`](../../../tests/base-stdin.test.ts)。
- DQL 边界：[`dql-subset`](../../design/dql-subset.md)、[`src/query/`](../../../src/query/)。
- Bases 历史差分：[`bases-vs-official`](../../design/bases-vs-official.md)、[`bases-status`](../../design/bases-status.md)、[语法接地 A/B](2026-08-08-bases-chat-grounding.md)。已有小样本结果不替代本轮任务能力分析。
- [局部报告](../../research/2026-10-01-dql-bases-compatibility-local-audit.md)：O1–O10 固定一手信源、P1–P9 项目证据、R01–R09 对照及未知项。
- 定向验证：`node --import tsx --test tests/{base-stdin,base-document,base-engine,base-cli,base-context,base-group-summary,base-functions-date,base-functions-link,base-list-hof,base-values-date,base-vault-entries,vault-entries-dql-proof,query,query-parser,sql-generator}.test.ts`：321/321；CLI 入口/模型探针 8 项及 TASK AST→SQL 检查 1 项。
- 第一 researcher 运行因工具声明不可用失败，不计成功验证；父代理保留工作区 diff/status，再以同协议可用 delegate 只读复核四项官方结论，成功返回。核心八份原文 hash 一致，未更改代理配置或绕行执行协议。
- 本轮只校正说明/运行时说明数据，未改生产执行、接口或依赖版本；R08/R09 已写入根 TODO，未修复。

## 验收口径

- 官方入口约束有一手出处；“没有公开接口”与“绝对做不到”明确区分。
- 每项本项目能力指向源码与测试；至少验证 source/stdin 与文件入口的主路径及 DQL 差异用例。
- 报告分开列已核实、历史观察、尚未实测与投入建议；图示区分定义输入、语言执行和数据集。
- 直接受影响的当前说明不再与已验证行为矛盾；本地链接、脱敏、正文哈希及 diff 检查通过。
- 不声称完整兼容，不通过本次调研自动授权功能开发或模块删改。

## Verify（2026-10-01）

- `pnpm run typecheck`、`pnpm run build` 实际通过；Evidence 的 15 文件集合加 `tests/skill.test.ts`，**357/357**，fail/skipped 均 0。
- `skills get core query base` 与 `skills get obsidian-base-spec` 冒烟通过，明确完成状态与 TASK 未执行子句，未改渲染器或召回机制。
- 文档最终验收：归档前 140 / 归档后 **138** 处新增本地链接/锚点通过；96 个外部 URL 做清单核对，21 个固定官方链接对应已取证原文；38 项缓存重算 hash 一致。上轮 Sync/Publish 两个固定 URL 重新抓取 HTTP 200、与旧缓存逐字节一致；旧 manifest 的字符计数曾被校验脚本误当字节数，已校正验证器，不是原文漂移。
- 16 个 Mermaid block，15 个 flowchart 做定界符检查；**未实际渲染**。新增架构路径不使用 GUI/browser 自动化。
- `git diff --check`、新增路径脱敏及 src/tests/依赖/配置零 diff 检查通过。归档及元数据刷新后，16 份正文哈希、链接/锚点和 diff 检查再次通过，frontmatter status=done；不把此记录当作功能修复。
- 未跑全仓测试/lint：未改生产执行、依赖版本、根脚本/配置或测试基础设施。官方 App/CLI、竞品、真实大库和复杂任务成功率未实测；R08/R09 尚未修复。

## Progress

- [x] 事实核查与本仓验证。
- [x] 报告与必要说明同步。
- [x] 元数据/链接检查，结论写回 TODO；调研计划收口。

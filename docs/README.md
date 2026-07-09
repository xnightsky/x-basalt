---
timestamp: 2026-07-09T05:27:46Z
sha256: 2d3d32367cbe82f4f3bbb1a06e060271cebd7c5cfdc9b9bf68897ed0b1b307bf
type: index
title: docs · 文档入口与路由
description: x-basalt 文档真相源目录路由与三层口径
tags:
  - docs
  - index
  - x-basalt
---
# docs · 文档入口与路由

本目录是 x-basalt 的文档真相源。改动前先按下表定位「该读哪些 / 结论往哪写」。

## 目录路由

| 目录            | 内容                                                            | 何时写                   |
| --------------- | --------------------------------------------------------------- | ------------------------ |
| `research/`     | 调研：外部规范、依赖核实、技术选型论证、不确定项与假设          | 进入设计前的事实收集     |
| `specs/`        | 设计/规格：模块划分、接口契约、数据模型、DQL 子集边界           | 架构确认后、实现前       |
| `plans/`        | 实现计划：`YYYY-MM-DD-<topic>.md`，分阶段切口 + 验收 + Evidence | 大型任务开始实现前       |
| `architecture/` | 稳定后的目标架构（允许阶段性滞后）                              | 边界稳定或用户要求校准时 |
| `guides/`       | 操作指南：代码质量、注释规范、测试手法等                        | 沉淀可复用工作口径时     |
| `testing/`      | 测试策略、fixtures 说明、用例清单                               | 测试分层/清单变化时      |

> **specs/ 内三分**（按 frontmatter `type` + 文件名后缀区分）：冻结契约（`-frozen`，type: spec）、设计（`-design`，type: design）、跨领域决策（`-decision`/`-vs-`，type: decision）。三者同放 `specs/`，不另立 rfc/ 或 adr/ 或 design/ 目录。

## 三层口径

- **当前实现**：代码 + `specs/` + 当前 active `plans/`，必须可互相验证。
- **目标架构**：`architecture/`，允许滞后于实现。
- **迁移约束**：跨阶段不变量写在对应 `plans/` 或 ADR。

## 当前活跃文档

- **架构总览（架构图 + 组件清单，先读这个建立全局观）**：[`architecture/2026-06-28-overview.md`](architecture/2026-06-28-overview.md)——分层依赖/读写数据流/DQL 管线/SQLite 数据模型/组件目录
- 使用指南（面向使用者，**教程总目录 + 分章**）：[`guides/usage.md`](guides/usage.md)——安装/命令/DQL/索引同步/配置/Obsidian语法/AI协作/排查
- 选库与许可证避坑（选第三方库前必读）：[`guides/dependency-license-policy.md`](guides/dependency-license-policy.md)
- Markdown 知识库编译器调研（lint / links / profile 分层路线）：[`research/2026-07-09-markdown-kb-compiler-lint-links-research.md`](research/2026-07-09-markdown-kb-compiler-lint-links-research.md)
- Markdown 知识库编译器设计（parser 定位 / links / lint / profile 分层契约）：[`specs/2026-07-09-kb-compiler-lint-links-design.md`](specs/2026-07-09-kb-compiler-lint-links-design.md)
- 发布时机决策（先 dogfood 还是先开源）：[`specs/2026-06-28-release-vs-dogfood.md`](specs/2026-06-28-release-vs-dogfood.md)
- 设计：[`specs/2026-06-25-x-basalt-design.md`](specs/2026-06-25-x-basalt-design.md)
- 调研：[`research/2026-06-25-obsidian-spec-and-deps.md`](research/2026-06-25-obsidian-spec-and-deps.md)
- 计划（MVP）：[`plans/2026-06-25-x-basalt-mvp.md`](plans/2026-06-25-x-basalt-mvp.md)

### 复盘真相源（2026-06-26）

> 复盘结论：自建未违规，但「零依赖运行时」被执行成「全部手撸」，规范未完全落地、缺集中真相源。

- 依赖与「自建 vs 用库」决策：[`specs/2026-06-26-deps-build-vs-buy.md`](specs/2026-06-26-deps-build-vs-buy.md)
- 现状体检报告（分模块发现）：[`testing/2026-06-26-audit.md`](testing/2026-06-26-audit.md)
- 规范覆盖矩阵（黑盒消除）：[`specs/2026-06-26-coverage-matrix.md`](specs/2026-06-26-coverage-matrix.md)
- 文档落地计划：[`plans/2026-06-26-docs-grounding.md`](plans/2026-06-26-docs-grounding.md)
- **▶ 可执行路线图（全模块收口 + 做深内核，逐步带验收标准）**：[`plans/2026-06-26-execution-roadmap.md`](plans/2026-06-26-execution-roadmap.md)

## 维护规则

- 大改动记入对应 `specs/` 决策/设计文档（`-decision`/`-design`）或当前阶段 `plans/`；小改动至少同步直接受影响的规范/实现说明/计划，不静默覆盖原规则。
- 入仓文档禁止出现仓库根目录之外的绝对本机路径（见 `AGENTS.md`「脱敏」）。

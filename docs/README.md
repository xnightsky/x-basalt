# docs · 文档入口与路由

本目录是 x-basalt 的文档真相源。改动前先按下表定位「该读哪些 / 结论往哪写」。

## 目录路由

| 目录 | 内容 | 何时写 |
|---|---|---|
| `research/` | 调研：外部规范、依赖核实、技术选型论证、不确定项与假设 | 进入设计前的事实收集 |
| `specs/` | 设计/规格：模块划分、接口契约、数据模型、DQL 子集边界 | 架构确认后、实现前 |
| `plans/` | 实现计划：`YYYY-MM-DD-<topic>.md`，分阶段切口 + 验收 + Evidence | 大型任务开始实现前 |
| `architecture/` | 稳定后的目标架构（允许阶段性滞后） | 边界稳定或用户要求校准时 |
| `guides/` | 操作指南：代码质量、注释规范、测试手法等 | 沉淀可复用工作口径时 |
| `testing/` | 测试策略、fixtures 说明、用例清单 | 测试分层/清单变化时 |

## 三层口径

- **当前实现**：代码 + `specs/` + 当前 active `plans/`，必须可互相验证。
- **目标架构**：`architecture/`，允许滞后于实现。
- **迁移约束**：跨阶段不变量写在对应 `plans/` 或 ADR。

## 当前活跃文档

- 使用指南（面向使用者，怎么用）：[`guides/usage.md`](guides/usage.md)
- 设计：[`specs/2026-06-25-x-basalt-design.md`](specs/2026-06-25-x-basalt-design.md)
- 调研：[`research/2026-06-25-obsidian-spec-and-deps.md`](research/2026-06-25-obsidian-spec-and-deps.md)
- 计划：[`plans/2026-06-25-x-basalt-mvp.md`](plans/2026-06-25-x-basalt-mvp.md)
- 执行真相源：MVP 已完成，根 `TODO.md` 已随之删除

## 维护规则

- 大改动记 ADR 或当前阶段计划；小改动至少同步直接受影响的规范/实现说明/计划，不静默覆盖原规则。
- 入仓文档禁止出现仓库根目录之外的绝对本机路径（见 `AGENTS.md`「脱敏」）。

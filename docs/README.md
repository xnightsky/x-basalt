---
type: index
title: x-basalt 文档入口
description: 按读者分流的文档总入口：use/ 怎么用、research/ 查当前调研、design/ 怎么改、archive/ 查归档；含四层口径与维护规则
tags:
  - docs
  - index
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: d570b991e38bbd6616b43801c89a48150129d132a2be0bef53a2d1874a201dfd
---
# x-basalt 文档

四个目录，按**你是谁**分：

| 我想…… | 去 |
| --- | --- |
| **用这个 CLI** —— 安装、查笔记、改元数据、报错了 | [`use/`](use/README.md) |
| **核对当前边界** —— 对照外部能力、查调研证据、判断是否真是差距 | [`research/`](research/README.md) |
| **改这个 CLI** —— 架构、模块设计、为什么这么定 | [`design/`](design/README.md) |
| **查归档** —— 已结束的计划、保留的调研与决策依据 | [`archive/`](archive/README.md) |

## 四层口径（改文档前先分清）

| 层 | 在哪 | 要求 |
| --- | --- | --- |
| **当前实现 / 设计提案** | `src/` + `design/` | 已实现契约必须与代码互证；提案明确标未实现，不作为现有能力 |
| **使用方式** | `use/` | 写在这里的必须能跑通，示例要真实跑过 |
| **当前调研** | `research/` | 基于证据的现状快照；不是实现契约、路线图或兼容承诺 |
| **归档文档** | `archive/` | 集中保留已结束或被接替的记录；归档不等于失效，也不自动代表当前事实 |

## 现在的主线

**Bases 无头引擎**——不启动 Obsidian 查询 `.base` 文件。

- 会用 → [`use/bases.md`](use/bases.md)
- 懂原理 → [`design/bases-vs-official.md`](design/bases-vs-official.md)
- 置顶关注与未完成事项 → 根 [`TODO.md`](../TODO.md)（会话开始先读；持续关注不等于立即实施，长期项和未修问题保留可见）
- 已完成工作与证据边界 → [本轮执行记录](archive/plans/2026-10-01-todo-sequential-cleanup.md)；调查收口不表示所有问题已修复
- 两路边界与投入顺序 → [DQL/Bases 兼容账本](design/query-compatibility-ledger.md)

## 维护规则

- AI / Superpowers 生成文档的任务分级、临时稿与正式落点见根 [`AGENTS.ai.md`](../AGENTS.ai.md)；不按生成工具另建文档树。
- 改了行为，同步改 `design/` 对应文档和 `use/` 对应章节；小改动也要同步，不静默覆盖原规则。
- 外部对照、能力边界和选型证据写入 `research/`；结论一旦成为当前实现契约或决策，再写入 `design/`。
- 按[内容级归档标准](archive/plans/README.md)判断：整篇已结束/被接替则迁移；混合文档只摘出历史章节，当前契约、有效决策理由与未完成义务保持可见。
- 正式归档统一进入 `archive/`，按 `decisions/`、`plans/`、`research/` 分类，不分散设置业务归档目录，**不删证据**。整篇被接替的设计标 `superseded_by`；局部归档标明来源章节和接替位置，保留双向溯源并同步标题锚点。
- 唯一证据可以完整留在归档，活跃入口引用它；旧读数注明基线，不改写成新版本事实。归档不表示全部后续功能或风险已解决。
- 入仓文档禁止出现仓库根目录之外的绝对本机路径（见 `AGENTS.md`「脱敏」）。
- 文件名：`use/` 和 `design/` 不带日期（名字即内容）；`research/` 与 `archive/` 保留 `YYYY-MM-DD-` 前缀。

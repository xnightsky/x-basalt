---
type: research
title: 最小修复切口的复用与库选型评估
description: R08/R09 局部复用与候选库的适配、成本、许可、失败边界和不新增依赖的决策依据。
tags:
  - research
  - libraries
  - base
  - query
timestamp: 2026-10-01T17:17:23Z
sha256: e707850698e8e5e0352fcd422a42c12e8725835030ce0ab38fa8f76962659e09
---
# 最小修复切口的复用与库选型评估

> 日期：2026-10-01；对应根 TODO 第四项。范围以 [顺序清理计划第三项](../plans/2026-10-01-todo-sequential-cleanup.md#3-下一轮切口--验收--非目标) 为准，不重新做全行业普查，也不把评估等同安装或兼容实跑。

## 结论 / 目的

**本轮不加新依赖。** R08 是既有文件解析器未注入公式上下文，R09 是 TASK 分支没有消费已解析子句；二者不需要替换文法、数据库或整个查询引擎。优先复用已在产品中的成熟组件及既有领域实现，局部自建仅限接线、子句拒绝与独立回归。

模型执行义务和外层转述范围不能靠换 SQL 构建器解决。入口默认直接 CLI、明确委托保留 chat；未复现默认委托，不为一次调查扩建新 MCP/模型宿主或检索引擎。

## 范围 / 主事实

- **R08**：`formulaAccessorFor()` 传入 limits/clock/propertyTypes/sharedBudget/contextRow/formulas，却漏 resolveFile；同文件的 rowEvalContext 已注入 `createFileResolver(rows)`。该解析器不额外查库/文件系统，按精确 path→去扩展名忽略大小写 pathKey→basename 匹配，歧义按 path ASC 第一条；不擅自改成更像官方的另一个策略。[P1][P2]
- **R09**：TASK 提前返回仅生成任务列/WHERE/LIMIT；LIST/TABLE 的 SORT 字段校验已有实现。最小切口复用标量字段映射，TASK GROUP/FLATTEN 暂明确拒绝；任务组树/扇出属于另外的输出契约。[P3]
- **验收**：终态 truth、路径集合正确或工具出现不能证明所有过程/输出义务。应复用 Node test runner 的确定性内核回归及已有外部宿主 argv/产品 trace；并发同名调用缺 toolCallId 的归属限制单独保留，不把观测困难包装为内核错误。[P4]

## 适配 / 成本 / 许可 / 失败边界

| 方案 | 对切口的适配 | 调用与维护成本 | 许可核验 | 失败边界 / 决策 |
| --- | --- | --- | --- | --- |
| 现有 createFileResolver + Bases evaluator | R08 直接满足，使用同一行数据集/预算/缓存 | 不增进程或依赖；需统一上下文接线并验证组合；现有大文件按相关职责抽离 | 本项目 MIT；不复制外部执行器 | 保留数据集口径、缺失传播与歧义策略；不为 custom summary values 注入行外状态。**采用** |
| 现有 Chevrotain + SQL 字段映射 + better-sqlite3 | R09 直接满足词法位置、字段白名单、绑定参数与实际任务行执行 | 不迁移 AST/schema；增加 TASK 排序和明确拒绝的覆盖 | 安装包 Chevrotain 12.0.0 Apache-2.0、better-sqlite3 12.11.1 MIT，manifest 与 LICENSE 对照 | 不能只测试 parser 接受；需实际行序、LIMIT 和失败定位。**采用** |
| 现有 yaml | .base 与 frontmatter 两侧的 YAML 结构解析不变 | 零迁移；不要绕过 Document 写侧 | 安装包 yaml 2.9.0 ISC，manifest 与 LICENSE 对照 | 不是表达式求值器，不能自行修复 resolveFile 漏注入；**维持** |
| Kysely 0.29.6 固定源码 | TypeScript/SQLite 构建器可适配 SQL 生成；仍需自己决定 TASK/JSON 字段语义 | 可仅 compile 后交现有 DB；若用其 driver 则接入 async 接口。整个 SQL 生成器迁移会扩大回归面，本次没有测构建耗时/类型成本 | 固定 package.json 与 LICENSE 均 MIT；Node >=22，声明 TS <5.4 使用 outdated 类型入口，本项目 TS 5.x 仍须具体版本验证 | 不会自动补消费遗漏或任务组模型；只是构建 SQL 不保证领域正确。**暂不引入，保留长期评估** [E1] |
| basecli 固定源码 | Python 的独立只读 Bases CLI，可作共同子集对照；不是 TS 注入一个解析器的替换库 | 增加 Python/PyYAML/dateutil、独立状态/类型与子进程输出适配；本轮无运行成本测量 | setup.cfg 声明 MIT；未取得独立 LICENSE 文本，集成许可停点未解除 | 声明了 property types/this/relative-time 等差异，不能直接保证既有 conformance；**不安装，仅保留未来受控对照** [E2] |
| headless-vault-kit 固定源码 | Python CLI，DQL 模块复用其 Bases 表达式；TASK 为 UNSUPPORTED_TYPES，GROUP/FLATTEN 明确拒绝 | 需另一个 schema/数据转换/子进程环境，不是当前 TASK 缺口的执行替换 | 固定 LICENSE 为 MIT；未做完整分发依赖许可审计 | 不应据语言相似合并 DQL/Bases AST，不能拿不支持项算为错误匹配。**不安装，不替换** [E3] |
| obsidian-dataview / Obsidian API | 仅规范、类型结构与受控对照参考 | 执行器绑运行时，不存在合规替换路径 | 即使许可证可用也不豁免项目禁止项 | **不安装、不 import、不调用其 Evaluator/Executor**；许可不是运行边界授权 |

宽松许可证也需保留版权/许可证及适用 NOTICE；上表不是法律意见。安装包许可以本次实际读取的 package.json + LICENSE 为准，不沿用旧调研中 Node 18/peggy 尚待落地的说法。[P5]

## 验证 / 未验证 / 停点

**已验证**：读取上述本仓接线/SQL/观测代码；本地已安装三包的具体版本、engines 和许可证文本；Kysely 固定 commit 的 manifest/许可证/SQLite driver；两个 Python 候选的固定原始文件。首次按未核实 `0.29.0` tag 请求 Kysely 返回 404，改由官方仓库 API 获取 commit 后固定读取，未把失败 tag 当版本依据。没有运行安装命令或改变依赖/lockfile。

**未验证**：Kysely NodeNext 编译/构建迁移、第三方 CLI 实跑/性能/兼容、完整分发依赖与商业条款、其它宿主/模型及真实大型 Vault。现阶段没有必要通过安装竞品来修一个漏字段接线。

**停点**：如果 B/C 的新端到端测试显示需要扩大数据集、改变共享字段语义或返回结构，则先更新计划/设计再实现；出现需要新跨语言执行器、许可不明或新运行时依赖时停止集成。本结论不取消未来共同子集对照、Kysely 或检索的条件化需求。

## 一手来源

### 本仓与安装包

- [P1] [`src/base/engine.ts`](../../src/base/engine.ts)：公式 accessor 与 rowEvalContext 装配。
- [P2] [`src/base/source.ts`](../../src/base/source.ts)：createFileResolver 的行集/匹配/歧义契约。
- [P3] [`src/query/sql-generator.ts`](../../src/query/sql-generator.ts)、[`parser.ts`](../../src/query/parser.ts)：TASK 提前返回与现有 SORT/词法位置。
- [P4] [`src/chat/loop.ts`](../../src/chat/loop.ts)、[`trace.ts`](../../src/chat/trace.ts)：SDK 事件输出与 trace；[`tests/`](../../tests/)：Node 原生回归。
- [P5] [`package.json`](../../package.json)、[`pnpm-lock.yaml`](../../pnpm-lock.yaml)、[许可策略](../design/dependency-license-policy.md)。安装包核验文件：`chevrotain/package.json` 与 `LICENSE.txt`、`better-sqlite3/package.json` 与 `LICENSE`、`yaml/package.json` 与 `LICENSE`，均位于 node_modules。

### 固定外部源码

- [E1] Kysely `996eae17fe325968da56e5aa4d9d3a216adb120d`：[package.json](https://github.com/kysely-org/kysely/blob/996eae17fe325968da56e5aa4d9d3a216adb120d/package.json)、[LICENSE](https://github.com/kysely-org/kysely/blob/996eae17fe325968da56e5aa4d9d3a216adb120d/LICENSE)、[sqlite-driver.ts](https://github.com/kysely-org/kysely/blob/996eae17fe325968da56e5aa4d9d3a216adb120d/src/dialect/sqlite/sqlite-driver.ts)。源码版本不等于 npm 发布状态。
- [E2] basecli `ebf409d798c637c86430739f13e1e6b585c5e22c`：[setup.cfg](https://github.com/hobbs/basecli/blob/ebf409d798c637c86430739f13e1e6b585c5e22c/setup.cfg)、[LIMITATIONS.md](https://github.com/hobbs/basecli/blob/ebf409d798c637c86430739f13e1e6b585c5e22c/LIMITATIONS.md)。未重新取得整个实现或独立 LICENSE。
- [E3] headless-vault-kit `f158bd8e8236efabb96505eea701cc204fe42b37`：[LICENSE](https://github.com/angelsaez/headless-vault-kit/blob/f158bd8e8236efabb96505eea701cc204fe42b37/LICENSE)、[dql.py](https://github.com/angelsaez/headless-vault-kit/blob/f158bd8e8236efabb96505eea701cc204fe42b37/src/hvk/dql.py)。机制可读不等于当前集成适配通过。

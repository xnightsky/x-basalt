---
type: design
title: DQL/Bases 兼容投入账本
description: DQL 冻结子集与 Bases conformance 的范围、证据分类、升级顺序、未知项及实施停点
tags:
  - design
  - compatibility
  - dql
  - bases
  - x-basalt
timestamp: 2026-10-02T00:20:03Z
sha256: 3112d3f6c6fa3efb487afc3c2e00f4cc06e823214e7386de512a019f6a19b7da
---
# DQL / Bases 兼容投入账本

> 状态：2026-10-01 决策与当前边界；不是完整上游兼容承诺，也不是未列特性的实施授权。
> 依据：[局部取证快照](../research/2026-10-01-dql-bases-compatibility-local-audit.md)、[最小切口选型](../research/2026-10-01-minimal-slice-reuse-assessment.md)、[顺序执行记录](../plans/2026-10-01-todo-sequential-cleanup.md)。

## 1. 目标版本与证据规则

| 路线 | 当前目标 | 不得外推 |
| --- | --- | --- |
| DQL | [冻结子集](dql-subset.md)：2026-06-27 基线，2026-07 真值/inline 修订，2026-10-01 R09 修正 | 不是某个完整 Dataview release；文法/执行独立自建，不依赖其 Evaluator/Executor |
| Bases 默认 | `bases-markdown-2026-07`：仅 Markdown 行，恒发 markdown-only warning | 不因官方默认含 .base/附件就扩大当前数据集 |
| Bases 选用 | `bases-all-files-2026-07`：附件并行索引、明确 conformance；旧库降级会诊断并回传实际口径 | 不是全部 UI/公式/插件或 embedded base 兼容 |
| 官方证据 | 2026-07/08 历史 oracle + 当前固定文档源码；[逐项校正](bases-vs-official.md#5-oracle-校正账本逐条跟官方--不跟官方及理由) | 新文档不等于新运行读数；旧版本的静默空输出不能证明当前版本没有该能力 |

每项区分：**子集内已验证**、**有据差异/自建扩展**、**明确未实现**、**未知/证据不足**。只在同输入、数据集、上下文、clock、预算、投影与独立验收下比较；模型退出成功/终态 truth 不能替代过程和答案义务。产品版本目前 0.10.0，本轮为未发布工作分支改动，不虚构新发布号。

## 2. 当前能力与边界

| 能力 | 分类 | 验证/取舍与后续条件 |
| --- | --- | --- |
| DQL LIST/TABLE、单源 FROM、WHERE、文件多键 SORT、LIMIT/外层分页 | 子集内已验证 | [文法与映射](dql-subset.md)、tests/query*.test.ts；固定子句顺序，不等于上游任意命令链 |
| DQL 文件隐式链接/任务聚合、inline TEXT/FM 优先 | 子集内已验证 | SQLite 查询期计算；[inline D1–D5](inline-fields.md)。不宣传强类型 inline 数值/日期或任意数组高阶 |
| TASK 文件排序（R09） | 子集内已验证 | R09-TASK-001..018：行序/行数/分页/空值/错误位置/注入/原型键/真实 CLI；普通 status/due 是文件属性，completed 仅 WHERE 特判 |
| TASK GROUP BY/FLATTEN、completed/task.* 排序 | 明确未实现 | 现在报错，不再接受后忽略；只有实际任务需要且任务组树/扇出/元信息契约独立批准，才扩建 |
| Bases table、类型/公式/过滤/排序/整体列表键分组/汇总 | 子集内已验证 | [实现状态](bases-status.md)、[矩阵](bases-scenarios.md)和 tests/base-*.test.ts；公式不是每个语境都可访问行外状态 |
| Bases 公式 file()/link.asFile()（R08） | 子集内已验证 | BASE-FORM-FILE-001..016；共用过滤前数据集解析器/clock/预算/this/类型表，逐行缓存。custom summary values 不注入解析器；无额外文件扫描/SQL JOIN |
| Bases 顶层行序、JSON 信封/诊断、资源预算、stdin source | 有据差异/自建扩展 | 稳定输出/安全与无头消费者所需；不是复刻官方本地化输出字节。用 groups 读取组序，不能拿顶层行序推断组内语义 |
| Bases 字符串 + | 历史扩展需重新核对 | 旧取证促成保留超集，但当前官方文档已声明拼接；不得再声称“官方根本不拼接”。下一轮 oracle 固定新版本再裁定同类型、混合类型和日期规则 |
| 显式 this 上下文 | 子集内已验证/宿主边界 | 仅 contextFile；无隐式活动文件。embedded code block/.base 锚点入口仍明确拒绝，用独立 .base/--view 替代 |
| 官方 GUI/CLI 执行、DataviewJS 任意 JS | 不进入产品运行时 | 项目硬约束，不以兼容投入为由引入 GUI/obsidian 包或执行层；历史 oracle 只作为证据来源 |

## 3. 投入顺序与停点

1. **先守已承诺语义**：本轮 R08/R09 已修。后续真实可复现错误先锁独立 RED，再最小修复；不把执行遗漏解释成缺检索或能力不足。
2. **执行验收纪律独立优先**：当前仍有真实二次执行遗漏、外层答案范围违约，以及写后不复核系统提示与显式验收冲突。未来切口先条件化提示/锁过程义务，对照原始 trace；不是本轮两个确定性引擎修复的顺带承诺。
3. **按实际任务补领域能力**：任务 emoji/状态/到期日字段、TASK 组树、default/数组高阶/聚合、FROM 多源、inline 强类型等需新计划、错误/安全矩阵和输出契约；没有需求频率/收益证据时保持未实现，不默认追平上游。
4. **再投资宿主体验/未知语义**：embedded base、动态活动上下文、日期本地化、其他 oracle 未决项需单列快照/输入/版本。无有效读数即停在 unknown，不用“有意差异”掩盖证据缺失。
5. **最后考虑替换基础设施**：Kysely/第三方引擎/embedding/MCP 只有测出当前方案瓶颈、收益和适配失败边界才准入；本轮不增依赖。[选型](../research/2026-10-01-minimal-slice-reuse-assessment.md)未运行竞品，basecli 独立许可证文本仍是集成停点。

任何升级先写清：目标任务、版本/快照、数据集、类型/路径/空值/排序规则、诊断/退出码、安全预算、逐项用例和迁移风险；公共契约改动同步教程/skill/CHANGELOG。重大兼容语义或数据集默认值变化先决定是否需要新 conformance，不静默重写旧口径。

## 4. 验证与剩余风险

- 本轮全量 lint/typecheck/build/test：1223/1223；Bases 定向 299/299、query 定向 115/115。确定性引擎验证与模型实验分别记账，不互代。
- 未验证：新版官方/Dataview oracle、真实大 Vault、其他宿主/模型/平台、竞品性能与完整许可审计；没有独立评审。
- 模型实跑仅合成语料；原 runner/truth 的通过不等于独立过程/范围验收。当前不能宣称复杂任务整体可靠、成本下降或动态 Bases 比 DQL 更优。
- 长期与持续关注不等于正在执行：未完成/关注项保留在根 [TODO.md](../../TODO.md)置顶；只有获准实施后才进入日期执行计划。本账本不隐藏关注项，也不自动启动第 3–5 层投资。

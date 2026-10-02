---
type: status
title: Bases 实现状态追踪
description: living 文档：Bases 各语法项/场景编号的实现状态（已实现/已计划/待开/暂缓/不做）与实现时间，随实现逐项更新
tags:
  - status
  - bases
  - testing
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 9394a6b2fe68e7dd86bf632adb6300f19726c6ccd07c5741b26a641d55bc5470
---
# Bases 实现状态追踪

> 性质：**living 文档**——每完成/计划一个语法项就更新本表（状态 + 日期 + 计划链接），语法事实以 [`../specs/2026-07-26-bases-syntax.md`](bases-syntax.md) 为准，验收编号以 [`2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md) 为准。
> 状态图例：✅ 已实现（标日期）｜📋 已建计划（标计划链接）｜🔜 待开计划（标阶段与前置条件）｜⏸ 暂缓（标触发条件）｜❌ 不做（标理由）。
> 更新纪律：翻状态必须同时更新对应计划/场景矩阵；声称 ✅ 的项必须有可追溯测试编号。

## 2026-10-01 局部复核

当前已有文件/stdin/API source 输入与显式 context；定义无需先落 `.base`。本轮 321 项定向测试及同库入口/能力对照见[局部调研](../research/2026-10-01-dql-bases-compatibility-local-audit.md)。**R08 后续已修复**：公式体的 `file()` / `link.asFile()` 与普通行表达式共用上下文，按需/逐行缓存与自定义 summary 行外禁令不变；`tests/base-formula-file.test.ts` 的 BASE-FORM-FILE-001..016 补齐组合覆盖，Bases 299 项回归通过。原报告保留发现时状态，不代表未修复仍是现状。函数计数不等于每个求值语境都已验证。

本表维护当前能力及测试追溯；2026-07 的取证与函数首次实施明细已集中归档，不覆盖后来的语义决定。上述测试数字是 2026-10-01/02 既有记录，本轮文档整理不重新认证那些结果。

## 总览

| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| P0 | document / schema / diagnostic | ✅ 2026-07-26（[计划](../archive/plans/2026-07-26-bases-p0-document-schema.md)） |
| P1 | Markdown query vertical slice（独立 AST/evaluator） | ✅ 2026-07-26（[计划](../archive/plans/2026-07-26-bases-p1-markdown-query.md)） |
| P1 oracle | 官方差分（争议语义冻结） | ✅ 2026-07-28 **取证完成**（Obsidian 1.12.7，26 view 全部两次一致，19 一致 / 7 分歧）；**校正第一批（①②④）✅ 已落地**，⑦⑧ 后续校正已落地、部分超集保留 boundary，当前取舍见 [vs-official §5](bases-vs-official.md)。同日上午的「⏸ 暂缓」决策已被推翻，理由见 runbook §0.1 |
| P2a | formulas 核心（typed values + 算术 + 依赖图/cycle + clock） | ✅ 2026-07-27（[计划](../archive/plans/2026-07-27-bases-p2a-formulas.md)） |
| P2b | types.json / list 高阶 / groupBy / summaries | ✅ 2026-07-27（[计划](../archive/plans/2026-07-27-bases-p2b-types-list-group-summary.md)） |
| P3 | all-files / context / 嵌入 | 🔀 P3a 附件数据集 ✅ 2026-07-27（[计划](../archive/plans/2026-07-27-bases-p3-attachments.md)）；context ✅ 2026-07-28（覆盖率片六 CTX-001）；嵌入形态 ❌ 不做 + 诊断（CTX-002/003） |
| review 修复 | P0..P2b 收口后的评审修复（静默失败 + 资源模型） | ✅ 2026-07-27（[计划](../archive/plans/2026-07-27-bases-code-review-fixes.md)） |
| 函数覆盖率 | 叶子函数补齐（六片） | ✅ 已实现；当前白名单/语义见 [bases-syntax](bases-syntax.md)，实施数量与质量门读数见[历史记录](../archive/decisions/2026-07-28-bases-implementation-record.md#6-函数覆盖率补齐--2026-07-28六片全部落地计划) |

## 1. 文档层（P0）✅ 2026-07-26

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 最小合法 `.base` 解析、默认 view | BASE-DOC-001 | ✅ 2026-07-26 |
| 非法 YAML 诊断（完整文件位置） | BASE-DOC-002 | ✅ 2026-07-26 |
| `views` 缺失/空 → view-required | BASE-DOC-003 | ✅ 2026-07-26 |
| 重名 view → duplicate-view-name | BASE-DOC-004 | ✅ 2026-07-26 |
| view-not-found + suggestions | BASE-DOC-005 | ✅ 2026-07-26 |
| 未知顶层 key warning + 原值保留 | BASE-DOC-006 | ✅ 2026-07-26 |
| 未知/插件 view type、cards/list/map | BASE-DOC-007 | ✅ 2026-07-26 |
| 未知函数（含旧 snake_case）浅扫描 | BASE-DOC-008 | ✅ 2026-07-26（名字级；receiver/arity 校验属 P1） |
| 超深 filter 深度预算 | BASE-DOC-009 | ✅ 2026-07-26 |
| YAML alias bomb / 路径越界 | BASE-SEC-007/008 | ✅ 2026-07-26 |
| filter 结构校验（and/or/not 单键、children 保序） | 设计 §6 | ✅ 2026-07-26 |
| `formulas`/`summaries`/`groupBy` 结构记录与校验 | 设计 §5 / BASE-FORM / BASE-SUM / BASE-GROUP | ✅ 当前支持；P0 拒绝只是旧阶段边界，已由 P2a/P2b 接替（见 §4） |
| properties/order/sort/limit 结构记录与校验 | 设计 §5 | ✅ 2026-07-26（property-ref 合法性 P1 再验） |

## 2. 查询主路径（P1）✅ 2026-07-26

> 计划：[`../plans/2026-07-26-bases-p1-markdown-query.md`](../archive/plans/2026-07-26-bases-p1-markdown-query.md)。测试追溯：文法层 `tests/base-expression.test.ts`、求值层 `tests/base-evaluator.test.ts`、端到端 `tests/base-engine.test.ts`，用例注释均标场景编号。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| view 选择（views[0] / 命名 view） | BASE-VIEW-001/002 | ✅ 2026-07-26（selectView API 于 P0，e2e 于 P1） |
| global + view filter AND 合并 | BASE-VIEW-003 | ✅ 2026-07-26 |
| 递归 and/or/not 求值 | BASE-VIEW-004 | ✅ 2026-07-26（空数组 ✅ 2026-07-28 经 oracle ④ 冻结：`and:[]`=真 / `or:[]`=假 / `not:[]`=真，不再拒绝，见 §3） |
| md-only 执行 + conformance warning | BASE-DATA-001/002 | ✅ 2026-07-26（`base/markdown-only-dataset` warning 每次查询恒发） |
| 空 vault / 多根 vault | BASE-DATA-003/004 | ✅ 2026-07-26 |
| 属性引用：`status`/`note.status`/`note["…"]`/Unicode | BASE-PROP-001..003 | ✅ 2026-07-26（文法 + 求值 + e2e 三层用例） |
| missing/null/空串/0/false/空列表 truthiness | BASE-PROP-004 | ✅ 2026-07-28 经 oracle ① 冻结（六形态全 falsy，与实现一致；equality 侧的 MISSING/null 合并同批校正） |
| `file.properties` | BASE-PROP-005 | ✅ 2026-07-26 |
| 非 Markdown 行访问 note property | BASE-PROP-006 | ✅ 2026-07-26（P1 不产生该类行——附件不为行，由 BASE-DATA-002 用例覆盖；all-files 阶段口径见 P3） |
| file fields（path/name/…/ctime/mtime） | BASE-FILE-001 | ✅ 2026-07-26（输出为 epoch ms number；与日期混合的算术按值层 datetime 规则处理） |
| `file.inFolder` / `hasTag` / `hasProperty` / `hasLink` | BASE-FILE-002..005 | ✅ 2026-07-26（hasLink bare/qualified/embed 三分支独立用例） |
| 比较/布尔/优先级文法（Chevrotain parser） | BASE-EXPR-001/002 | ✅ 2026-07-26（`src/base/tokens.ts`/`parser.ts`，独立于 DQL token/AST） |
| string/list 方法、typed equality | BASE-EXPR-003/004 | ✅ 2026-07-26 |
| `if()`/`list()`/`number()` | BASE-EXPR-005 | ✅ 2026-07-26（`if` lazy ✅ 2026-07-28 经 oracle ③ 冻结，与实现一致；number 转换失败 = 行级类型错误） |
| `order` 投影 / 多键 sort / limit / 默认 file.path tie-break | BASE-RESULT-001..004 | ✅ 2026-07-26（null 排序位置 ✅ 2026-07-28 经 oracle ② 冻结为「恒排最后、与方向无关」并修复 DESC 漂移；无显式 sort 给 `base/default-sort-tiebreak` info） |
| 属性访问白名单 / 无 eval / 参数化 SQL | BASE-SEC-001/002/003 | ✅ 2026-07-26 |
| view 必填字段（type/name 缺失即 error，不按 table 猜测） | 设计 §5 | ✅ 2026-07-27（review 修复；缺失校验移出 key 循环） |
| `order`/`sort` 非法项报错而非静默丢弃 | 设计 §5 | ✅ 2026-07-27（review 修复） |
| 越界防线跨平台（Windows 盘符大小写不假阳） | BASE-SEC-008 | ✅ 2026-07-27（review 修复；共享 `isPathInside`） |
| 多根 `.base` 主键与行 `file.path` 同一命名空间键 | BASE-DATA-004 | ✅ 2026-07-27（review 修复；统一走 `resolveVaultLayout`） |
| 查询级操作数总额（跨行累计，防「每行都烧到单次上限」） | 设计 §12 延伸 | ✅ 2026-07-27（review 修复；`maxTotalOperations` 默认 5e7） |
| 恶意属性名入 JSON path/SQL | BASE-SEC-009 | ✅ 2026-07-26（属性名不进 SQL，own-property 白名单） |
| 结果字节稳定（同 DB+Base+clock 重跑） | 矩阵 §9 P1 门 | ✅ 2026-07-26（两次 `JSON.stringify(query())` 全等专项用例） |
| 1/100/10,000 篇基准（只记录不承诺） | 矩阵 §9 P1 门 | ✅ 2026-07-26（query 11ms/4ms/68ms，数值见计划「验证结论」，无需 SQL 下推） |
| CLI 薄出口（`base` 命令）+ guides 补 Bases 章节 | 设计 §15（API 先于 CLI） | ✅ 2026-07-27（[计划](../archive/plans/2026-07-27-bases-cli-export.md)；`x-basalt base` + `guides/querying-bases.md`，tests/base-cli.test.ts 7 用例） |

## 3. P1 前置 oracle ✅ 取证完成 / 第一二批校正 ✅ 已落地（round-2 判定已出）

旧观察与分批校正见[归档](../archive/decisions/2026-07-28-bases-implementation-record.md#3-p1-前置-oracle--取证完成--第一二批校正--已落地round-2-判定已出)；当前逐项取舍见 [vs-official §5](bases-vs-official.md#5-oracle-校正账本逐条跟官方--不跟官方及理由) 和[兼容账本](query-compatibility-ledger.md)。旧版静默空拼接不证明当前官方不支持字符串 `+`；BASE-TYPE-004/005/006、附件链接等未知项继续保留，不因已完成两轮取证全部翻为已验证。

## 4. P2 typed formulas / group / summary（P2a ✅ / P2b ✅ 2026-07-27）

> P2a 计划：[`../plans/2026-07-27-bases-p2a-formulas.md`](../archive/plans/2026-07-27-bases-p2a-formulas.md)；P2b 计划：[`../plans/2026-07-27-bases-p2b-types-list-group-summary.md`](../archive/plans/2026-07-27-bases-p2b-types-list-group-summary.md)。
> 测试：`tests/base-formula.test.ts`、`tests/base-values-date.test.ts`（P2a）；`tests/base-list-hof.test.ts`、`tests/base-typeschema.test.ts`、`tests/base-group-summary.test.ts`（P2b）。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| `.obsidian/types.json` 读取 / 缺失回退 / 非法 warning | BASE-TYPE-001..003 | ✅ 2026-07-27（P2b；可选只读、永不写回、多根先根优先暂定） |
| 不加引号的 YAML 日期（`due: 2026-08-10`）识别为日期值 | BASE-TYPE-005 延伸 | ✅ 2026-07-27（根因在读侧 YAML 引擎：改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型），日期保持字符串由值层按词法判定精度；`tests/base-yaml-dates.test.ts` + `tests/parser.test.ts` 锁「加/不加引号等价」与 date 精度不退化） |
| 声明类型与值冲突 → type-mismatch | BASE-TYPE-004 | ⏸ oracle（P2b 已落暂定口径：行级 warning + 值按运行时类型参与，不静默字符串比较） |
| date vs datetime 比较（固定时区） | BASE-TYPE-005 | ⏸ oracle（P2a 已落暂定机制：严格 ISO 推断 + 统一 epoch 比较） |
| frontmatter wikilink → Link value | BASE-TYPE-006 | ⏸ oracle（P2a 已落暂定机制：`[[target]]`/`[[t\|d]]`/`[[t#sub]]` → Link value，路径感知相等） |
| 常量/算术公式、引用属性/公式、拓扑排序 | BASE-FORM-001..003 | ✅ 2026-07-27（P2a；Kahn 拓扑与 YAML 键序无关） |
| 公式 `file()` / `link.asFile()` 关联读取 | BASE-FORM-FILE-001..016 | ✅ 2026-10-01（[矩阵](bases-scenarios.md#51-公式关联读取r08)、[顺序计划](../archive/plans/2026-10-01-todo-sequential-cleanup.md#5-bases-公式-file--asfile)；filter/sort/投影/group/summary 目标、多根/附件/安全/预算与 CLI） |
| 公式循环 → formula-cycle | BASE-FORM-004 / BASE-SEC-006 | ✅ 2026-07-27（P2a；message 含完整循环链；maxFormulaNodes 256 / maxFormulaDepth 64，超限含依赖路径） |
| 公式运行时类型错误行级诊断 | BASE-FORM-005 | ✅ 2026-07-27（P2a；行级 warning + cell null，不误伤他行） |
| `today`/`now`（clock 注入） | BASE-FORM-006 | ✅ 2026-07-27（P2a；同 clock 两次 query 字节一致） |
| list filter/map/reduce（value/index/acc 隐式作用域） | BASE-LIST-001 / BASE-SEC-005 | ✅ 2026-07-27（P2b；lazy 分派 + 作用域栈，flat/sort/unique/join 同批；迭代/collection/callDepth 预算） |
| groupBy 标量 / 列表/tag | BASE-GROUP-001/002 | GROUP-001 ✅ 2026-07-27（P2b；`groups` 增量字段，组序方向 + 组内稳定）；**GROUP-002 ✅ 2026-08-03 校正**（整列表键成组、不扇出；空列表键为 `[]`，link 标量键可用；顶层行序为 boundary，本轮 R04 复现） |
| 默认汇总 / custom summary values | BASE-SUM-001/002 | SUM-001 ✅ 2026-07-27（P2b；15 内置）；SUM-002 ✅ 2026-07-28 收口（`values` 作用域 + **组级汇总 `groups[].summaries`**）；**计算集 ✅ 2026-07-29 改为 limit 后**（oracle⑧(b) 跟官方，原「limit 前全量」已翻，breaking）；**空值 ✅ 2026-08-03 校正**（values 含 null/MISSING，mean 计分母；自定义汇总禁止行外状态，本轮相关测试通过） |
| regex（若支持必须 ReDoS 防护 + 长度预算） | BASE-SEC-004 | ✅ 2026-07-28（覆盖率片四：`string.matches(pattern)` + 三层防护；见 §6 片四明细） |

## 5. P3 all-files / context（P3a 附件数据集 ✅ 2026-07-27）

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 附件作为行（图片/PDF/Canvas/.base） | BASE-ALL-001 | ✅ 2026-07-27（[P3a 计划](../archive/plans/2026-07-27-bases-p3-attachments.md)：独立 `vault_entries` 表 + indexer 六条写入路径 + all-files 数据源 + CLI `--conformance`；「DQL 不变」证明 11①③④ 与跨表 path 唯一性 12 全部落成测试） |
| 附件 links/backlinks/embeds | BASE-ALL-002 | ✅ 2026-07-27（P3a 满足线：附件行出链恒 `[]`、不伪造内容链接；附件作为链接 target 的命中关系可查询（笔记行 `file.links` 含原始 target，embed `![[img.png]]` 计入 links 表 is_embed=1）——暂定口径待 oracle） |
| 独立 `.base` 的 `this`（显式 contextFile） | BASE-CTX-001 | ✅ 2026-07-28（覆盖率片六；`this.file.*` / `this.<属性>` / 裸 `this`，公式体内可用；解析口径同 `file(path)`；给了却解析不到 → error + 空结果） |
| Markdown `base` code block | BASE-CTX-002 | ❌ 不做（用户 2026-07-28 拍板）+ ✅ 诊断已落地：入口形态检查（**读文件之前**按路径形态判定，避免被 YAML 解析失败掩盖）报 `base/unsupported-feature`，消息含替代写法「把查询定义单独存成 .base 文件」 |
| `![[View.base#Name]]` embed | BASE-CTX-003 | ❌ 不做（同上）+ ✅ 诊断已落地：路径含 `#` 锚点 → `base/unsupported-feature`，消息直接给出可照抄的 `--view <名>` 替代命令 |
| sidebar/active-file 语义（禁环境隐式状态） | BASE-CTX-004 | ❌ 不做（同上）+ ✅ 由「不给 `contextFile` 即报 `base/dynamic-context-required`」覆盖——隐式环境状态不可重复、不可测，一律不猜 |
| 插件 view/function | BASE-PLUGIN-001 | ⏸ 默认拒绝；显式注册纯函数扩展需真实需求再议 |

## 6. 函数覆盖率补齐 ✅ 2026-07-28（六片全部落地，[计划](../archive/plans/2026-07-28-bases-functions.md)）

六片实施与早期口径见[归档](../archive/decisions/2026-07-28-bases-implementation-record.md#6-函数覆盖率补齐--2026-07-28六片全部落地计划)。当前叶子/日期/链接/正则/上下文与端到端规则由 [bases-syntax](bases-syntax.md) 及 `tests/base-functions-*.test.ts`、`base-context.test.ts` 承载；函数单测不代替真实查询接线。

当前安全边界包括：正则限长与静态拒绝/有界缓存、集合/字符串产物预算、`random` 与渲染类显式拒绝；`file()` 只解析当前数据集，不查额外文件，自定义 summary `values` 不注入行外状态。`date.time()` 为 `HH:mm:ss` 字符串、month=31d，列表键整体成组，不沿用首次实现的 duration/30d/扇出口径。

## 7. 不做 / 暂缓（理由记录）

| 项 | 状态 | 理由 |
| ---- | ---- | ---- |
| 渲染 table/cards/list/map 布局 | ❌ | 查询内核不渲染（设计 §1） |
| 复刻官方 CLI 输出字节 / 用官方 CLI 兜底执行 | ❌ | 官方 JSON 非稳定 schema；CLI 依赖 GUI（设计 §14） |
| 自动改写旧 `.base` / 写 `.obsidian/types.json` | ❌ | 只读原则（设计 §14） |
| `.base` → DQL 文本翻译器 | ❌ | 两套语言独立 AST（设计 §14） |
| Dataview inline fields 当 Bases properties | ❌ | 官方 Bases 不支持（设计 §10） |
| 未经验证就标「完整兼容」 | ❌ | 版本化 conformance 政策（语法文档 §8） |
| chat 打磨 / DQL 函数全集 / task emoji / lint CI / embedding / 复杂编排器 | ⏸ | 按实际需求另案投入，未完成项持续保留根 TODO；P0/P1 已结束，不再沿用旧阶段的全局冻结排序 |

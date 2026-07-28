---
type: status
title: Bases 实现状态追踪
description: living 文档：Bases 各语法项/场景编号的实现状态（已实现/已计划/待开/暂缓/不做）与实现时间，随实现逐项更新
tags:
  - status
  - bases
  - testing
  - x-basalt
timestamp: 2026-07-28T02:55:34Z
sha256: 0cd80053b57707074a7d616feecdcf1de84478f1cedc7718f5af8001f90de60a
---
# Bases 实现状态追踪

> 性质：**living 文档**——每完成/计划一个语法项就更新本表（状态 + 日期 + 计划链接），语法事实以 [`../specs/2026-07-26-bases-syntax.md`](bases-syntax.md) 为准，验收编号以 [`2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md) 为准。
> 状态图例：✅ 已实现（标日期）｜📋 已建计划（标计划链接）｜🔜 待开计划（标阶段与前置条件）｜⏸ 暂缓（标触发条件）｜❌ 不做（标理由）。
> 更新纪律：翻状态必须同时更新对应计划/场景矩阵；声称 ✅ 的项必须有可追溯测试编号。

## 总览

| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| P0 | document / schema / diagnostic | ✅ 2026-07-26（[计划](../history/plans/2026-07-26-bases-p0-document-schema.md)） |
| P1 | Markdown query vertical slice（独立 AST/evaluator） | ✅ 2026-07-26（[计划](../history/plans/2026-07-26-bases-p1-markdown-query.md)） |
| P1 oracle | 官方差分（争议语义冻结） | ✅ 2026-07-28 **取证完成**（Obsidian 1.12.7，26 view 全部两次一致，19 一致 / 7 分歧）；**校正未动手**，待办见 [runbook §5](bases-oracle-runbook.md)。同日上午的「⏸ 暂缓」决策已被推翻，理由见 runbook §0.1 |
| P2a | formulas 核心（typed values + 算术 + 依赖图/cycle + clock） | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p2a-formulas.md)） |
| P2b | types.json / list 高阶 / groupBy / summaries | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p2b-types-list-group-summary.md)） |
| P3 | all-files / context / 嵌入 | 🔀 P3a 附件数据集 ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p3-attachments.md)）；context ✅ 2026-07-28（覆盖率片六 CTX-001）；嵌入形态 ❌ 不做 + 诊断（CTX-002/003） |
| review 修复 | P0..P2b 收口后的评审修复（静默失败 + 资源模型） | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-code-review-fixes.md)） |
| 函数覆盖率 | 叶子函数补齐（六片） | ✅ 2026-07-28 六片全部落地（[计划](../history/plans/2026-07-28-bases-functions.md)）：注册表条目 **35 → 68**，其中 63 条可执行、5 条为白名单内显式拒绝（4 渲染类 + `random`）。四门全绿（test **880**，基线 820） |

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
| `formulas`/`summaries`/`groupBy` 报 unsupported-feature | 设计 §5 | ✅ 2026-07-26 |
| properties/order/sort/limit 结构记录与校验 | 设计 §5 | ✅ 2026-07-26（property-ref 合法性 P1 再验） |

## 2. 查询主路径（P1）✅ 2026-07-26

> 计划：[`../plans/2026-07-26-bases-p1-markdown-query.md`](../history/plans/2026-07-26-bases-p1-markdown-query.md)。测试追溯：文法层 `tests/base-expression.test.ts`、求值层 `tests/base-evaluator.test.ts`、端到端 `tests/base-engine.test.ts`，用例注释均标场景编号。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| view 选择（views[0] / 命名 view） | BASE-VIEW-001/002 | ✅ 2026-07-26（selectView API 于 P0，e2e 于 P1） |
| global + view filter AND 合并 | BASE-VIEW-003 | ✅ 2026-07-26 |
| 递归 and/or/not 求值 | BASE-VIEW-004 | ✅ 2026-07-26（空数组 P1 直接报 `base/unsupported-feature` 拒绝并注明待 oracle，见 §3） |
| md-only 执行 + conformance warning | BASE-DATA-001/002 | ✅ 2026-07-26（`base/markdown-only-dataset` warning 每次查询恒发） |
| 空 vault / 多根 vault | BASE-DATA-003/004 | ✅ 2026-07-26 |
| 属性引用：`status`/`note.status`/`note["…"]`/Unicode | BASE-PROP-001..003 | ✅ 2026-07-26（文法 + 求值 + e2e 三层用例） |
| missing/null/空串/0/false/空列表 truthiness | BASE-PROP-004 | ⏸ 待 oracle 冻结（暂定口径已锁定于 evaluator 用例并注释标注） |
| `file.properties` | BASE-PROP-005 | ✅ 2026-07-26 |
| 非 Markdown 行访问 note property | BASE-PROP-006 | ✅ 2026-07-26（P1 不产生该类行——附件不为行，由 BASE-DATA-002 用例覆盖；all-files 阶段口径见 P3） |
| file fields（path/name/…/ctime/mtime） | BASE-FILE-001 | ✅ 2026-07-26（ctime/mtime 为 epoch ms number，P1 无 Date runtime） |
| `file.inFolder` / `hasTag` / `hasProperty` / `hasLink` | BASE-FILE-002..005 | ✅ 2026-07-26（hasLink bare/qualified/embed 三分支独立用例） |
| 比较/布尔/优先级文法（Chevrotain parser） | BASE-EXPR-001/002 | ✅ 2026-07-26（`src/base/tokens.ts`/`parser.ts`，独立于 DQL token/AST） |
| string/list 方法、typed equality | BASE-EXPR-003/004 | ✅ 2026-07-26 |
| `if()`/`list()`/`number()` | BASE-EXPR-005 | ✅ 2026-07-26（`if` lazy 为暂定实现，待 oracle；number 转换失败 = 行级类型错误） |
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
| CLI 薄出口（`base` 命令）+ guides 补 Bases 章节 | 设计 §15（API 先于 CLI） | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-cli-export.md)；`x-basalt base` + `guides/querying-bases.md`，tests/base-cli.test.ts 7 用例） |

## 3. P1 前置 oracle ✅ 取证完成 / ⏳ 校正未动手

> **2026-07-28：26 个 view 全部取证完毕**（Obsidian 1.12.7，每个 view 连跑两次全部一致，无 `implementation-defined`）。
> 同日上午曾判「⏸ 整体暂缓、不再排期」，当天下午被推翻——官方 CLI 的 `eval` 能读到 Bases 算好的行集，
> 取证可脚本化、不需要人逐个点。误判复盘见 [runbook §0.1](bases-oracle-runbook.md)。
> **下表状态是「官方结论已知，但实现一行未改」**——⏳ 表示待校正，逐条取舍见 [runbook §5](bases-oracle-runbook.md)。

| 争议语义 | 场景编号 | 官方结论 | 状态 |
| ---- | ---- | ---- | ---- |
| missing/null/空串/0/false/空列表 truthiness | BASE-PROP-004 | 六形态全 falsy，**与实现一致** | ✅ 可转正 |
| `X == null` 与 MISSING 是否合并 | BASE-PROP-004 | **合并**（`missing == null` 为 true） | ✅ 2026-07-28 已校正（跟官方；合并落在 `typedEqual`，分组/`unique`/`contains` 一并生效，`isType("null")` 有意不跟随；取舍见 [vs-official §5.1](bases-vs-official.md)） |
| 多键 sort 的 null 位置 | BASE-RESULT-002 | 恒排最后，与方向无关 | ✅ 2026-07-28 已校正（当 bug 修：`sortKeyCompareDirected` 让方向只作用于可比值，空值组恒最后；回归用例 `base-engine.test.ts` / `base-values-date.test.ts` 标 oracle ②） |
| 空 filter 数组（and:[]/or:[]/not:[]） | 设计 §6 | `and:[]`=真 / `or:[]`=假 / `not:[]`=真 | ⏳ 分歧待校正（当前是拒绝） |
| `if()` lazy branch | 设计 §9 | lazy，**与实现一致** | ✅ 可转正 |
| 二元运算的字符串→日期推断是否作用于 `+` | 语法 §5.1 / 设计 §8.3 | **原命题不成立**：官方 `+` 根本不拼接字符串，string+string 也得空 | ⏳ 倾向保留超集 + 落 boundary |
| 自定义 summary 的 `values` 边界 | BASE-SUM-002 | **含** null/missing（计入分母）、按 **limit 后** | ⏳ 两维度都与实现相反 |
| list 分组键扇出的顶层行序 | BASE-GROUP-002 | 顶层 rows 顺序随分组键变动 | ⏳ 与字节稳定契约冲突，待取舍 |
| **默认数据集是否含 `.base` 自身** | BASE-DATA-001/002 | **含**（`.base` 文件自身也是行） | ⏳ 本轮新发现，原不在清单 |

> 取证方式与三个会静默出错的坑见 [runbook §0.2](bases-oracle-runbook.md)。原始观察数据由取证侧留档（不入本仓：机器生成、体量大，且与 §4 的人读结论重复存放必然漂移）。
> **⑩..㉖ 共 17 条仍无 fixture view**（见 runbook §1.1 / §1.2）——取证已脚本化，补 view 是唯一门槛。
> 校正清单 `rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`。

## 4. P2 typed formulas / group / summary（P2a ✅ / P2b ✅ 2026-07-27）

> P2a 计划：[`../plans/2026-07-27-bases-p2a-formulas.md`](../history/plans/2026-07-27-bases-p2a-formulas.md)；P2b 计划：[`../plans/2026-07-27-bases-p2b-types-list-group-summary.md`](../history/plans/2026-07-27-bases-p2b-types-list-group-summary.md)。
> 测试：`tests/base-formula.test.ts`、`tests/base-values-date.test.ts`（P2a）；`tests/base-list-hof.test.ts`、`tests/base-typeschema.test.ts`、`tests/base-group-summary.test.ts`（P2b）。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| `.obsidian/types.json` 读取 / 缺失回退 / 非法 warning | BASE-TYPE-001..003 | ✅ 2026-07-27（P2b；可选只读、永不写回、多根先根优先暂定） |
| 不加引号的 YAML 日期（`due: 2026-08-10`）识别为日期值 | BASE-TYPE-005 延伸 | ✅ 2026-07-27（根因在读侧 YAML 引擎：改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型），日期保持字符串由值层按词法判定精度；`tests/base-yaml-dates.test.ts` + `tests/parser.test.ts` 锁「加/不加引号等价」与 date 精度不退化） |
| 声明类型与值冲突 → type-mismatch | BASE-TYPE-004 | ⏸ oracle（P2b 已落暂定口径：行级 warning + 值按运行时类型参与，不静默字符串比较） |
| date vs datetime 比较（固定时区） | BASE-TYPE-005 | ⏸ oracle（P2a 已落暂定机制：严格 ISO 推断 + 统一 epoch 比较） |
| frontmatter wikilink → Link value | BASE-TYPE-006 | ⏸ oracle（P2a 已落暂定机制：`[[target]]`/`[[t\|d]]`/`[[t#sub]]` → Link value，路径感知相等） |
| 常量/算术公式、引用属性/公式、拓扑排序 | BASE-FORM-001..003 | ✅ 2026-07-27（P2a；Kahn 拓扑与 YAML 键序无关） |
| 公式循环 → formula-cycle | BASE-FORM-004 / BASE-SEC-006 | ✅ 2026-07-27（P2a；message 含完整循环链；maxFormulaNodes 256 / maxFormulaDepth 64，超限含依赖路径） |
| 公式运行时类型错误行级诊断 | BASE-FORM-005 | ✅ 2026-07-27（P2a；行级 warning + cell null，不误伤他行） |
| `today`/`now`（clock 注入） | BASE-FORM-006 | ✅ 2026-07-27（P2a；同 clock 两次 query 字节一致） |
| list filter/map/reduce（value/index/acc 隐式作用域） | BASE-LIST-001 / BASE-SEC-005 | ✅ 2026-07-27（P2b；lazy 分派 + 作用域栈，flat/sort/unique/join 同批；迭代/collection/callDepth 预算） |
| groupBy 标量 / 列表/tag | BASE-GROUP-001/002 | GROUP-001 ✅ 2026-07-27（P2b；`groups` 增量字段，组序方向 + 组内稳定）；**GROUP-002 ✅ 2026-07-28**（覆盖率片五：list 键扇出、link 标量键；语义仍属暂定口径待 oracle，但已不再拒绝） |
| 默认汇总 / custom summary values | BASE-SUM-001/002 | SUM-001 ✅ 2026-07-27（P2b；15 内置，limit 前全量暂定）；SUM-002 ✅ 2026-07-28 收口（`values` 作用域 + **组级汇总 `groups[].summaries`**；空值剔除/越权口径仍为暂定，待 oracle） |
| regex（若支持必须 ReDoS 防护 + 长度预算） | BASE-SEC-004 | ✅ 2026-07-28（覆盖率片四：`string.matches(pattern)` + 三层防护；见 §6 片四明细） |

## 5. P3 all-files / context（P3a 附件数据集 ✅ 2026-07-27）

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 附件作为行（图片/PDF/Canvas/.base） | BASE-ALL-001 | ✅ 2026-07-27（[P3a 计划](../history/plans/2026-07-27-bases-p3-attachments.md)：独立 `vault_entries` 表 + indexer 六条写入路径 + all-files 数据源 + CLI `--conformance`；「DQL 不变」证明 11①③④ 与跨表 path 唯一性 12 全部落成测试） |
| 附件 links/backlinks/embeds | BASE-ALL-002 | ✅ 2026-07-27（P3a 满足线：附件行出链恒 `[]`、不伪造内容链接；附件作为链接 target 的命中关系可查询（笔记行 `file.links` 含原始 target，embed `![[img.png]]` 计入 links 表 is_embed=1）——暂定口径待 oracle） |
| 独立 `.base` 的 `this`（显式 contextFile） | BASE-CTX-001 | ✅ 2026-07-28（覆盖率片六；`this.file.*` / `this.<属性>` / 裸 `this`，公式体内可用；解析口径同 `file(path)`；给了却解析不到 → error + 空结果） |
| Markdown `base` code block | BASE-CTX-002 | ❌ 不做（用户 2026-07-28 拍板）+ ✅ 诊断已落地：入口形态检查（**读文件之前**按路径形态判定，避免被 YAML 解析失败掩盖）报 `base/unsupported-feature`，消息含替代写法「把查询定义单独存成 .base 文件」 |
| `![[View.base#Name]]` embed | BASE-CTX-003 | ❌ 不做（同上）+ ✅ 诊断已落地：路径含 `#` 锚点 → `base/unsupported-feature`，消息直接给出可照抄的 `--view <名>` 替代命令 |
| sidebar/active-file 语义（禁环境隐式状态） | BASE-CTX-004 | ❌ 不做（同上）+ ✅ 由「不给 `contextFile` 即报 `base/dynamic-context-required`」覆盖——隐式环境状态不可重复、不可测，一律不猜 |
| 插件 view/function | BASE-PLUGIN-001 | ⏸ 默认拒绝；显式注册纯函数扩展需真实需求再议 |

## 6. 函数覆盖率补齐 ✅ 2026-07-28（六片全部落地，[计划](../history/plans/2026-07-28-bases-functions.md)）

> 缺口全在**叶子函数**：注册表 / 名字真相源 / 运行时分派三处骨架已成型，补函数 = 扩表 + 扩分派组 + 补用例。
> 每片完成后本表翻标（日期 + 测试文件）。
>
> **测试分两层**：各片的求值层单测（合成 BaseRow，锁语义细节）+ `tests/base-functions-e2e.test.ts`
> （经 BaseEngine 跑真实索引，锁「函数在真查询里确实能用」）。后者是**补漏检**而非补覆盖率——
> 变异检验实测：删掉 `engine.ts` 的 `resolveFile:` 注入行，只有单测时 880 例仍全绿，
> 而 `file()`/`link().asFile()` 在真实查询里已经报错。CLI `--context-file` 同理，见 `tests/base-cli.test.ts`。

| 片 | 内容 | 状态 |
| ---- | ---- | ---- |
| 片一 | 机械叶子 16 个 + 渲染类 4 个显式拒绝 + `round` 归组 | ✅ 2026-07-28（`tests/base-functions-leaf.test.ts` 18 用例；838 全量绿） |
| 片二 | Date/Duration 族 6 个（`date()`/`duration()`/`format`/`time`/`relative`/`isEmpty`），新增 `date` 分派组 | ✅ 2026-07-28（`tests/base-functions-date.test.ts` 11 用例；850 全量绿） |
| 片三 | Link/File 互转 5 个（`asFile`/`linksTo`/`asLink`/`file()`/`link()`） | ✅ 2026-07-28（`tests/base-functions-link.test.ts` 8 用例；858 全量绿。**含文法改动**：`file(...)` 调用形态） |
| 片四 | `matches`（regex）+ ReDoS 防护 | ✅ 2026-07-28（`tests/base-functions-regex.test.ts` 8 用例；866 全量绿） |
| 片五 | list/link 当分组键 + 自定义汇总收口 | ✅ 2026-07-28（`tests/base-group-summary.test.ts` +4 用例；870 全量绿） |
| 片六 | 显式 `contextFile` + `this.*` 求值 | ✅ 2026-07-28（`tests/base-context.test.ts` 10 用例；880 全量绿。CTX-002/003 落成**入口形态诊断**，CTX-004 由「不给即拒绝」覆盖） |

### 片一明细 ✅ 2026-07-28

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| string `replace`/`repeat`/`reverse`/`slice`/`split`/`title`/`isEmpty` | BASE-EXPR-003 | ✅ 2026-07-28（自建口径见语法 §4.4 尾注，待 oracle） |
| number 分派组新增（`receiverGroupOf` 返 `"number"`）+ `abs`/`ceil`/`floor`/`toFixed`/`isEmpty` | BASE-EXPR-005 | ✅ 2026-07-28（`toFixed` 返 string；`isEmpty` 恒 false） |
| `round` 由 `any` 组迁入 `number` 组 | BASE-SUM-001 | ✅ 2026-07-28（语义不变；`"x".round()` message 由「参数类型错误」变「类型 string 不支持方法」，rule 不变） |
| list `reverse`/`slice`（`reverse` 产新数组，不污染行状态） | BASE-EXPR-004 | ✅ 2026-07-28 |
| global `max`/`min`（变长 number 参） | BASE-EXPR-005 | ✅ 2026-07-28 |
| 渲染类 `escapeHTML`/`html`/`image`/`icon` 白名单内显式拒绝 | 设计 §1 | ✅ 2026-07-28（新增 `BaseUnsupportedError` → `base/unsupported-feature`，与 `property-type-mismatch` 分开，读出方可据 rule 区分「用错类型」与「本引擎不做」） |
| `repeat`/`replace`/`split` 产物规模预算（string 计字符数，`repeat` 分配前预检） | BASE-SEC-005 延伸 | ✅ 2026-07-28 |
| `random()` × 字节稳定冲突 | 语法 §4.4 | ✅ 2026-07-28 **直接拒绝**（用户拍板；白名单内报 `base/unsupported-feature`，消息说明是契约冲突而非「不渲染」，与渲染类分开断言） |

### 片六明细 ✅ 2026-07-28（BASE-CTX-001；CTX-002/003/004 ❌ 不做 + 诊断）

> 测试：`tests/base-context.test.ts`（10 用例）+ fixture `views/context.base`。CLI 增 `--context-file`。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 显式 `contextFile` 驱动 `this.*`（filter / 投影 / 公式体内） | BASE-CTX-001 | ✅ 2026-07-28（`this.file.*` 取上下文行 file 字段、`this.<属性>` 取其 note 属性、裸 `this` 为其 note 对象；note 读取与 `note.<key>` **共用 `evalNoteKey`**，防两处类型升级链分叉） |
| contextFile 路径解析口径 = `file(path)` | BASE-CTX-001 | ✅ 2026-07-28（复用同一个 `createFileResolver`，不造第二套路径口径；完整路径 / 去扩展名忽略大小写 / bare basename 三种写法等价，专项用例） |
| 给了 contextFile 却解析不到 → error + 空结果 | BASE-CTX-001 | ✅ 2026-07-28（**不静默当没给**——否则 `this.*` 会退化成「需要上下文」的误导性诊断） |
| 自定义汇总 `values` 作用域内 `this.*` 仍拒绝 | SUM-002 延伸 | ✅ 2026-07-28（该语境有意不注入 contextRow，与 note/file/`file()` 同一「禁访问行外状态」原则） |
| 入口形态检查（CTX-002/003 的诊断落点） | BASE-CTX-002/003 | ✅ 2026-07-28（**在读文件之前**按路径形态判定：带 `#` → 指向 `--view`；非 `.base` 扩展名 → 指向「单独存成 .base」。专项用例断言指向不存在的 `.md` 时仍给形态诊断而非 ENOENT/invalid-yaml） |

### 片五明细 ✅ 2026-07-28（GROUP-002 + SUM-002 收口）

> 测试：`tests/base-group-summary.test.ts`（+4 用例，共 22）。fixture `group-list.base` 由「拒绝场景」改写为扇出/link/空 list 五个 view。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| list 分组键**扇出**（一行进入其每个元素的组） | BASE-GROUP-002 | ✅ 2026-07-28（`groupBy: tags` 的自然语义；**代价：组内行数之和 ≥ `rows.length`**，已写进 `BaseQueryResult.groups` 契约与 use 文档；顶层 `rows` 仍平铺一份不变。暂定口径待 oracle） |
| 行内元素先 typedEqual 去重 | BASE-GROUP-002 | ✅ 2026-07-28（`[a, a]` 不得把同一行塞进同一组两次） |
| 空 list 键视同 MISSING（单独成组） | BASE-GROUP-002 | ✅ 2026-07-28（**不静默丢行**——专项用例断言 6 行全在） |
| link 为**标量**键（不扇出） | BASE-GROUP-002 | ✅ 2026-07-28（路径感知相等分组；新增 `groupKeyCompare`——`sortKeyCompare` 对 link **抛类型错误**，分组只需确定性组序，故按归一 `path`+`subpath` 定序，序为「可比标量 < link < null/MISSING」） |
| 组级汇总 `groups[].summaries` | BASE-SUM-002 | ✅ 2026-07-28（**口径变更留档**：P2b 曾判「组级汇总属官方 UI 形态，无头 JSON 暂不做」，片五 GROUP-002 落地后 groups 成一等产物，「有组没有组的汇总」是半个功能故补上。计算集 = 该组 **limit 后**的行，与顶层的 **limit 前**全量有意不同） |

### 片四明细 ✅ 2026-07-28（BASE-SEC-004）

> 测试：`tests/base-functions-regex.test.ts`（8 用例）。新增 `src/base/regexp.ts` 与 rule `base/invalid-regex`。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| `string.matches(pattern)`（pattern 为**字符串**，子串命中语义） | BASE-EXPR-003 / BASE-SEC-004 | ✅ 2026-07-28（正则**字面量** `/…/` 仍在文法层拒绝，语法 §4.3 由「P2 最后评估」翻为「不做」） |
| 防护①：静态拒绝灾难性回溯构造 | BASE-SEC-004 | ✅ 2026-07-28（判据 = **无界量词**作用于分组且分组体内含无界量词或顶层交替；命中 `(a+)+`/`(a*)*`/`(a\|a)*`/`(a\|ab)+`，放行 `(\d+)?`/`(foo)+`/`[a-z]+@[a-z]+`。充分不必要，故必须叠加防护②③） |
| 防护①附：反向引用（`\1` / `\k<name>`）一律拒绝 | BASE-SEC-004 | ✅ 2026-07-28（先剥成对转义再检测，「转义反斜杠 + 字面 1」不被误杀，专项用例） |
| 防护②：限长（pattern 200 / 被匹配串 10000，与 DQL 侧同档） | BASE-SEC-004 | ✅ 2026-07-28 |
| 防护③：有界编译缓存（上限 64，超限整表清空） | 设计 §12 延伸 | ✅ 2026-07-28（逐行匹配不重复编译；不做无界增长——沿用 review 批次「解析缓存无界」的教训） |
| 新 rule `base/invalid-regex`（非法/不安全一律行级诊断） | 设计 §11 | ✅ 2026-07-28（**与 DQL 侧 `regexmatch` 策略有意不同**：那边非法正则降级为「不匹配」且不报错，Bases 侧硬约束是不静默忽略） |

### 片二明细 ✅ 2026-07-28

> 测试：`tests/base-functions-date.test.ts`（11 用例）。**快照口径变化**：`date()`/`duration()` 晚于 2026-07-22 冻结快照，本片显式采纳，语法 §1.1 漂移记录已同步（`%` 取模仍不采纳）。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| global `date(v)` 构造（严格 ISO / date 幂等 / number 按 epoch 毫秒） | BASE-TYPE-005 | ✅ 2026-07-28（与 frontmatter 推断复用同一 `parseDateLike`，保证「属性里能识别的」与「`date()` 能构造的」是同一集合） |
| global `duration(v)` 构造（长单位 + 官方短单位 + number 按毫秒） | BASE-TYPE-005 | ✅ 2026-07-28（新增值层 `parseDurationLike`；短单位**大小写敏感**：`M`=月/`m`=分，大写变体 `D`/`Y` 一律拒绝——混淆代价是量级级错误） |
| date 分派组新增（`receiverGroupOf` 返 `"date"`） | 设计 §9 | ✅ 2026-07-28（duration/link 仍只命中 `any`；内部字段 epochMs/precision 依旧不外露） |
| `date.format(fmt)` | BASE-TYPE-005 | ✅ 2026-07-28（数字 token 子集 + 同字符游程分词 + `[字面量]` 转义；本地化 token 报错——见下方「实测非显然点」） |
| `date.time()` → 当日 UTC 零点起的 duration | BASE-TYPE-005 | ✅ 2026-07-28（暂定口径：选 duration 而非 `"HH:mm"` 字符串，可比较可算术；date 精度恒 0） |
| `date.relative()` | BASE-TYPE-005 / BASE-FORM-006 | ✅ 2026-07-28（固定英文 + 固定阶梯，时间源恒为注入 clock；官方输出随界面语言变，不复刻） |
| `date.isEmpty()` 恒 false | BASE-TYPE-005 | ✅ 2026-07-28 |

### 片三明细 ✅ 2026-07-28

> 测试：`tests/base-functions-link.test.ts`（8 用例）。**含文法改动**（片六原本被认为是唯一动 parser 的一片，实际本片先动了）：`file` 是关键字 token，`file(...)` 此前直接语法错误；`rootRef` 增加「根 token 后随 `(` → 全局调用」分支。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 文法：`file(...)` 调用形态；`note(`/`formula(`/`this(` 走同一分支报 `base/unknown-function` | 设计 §7 | ✅ 2026-07-28（既有 `file.name` / 裸 `file` / `file["name"]` / `file.hasTag(...)` 零回归，专项用例锁定） |
| global `file(path)`：行集内三级解析（精确 path → pathKey → bare basename） | BASE-FILE-001 | ✅ 2026-07-28（新增 `createFileResolver`；解析范围 = 当前查询行集，不查库不碰 FS，故 markdown 模式解析不到附件；解析不到 → MISSING 不伪造空 file 值） |
| global `link(target, display?)`：纯值构造 | BASE-TYPE-006 | ✅ 2026-07-28（**不解析行集**，悬空链接合法——与 `file()` 的「解析不到 → MISSING」是有意的两种口径） |
| link 分派组新增 + `link.asFile()` | BASE-TYPE-006 / BASE-FILE-001 | ✅ 2026-07-28（用原始 target 走三级解析，bare `[[A]]` 可命中；悬空 → MISSING） |
| `file.asLink(display?)` | BASE-TYPE-006 | ✅ 2026-07-28（target 用完整 vault 相对路径，不受同名文件影响；`file → link → file` 往返用例锁定） |
| `file.linksTo(x)` | BASE-FILE-005 | ✅ 2026-07-28（string/link 入参走与 `hasLink` 同一匹配函数 `matchesAnyLink`；**file 入参走解析**，见下） |
| 无行集解析器语境（自定义汇总 `values` 作用域）→ `base/unsupported-feature` | SUM-002 延伸 | ✅ 2026-07-28（不静默 MISSING；`link()` 纯值构造在该语境照常可用） |

> **片三实测非显然点**：`file.linksTo(file("Beta"))` 起初返回 **false**——Alpha 里写的是 bare `[[Beta]]`，而 `file("Beta").path` 是 `Projects/Beta.md`，文本匹配走 qualified 分支比 `pathKey`（`"beta"` ≠ `"projects/beta"`），明明链上了却判否。定为两种入参两种语义：string/link = 文本目标（同 `hasLink`），**file = 那个具体文件**（把每条出链解析一遍比解析后的 path）。
> **另一处**（文法）：`rootRef` 里按 `callArgs` 提前 `return` 会让后半段属性路径 `OPTION` **永远不被录进 chevrotain 语法**（录制阶段会真的执行 OPTION 的 DEF，callArgs 被赋成 dummy 值），运行期 `file.name` 直接抛 `Cannot read properties of undefined`。规则必须单出口。

> **片二实测非显然点**（已在代码注释与测试里存证）：`format` 若按「最长已知 token 优先」扫描，`MMMM` 会被贪婪切成 `MM`+`MM` **静默输出 `0808`**——用户写 `MMMM` 要的是月名，静默给错数字比报错糟得多。改为按同字符最长游程整体查表后才落到正确诊断，测试用 `MMMM`/`dddd`/`DDDD`/`YYY` 四个游程锁定。

## 7. 不做 / 暂缓（理由记录）

| 项 | 状态 | 理由 |
| ---- | ---- | ---- |
| 渲染 table/cards/list/map 布局 | ❌ | 查询内核不渲染（设计 §1） |
| 复刻官方 CLI 输出字节 / 用官方 CLI 兜底执行 | ❌ | 官方 JSON 非稳定 schema；CLI 依赖 GUI（设计 §14） |
| 自动改写旧 `.base` / 写 `.obsidian/types.json` | ❌ | 只读原则（设计 §14） |
| `.base` → DQL 文本翻译器 | ❌ | 两套语言独立 AST（设计 §14） |
| Dataview inline fields 当 Bases properties | ❌ | 官方 Bases 不支持（设计 §10） |
| 未经验证就标「完整兼容」 | ❌ | 版本化 conformance 政策（语法文档 §8） |
| chat 打磨 / DQL 函数全集 / task emoji / lint CI / embedding / 复杂编排器 | ⏸ | TODO 冻结：不能优先于 Bases P0/P1，除非 dogfood 阻断性缺陷 |

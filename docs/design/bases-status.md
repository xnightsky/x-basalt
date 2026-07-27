---
type: status
title: Bases 实现状态追踪
description: living 文档：Bases 各语法项/场景编号的实现状态（已实现/已计划/待开/暂缓/不做）与实现时间，随实现逐项更新
tags:
  - status
  - bases
  - testing
  - x-basalt
timestamp: 2026-07-27T18:55:09Z
sha256: 1205110636dec5ecd7143e0f31635f3208b1448780295d1c78962d13aca80217
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
| P1 oracle | 官方串行差分（争议语义冻结） | 🔜 待开（需用户侧 Obsidian App 环境，人工触发） |
| P2a | formulas 核心（typed values + 算术 + 依赖图/cycle + clock） | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p2a-formulas.md)） |
| P2b | types.json / list 高阶 / groupBy / summaries | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p2b-types-list-group-summary.md)） |
| P3 | all-files / context / 嵌入 | 🔀 P3a 附件数据集 ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-p3-attachments.md)）；context/嵌入仍 🔜 待开 |
| review 修复 | P0..P2b 收口后的评审修复（静默失败 + 资源模型） | ✅ 2026-07-27（[计划](../history/plans/2026-07-27-bases-code-review-fixes.md)） |
| 函数覆盖率 | 官方 68 条目 51% → ~90%（六片） | 🚧 进行中（[计划](../plans/2026-07-28-bases-functions.md)）：片一 ✅ 2026-07-28；片二..六 🔜 |

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
| `order` 投影 / 多键 sort / limit / 默认 file.path tie-break | BASE-RESULT-001..004 | ✅ 2026-07-26（null 排序位置暂定恒排最后，⏸ 待 oracle；无显式 sort 给 `base/default-sort-tiebreak` info） |
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

## 3. P1 前置 oracle（用户侧人工串行）🔜

> 2026-07-26 起口径变化：P1 已按**暂定口径**落地（代码注释与测试均标「待 oracle」），oracle 从「阻塞 P1」转为「校正 P1 暂定口径」；空 filter 数组在 P1 直接拒绝（`base/unsupported-feature`）。

| 争议语义 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| missing/null/空串/0/false/空列表 值与 truthiness | BASE-PROP-004 | 🔜 校正 P1 暂定口径（falsy=MISSING/null/false/0/""/空列表） |
| 多键 sort 的 null 位置 | BASE-RESULT-002 | 🔜 校正 P1 暂定口径（null/missing 恒排最后，与方向无关） |
| 空 filter 数组（and:[]/or:[]/not:[]） | 设计 §6 | 🔜 P1 拒绝空数组；oracle 稳定后再放开 |
| `if()` lazy branch | 设计 §9 | 🔜 校正 P1 暂定 lazy 实现 |
| 二元运算操作数的字符串→日期推断是否作用于 `+`（拼接语境） | 语法 §5.1 / 设计 §8.3 | 🔜 校正 P2a 暂定口径（`upgradeStringOperand` 对全部非短路二元运算生效，故 `"2026-01-01" + " 备注"` 报类型错误而非拼接；2026-07-27 code review 登记，runbook 观察项 ⑨） |

> oracle 协议见矩阵 §8：固定版本、无插件 fixture vault、预启动 App、串行 `base:query`、存原始 JSON + hash，人工审查后转期望快照。
> **操作手册（fixture + 26 个 view 串行步骤 + 观察记录表 + 校正工作流）：[`2026-07-27-bases-oracle-runbook.md`](bases-oracle-runbook.md)**；校正清单 `rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`。

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
| groupBy 标量 / 列表/tag | BASE-GROUP-001/002 | GROUP-001 ✅ 2026-07-27（P2b；`groups` 增量字段，组序方向 + 组内稳定）；GROUP-002 ⏸ oracle（list/link 键暂定报 `base/unsupported-feature` 拒绝） |
| 默认汇总 / custom summary values | BASE-SUM-001/002 | SUM-001 ✅ 2026-07-27（P2b；15 内置，limit 前全量暂定）；SUM-002 ⏸ 暂定（`values` 作用域实现，空值剔除/越权口径待 oracle） |
| regex（若支持必须 ReDoS 防护 + 长度预算） | BASE-SEC-004 | ⏸ P2 最后评估 |

## 5. P3 all-files / context（P3a 附件数据集 ✅ 2026-07-27）

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 附件作为行（图片/PDF/Canvas/.base） | BASE-ALL-001 | ✅ 2026-07-27（[P3a 计划](../history/plans/2026-07-27-bases-p3-attachments.md)：独立 `vault_entries` 表 + indexer 六条写入路径 + all-files 数据源 + CLI `--conformance`；「DQL 不变」证明 11①③④ 与跨表 path 唯一性 12 全部落成测试） |
| 附件 links/backlinks/embeds | BASE-ALL-002 | ✅ 2026-07-27（P3a 满足线：附件行出链恒 `[]`、不伪造内容链接；附件作为链接 target 的命中关系可查询（笔记行 `file.links` 含原始 target，embed `![[img.png]]` 计入 links 表 is_embed=1）——暂定口径待 oracle） |
| 独立 `.base` 的 `this`（显式 contextFile） | BASE-CTX-001 | 🔜 P3 |
| Markdown `base` code block | BASE-CTX-002 | 🔜 P3（parser 新节点） |
| `![[View.base#Name]]` embed | BASE-CTX-003 | 🔜 P3 |
| sidebar/active-file 语义（禁环境隐式状态） | BASE-CTX-004 | 🔜 P3 |
| 插件 view/function | BASE-PLUGIN-001 | ⏸ 默认拒绝；显式注册纯函数扩展需真实需求再议 |

## 6. 函数覆盖率补齐（2026-07-28 起，[计划](../plans/2026-07-28-bases-functions.md)）

> 缺口全在**叶子函数**：注册表 / 名字真相源 / 运行时分派三处骨架已成型，补函数 = 扩表 + 扩分派组 + 补用例。
> 每片完成后本表翻标（日期 + 测试文件）。

| 片 | 内容 | 状态 |
| ---- | ---- | ---- |
| 片一 | 机械叶子 16 个 + 渲染类 4 个显式拒绝 + `round` 归组 | ✅ 2026-07-28（`tests/base-functions-leaf.test.ts` 18 用例；838 全量绿） |
| 片二 | Date/Duration 族 6 个（`date()`/`duration()`/`format`/`time`/`relative`/`isEmpty`），新增 `date` 分派组 | 🔜 |
| 片三 | Link/File 互转 5 个（`asFile`/`linksTo`/`asLink`/`file()`/`link()`） | 🔜 |
| 片四 | `matches`（regex）+ ReDoS 防护 | 🔜 BASE-SEC-004 |
| 片五 | list/link 当分组键 + 自定义汇总收口 | 🔜 BASE-GROUP-002 / BASE-SUM-002 |
| 片六 | `contextFile`/`this`、` ```base ` 代码块、`![[View.base#Name]]` embed | 🔜 BASE-CTX-001..004（唯一动 parser 的一片，范围待用户拍板） |

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
| `random()` × 字节稳定冲突 | 语法 §4.4 | ⏸ 待用户拍板（注入种子 / 直接拒绝 / 放弃字节稳定） |

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

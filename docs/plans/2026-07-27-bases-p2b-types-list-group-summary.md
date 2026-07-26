---
type: plan
title: Bases P2b 计划（list 高阶 / types.json / groupBy / summaries）
description: list 高阶方法与迭代预算、.obsidian/types.json 可选只读、view groupBy 与 15 内置汇总 + 自定义 values 作用域
tags:
  - plan
  - bases
  - x-basalt
timestamp: 2026-07-26T20:08:39Z
sha256: 3d8d32c4feb470b8001d9d4f3f71afc4b9fc73fa9e4579826a6ee52401d266f5
---
# 计划：Bases P2b · list 高阶 / types.json / groupBy / summaries

> 2026-07-27 · 来源：根 `TODO.md` P2 项第二片；前置 P2a [`2026-07-27-bases-p2a-formulas.md`](2026-07-27-bases-p2a-formulas.md)（✅）。
> 设计真相源：[`../specs/2026-07-22-bases-headless-engine-design.md`](../specs/2026-07-22-bases-headless-engine-design.md) §13；语法真相源：[`../specs/2026-07-26-bases-syntax.md`](../specs/2026-07-26-bases-syntax.md)；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../testing/2026-07-22-bases-scenario-matrix.md) §5/§7；官方形态依据：[Bases syntax 官方镜像（mintlify）](https://obsidianmd-obsidian-help.mintlify.app/bases/syntax)。
> 分三片顺序推进：片一 list 高阶 → 片二 types.json → 片三 groupBy + summaries。每片独立测试 + 文档更新，最后统一收口。

## 目标与范围

- **片一 · list 高阶**（BASE-LIST-001 / BASE-SEC-005）：方法 `filter`/`map`/`reduce`（隐式 `value`/`index`/`acc` 作用域，非 JS lambda）、`flat`/`sort`/`unique`/`join`；迭代预算（巨大列表 + 嵌套高阶 → 结构化错误，不阻塞进程）。
- **片二 · types.json**（BASE-TYPE-001..003；TYPE-004 暂定待 oracle）：可选只读 `<vaultRoot>/.obsidian/types.json`，显式类型优先于 YAML 推断；缺失 → 推断 + compat info；非法/未知类型 → warning + 保守推断；永不写回。
- **片三 · groupBy + summaries**（BASE-GROUP-001、BASE-SUM-001；GROUP-002/SUM-002 暂定）：view `groupBy: { property, direction }` 标量分组；view `summaries: { <property-ref>: <内置名> }` 15 个内置汇总；顶层自定义 `summaries:` map（`values` 隐式作用域）暂定实现。

## 非目标

- P3 全部；regex（SEC-004）；`date()`/`link()` 构造函数、`%` 取模（官方现网新增，超出 2026-07-22 冻结快照，见「风险」）；GROUP-002（list/tag 分组键，待 oracle）；cards/list/map view。
- 不改 `BaseQueryResult` 既有字段语义（`groups`/`summaries` 仅作可选增量字段）；不改 CLI 命令。

## 关键取舍（实现前拍板）

### 片一 · list 高阶

1. `BASE_FUNCTION_NAMES` 增量：`filter`/`map`/`reduce`/`flat`/`sort`/`unique`/`join`（receiver=list；`sort` 为方法名与 view sort 无关）。注册表照旧数据驱动 + 一致性自检。
2. HOF 语义（对齐官方「隐式作用域」）：`filter(expr)` 保留 truthy 元素；`map(expr)`；`reduce(expr, init)`（`acc` 初值 init）。arg 表达式**不求值预绑定**——evaluator 对这三个方法走 lazy 特殊分派（同 `if` 模式），逐元素在作用域 `{ value, index, acc }` 下求值；作用域变量遮蔽同名 note 属性（注释声明）；嵌套 HOF 作用域栈隔离。
3. `flat(depth=1)`；`sort()` 用 compareValues（混合类型 → 行级类型错误）；`unique()` typedEqual 去重保留首现；`join(separator="")`（元素须 string/number/boolean，其余 → 类型错误）。
4. SEC-005 预算：每个元素迭代/比较照常扣 `maxOperations`；结果列表与输入列表元素数受 `maxCollectionItems`；嵌套 HOF 深度受 `maxCallDepth`；耗尽 → `base/execution-budget`（不返回部分结果）。

### 片二 · types.json

5. 读取：每个 vaultRoot 的 `.obsidian/types.json`（只读 fs，永不写回）；期望形状 `{ "types": { <prop>: <type> } }`；类型名识别 `text|number|checkbox|date|datetime|multitext|tags|aliases`（未知类型名 → 该条目 warning + 忽略）。多根：逐根读取合并，同名冲突 → warning + 先根优先（暂定，注释标注）。
6. 应用点：evaluator note 属性读取升级链变为「types.json 显式类型 → 保留字段规则 → parseDateLike/parseWikilinkValue 推断 → 原样」。显式类型与实际值冲突**不强制转换**：该行该属性产 `base/property-type-mismatch`（warning）+ 值按运行时类型参与（TYPE-004 暂定，待 oracle；比较/排序不得因声明类型静默字符串比较）。
7. 缺失文件 → compat info 诊断（TYPE-002，每次查询至多一条，不刷屏）；JSON 非法/顶层无 `types` map → warning + 全量回退推断（TYPE-003）。诊断 rule 复用既有，不新增。

### 片三 · groupBy + summaries

8. view `groupBy`：从 unsupported 集合移出，解析 `{ property: <property-ref>, direction: ASC|DESC（缺省 ASC） }`；结构非法 → `base/invalid-schema`。
9. 结果形状（增量可选字段，既有字段不动）：`BaseQueryResult.groups?: { key: BaseOutputValue; rows: Record<string, BaseOutputValue>[] }[]`——组序按组键 sortKeyCompare（direction 控制方向），组内按 view sort + `file.path` tie-break；顶层 `rows` 保持既有平铺行为（向后兼容）。分组键为 **list**（tag 等）→ 暂定报 `base/unsupported-feature` 待 oracle（GROUP-002，与空 filter 数组同款口径）。
10. view `summaries`：map `<property-ref>` → 内置汇总名，15 个内置（Average/Min/Max/Sum/Range/Median/Stddev（number）；Earliest/Latest/Range（date）；Checked/Unchecked（boolean）；Empty/Filled/Unique（any）——Range 按输入类型分派）。结果增量字段 `summaries?: Record<string, BaseOutputValue>`（key = view summaries 的 property-ref 原文）。计算集 = filter 后 **limit 前**全量（暂定，注释标注）。空值/混合类型口径：非匹配类型值跳过（如 Average 只计 number；Empty 计 null/missing，Filled 反之）；全空 → null。
11. 顶层自定义 `summaries:` map（SUM-002 暂定）：name → 表达式字符串，隐式 `values` 作用域（= 目标列跨行值列表，**只接收当前结果集目标列**，表达式内不得访问行外状态——`values` 之外按普通表达式求值、行上下文缺失时 note/file 属性为 MISSING）；为支持官方示例 `values.mean().round(3)` 增量白名单：`mean`（list<number>）、`round`（number 方法，0..1 参）。view summaries 的值可以是内置名或顶层自定义名；未知名 → `base/unknown-function`（error）。

## 风险

- **官方快照漂移**：现网官方文档（2026-07 之后）新增 `%`、`date()`/`link()` 构造、duration 字符串后缀形态（`"1 day"`、短单位 y/M/d/w/h/m/s）——与 2026-07-22 冻结快照及 P2a 的 `1day` token 形态存在差异。本片不追新快照；记录于此，快照升级时需专项对齐（含 P2a duration 形态复核）。
- types.json 的真实样本形状（顶层 `types` key、类型名大小写）属调研「未决问题」#2：按 §3.3 回退规则防御，未知即 warning 不崩。
- SUM-001 矩阵原文写「Count 类」而官方无 Count（有 Filled/Empty/Unique）——按官方 15 名实现，矩阵口径以官方为准并注释。

## 停点

- 需要改 `BaseQueryResult` 既有字段语义或 CLI 契约 → 停下回报；
- types.json 读取与多根命名空间产生歧义无法保守处理 → 片二降级为单根 + 文档标注；
- HOF 作用域与既有 note 属性解析冲突无法隔离 → 停下回报。

## 验证口径（完成定义）

- BASE-LIST-001、BASE-SEC-005、BASE-TYPE-001/002/003（TYPE-004 暂定用例标注）、BASE-GROUP-001（GROUP-002 拒绝用例标注）、BASE-SUM-001（SUM-002 暂定用例标注）每号独立测试通过（注释标编号）。
- `pnpm run typecheck`、`pnpm test` 全绿；触碰代码文件 `oxfmt --check` + `oxlint` 0 告警。
- 状态文档 §4 对应行翻 ✅；语法文档对应标记翻【P2b ✅】；TODO.md 勾销 P2b；本计划附验证结论；改动文档 dogfood + `x-basalt lint --profile llm-wiki docs`。

## 验证结论（2026-07-27）

**交付**（三片，均增量）：

- 片一 list 高阶：`filter`/`map`/`reduce`（lazy 分派 + `value`/`index`/`acc` 作用域栈，遮蔽同名 note 属性、嵌套穿透）、`flat`/`sort`/`unique`/`join`；SEC-005 三项预算（operations/collection/callDepth）。
- 片二 types.json：`src/base/typeschema.ts` 可选只读（期望 `{types:{...}}`，未知类型名/非法 JSON/无 types map 全部 warning 回退、永不写回；多根先根优先暂定）；evaluator 升级链首加显式类型（text 抑制推断；冲突行级 warning + 运行时类型参与，TYPE-004 暂定）。
- 片三 groupBy + summaries：view `groupBy {property,direction}` → 结果增量 `groups`（组序方向 + 组内 tie-break；list/link 键拒绝待 oracle）；15 内置汇总（`src/base/summaries.ts` 数据驱动）+ 顶层自定义 `values` 作用域（SUM-002 暂定，空值剔除）；结果增量 `summaries`；`mean`/`round` 入白名单；`string + string` 拼接补齐（官方示例形态）。

**已验证项**（全部实际运行）：

- 场景每号独立用例：BASE-LIST-001（16 含 SEC-005×3）、BASE-TYPE-001..003（8 含 TYPE-004 暂定）、BASE-GROUP-001/SUM-001/SUM-002（18 含 GROUP-002 拒绝、未知汇总名、非法结构）。
- `pnpm run typecheck` 通过；`pnpm test` 全量 **780 pass / 0 fail**（三片累计 +42，零回归）；触碰代码 `oxfmt --check` 全过、`oxlint` 0 告警。
- 官方示例形态可跑：`values.mean().round(3)` 自定义汇总、`formatted_price` 字符串拼接公式。

**实现期拍板记录**：

- types.json 读取独立成 `typeschema.ts`（source.ts 保持纯 DB 边界）；每次 query 读一次不缓存（`.obsidian/` 不在索引监听内，缓存有陈旧风险）；诊断 rule 复用 `base/invalid-schema`（配置形状）与 `base/property-type-mismatch`（行级冲突）。
- HOF：`note.value` 显式形态同样被作用域遮蔽（AST 不可区分）；reduce 的 init 在元素作用域外求值；sort 复用 compareValues 判定可比性（date/duration 可排序，混合报错）。
- summaries：计算集 = filter 后 limit 前全量（暂定）；Stddev = 总体标准差（÷n）；自定义 `values` 剔除 null/MISSING（对齐内置空值跳过）；`values` 越权 → MISSING 静默 → 结果 null（暂定）；GROUP-002 把 link 键并入 list 同款拒绝（防 sortKeyCompare 未捕获异常）；组作用在 limit 后行集、组级汇总不做（无头 JSON 口径）。
- 顶层 `groupBy` 仍拒绝（官方仅 view 级）。

**未验证项**：TYPE-004 冲突精确口径、GROUP-002 一行多组语义、SUM-002 values 边界——均暂定实现，待官方 oracle（已全部纳入 runbook fixture⑦⑧，2026-07-27 补）。

**剩余风险**：官方快照漂移（`%`/`date()`/`link()`/duration 字符串后缀）已记录于语法文档 §1.1，快照升级时需专项对齐；其余无新增。

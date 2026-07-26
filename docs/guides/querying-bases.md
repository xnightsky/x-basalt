---
type: guide
title: Bases 查询指南 · x-basalt
description: .base view 无头查询：支持子集、稳定 JSON 契约、退出码、md-only 限制与 oracle 暂定口径
tags:
  - guide
  - bases
  - query
  - x-basalt
timestamp: 2026-07-26T17:40:07Z
sha256: 80a42821bae59fb75ebc3aafc1a5e41260ec2939e25c1f84f30d748cf4c9909f
---
# Bases 查询指南 · x-basalt

> 上级索引：[使用指南](usage.md) · 同级：[命令参考](commands.md) · [DQL 查询指南](querying-dql.md) · [索引与同步](indexing-and-sync.md) · [故障排查](troubleshooting.md)
>
> 真相源：`src/base/`（engine/planner/evaluator/functions/values/source/parser/tokens）、`docs/specs/2026-07-26-bases-syntax.md`（语法）、`docs/specs/2026-07-22-bases-headless-engine-design.md`（设计契约）、`docs/testing/2026-07-26-bases-implementation-status.md`（逐项实现状态）。

---

## 1. 概览

`x-basalt base` 是 Obsidian `.base` 文件的**无头查询出口**：不启动 Obsidian、不渲染表格，回答「对当前 SQLite 索引中的 Markdown 笔记，指定 `.base` view 会返回哪些行和列」。兼容级别：

```text
x-basalt Bases Markdown conformance 2026-07
```

流水线：`.base`（YAML + schema 校验）→ view 选择 + filter 合并（planner）→ SQLite 读候选 Markdown 行（source，只读参数化）→ 独立表达式 AST 内存求值（evaluator，带预算）→ 稳定 JSON。**Bases 表达式不是 DQL**（`==`/`&&`/`||`/`!` vs `=`/`AND/OR/NOT`），两套 token/AST 完全独立。

它不承诺：渲染 table/cards/list/map 布局、控制 Obsidian App、查询附件等非 Markdown 文件、运行任意 JavaScript/插件函数、模拟 GUI `this`。

## 2. 快速上手

```bash
x-basalt index ./my-vault                                  # 先建索引（.base 查询只读索引）
x-basalt base views/projects.base --vault ./my-vault       # 默认 view（views[0]）
x-basalt base views/projects.base --view Active --vault ./my-vault
```

`.base` 路径必须落在 vault 内（读取前拒绝越界）。`--vault` 可省略回退配置 `vault`，`--db` 默认 `.x-basalt/index.db`。

## 3. 命令

```
x-basalt base <file.base> [--view <name>] [--vault <path...>] [--db <path>] [--format json|yaml]
```

| 参数/选项 | 默认 | 说明 |
| --- | --- | --- |
| `<file.base>` | 必填 | vault 内 `.base` 路径（vault 相对或绝对） |
| `--view <name>` | `views[0]` | 指定 view；不存在报 `base/view-not-found`（error，suggestions 列可用名） |
| `--vault <path>` | 配置 `vault` | 可重复传多个（多根 vault） |
| `--db <path>` | `.x-basalt/index.db` | 索引文件（只读打开） |
| `--format <fmt>` | `json` | `json`（缩进 2）或 `yaml` |

**退出码**：结果 `diagnostics` 含任一 `error` 级 → 仍输出完整 JSON（rows 为空）并以 **1** 退出；仅 warning/info → **0**。

## 4. 输出契约

```json
{
  "conformance": "bases-markdown-2026-07",
  "base": "views/projects.base",
  "view": "Active",
  "columns": ["file.name", "status"],
  "total": 4,
  "rows": [{ "file.name": "Alpha.md", "status": "active" }],
  "diagnostics": [
    { "rule": "base/markdown-only-dataset", "severity": "warning", "message": "…" }
  ]
}
```

- `total` = filter 后、limit 前的行数；`rows.length <= limit`。
- 列 = view 的 `order` 原文（缺省 `["file.name"]`）；缺失属性投影为 `null`，列不消失。
- 未显式 `sort` 时按 `file.path` 升序稳定输出，并附 `base/default-sort-tiebreak`（info）；显式多键 sort 稳定执行、最终也以 `file.path` 兜底 tie-break。
- 每次查询恒发 `base/markdown-only-dataset`（warning）：声明 md-only conformance，附件不作为行。
- 同一 DB + Base 重复运行结果**字节稳定**；输出值只含 JSON 形状，不泄漏内部对象。

## 5. .base 支持子集（P1 + P2a + P2b）

- view：`type: table` 的 `filters` / `order` / `sort`（ASC/DESC）/ `limit`（非负整数）/ `groupBy { property, direction }` / `summaries`；`cards`/`list`/`map` 与插件 view 报 `base/unsupported-feature` / `base/unsupported-view-type`。
- filter：表达式字符串 + 递归 `and`/`or`/`not`（单键数组）；全局 `filters` 与 view filter 外层 AND 合并；**空数组（`and: []` 等）直接拒绝**（`base/unsupported-feature`，语义待官方 oracle）。
- formulas：顶层 `formulas:` map（表达式字符串），以 `formula.name` 引用；依赖图拓扑排序（与 YAML 键序无关）、循环报 `base/formula-cycle`（含完整循环链）。
- 表达式：字面量（null/boolean/number/字符串/list）、属性引用（`status` / `note.status` / `note["带空格"]` / Unicode 名 / `file.*` / `formula.*`）、`!` `&&` `||` `==` `!=` `<` `>` `<=` `>=`、算术 `+ - * /`（含字符串拼接与 date/duration 算术）、一元 `-`、duration 字面量（`1day`/`2weeks` 等）、括号、白名单函数/方法调用、只读属性/索引访问。无 regex、无 `%`。
- 函数白名单：`if` / `list` / `number`；`isTruthy` / `isType` / `toString`；string `contains` / `containsAll` / `containsAny` / `startsWith` / `endsWith` / `lower` / `trim`；list `contains` / `containsAll` / `containsAny` / `isEmpty` / `filter` / `map` / `reduce` / `flat` / `sort` / `unique` / `join` / `mean`；object `isEmpty` / `keys` / `values`；file `hasTag` / `inFolder` / `hasLink` / `hasProperty`；time `today` / `now`；number `round`。
- summaries：view 级 `<property-ref> → 汇总名`；15 个内置（Average/Min/Max/Sum/Range/Median/Stddev/Earliest/Latest/Checked/Unchecked/Empty/Filled/Unique）；顶层自定义（`values` 隐式作用域，如 `values.mean().round(3)`）。
- groupBy：结果含增量 `groups` 字段（组序按 direction、组内按 sort + file.path tie-break）；list/tag 分组键暂拒绝（待 oracle）。
- 类型：可选只读 `.obsidian/types.json`（显式类型优先；缺失/非法回退推断并给诊断，永不写回）；frontmatter 日期字符串（严格 ISO）与 wikilink 自动升级为 Date/Link 值（暂定机制，待 oracle）。
- file 属性：`name`（带扩展名）/ `basename` / `path` / `folder` / `ext` / `size` / `ctime` / `mtime`（epoch 毫秒）/ `properties` / `tags` / `links`。
- note 属性只来自 frontmatter；**Dataview inline fields（`key:: value`）不会进入 Bases 属性**（官方 Bases 不支持）。

## 6. 限制与暂定口径

- P3 未做：附件数据集（all-files）、嵌入 `base` code block、`this`（遇 `this` 报 `base/dynamic-context-required`）、regex。
- **oracle 暂定项**（实现已落地、语义待官方串行 oracle 校正，校正后可能调整）：missing/null/空串/0/false/空列表的 truthiness 精确合并；多键 sort 的 null 排序位置（暂定恒排最后）；空 filter 数组（暂定拒绝）；`if()` lazy branch（暂定 lazy）；date vs datetime 跨精度比较（暂定统一 epoch）；frontmatter wikilink → Link（暂定机制）；types.json 声明冲突口径（暂定行级 warning）；GROUP-002 一行多组（暂定拒绝）；SUM-002 `values` 边界（暂定剔除空值）。逐项状态见 [实现状态追踪](../testing/2026-07-26-bases-implementation-status.md) 与 [oracle 操作手册](../testing/2026-07-27-bases-oracle-runbook.md)。
- 执行预算（`base/execution-budget`）：文档大小、filter 深度、表达式节点、调用深度、行数、集合元素、操作数、公式图节点/深度均有硬上限，耗尽返回 error + 空结果，不返回部分结果。

## 7. 常见报错速查

| rule | 含义 |
| --- | --- |
| `base/view-required` / `base/view-not-found` / `base/duplicate-view-name` | views 缺失/空；指定 view 不存在（suggestions 列可用名）；view 重名 |
| `base/unsupported-view-type` / `base/unsupported-feature` | 未知/插件 view type；`cards`/`list`/`map`、空 filter 数组、list/tag 分组键等未支持特性 |
| `base/unknown-function` / `base/expression-syntax` | 白名单外函数（含旧 snake_case，不静默迁移）；表达式文法错误（位置 = .base 文件行列） |
| `base/unknown-property` / `base/property-type-mismatch` | 未知 file 属性；行级类型错误（该行不通过、查询继续，warning） |
| `base/path-outside-vault` | `.base` 路径越出 vault（读取前拒绝） |
| `base/execution-budget` | 任一预算耗尽（error，空结果） |
| `base/dynamic-context-required` | 无显式 context 遇 `this`（P3 才支持） |

诊断完整契约（位置规则、severity 口径）见设计文档 §11。

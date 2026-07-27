---
type: guide
title: Bases 查询指南 · x-basalt
description: x-basalt base 命令怎么跑：选项、稳定 JSON 输出契约、退出码、限制与 oracle 暂定口径、常见报错速查
tags:
  - guide
  - bases
  - query
  - x-basalt
timestamp: 2026-07-27T05:01:57Z
sha256: 7f8a44bceaf86530c914897b852f92ede6954e4891f35c44f1a828abf8820c62
---
# Bases 查询指南 · x-basalt

> 上级索引：[使用指南](usage.md) · **前置**：[Bases 编写指南](writing-bases.md)（Bases 是什么、六步教程、**完整语法快照**）· 同级：[命令参考](commands.md) · [DQL 查询指南](querying-dql.md) · [索引与同步](indexing-and-sync.md) · [故障排查](troubleshooting.md)
>
> 本文管**怎么跑**：命令与选项 → 输出契约 → 限制 → 报错速查。
> **`.base` 怎么写、支持哪些语法，全部在[编写指南](writing-bases.md)**——本文不重复语法，遇到「这个写法支不支持」一律去那边查 [§3 完整语法快照](writing-bases.md#3-完整语法快照x-basalt-覆盖范围)。

`x-basalt base` 是 `.base` 文件的**无头查询出口**：不启动 Obsidian、不渲染表格，回答「对当前 SQLite 索引中的 Markdown 笔记，指定 view 会返回哪些行和列」。兼容级别 `bases-markdown-2026-07`（官方文档快照 2026-07-22）。

**执行流水线**：`.base`（YAML + schema 校验）→ view 选择 + filter 合并（planner）→ SQLite 读候选 Markdown 行（source，固定 SQL 只读）→ 独立表达式 AST 内存求值（evaluator，带预算）→ 稳定 JSON。

---

## 1. 命令

```text
x-basalt base <file.base> [--view <name>] [--vault <path...>] [--db <path>] [--format json|yaml] [--conformance <id>]
```

| 参数/选项 | 默认 | 说明 |
| --- | --- | --- |
| `<file.base>` | 必填 | vault 内 `.base` 路径（vault 相对或绝对）；越出 vault 在读取前拒绝 |
| `--view <name>` | `views[0]` | 指定 view；不存在报 `base/view-not-found`（error，`suggestions` 列可用名） |
| `--vault <path>` | 配置 `vault` | 可重复传多个（多根 vault） |
| `--db <path>` | `.x-basalt/index.db` | 索引文件（只读打开） |
| `--format <fmt>` | `json` | `json`（缩进 2）或 `yaml` |
| `--conformance <id>` | `bases-markdown-2026-07` | 数据集口径：`bases-markdown-2026-07`（仅 Markdown 笔记）或 `bases-all-files-2026-07`（附件并入为行，见 [§3.2](#32-all-files-模式附件并入数据集)）；未知值报 `base/invalid-schema`（error） |

```bash
x-basalt index ./my-vault                                   # 先建索引（查询只读索引，不扫文件）
x-basalt base views/projects.base --vault ./my-vault        # 默认 view（views[0]）
x-basalt base views/projects.base --view Active --vault ./my-vault
x-basalt base views/projects.base --conformance bases-all-files-2026-07 --vault ./my-vault   # all-files：附件也作为行
```

**退出码**：`diagnostics` 含任一 `error` 级 → 仍输出完整 JSON（`rows` 为空）并以 **1** 退出；仅 warning/info → **0**。CI 里可直接当 `.base` 校验器用。

> 笔记改了要重建索引（`x-basalt index`）或增量重扫（`x-basalt scan`），否则查的是旧快照。

## 2. 输出契约

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

| 字段 | 语义 |
| --- | --- |
| `conformance` | 回传**实际生效**的数据集口径：`bases-markdown-2026-07`（缺省，仅 Markdown）或 `bases-all-files-2026-07`（附件并入为行，见 [§3.2](#32-all-files-模式附件并入数据集)）；all-files 遇旧库降级时回传 markdown |
| `base` | `.base` 的 vault 相对 POSIX 路径（见下方多根说明） |
| `view` | 实际执行的 view 名 |
| `columns` | view 的 `order` 原文（缺省 `["file.name"]`） |
| `total` | **filter 后、limit 前**的行数（`rows.length <= limit`） |
| `rows` | 行数组，key 为列原文 |
| `groups` | 仅 view 配了 `groupBy` 时出现：`[{ key, rows }]`；顶层 `rows` 仍是平铺全部行 |
| `summaries` | 仅 view 配了 `summaries` 时出现；按 filter 后、limit 前的全量行计算 |
| `diagnostics` | 全量诊断（文档层 → planner → 引擎级 → 行级，顺序固定） |

其它契约要点：

- **路径键**：`base` 与诊断的 `file` 与行的 `file.path` **同一套键**。单根为根内相对路径（`views/projects.base`）；**多根**（重复 `--vault`）时带 `<根目录名>/` 命名空间前缀（`vault/views/projects.base`，与 `file.path` 的 `vault/Alpha.md` 一致）。任何情况下都不含物理绝对路径。
- **缺失属性投影为 `null`，列不消失**。
- **排序确定性**：未显式 `sort` 时按 `file.path` 升序，并附 `base/default-sort-tiebreak`（info）；显式多键 sort 也以 `file.path` 兜底 tie-break。
- **带类型的值**用带 `type` 标签的对象表达：`{ "type": "date", "value": "2026-08-10" }`、`{ "type": "datetime", "value": "<ISO>" }`、`{ "type": "link", "path": …, "display"?: …, "subpath"?: … }`；duration 直出毫秒 number。
- **md-only 声明**：markdown 模式（缺省）每次查询恒发 `base/markdown-only-dataset`（warning），声明附件不作为行——这是声明不是错误，退出码不受影响；all-files 模式（附件并入数据集）不发该 warning。
- **字节稳定**：同一 DB + 同一 `.base` + 同一注入时钟重复运行，结果逐字节一致；输出只含 JSON 形状，不泄漏内部对象。

## 3. 限制与暂定口径

### 3.1 未做（P3 及以后）

嵌入式 ```` ```base ```` 代码块、`![[View.base#Name]]`、`this`（遇到报 `base/dynamic-context-required`）、regex。完整的「明确不支持」清单见[编写指南 §3.9](writing-bases.md#39-明确不支持报诊断不静默忽略)。

### 3.2 all-files 模式（附件并入数据集）

`--conformance bases-all-files-2026-07` 把数据集从「仅 Markdown 笔记」扩为「笔记 + 附件」：图片 / PDF / `.base` / `.canvas` 等一切非 `.md` 非隐藏文件也作为行出现（索引层写入独立的 `vault_entries` 表，纯 stat 不解析内容，见[索引与同步](indexing-and-sync.md#56-vault_entries--每个附件一行纯-stat)）。

- **附件行可用字段**：`file.name` / `file.ext` / `file.folder` / `file.path` / `file.size` / `file.ctime` / `file.mtime`。
- **note 属性（frontmatter）缺失 → 投影为 `null`，列保留**——附件行没有 frontmatter，访问即得 `null`。
- **`file.tags` / `file.links` 恒 `[]`**：附件无正文，不伪造内容链接。
- **链接命中关系可查询**：笔记行的 `file.links` 含指向附件的原始 target（如 embed `![[img.png]]`），filter 里可命中。
- **合并与排序**：行 = files ∪ vault_entries 内存合并，全局 `file.path` 升序；多根命名空间下附件同样带 `<根目录名>/` 前缀。
- **预算对合并集计数**：maxRows 等行数预算按笔记 + 附件合计。
- **旧库降级**：索引库无 `vault_entries` 表（旧版本所建）时，all-files 模式自动降级为 md-only + `base/unsupported-feature` compat warning（不崩），输出的 `conformance` 回传实际生效口径；markdown 模式对旧库零感知。
- all-files 模式**不发** `base/markdown-only-dataset` warning。

### 3.3 oracle 暂定口径

实现已落地，语义待官方串行 oracle 校正，校正后可能调整：

missing/null/空串/0/false/空列表的 truthiness 精确合并；多键 sort 的 null 排序位置（暂定恒排最后）；空 filter 数组（暂定拒绝）；`if()` lazy branch（暂定 lazy）；date vs datetime 跨精度比较（暂定统一 epoch）；frontmatter wikilink → Link（暂定机制）；types.json 声明冲突口径（暂定行级 warning）；一行多组的 list/tag 分组键（暂定拒绝）；自定义 summary 的 `values` 边界（暂定剔除空值）；拼接语境下的日期推断（暂定 `"2026-01-01" + " 备注"` 报类型错误）。

逐项状态见[实现状态追踪](../testing/2026-07-26-bases-implementation-status.md)，观察与校正流程见 [oracle 操作手册](../testing/2026-07-27-bases-oracle-runbook.md)。

### 3.4 执行预算

文档大小、filter 深度、表达式节点、调用深度、行数、集合元素、单次求值操作数、**单次查询操作数总额**、公式图节点/深度均有硬上限；任一耗尽返回 `base/execution-budget`（error）+ 空结果，**不返回部分结果冒充成功**。

## 4. 常见报错速查

| rule | severity | 含义与处理 |
| --- | --- | --- |
| `base/invalid-schema` | error | 结构不合法：view 缺 `type`/`name`、`order`/`sort` 项形态错、`limit` 非非负整数等 |
| `base/view-required` | error | `views` 缺失或为空 |
| `base/view-not-found` | error | `--view` 指定的名字不存在——看 `suggestions` 里的可用名 |
| `base/duplicate-view-name` | error | 两个 view 重名，拒绝歧义选择 |
| `base/unsupported-view-type` | error | 未知/插件 view type（不按 table 猜测） |
| `base/unsupported-feature` | error | `cards`/`list`/`map`、空 filter 数组、多值分组键等已知但未支持的特性；也用于 all-files 模式遇旧库无 `vault_entries` 表时的降级 compat warning（此时为 warning 级，数据集自动退回 md-only） |
| `base/unknown-function` | error | 白名单外函数（含旧 snake_case，不静默迁移）；也用于未知汇总名 |
| `base/expression-syntax` | error | 表达式文法错误（位置 = `.base` 文件行列）——**把 DQL 的 `=`/`AND` 写进 `.base` 会落这里** |
| `base/formula-cycle` | error | 公式循环引用（message 含完整循环链） |
| `base/path-outside-vault` | error | `.base` 路径越出 vault（读取前拒绝，不读任何字节） |
| `base/execution-budget` | error | 任一预算耗尽（空结果） |
| `base/dynamic-context-required` | error | 无显式 context 遇 `this` |
| `base/unknown-property` | warning | 访问未知 `file.*` 属性（行级，该行不通过，查询继续） |
| `base/property-type-mismatch` | warning | 行级类型错误（类型不可比较、声明类型冲突等；该 cell 为 `null`） |
| `base/invalid-yaml` | error/warning | `.base` YAML 非法（error）；某行 frontmatter JSON 解析失败（warning，该行按空属性处理） |
| `base/markdown-only-dataset` | warning | markdown 模式（缺省）**恒发，不是错误**：声明本次为 md-only 数据集；all-files 模式不发 |
| `base/default-sort-tiebreak` | info | 未显式 sort，按 `file.path` 稳定排序（x-basalt 扩展） |

行级诊断有条数上限（防洪），超出后补一条汇总诊断说明省略了多少条。诊断的完整契约（位置规则、severity 口径）见[设计文档](../specs/2026-07-22-bases-headless-engine-design.md) §11。

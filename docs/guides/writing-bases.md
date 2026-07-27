---
type: guide
title: Bases 编写指南 · x-basalt
description: Bases 是什么、六步写出第一个 .base，以及 x-basalt 覆盖的完整 .base 语法快照（顶层 key/view/filter/表达式/函数全表/值语义/明确不支持）
tags:
  - guide
  - bases
  - syntax
  - tutorial
  - x-basalt
timestamp: 2026-07-27T05:03:24Z
sha256: 2716baab3155fa0bb6375f5e36cbaf9b9060cfaea672b84b26cc7ab8885f7b4e
---
# Bases 编写指南 · x-basalt

> 上级索引：[使用指南](usage.md) · **配套**：[Bases 查询指南](querying-bases.md)（怎么跑、输出契约、报错速查）· 同级：[DQL 查询指南](querying-dql.md)
>
> 本文管**怎么写 `.base`**：[§1 Bases 是什么](#1-bases-是什么) → [§2 六步教程](#2-教程六步写出你的第一个-base) → [§3 完整语法快照](#3-完整语法快照x-basalt-覆盖范围)。写完怎么跑，见[查询指南](querying-bases.md)。

## ⚠ 这是一份快照，不是官方文档的镜像

| | |
| --- | --- |
| **官方文档快照日期** | **2026-07-22**（[Bases syntax](https://obsidian.md/help/bases/syntax) / [Functions](https://obsidian.md/help/bases/functions) / [Views](https://obsidian.md/help/bases/views) / [Properties](https://obsidian.md/help/properties)） |
| **兼容级别 id** | `bases-markdown-2026-07` |
| **本文覆盖** | x-basalt **实际实现**的语法全集——写在这里的才保证能跑 |

Bases 仍在快速演进（1.9 early access 期间已发生 snake_case → camelCase、表达式改方法链、属性引用改 `note["…"]` 等破坏性变更），而 `.base` **没有 schema version 字段**。我们不做持续跟随，而是**定期有意识地对齐官方快照**——所以本文必须是自足的快照：不写在这里的语法，不要假设它能用。

**已知官方后续变动（晚于上述快照，本仓未采纳）**——见到官方文档里有、这里没有的，多半是这些：

| 官方新增 | x-basalt 状态 |
| --- | --- |
| `%` 取模运算符 | 未采纳（快照后新增） |
| `date()` / `link()` 构造函数 | 未采纳（快照后新增） |
| duration 字符串后缀形态（`"1 day"`、短单位 `y/M/d/w/h/m/s`） | 未采纳；本仓只支持 `1day` 这种单 token 形态（[§3.4](#34-字面量与运算符)） |
| `file.backlinks` | 未采纳（待评估） |

升级快照时需专项对齐上表，并同步 [语法真相源](../specs/2026-07-26-bases-syntax.md) 与[实现状态追踪](../testing/2026-07-26-bases-implementation-status.md)。**逐项实现状态与诊断编号以语法真相源为准**；本文是面向使用者的完整覆盖清单与示例，两者标注同一个官方快照日期，升级时必须同步两处。

---

## 1. Bases 是什么

### 1.1 一句话

**Bases 是 Obsidian 官方的「把笔记当数据库查」的核心功能**：你在笔记的 frontmatter 里写属性，再用一个 `.base` 文件声明「筛哪些笔记、显示哪些列、怎么排序分组」，Obsidian 就把匹配的笔记渲染成一张表。

它不引入新的存储——数据仍然是你的 Markdown 笔记和 YAML frontmatter，`.base` 只是一份**查询定义**，本身是纯 YAML 文本，可以进 git。

### 1.2 心智模型：笔记就是表

把整个 vault 想成一张表：

| | `file.name` | `status` | `owner` | `estimate` |
| --- | --- | --- | --- | --- |
| **一行 = 一篇笔记** | 登录改版.md | 进行中 | 小林 | 8 |
| | 搜索优化.md | 进行中 | 阿远 | 21 |
| | 账单导出.md | 已完成 | 小林 | 5 |

- **行** = vault 里的每篇 Markdown 笔记；
- **列** = 两类属性：
  - `note` 属性——来自 frontmatter，直接写属性名即可（`status`、`owner`）；
  - `file` 属性——文件本身的元数据，带 `file.` 前缀（`file.name`、`file.folder`、`file.mtime`、`file.tags`…）。

`.base` 做的事，就是对这张表写「筛选 + 选列 + 排序 + 分组 + 汇总」。

### 1.3 和 Dataview / DQL 是什么关系

同一个需求（「查笔记」）在 Obsidian 生态里有两套东西，**x-basalt 两套都支持，但它们完全独立**：

| | Bases（本文） | Dataview / DQL（[另见](querying-dql.md)） |
| --- | --- | --- |
| 出身 | Obsidian **官方核心功能** | 社区插件 |
| 查询写在哪 | 独立的 `.base` YAML 文件 | 笔记里的 ```` ```dataview ```` 代码块 |
| 长什么样 | `status == "进行中" && priority < 3` | `LIST WHERE status = "进行中"` |
| 运算符 | `==` `!=` `&&` `\|\|` `!` | `=` `!=` `AND` `OR` `NOT` |
| 数据来源 | **只认 frontmatter** | frontmatter + inline fields（`key:: value`） |
| x-basalt 命令 | `x-basalt base` | `x-basalt query` |

**两者语法不通用**，别把 DQL 的 `=`/`AND` 写进 `.base`（会报 `base/expression-syntax`）。Dataview 的 inline fields（`key:: value`）也不会成为 Bases 属性——这是官方 Bases 的限制，不是 x-basalt 的取舍。

### 1.4 x-basalt 在这里做什么

Obsidian 自己渲染 `.base` 需要开着 App。x-basalt 提供的是**无头执行**：不启动 Obsidian，直接回答「这个 view 会返回哪些行和列」，输出稳定 JSON。用途：CI 里校验 `.base` 写得对不对、脚本/AI 拿结构化结果做后续处理、不开 App 快速看结果。

它**不做**：渲染表格/卡片布局、控制 Obsidian App、运行插件函数；查询上**默认只覆盖 Markdown 笔记**——附件（图片/PDF 等）需显式切 all-files 模式才作为行，见[查询指南 §3.2](querying-bases.md#32-all-files-模式附件并入数据集)。

---

## 2. 教程：六步写出你的第一个 `.base`

**每一步的输出都是真实跑出来的**，照抄就能复现。

### 第 0 步：准备笔记与索引

```text
my-vault/
├─ 项目/
│  ├─ 登录改版.md
│  ├─ 搜索优化.md
│  └─ 账单导出.md
├─ 随手记.md          ← 没有 status，用来验证筛选确实生效
└─ views/
   └─ 项目.base       ← 接下来要写的文件
```

`项目/登录改版.md`：

```markdown
---
status: 进行中
owner: 小林
priority: 1
estimate: 8
due: 2026-08-10
tags: [项目, 前端]
---
# 登录改版
```

另外两篇同理（搜索优化：进行中 / 阿远 / priority 3 / estimate 21 / due `2026-09-01`；账单导出：已完成 / 小林 / priority 2 / estimate 5 / due `2026-07-15`）。

> 日期加不加引号都可以（`due: 2026-08-10` 与 `due: "2026-08-10"` 等价）——形态由值层按词法判定：`YYYY-MM-DD` → date、`YYYY-MM-DDTHH:mm[:ss]` → datetime，见 [§3.8](#38-值与类型语义)。

x-basalt 查的是 SQLite 索引而不是直接扫文件，所以**先建索引**（笔记改了要重跑，或用 `x-basalt scan` 增量）：

```bash
x-basalt index ./my-vault
```

### 第 1 步：最小可跑的 `.base`

一个 `.base` 至少要有 `views` 数组，每个 view 至少要有 `type` 和 `name`（两个都是必填）：

```yaml
# views/项目.base
views:
  - type: table
    name: 全部
```

```bash
x-basalt base views/项目.base --vault ./my-vault
```

```json
{
  "base": "views/项目.base",
  "view": "全部",
  "columns": ["file.name"],
  "total": 4,
  "rows": [
    { "file.name": "随手记.md" },
    { "file.name": "搜索优化.md" },
    { "file.name": "登录改版.md" },
    { "file.name": "账单导出.md" }
  ]
}
```

读懂三件事：没写筛选 → **全 4 篇笔记都是行**；没写列 → 默认只给 `file.name`；`type` 目前只支持 `table`。

### 第 2 步：筛选（`filters`）+ 选列（`order`）

`filters` 写表达式，`order` 是要输出的列清单（名字有点反直觉：它是**列顺序**，不是排序）：

```yaml
filters: status
views:
  - type: table
    name: 全部
    order: [file.name, status, owner, due]
```

```json
{
  "columns": ["file.name", "status", "owner", "due"],
  "total": 3,
  "rows": [
    { "file.name": "搜索优化.md", "status": "进行中", "owner": "阿远", "due": { "type": "date", "value": "2026-09-01" } },
    { "file.name": "登录改版.md", "status": "进行中", "owner": "小林", "due": { "type": "date", "value": "2026-08-10" } },
    { "file.name": "账单导出.md", "status": "已完成", "owner": "小林", "due": { "type": "date", "value": "2026-07-15" } }
  ]
}
```

- `filters: status` 是**真值判断**——有 `status` 且值非空的笔记才留下，`随手记.md` 被筛掉（4 → 3）。
- 日期列输出成 `{ "type": "date", … }` 而非裸字符串：说明被识别成了**日期值**，可参与比较与运算。

### 第 3 步：组合条件（`and` / `or` / `not`）+ 排序（`sort`）

```yaml
filters:
  and:
    - status == "进行中"
    - file.inFolder("项目")
views:
  - type: table
    name: 进行中
    order: [file.name, owner, priority, due]
    sort:
      - property: priority
        direction: ASC
```

```json
{
  "total": 2,
  "rows": [
    { "file.name": "登录改版.md", "owner": "小林", "priority": 1, "due": { "type": "date", "value": "2026-08-10" } },
    { "file.name": "搜索优化.md", "owner": "阿远", "priority": 3, "due": { "type": "date", "value": "2026-09-01" } }
  ]
}
```

- 字符串相等用 `==`（**不是** `=`）；上面的 `and` 也可以直接写成一个表达式 `status == "进行中" && file.inFolder("项目")`，等价。
- `sort` 是数组，可多键；顶层 `filters` 与 view 内 `filters` 同时存在时按 **AND 合并**。

### 第 4 步：计算列（`formulas`）

`formulas` 写在**顶层**（不是 view 里），用 `formula.<名字>` 引用：

```yaml
formulas:
  剩余天数: '(due - today()) / 1day'
  规模: 'if(estimate >= 13, "大", "小")'
filters: status
views:
  - type: table
    name: 计算列
    order: [file.name, estimate, 'formula.规模', 'formula.剩余天数']
    sort:
      - property: formula.剩余天数
        direction: ASC
```

```json
{
  "total": 3,
  "rows": [
    { "file.name": "账单导出.md", "estimate": 5,  "formula.规模": "小", "formula.剩余天数": -12 },
    { "file.name": "登录改版.md", "estimate": 8,  "formula.规模": "小", "formula.剩余天数": 14 },
    { "file.name": "搜索优化.md", "estimate": 21, "formula.规模": "大", "formula.剩余天数": 36 }
  ]
}
```

- `today()` / `now()` 给当前时间；`1day` 是 **duration 字面量**。日期相减得 duration，除以 `1day` 得天数（负数 = 已过期）。
- 公式可引用别的公式，自动按依赖顺序求值；循环引用报 `base/formula-cycle` 并列出完整环。
- 公式名含中文/空格时，在 `order` / `sort` 里要加引号（YAML 要求）。

### 第 5 步：分组（`groupBy`）与汇总（`summaries`）

```yaml
summaries:
  平均工作量: 'values.mean().round(1)'
filters: status
views:
  - type: table
    name: 按状态分组
    order: [file.name, owner, estimate]
    groupBy:
      property: status
      direction: ASC
    summaries:
      estimate: 平均工作量
      owner: Unique
      due: Earliest
```

```json
{
  "total": 3,
  "groups": [
    { "key": "已完成", "rows": [{ "file.name": "账单导出.md", "owner": "小林", "estimate": 5 }] },
    { "key": "进行中", "rows": [
        { "file.name": "搜索优化.md", "owner": "阿远", "estimate": 21 },
        { "file.name": "登录改版.md", "owner": "小林", "estimate": 8 }
    ]}
  ],
  "summaries": { "estimate": 11.3, "owner": 2, "due": { "type": "date", "value": "2026-07-15" } }
}
```

- `groupBy` 后多出 `groups` 字段；顶层 `rows` **仍是平铺的全部行**，两者是同一批行的两种视图。
- view 的 `summaries` 是「列名 → 汇总名」；汇总名要么是 15 个内置之一，要么是顶层 `summaries` 里自定义的名字（用隐式变量 `values`）。
- 汇总算的是 **filter 后、limit 前**的全量行。

### 第 6 步：多个 view

一个 `.base` 可放多个 view，`--view` 指定跑哪个，不指定跑第一个。写错不会静默——view 名拼错会报 `base/view-not-found` 并在 `suggestions` 里列出可用名，命令以退出码 1 结束。

### 小结：拼起来的完整文件

```yaml
formulas:
  剩余天数: '(due - today()) / 1day'
  规模: 'if(estimate >= 13, "大", "小")'
summaries:
  平均工作量: 'values.mean().round(1)'
filters:
  and:
    - status
    - file.inFolder("项目")
views:
  - type: table
    name: 进行中
    filters: status == "进行中"
    order: [file.name, owner, priority, 'formula.剩余天数']
    sort:
      - property: formula.剩余天数
        direction: ASC
    limit: 20
  - type: table
    name: 按状态分组
    order: [file.name, owner, estimate]
    groupBy:
      property: status
      direction: ASC
    summaries:
      estimate: 平均工作量
      due: Earliest
```

---

## 3. 完整语法快照（x-basalt 覆盖范围）

> 本节是自足的语法参考——**写在这里的才保证能跑**。官方快照 2026-07-22，未采纳的官方后续变动见[文首表](#-这是一份快照不是官方文档的镜像)。

### 3.1 文件与顶层 key

`.base` 是合法 UTF-8 YAML，无 schema version 字段。顶层允许：

| key | 类型 | 语义 |
| --- | --- | --- |
| `views` | array，**必填且非空** | 视图列表（[§3.2](#32-view-配置)）。缺失/空 → `base/view-required` |
| `filters` | filter（[§3.3](#33-filter-三种形态)） | 全局过滤，与 view 的 `filters` 以 **AND** 合并 |
| `formulas` | map `<名> → <表达式字符串>` | 派生属性（[§3.7](#37-formulas-与-summaries)），以 `formula.<名>` 引用 |
| `summaries` | map `<名> → <表达式字符串>` | 自定义汇总（[§3.7](#37-formulas-与-summaries)），隐式 `values` 作用域 |
| `properties` | map `<property-ref> → { displayName }` | 属性显示配置；**仅结构记录，不影响查询结果** |
| 其它未知 key | 任意 | 向前兼容：产 warning + 原值保留，不影响已知字段执行 |

公式名/汇总名须是合法标识符（Unicode 字母或 `_` 开头，后续可含数字）。

### 3.2 view 配置

| key | 类型 | 说明 |
| --- | --- | --- |
| `type` | string，**必填** | 仅 `table`。`cards`/`list`/`map` → `base/unsupported-feature`；未知/插件 type → `base/unsupported-view-type`。**缺失也报错，不按 table 猜测** |
| `name` | string，**必填非空** | view 名，`--view` 用它选择；重名 → `base/duplicate-view-name` |
| `filters` | filter | 本 view 的过滤，与顶层 `filters` AND 合并 |
| `order` | string 数组 | **投影列清单**（不是排序）。缺省 `["file.name"]`；每项须是字符串 property-ref |
| `sort` | `{ property, direction }` 数组 | 多键排序，按数组顺序；`direction` 仅 `ASC`/`DESC`（缺省 `ASC`） |
| `limit` | 非负整数 | 截断行数；`total` 仍是 limit 前的行数 |
| `groupBy` | `{ property, direction }` | 分组键（标量）；结果增加 `groups` 字段。list/tag 等多值键暂拒绝 |
| `summaries` | map `<property-ref> → <汇总名>` | 列汇总（[§3.7](#37-formulas-与-summaries)） |

未列出的 view 内 key → warning（不影响已支持字段）；`formulas` 写在 view 内 → 报错（官方只在顶层）。

### 3.3 filter 三种形态

```yaml
# 形态一：表达式字符串
filters: status == "进行中"

# 形态二：and / or / not —— 单键对象，值为 filter 数组，可递归嵌套
filters:
  and:
    - status == "进行中"
    - or:
        - priority == 1
        - file.hasTag("紧急")
    - not:
        - file.inFolder("归档")
```

- `and` 全部满足；`or` 任一满足；`not` 是「**不满足其中任何一项**」（= `NOT(a OR b …)`）。
- 一个对象只能有一个键（`and`/`or`/`not` 三选一），值必须是数组。
- **空数组（`and: []`）直接报错**——官方语义未确认，不猜。
- 嵌套深度有上限（超限报 `base/execution-budget`）。

### 3.4 字面量与运算符

**字面量**：`null`、`true`/`false`、数字（整数/小数，无科学计数法）、字符串（单/双引号，支持 `\"` `\\` `\n` `\t` 转义）、list（`[a, b, c]`）、**duration**（`1day`、`2weeks`、`1.5hours`）。

duration 单位（单复数均可）：`millisecond` `second` `minute` `hour` `day` `week` `month` `year`。约定 `month` = 30 天、`year` = 365 天。

**运算符优先级（低 → 高）**：

```text
||  →  &&  →  == !=  →  < > <= >=  →  + -  →  * /  →  一元 ! -  →  .成员/[索引]/调用
```

- 二元运算左结合；`&&` / `||` 短路求值。
- 算术允许的组合（其它组合报行级类型错误，不静默转换）：

| 运算 | 允许 | 结果 |
| --- | --- | --- |
| `+` | number+number；string+string；date±duration；duration+duration | 同类 |
| `-` | number−number；date−duration；duration−duration；**date−date** | 后者得 duration |
| `*` | number×number；duration×number | |
| `/` | number÷number；duration÷number；**duration÷duration** | 后者得无量纲 number（`(now()-file.ctime)/1day` 靠它） |
| 一元 `-` | number；duration | |

**除零报行级类型错误，不产生 Infinity。**

### 3.5 属性引用

| 形态 | 语义 |
| --- | --- |
| `status` | note 属性简写 |
| `note.status` | note 属性显式 |
| `note["Review Status"]` | 带空格/特殊字符的属性名 |
| `note["状态"]` / `状态` | Unicode 属性名合法 |
| `file.name` 等 | file 属性（下表） |
| `formula.<名>` | 引用顶层 `formulas` 定义的公式 |
| `this.*` | **不支持**——无头执行没有「当前活动文件」，报 `base/dynamic-context-required` |

**file 属性全集**：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `file.name` | string | 带扩展名（`Alpha.md`） |
| `file.basename` | string | 不带扩展名（`Alpha`） |
| `file.path` | string | vault 相对 POSIX 路径 |
| `file.folder` | string | 所在目录（根目录为 `""`） |
| `file.ext` | string | 含点（`.md`） |
| `file.size` | number | 字节数 |
| `file.ctime` / `file.mtime` | number | epoch **毫秒**；与日期混合算术时自动按 datetime 处理 |
| `file.properties` | object | 整个 frontmatter |
| `file.tags` | list | frontmatter + 正文行内 tag，去重保序 |
| `file.links` | list | 出链的原始 target 文本（含 embed） |

访问未列出的 file 属性 → `base/unknown-property`（行级错误，不静默 missing）。

### 3.6 函数与方法全表

调用形态只有两种：**全局函数** `f(...)` 和**方法** `接收者.f(...)`。方法按接收者的运行时类型分派，白名单外的名字一律 `base/unknown-function`（含旧版 snake_case 如 `contains_all`，**不静默迁移**）。参数个数不符报行级类型错误。

**全局函数**

| 签名 | 返回 | 说明 |
| --- | --- | --- |
| `if(cond, a, b)` | any | 三元；**只求值被选中的分支** |
| `list(...)` | list | 由参数构造列表（可 0 参） |
| `number(v)` | number | number 原样；字符串 trim 后整体可解析才转换（`"1px"` 报错）；其它类型报错，**不静默塌 0** |
| `today()` | date | 当日 UTC 00:00 |
| `now()` | datetime | 当前时刻 |

**任意接收者**

| 签名 | 返回 | 说明 |
| --- | --- | --- |
| `x.isTruthy()` | boolean | 真值判定（[§3.8](#38-值与类型语义)） |
| `x.isType(name)` | boolean | `name` ∈ `string`/`number`/`boolean`/`list`/`object`/`null`；未知类型名报错 |
| `x.toString()` | string | string 原样；number/boolean 转字符串；null/missing → `""`；**list/object/file 报错** |
| `x.round(digits?)` | number | 接收者须是 number；`digits` 非负整数，缺省 0 |

**string 方法**

| 签名 | 返回 |
| --- | --- |
| `s.contains(sub)` | boolean |
| `s.containsAll(a, b, …)` 或 `s.containsAll([a, b])` | boolean（空集 → true） |
| `s.containsAny(a, b, …)` 或 `s.containsAny([a, b])` | boolean（空集 → false） |
| `s.startsWith(p)` / `s.endsWith(p)` | boolean |
| `s.lower()` / `s.trim()` | string |

**list 方法**

| 签名 | 返回 | 说明 |
| --- | --- | --- |
| `l.contains(v)` | boolean | 成员比较用 typed equality（`1` ≠ `"1"`） |
| `l.containsAll(…)` / `l.containsAny(…)` | boolean | 同 string 版的变长/单 list 两种传法 |
| `l.isEmpty()` | boolean | |
| `l.filter(表达式)` | list | 逐元素求值，真值保留 |
| `l.map(表达式)` | list | 逐元素求值，收集结果 |
| `l.reduce(表达式, 初值)` | any | 逐元素累计 |
| `l.flat(depth?)` | list | 只拍平 list 元素；`depth` 非负整数，缺省 1 |
| `l.sort()` | list | 升序；混合不可比类型报错；null/missing 排最后 |
| `l.unique()` | list | typed equality 去重，保留首现 |
| `l.join(sep?)` | string | 元素只许 string/number/boolean；`sep` 缺省 `""` |
| `l.mean()` | number | 元素须全为 number；**空列表报错**（均值无定义） |

> `filter`/`map`/`reduce` 的参数是**表达式，不是 JS lambda**。表达式里用隐式变量：`value`（当前元素）、`index`（下标）、`reduce` 另有 `acc`（累计值）。例：`tags.filter(value != "草稿").join(", ")`。隐式变量会遮蔽同名 note 属性。

**object 方法**：`o.isEmpty()` → boolean；`o.keys()` / `o.values()` → list。

**file 方法**

| 签名 | 说明 |
| --- | --- |
| `file.hasTag(t)` | 精确或**嵌套前缀**命中（`area` 命中 `area` 与 `area/x`），大小写不敏感 |
| `file.inFolder(f)` | 该目录本身及其子目录；不命中同前缀的兄弟目录（`Projects` 不命中 `Projects2`）；大小写敏感 |
| `file.hasLink(t)` | `t` 含 `/` 走完整路径匹配，否则按 basename 匹配；均忽略扩展名与大小写 |
| `file.hasProperty(k)` | 只看 frontmatter 里 key **是否存在**，不看值真假 |

### 3.7 formulas 与 summaries

**formulas**（顶层）：值是表达式字符串，可引用 note/file 属性和**其它公式**。依赖关系自动拓扑排序（与 YAML 键序无关）；循环引用 → `base/formula-cycle`（消息含完整环）；公式的运行时类型错误只影响该行（行级 warning + 该 cell 为 `null`）。

**summaries**：view 里写 `<列> → <汇总名>`。汇总名可以是 15 个内置之一：

| 输入类型 | 内置汇总 |
| --- | --- |
| number | `Average` `Min` `Max` `Sum` `Median` `Stddev`（总体标准差，除以 n） |
| number 或 date | `Range`（有 number 取 max−min；否则 date 取 latest−earliest） |
| date | `Earliest` `Latest`（保留原精度） |
| boolean | `Checked` `Unchecked` |
| 任意 | `Empty`（空值计数） `Filled` `Unique`（去重计数） |

类型不匹配的值被跳过；全部跳过（或计算集为空）→ 结果 `null`。

也可以在**顶层 `summaries`** 自定义，用隐式变量 `values`（该列的跨行值列表，已剔除 null/missing）：

```yaml
summaries:
  平均工作量: 'values.mean().round(1)'
```

### 3.8 值与类型语义

**类型来源优先级**（高 → 低）：

1. `.obsidian/types.json` 的显式声明（**只读，永不写回**；缺失回退推断并给 info，非法给 warning）；
2. 官方保留字段规则（`tags`/`aliases`/`cssclasses` 为 list）；
3. YAML 运行时类型 + 严格 ISO 日期推断（`YYYY-MM-DD` → date；`YYYY-MM-DDTHH:mm[:ss]`，可带 `Z`/`±hh:mm` → datetime；**不接受小数秒**）；
4. 其余按字符串。

声明类型与实际值冲突**不强制转换**：产 `base/property-type-mismatch`（行级 warning），值按运行时类型继续参与求值。

frontmatter 里整串恰为一个 wikilink 的字符串（`"[[目标]]"` / `"[[目标|显示]]"` / `"[[目标#锚点]]"`）会升级为 **Link 值**，按归一路径 + 锚点比较相等。

**真值（truthiness）**：假 = missing / `null` / `false` / `0` / `""` / 空列表；其余为真（含空对象、非空列表）。

**missing 与 null 是两回事**：属性不存在是 missing，写了 `key:` 是显式 null。`missing == null` 为 **false**；`file.hasProperty()` 只看 key 存在性；missing **投影输出时**才塌成 `null`。

**相等**：同类型按值，**数字不与数字字符串相等**（`1 == "1"` 为 false）；list 按元素递归；object 按 own key 递归；date/datetime 按 epoch；duration 按毫秒；link 按路径+锚点；file 按 path。

**有序比较**（`< > <= >=`）只允许 number↔number、string↔string、date↔date、duration↔duration；其余组合报行级类型错误。

**排序**：多键稳定排序，最终恒以 `file.path` 升序 tie-break（保证结果字节稳定）；null / missing / 不可比类型**恒排最后，与 ASC/DESC 无关**。

> 上面几条里，truthiness 的精确合并、null 排序位置、跨精度 date/datetime 比较、wikilink → Link 等属**暂定口径**，待官方串行 oracle 校正，清单见[查询指南 §3](querying-bases.md#3-限制与暂定口径)。

### 3.9 明确不支持（报诊断，不静默忽略）

| | 行为 |
| --- | --- |
| 白名单外的函数名（含旧 snake_case） | `base/unknown-function` |
| 任意标识符调用、动态成员调用 | 文法层拒绝 |
| `constructor` / `prototype` / `__proto__` 访问 | 拒绝（安全白名单） |
| regex 字面量、`%` 取模 | 文法层拒绝 |
| `this.*` | `base/dynamic-context-required` |
| `cards` / `list` / `map` view、插件 view | `base/unsupported-feature` / `base/unsupported-view-type` |
| 空 filter 数组、多值（list/tag）分组键 | `base/unsupported-feature`（官方语义未确认，不猜） |
| Dataview inline fields（`key:: value`） | 不进入 Bases 属性（官方 Bases 即如此） |
| 附件（图片/PDF/`.base`）作为行 | 默认不支持：markdown 模式每次查询恒发 `base/markdown-only-dataset` 声明；`--conformance bases-all-files-2026-07` 可开启附件为行，见[查询指南 §3.2](querying-bases.md#32-all-files-模式附件并入数据集) |
| 嵌入式 ```` ```base ```` 代码块、`![[View.base#Name]]` | 首期只支持独立 `.base` 文件 |
| 渲染 table/cards 布局 | 查询内核不渲染 |

---

**写好了怎么跑** → [Bases 查询指南](querying-bases.md)：命令与选项、输出 JSON 契约、限制与暂定口径、报错速查表。

**逐项实现状态 / 场景编号 / 诊断契约** → [语法真相源](../specs/2026-07-26-bases-syntax.md) · [实现状态追踪](../testing/2026-07-26-bases-implementation-status.md) · [设计契约](../specs/2026-07-22-bases-headless-engine-design.md)。

---
type: guide
title: 管道教程：--pipe 与算子链
description: x-basalt --pipe 算子链完整教学：Row 心智模型、actions/steps 两种链写法、逐个算子手册、{{row.x}} 插值、filter 表达式、RunReport 口径与端到端配方
tags:
  - guide
  - pipeline
  - orchestration
  - x-basalt
timestamp: 2026-07-30T16:41:55Z
sha256: 9faea6496c8917263f11597114077d66f7d72cf807a19ddb7b2e5cb1c2d9b842
---
# 管道教程：`--pipe` 与算子链

> 这篇讲清一件事：**怎么用 `--pipe` 把 x-basalt 的能力串成一条链**。读完后你应能：写出含逗号参数的链、把 `.base` 的 formula 计算列写回 frontmatter、读懂执行报告。
> 命令签名与逐选项默认值见 [命令参考 · `run`](commands.md#run--变更编排管道)；设计动机与模型决策见 [统一算子模型（设计）](../design/pipeline-op-model.md)。

## 1. 什么时候用管道

- **单文件**改 frontmatter → 用 `meta`，不需要管道。
- **一批文件**做同一件事（批量补 profile、批量改名、定期归一）→ 管道。
- **跨能力**组合（查出来的笔记 → 过滤 → 写回；断链诊断 → 只处理有问题的文件）→ 管道，且必须用 `step=` 写法（§3）。
- **watch 常驻**自动维护 → 配置段 `pipelines.<name>` + `watch --pipe use=<name>`。

管道的纪律：**写动作默认 dry-run**，不加 `--apply` 什么都不落盘——先预览，确认了再加 `--apply`。

## 2. 三个梯度，先跑通

```bash
# ① 简单链：actions= 逗号分隔（七个经典动作，参数里没逗号时用它，紧凑）
x-basalt run --pipe actions=normalize,index --pipe where="LIST FROM #pkm" --apply

# ② 含逗号参数：step= 一 flag 一算子、不切分（参数含顶层逗号时只能用它）
x-basalt run --pipe step=query --pipe step='query TABLE file.path, status FROM #pkm' …   # ✗ 错，见下
```

②的错误示范恰恰是最常见的踩坑：`step=` 的值是**完整算子 spec**（算子名 + 参数），不是「算子名一个 flag、参数一个 flag」。正确写法：

```bash
# ② 正确：一个 step 就是一个完整 spec（第一个空格前是算子名，其余原样是参数）
x-basalt run \
  --pipe step='query TABLE file.path, status FROM #pkm WHERE status = null' \
  --pipe step='set status=active' \
  --apply

# ③ 端到端：.base 的 formula 计算列 → 插值 → 写回 frontmatter
x-basalt run \
  --pipe step='base reports/tasks.base#overdue' \
  --pipe step='filter formula.urgency > 4' \
  --pipe step='set priority={{row.formula.urgency}}' \
  --apply
```

③是这条教程的核心场景：`base` 算子把 `.base` view 的行（含 formula 算出来的 `formula.urgency` 列）变成管道行，`filter` 按计算列筛，`set` 用 `{{row.x}}` 插值把计算结果写回笔记。**这在旧模型里做不到**——计算列进管道就被丢弃了。

## 3. 心智模型：行（Row）在算子间流动

管道里流动的不是「文件路径」，而是**行**：

```
Row = { path: "pkm/A.md",        ← 一等字段：索引主键形态的路径
        event?: "add"|"change"|"unlink",   ← 仅 scan/watch 源产出的行有
        fields: { status: "active",        ← 上游算子的产物全挂这里
                  "formula.urgency": 7,
                  diagnostics: [...] } }
```

每个**算子**都是同一个形状：批进批出 `Row[] → Row[]`。角色不由类型决定，由「它看不看入参」决定：

| 角色 | 形态 | 算子 |
| --- | --- | --- |
| 源 | 忽略入参，凭空产出行（`0 → N`） | `query` / `search` / `base` / `lint` / `links.check` / `links.suggest` |
| 转换 | 消费入参，筛/改行（`N → M`） | `filter` / `limit` / `dedup` / `map`；`query` / `search` / `base` 也能当转换 |
| 动作 | 透传行，副作用在外（`N → N`） | `index` / `parse` / `normalize` / `apply` / `set` / `unset` / `rename` |

**同一个 `query`/`search`/`base` 算子，入参为空就是源，入参非空就是转换**（过滤上游行 + 把自己的列合并进去）。这条规则有一个必须知道的推论：

> ⚠️ **上游把行滤成 0 时，下游查询类算子会「退化为全库源」**。例如 `query A → filter …（滤光）→ query B`：第二步 filter 产出 0 行，`query B` 看到的入参是空集，于是按源模式执行——结果不是「0 行」，而是「B 的全量命中」。这不是 bug，是「源 = 忽略入参」的定义使然（调度层被禁止对空批短路，否则源角色永远无法发生）。**把查询类算子放链首当源用；放中段时确保上游不会合法地滤空。**

## 4. 链的两种写法：`actions=` 与 `step=`

| | `actions=a,b,c` | `step=<spec>`（可重复） |
| --- | --- | --- |
| 切分 | 逗号分隔，**括号感知**（`[]`/`{}`/`()` 内逗号是字面量） | **不切分**，一个 flag 就是完整一步 |
| 适用 | 七个经典动作、参数不含顶层逗号 | 一切算子；参数含顶层逗号时**唯一选择** |
| 例子 | `actions="set tags=[a, b],index"` ✅ | `step='filter tags == "a,b"'` |

两个硬规则：

1. **`step` 存在时优先于 `actions`**（同一条管道里给了两种，走 `step`）。
2. **命令行显式给出链（任一形态）时，整体覆盖配置基底的链**——`--pipe use=maintain --pipe step=…` 不会把 step 追加到 maintain 的链尾，而是整条替换。要复用基底的其他参数（`where`/`concurrency` 等）照常，只有「链」是整体覆盖。

**为什么 `actions=` 表达不了含逗号的参数**：它的切分发生在 CLI 拿到字符串之后，shell 已经剥掉一层引号，括号感知只认 `[]{}()`——`filter status == "a,b"` 里的引号内逗号对它仍是分隔符，一条 spec 会被劈成两半，后半段被当成算子名报「未知操作」。这是 `step=` 存在的全部理由，不是重复设计。

**配置段**对应 `pipelines.<name>.steps`（字符串数组，一元素一算子 spec，只收数组）：

```yaml
pipelines:
  overdue-sweep:
    steps:
      - "base reports/tasks.base#overdue"
      - "filter formula.urgency > 4"
      - "set priority={{row.formula.urgency}}"
    concurrency: 4
    onError: continue
    dryRun: true        # 命令行 --apply 覆盖
```

## 5. 算子手册

spec 的通用形态：**第一个空格前是算子名，其余原样作为参数**（`base reports/a.base#v` → 算子 `base`、参数 `reports/a.base#v`）。

### 5.1 写/读动作（七个经典，`actions=` 也能写）

| 算子 spec | 写 `.md` | 说明 |
| --- | --- | --- |
| `index` | 否（写库） | 把行对应文件增量写入 SQLite 索引 |
| `parse` | 否 | 只读解析校验 |
| `normalize` | 是 | 归一 frontmatter（tags 列表化 / 去 `#` / 去重 / 单数键迁移） |
| `apply <profile>` | 是 | 套用 profile（**纯 top-up**：机械补缺 + 自动归一；要 `--set` / `--refresh-derived` 用 `meta apply` 命令） |
| `set <key>=<value>` | 是 | 设属性；标量值不含空格，列表写 `[a, b]`（`[]` = 空列表） |
| `unset <key>` | 是 | 删属性 |
| `rename <old> <new>` | 是 | 改键名；冲突按 `if-exists`（skip/overwrite/merge） |

这七个都是**逐行独立**（`rowwise`），受 `concurrency` 并发；含 `{{row.x}}` 插值的写算子（如 `set priority={{row.x}}`）一律按写动作对待、受 dry-run 闸约束。

### 5.2 查询类（源/转换双模式，只读）

| 算子 spec | 源模式产出 | 转换模式行为 | fields 键 |
| --- | --- | --- | --- |
| `query <DQL>` | 每个命中文件一行 | 过滤上游行为命中集 + 合并 DQL 列（**同名键 DQL 覆盖上游**） | DQL 的各列 |
| `search <text>` | 每个命中文件一行 | 同上，**search 字段覆盖上游同名键** | `score` / `name` / `snippet` |
| `base <file>[#<view>]` | view 每行一行（**含 formula 计算列**） | 过滤上游行 + 合并列（**上游优先**，base 列只填新键） | view 的各列 |

三个共同的坑：

- **`query` 的 DQL 必须能映射出路径**：`LIST` 天然有 `file.path`；`TABLE` 必须**显式写出 `file.path` 列**（`TABLE file.path, status FROM …`），否则整步报错并提示补法。
- **`base` 的 view 必须在 `order` 里投影 `file.path`**（与上一条同一规则）：BaseEngine 只把 `order` 列出的键投进行，缺了它算子无法映射行路径——该步显式报错「view 未投影 file.path 列…请在 order 中加入」并给出示例。写 `.base` 给管道用时，把 `file.path` 放在 `order` 第一项即可。
- `base` 缺省 `#view` 时取 `views[0]`；**error 级诊断算该步失败**（warning/info 不算——md-only 数据集的 warning 是恒发的）。
- 三者合并策略不同是有意的：`query`/`search` 的列是「查询的当前真相」故覆盖上游；`base` 的列是「计算补充」故不覆盖上游已有值。

### 5.3 诊断类（源/转换双模式，只读）

| 算子 spec | 说明 |
| --- | --- |
| `lint` | 对整个 vault 跑 lint；诊断按文件挂到行上 |
| `links.check` | 对整个 vault 跑断链检查；同上 |
| `links.suggest <fileRel>` | 单文件链接建议；建议挂 `fields.linkSuggestions`（string[]） |

诊断的约定：**诊断挂在 `fields.diagnostics`（`BasaltDiagnostic[]`），诊断 ≠ 失败**——有诊断的行照常透传，`failed` 只表示「跑检查这个动作本身失败」（如 vault 根不可读）。源模式下只有**有诊断的文件**产出行，所以 `lint → set …` 天然只碰有问题的文件：

```bash
# 只给有 lint 诊断的文件打标（源模式：无诊断的文件根本不在行集里）
x-basalt run --pipe step=lint --pipe step='set needs-fix=true' --apply
```

### 5.4 纯函数转换（只读、不碰 IO）

| 算子 spec | 说明 |
| --- | --- |
| `filter <field> <op> [<value>]` | 按行字段过滤，详见 §6 |
| `limit <n>` | 取前 n 行；n 必须为正整数，否则该步报错 |
| `dedup [<key>]` | 缺省按 `path` 去重，给 key 按 `fields[key]` 去重；保留首次出现 |
| `map <target>=<template>` | 模板渲染（支持 `{{row.x}}`）写进 `fields[target]`；不含插值时是常量赋值 |

不匹配的过滤是**丢弃、不是失败**（`filter` 的 `failed` 恒空）——这正是它和「出错」的区别。

## 6. `filter` 表达式：只做字段比较

语法：`filter <field> <op> [<value>]`，**不是 DQL、不是表达式求值器**（管道里过滤的是已在内存的行；要查索引的语义过滤请用 `query` 算子或 `--pipe where=`）。

- 二元：`==` `!=` `>` `>=` `<` `<=`，值按字面量推断类型：纯数字 → number、`true`/`false` → boolean、其余 → string。值可含空格（`filter status == in progress`）。
- 一元：`exists` / `missing`（字段存在与否，不需要值）。
- **类型不同 = 不通过**（不做隐式转换）：`filter priority > 4` 对 `priority` 是字符串 `"5"` 的行不通过；字段缺失在二元比较下也不通过。

字段寻址与插值共用同一套规则（见 §7）：`filter formula.urgency > 4`、`filter score >= 2`、`filter diagnostics exists` 都合法。

## 7. 数据传递：`{{row.x}}` 插值

写算子和 `map` 的参数里可以引用当前行的字段：

```
set priority={{row.formula.urgency}}
map summary=「{{row.name}}」评分 {{row.score}}
```

取值优先级（第一处命中即停）：

1. `path` / `event` → 一等字段；
2. `fields.xxx` → 显式前缀；
3. `xxx` → 隐式等同 `fields.xxx`；
4. 点号键名（`formula.urgency`）→ **先整键匹配** `fields["formula.urgency"]`，再尝试逐级下钻 `fields["formula"]["urgency"]`。

两条纪律：

- **缺失字段 → 渲染为空串 + 记一条 `failed`**（不静默吞掉），但该行的动作仍执行——报告里看到 `模板引用了不存在的字段` 就要检查上游算子的产出键名。
- **只读不求值**：插值里不能写运算/函数/条件。要计算，在 `.base` 的 formula 里算好，或用 `map` 拼字符串——管道不是脚本编排器。

各算子往 `fields` 里放了什么，翻 §5 各表的「fields 键」列；合并冲突时的覆盖规则也在那里。

## 8. 入口与调度：源、过滤、并发、失败策略

一条管道 = **源**（行从哪来）+ **算子链**（怎么流）+ **调度参数**（怎么跑）。

**源**（三命令共享 `--pipe`，命令只决定默认源）：

| 命令 | 默认源 | 可切换 |
| --- | --- | --- |
| `run` | scan（FS↔DB diff） | `--pipe where=<完整DQL>` → DQL 手动源；`--stdin` → 外部喂文件列表；链首放 `query`/`base`/`search` → 算子源 |
| `scan` | diff | 同上（`--pipe` 对称） |
| `watch` | chokidar 事件 | 配置段常驻（`watch --pipe use=<name>`） |

`--stdin` 与 `--pipe` 正交：源走 Unix 管道（逐行一个 vault 相对路径，跳空行与 `#` 注释，不猜 JSON——先用 `jq` 抽路径），链仍用 `--pipe` 定义；与 `where=` 同给时取交集。

**调度参数**（`--pipe k=v`，⟷ 配置段同名 key）：

| key | 说明 |
| --- | --- |
| `where` | DQL 语义过滤；必须是**完整 DQL**（`LIST`/`TABLE`/`TASK` 开头），裸子句直接报错并提示补法 |
| `paths` | glob 过滤（只过滤不作源） |
| `on` | 事件类型过滤（仅 `add`/`change`/`unlink`，对 watch/scan 源有意义） |
| `concurrency` | 逐行动作的并发上限（默认 4）；查询/纯函数类算子整批一次过、不受它影响 |
| `on-error` | `continue`（默认）：失败行从**后续算子**的输入中剔除，其余照跑；`stop`：当前算子跑完即停，不进下一个算子 |
| `debounce` | `wait,maxWait` 毫秒（watch 堆积窗，`wait ≤ maxWait`） |
| `if-exists` | `rename` 键冲突策略（默认 `skip`） |
| `refresh-index` | 写动作落盘后自动把改动文件刷进索引（默认 `true`；链里已含 `index` 时不重复刷）。关掉 = 落盘与索引静默不一致，只建议在「稍后必定统一 index」的批处理里用 |
| `on-busy` | 只支持 `queue`；`restart`/`ignore` 给了会报错而不是静默降级 |

写动作统一受 **dry-run 闸**：默认只预览（`skipped` 计数），`--apply` 才落盘。

## 9. 读懂报告（`--json` 的 `RunReport`）

```json
{
  "total": 0, "changed": 28, "skipped": 0, "dryRun": false,
  "changedPaths": ["pkm/A.md"],
  "byAction": { "set": 28 },
  "reindexed": 28,
  "steps": [
    { "op": "query", "rowsIn": 0, "rowsOut": 30, "failed": [] },
    { "op": "filter", "rowsIn": 30, "rowsOut": 28, "failed": [] },
    { "op": "set", "rowsIn": 28, "rowsOut": 28, "failed": [] }
  ]
}
```

口径（都踩过坑，逐条钉死）：

- `total` / `changed` / `skipped` **同为文件数**——同一文件被多个动作改动只计一次；分动作明细看 `byAction`。
- **`total` 是「进入链首的行数」（scan / `where=` / `--stdin` 源的事件批大小），链内算子自产的行不计入**。所以链首放 `query`/`base`/`search` 当源时 `total` 通常是 0（scan diff 无事件），而 `changed` 照常计数——「`total: 0` 却 `changed: 2`」不是矛盾，实际行数流水看 `steps[]`。
- `steps[]` 是逐步行数流水：定位「行在哪一步消失」就靠它（`rowsOut` 骤降的那步是 filter 语义还是 bug，一目了然）。
- `reindexed`：写后自动刷索引的篇数（dry-run 或链里已有 `index` 时为 0）。`changed > 0` 即说明**写成功且索引已刷新**，不必再手动 `index`/`scan` 复核。
- 退出码：有失败即 `1`，明细在 stderr / `failed`。

## 10. 端到端配方

**A. `.base` 计算列写回 frontmatter**（片三的核心场景）

`reports/tasks.base`（注意 `order` 第一项投影了 `file.path`，管道算子靠它映射行）：

```yaml
formulas:
  urgency: score * 2
views:
  - type: table
    name: overdue
    filters: 'status == "open"'
    order: [file.path, file.name, score, formula.urgency]
```

```bash
x-basalt run \
  --pipe step='base reports/tasks.base#overdue' \
  --pipe step='filter formula.urgency > 4' \
  --pipe step='set priority={{row.formula.urgency}}' \
  --pipe step=index \
  --apply --json
```

链里显式带 `index` 时 `reindexed` 为 0（那一步已落库），去掉它则由 `refresh-index` 自动刷——两种写法索引都是新鲜的。

**B. 全文命中 → 取头部 → 打标**

```bash
x-basalt run --pipe step='search 迁移指南' --pipe step='limit 10' --pipe step='set topics=[迁移]' --apply
```

（`search` 源模式的行按 bm25 排序，`limit` 截的是相关性最高的头部。）

**C. 诊断驱动修复**

```bash
# 只处理有断链诊断的文件：归一 + 重索引
x-basalt run --pipe step=links.check --pipe step=normalize --pipe step=index --apply
```

**D. 原生管道混合**：`query` 选文件 → `jq` 抽路径 → `run --stdin` 只处理这批

```bash
x-basalt query "LIST FROM #pkm" --json | jq -r '.rows[]["file.path"]' \
  | x-basalt run --stdin --pipe actions=normalize --apply
```

**E. 配置段常驻**：§4 的 `overdue-sweep` 写进 `.x-basalt/config.yaml` 后

```bash
x-basalt run --pipe use=overdue-sweep --apply          # 手动跑一次
x-basalt watch --pipe use=overdue-sweep --apply        # 常驻：变更触发自动重跑
```

## 11. 边界与不做

- **不做表达式求值器**（`filter` 只有字段比较，插值只读）；要算，用 DQL / `.base` formula。
- **不做 DAG / 补偿回滚 / 重试退避**——链是线性的，失败策略只有 continue/stop。
- **没有裸 shell 算子**——算子全部内建强类型；要接外部程序走 `--stdin` / Unix 管道（配方 D）。
- 汇（把行集吐成 json/yaml 的 `emit` 算子）**尚未实现**；要看行集内容，用 `query`/`base`/`search` 命令本体或 `--json` 报告的 `steps[]`。
- `on-busy` 只实现 `queue`。

---
type: research
title: 功能覆盖 gap — 对标官方 Dataview / Obsidian
description: deep-research（5 角度 / 23 源 / 105 claim / 22 确认）产出的 x-basalt vs 官方 Dataview 能力差距，按高频刚需 / 中频可缓 / 范围外合理分级
tags:
  - research
  - gap-analysis
  - dataview
  - obsidian
  - coverage
timestamp: 2026-06-30T15:42:56Z
sha256: a50757c6b89f780053b63b867a8ac5f08bfc32c41951dfdcb1a2b60b6584ba08
---

# 功能覆盖 gap — 对标官方 Dataview / Obsidian

> 日期：2026-06-30。状态：调研落地，差距清单 + 优先级建议。
> 触发：dogfood 期评估「对标官方还差多少」，从官方完整能力集**反向 diff**（不止项目自认为的子集口径）。
> 方法：deep-research harness — 5 搜索角度 / 23 源（多为 Dataview 官方文档 primary）/ 105 claim 抽取 / 25 验证 / **22 确认、3 否定**。
> 配套：chat 侧差距见 [`2026-06-30-chat-gap-vs-agent-browser.md`](2026-06-30-chat-gap-vs-agent-browser.md)；既有覆盖口径见 [`../specs/2026-06-26-coverage-matrix.md`](../specs/2026-06-26-coverage-matrix.md)。

## 0. 一句话结论

x-basalt 与官方 Dataview 的核心差距集中在三层：**①元数据采集层**完全缺 inline fields（`key:: value`）→ 以行内字段注入元数据的笔记对 x-basalt 不可查；**②查询表达力层**函数覆盖率仅 ~15%（10/64），且缺 Lambda、动态字段访问、`meta(link)`、`default()`；**③task 元数据层**只提单一 ISO 日期，缺 emoji 多字段语义与三完成状态。

## 1. Gap 清单（按对标对象分组）

> 列：能力 ｜ 官方是否高频 ｜ x-basalt 现状（✅有 / ⚠️近似有缺陷 / ❌缺）｜ 缺失影响。证据均经 deep-research 多票确认（vote 见括号）。

### A. Dataview 元数据采集层（最关键）

| 能力 | 高频 | 现状 | 影响 |
|---|---|---|---|
| **inline fields** `key:: value` / `[key:: value]` / `(key:: value)` | ★核心 | ❌ 完全缺（解析层无 `::` 逻辑、索引层无表、查询层无通道） | **以行内字段注入元数据的整类笔记对 x-basalt 不可查**——Dataview 三元模型（frontmatter/inline/implicit）缺一元（3-0） |
| **task emoji 字段** 🗓️due/✅completion/➕created/🛫start/⏳scheduled | ★高频 | ⚠️ 只用 `DUE_DATE_RE` 提 text 中第一个 ISO 日期，**不区分 emoji 语义** | 无法区分 due/scheduled/completion，多日期场景误判（2-1，注：官方此处有 U+FE0F regex 版本差异） |
| **task 完成状态** status/checked/completed/fullyCompleted | 中 | ⚠️ 仅 status（方括号字符），无 checked/completed/fullyCompleted | 无法表达「级联完成」等语义（3-0） |

> **自评修正**：覆盖矩阵旧记「task due 恒 NULL / 不提取」**不准确**——代码实际提取 ISO due_date，真实差距是「不区分 emoji 语义、缺其余 4 日期字段」。应回写 `coverage-matrix.md`。

### B. Dataview 查询表达力层

| 能力 | 高频 | 现状 | 影响 |
|---|---|---|---|
| **内置函数** 64 个（构造器/数值/数组对象/字符串/工具） | ★核心 | ❌ 仅 10 个（lower/upper/length/round/contains/icontains/startswith/endswith/regexmatch/date），**覆盖 ~15%** | 缺 `default()` 空值回退、`meta(link)` 链接元信息、数组高阶 `filter/map/reduce/flat`、`sort/unique/join`、`dateformat/dur`、`min/max/sum/average`——复杂查询写不出（3-0） |
| **Lambda** `(x) => expr` + **动态字段访问** `a[expr]` | 中 | ❌ 无 lambda 节点、无动态方括号；WHERE 仅静态 `field.field` | 高阶函数与动态键不可用（3-0） |
| **GROUP BY field swizzling** `rows.field` | 中 | ⚠️ `rows` 仅 `json_group_array(path)`（路径字符串数组），非完整对象数组 | 分组后无法 `rows.rating` 再聚合（3-0） |
| **数据类型** 8 种（Text/Number/Boolean/Date/Duration/Link/List/Object） | 中 | ⚠️ Date 靠 ISO 字典序近似；缺 Duration、Link 对象（仅路径串）、Object 嵌套 | 时长运算、链接属性、嵌套对象不可查（3-0） |

### C. Dataview 查询入口

| 能力 | 高频 | 现状 | 影响 / 取舍 |
|---|---|---|---|
| **Inline DQL** `` `= this.file.name` `` | 中 | ❌ 完全缺（无 inline 模式、无 `this`） | 对 **CLI 批量查询**场景影响有限——渲染单值是 GUI 笔记内联用法（3-0） |
| **DataviewJS** dv.pages/list/table | 高（GUI） | ❌ 范围外 | **取舍合理**：需运行时执行任意 JS，违背安全/纯净身份（3-0，已记 `dql-subset-frozen.md`） |
| **FROM 多源** `#tag and "folder"` / `[[A]] or [[B]]` / `-#tag` | ★高频 | ❌ 范围外（DqlSource 单值） | **取舍需复核**：官方将其列为核心高频，CLI 下「跨标签+目录」是真实需求，建议重评是否解禁（3-0） |
| LIST 单附加字段 / WITHOUT ID / TASK 回写 | — | ✅/不适用 | LIST 单字段、WITHOUT ID 已支持；TASK 勾选回写是 GUI 特性，CLI 不适用（3-0） |

### D. Obsidian 解析层（本轮 + 覆盖矩阵已知）

| 能力 | 现状 | 来源 |
|---|---|---|
| callout 嵌套 `>>` / 折叠默认态 `+/-` | ⚠️ 折叠合并为布尔、嵌套未处理 | 覆盖矩阵 + 官方 callouts 文档 |
| 转义 `\[\[` `\#` / 代码块内不解析其他语法 / HTML 注释 | ❌ | 覆盖矩阵 §A |
| **Properties（Obsidian 1.4+ 类型系统）** text/number/checkbox/date/datetime/list/tags/aliases | ⚠️ 未深验，x-basalt 只有 frontmatter 标量白名单 | openQuestion（见 §3） |

### E. 竞品维度（未经多票验证，仅记录）

> caveat：本轮 22 个确认 claim 中**无竞品条目**，以下来自搜索摘要、未对抗验证，不计入正式 gap，仅供视野补充。

- **`nightisyang/obsidian-cli`**（headless-first）：wikilink 解析 + **反链索引** + **graph neighborhood** + **ripgrep 全文检索** + JSON 输出 → 印证 x-basalt 缺「全文检索」「图谱/邻居」两维度。
- `zoni/obsidian-export`（Rust，导出 markdown）、`intellectronica/mdbasequery`、`tobi/qmd`。

## 2. 补齐优先级建议

| 级别 | 项 | 理由 |
|---|---|---|
| **高频刚需（应尽快）** | ① inline fields 提取（解析+索引表+查询通道）② task emoji 多字段+语义 ③ 函数补一批（default / 数组高阶 / 聚合 min·max·sum·average）④ 全文检索（FTS5，竞品标配，已有评估背书） | 直接决定「能不能查到/查得对」，影响面最大 |
| **中频可缓** | Lambda + 动态访问、GROUP BY swizzling、Duration/Link/Object 类型、callout 嵌套/折叠、Properties 类型对齐 | 表达力增强，缺了有 workaround |
| **范围外（取舍合理）** | DataviewJS（安全取舍）、Inline DQL（CLI 影响有限） | 与「纯净无头」身份冲突或低频 |
| **范围外（建议复核）** | FROM 多源 AND/OR/NOT | 官方高频，CLI 跨源查询是真实需求，建议重评是否解禁 |

## 3. 待解问题（openQuestions）

1. inline fields 最小落地成本——解析层加 `key:: value` regex、索引层加 `inline_fields` 表、查询层打通字段路由，能否不破坏现有 schema 增量落地？
2. Obsidian Properties 类型系统与 x-basalt frontmatter 标量白名单的**精确**差距？
3. GROUP BY swizzling 把 `rows` 从路径数组升级为完整对象数组的架构改动量？
4. 竞品（obsidian-cli 等）的全文检索/图谱/导出对无头 CLI 的真实价值？

## 4. 可信度与边界（caveats）

- 竞品对标未多票验证（§1E），全文检索/导出/图谱差距未列正式 gap。
- task emoji claim 为 2-1（一票否决，源于 Dataview U+FE0F regex bug 的版本差异）。
- 「20 个隐式 file.* 字段」claim 被否（1-2）→ `file.etags/aliases/lists/frontmatter/cday/mday/day/starred` 的缺失**程度**本轮未确证，需单独核。
- 来源基于 2026-06 官方文档，Dataview 活跃开发中，细节随版本变。

## 5. 来源（primary 为主）

- Dataview 官方文档：metadata-pages / query-types / data-commands / functions / dql-js-inline / metadata-tasks / add-metadata / api/code-reference / expressions / types-of-metadata
- Obsidian 官方：help/callouts、help/links、changelog 1.4.5、obsidian-help Properties（deepwiki）
- Tasks 插件：Tasks Emoji Format、Dates
- 竞品：nightisyang/obsidian-cli、zoni/obsidian-export、intellectronica/mdbasequery、tobi/qmd

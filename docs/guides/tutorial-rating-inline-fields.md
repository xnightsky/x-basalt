---
type: guide
title: "教程：给笔记打分——rating:: 5 与 inline fields 上手"
description: "面向人的 10 分钟教程：正文 inline fields（key:: value）三种写法、示例 vault 全实测（建索引/四条查询）、五个坑（文本字典序比较/frontmatter 优先/同名 last-wins/key 白名单/旧库重建）、生态调研结论与使用建议"
tags:
  - guide
  - tutorial
  - inline-fields
  - rating
  - dql
  - x-basalt
timestamp: 2026-07-02T06:23:59Z
sha256: 83ac8f691ebeb6eb574c48dafac4c5fe86003ee60e928ed98cdc6bc4de5cbec4
---
# 教程：给笔记打分——`rating:: 5` 与 inline fields 上手

> 这一篇写给**人**看：不讲实现，只讲这个玩法是什么、怎么用、什么时候别用。10 分钟能跟完，所有命令与输出都在真机实测过（2026-07-02）。
>
> 上级索引：[使用指南](usage.md) · 语法细节：[obsidian-syntax.md](obsidian-syntax.md) · 完整查询参考：[querying-dql.md](querying-dql.md) §7.4

---

## 1. 这是什么（30 秒）

给笔记记「评分」这类元数据，正统做法是写在文件顶部的 frontmatter 里：

```markdown
---
rating: 5
---
```

**inline field 是另一种写法**：把字段直接写进正文，用**两个冒号** `键:: 值`。它是 Dataview 插件的发明，好处是字段能**贴着它描述的内容**写，不用跳到文件头部：

```markdown
# 三体
rating:: 5
很硬核。
```

x-basalt 索引后，这两种写法**查起来没有区别**——`WHERE rating` 都能命中。

## 2. 三种写法

| 写法   | 例子                                  | 阅读视图效果            |
| ------ | ------------------------------------- | ----------------------- |
| 整行   | `rating:: 5`（独占一行，可带 `- `）   | 显示 `rating: 5`        |
| 方括号 | `这本 [rating:: 5] 值得重读`          | 行内显示 `rating: 5`    |
| 圆括号 | `这本 (rating:: 5) 值得重读`          | 只显示 `5`，键隐藏      |

## 3. 十分钟上手

### 第 1 步：造几篇笔记

在 `vault/` 目录下建四篇笔记：

```markdown
<!-- 三体.md：整行写法，一本书一篇笔记（推荐姿势，原因见第 4 节坑 3） -->
# 三体
rating:: 5
read:: 2026-01
很硬核。

<!-- 基地.md：行内写法，字段贴着句子 -->
# 基地
这本 (rating:: 4) 二刷过，[author:: 阿西莫夫] 的开山作。

<!-- 神雕.md：frontmatter 和正文都写了 rating（故意的，看谁赢） -->
---
rating: 3
---
rating:: 5
头部写了 3，正文写了 5。

<!-- 待读.md：什么分都没打 -->
# 还没读的
```

### 第 2 步：建索引

```bash
x-basalt index vault --db ./i.db
# ✓ 已索引 vault → ./i.db
```

### 第 3 步：查

**列出所有打过分的，按分数倒序**：

```bash
x-basalt query "TABLE rating, read WHERE rating SORT rating DESC" --db ./i.db
```

实测输出（节选）：

```json
"rows": [
  { "file.name": "三体", "rating": "5", "read": "2026-01" },
  { "file.name": "基地", "rating": "4", "read": null },
  { "file.name": "神雕", "rating": 3,   "read": null }
]
```

注意两件事：**神雕是 3 不是 5**（frontmatter 赢了正文，见坑 2）；inline 来的值带引号（是文本 `"5"`，不是数字，见坑 1）。

**只要高分的**：

```bash
x-basalt query 'LIST WHERE rating > "4"' --db ./i.db
# → 只命中 三体（"5" > "4"）
```

**找出还没打分的**：

```bash
x-basalt query "LIST WHERE !rating" --db ./i.db
# → 只命中 待读
```

就这些。`WHERE rating`（有分）、`!rating`（没分）、`rating > "4"`（比较）、`TABLE ... SORT`（列表排序），加上任意 frontmatter 字段随便混用（`WHERE rating AND status = "done"`），够覆盖日常。

## 4. 五个坑（背下来再用）

1. **值是文本，不是数字。** 比较按字典序：1~5 打分没问题，但 `"10" < "9"`——两位数会排错。评分保持个位数，或只用等值查询。
2. **frontmatter 和正文同名时，frontmatter 赢。** 神雕那篇查出来是 3，正文的 5 只是兜底。别两头写。
3. **一篇笔记里同名字段写几次，只算最后一次。** 这直接决定用法：`清单.md` 里写 `- [[三体]] (rating:: 5)` 和 `- [[基地]] (rating:: 4)` 两行，查出来整篇 `rating` 是 `"4"`（最后那个）——**「一行一本书」的清单在这里行不通，想每本书一个分数就每本书一篇笔记**（实测确认；Dataview 原版会聚成列表，x-basalt v1 取 last-wins，列表化在 backlog）。
4. **key 只认字母/数字/下划线。** `reading time:: 5`、`bad-key:: 1` 不会被识别；查询时 key 大小写不敏感（`WHERE RATING` 也命中 `rating::`）。另外空值（`rating::`）和代码块里的 `k:: v` 都不算字段。
5. **升级或换机器后要重建索引。** 旧索引库里没有 inline 数据，重跑一次 `x-basalt index` 才查得到。

## 5. 老实话：这玩法该不该用？

2026-07 做过一轮多源对抗验证的深度调研（证据链见 [inline fields 采用度与前景调研](../research/2026-07-02-inline-fields-adoption-outlook.md)），结论：

- **它是真的**：Dataview 官方语法，存在整个读书 vault 靠它驱动的真实用户。
- **但生态在退场**：Obsidian 官方的 Properties/Bases 只认 frontmatter，官方明确表示「没有支持 inline 的计划」；连 Dataview 自己的后继者 Datacore 都被官方建议弃用它，降级为 opt-in 遗留选项。

所以建议：**新笔记优先 frontmatter**（x-basalt 的 `meta set` 就是干这个的）；inline fields 留给两种场景——① 你的存量笔记已经这么写了；② 字段确实需要贴着正文某句话。x-basalt 两种都能查，不用二选一，也不用迁移。

## 6. 接下来

- 完整 DQL 语法（GROUP BY、FLATTEN、分页……）：[querying-dql.md](querying-dql.md)
- inline fields 的精确解析规则：[obsidian-syntax.md](obsidian-syntax.md)
- 改 frontmatter（写侧）：`x-basalt meta --help` 或 [commands.md](commands.md)

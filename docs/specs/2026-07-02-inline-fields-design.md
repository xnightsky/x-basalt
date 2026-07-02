---
type: design
title: "inline fields（key:: value）设计规格：三形态文法 · inline_fields 数据模型 · 字段解析语义"
description: x-basalt inline fields 设计真相源：Dataview 三形态（整行/方括号/圆括号）提取正则、inline_fields 表 DDL、查询期 frontmatter ∪ inline 字段解析 SQL（COALESCE）、D1–D5 决策（待拍板，附推荐默认）、安全与已知限制；实现切口与验收见同日 plan
tags:
  - design
  - inline-fields
  - dql
  - parser
  - indexer
  - query
  - x-basalt
timestamp: 2026-07-02T04:14:54Z
sha256: e39210243c331b36b4e1e57098bebd4c58d044e55b7c63f036429253f9dfc9ac
---
# inline fields（`key:: value`）设计规格：三形态文法 · `inline_fields` 数据模型 · 字段解析语义

> 日期：2026-07-02 · 类型：数据模型 + DQL 子集边界设计（先于代码）
> 状态：**草案 — §4 决策（D1–D5）待拍板；拍板后本 spec 冻结，实现计划进入编码**。
> 父冻结规格：[`2026-06-27-dql-subset-frozen.md`](2026-06-27-dql-subset-frozen.md)（本 spec 冻结后新增条目 #28）。
> 关联调研：[`../research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](../research/2026-06-30-feature-gap-vs-dataview-obsidian.md) §A（deep-research 3-0 确认「元数据采集层最关键缺口」）。
> 实现计划（分阶段切口 + 验收）：[`../plans/2026-07-02-inline-fields.md`](../plans/2026-07-02-inline-fields.md)。边界分工：**是什么/为什么/决定什么/规范化产物在本 spec；怎么做/改哪些文件/验收在 plan**——与 [`2026-07-01-dql-truthiness-existence-design.md`](2026-07-01-dql-truthiness-existence-design.md)「先 spec 后实现」先例一致。

## 1. inline fields 是什么（背景与动机）

一句话：**把元数据直接写在正文里的一种写法**——不用挤在文件顶部那段 YAML（frontmatter）里。

Obsidian 笔记记元数据本来只有一个地方，Dataview 又加了一个：

- **frontmatter**（x-basalt 已支持）：文件最顶部 `---` 围起来的 YAML 块，**整篇一份**：
  ```markdown
  ---
  rating: 5
  due: 2026-07-10
  ---
  正文……
  ```
- **inline field**（Dataview 扩展、**本设计要补的**）：元数据**跟正文写在一起**，用 `键:: 值` 表示。三种形态：

  | 形态 | 写法（正文里） | 阅读视图渲染 | 用途 |
  |---|---|---|---|
  | 整行 | `rating:: 5`（独占一行） | `rating: 5` | 给整篇加字段，但不想动 frontmatter |
  | 方括号（键可见） | `这本书 [rating:: 5] 值得重读` | 行内显示 `rating: 5` | 元数据贴着它描述的那句话 |
  | 圆括号（键隐藏） | `这本书 (rating:: 5) 值得重读` | 只显示值 `5`，键藏起来 | 想要字段但不想让键出现在正文 |

**为什么有人这么写**：元数据能**紧挨着它描述的内容**。最典型是一个列表里每行一条、各带自己的字段——

```markdown
## 读书清单
- [[三体]] (rating:: 5) (read:: 2026-01)
- [[基地]] (rating:: 4) (read:: 2026-03)
```

`rating` / `read` 就长在每一行上，不必为每本书单独开一篇带 frontmatter 的文件。

**这恰恰是 x-basalt 今天查不到的**：上面这篇笔记 frontmatter 是空的，`rating` 全在正文的 `::` 里。现在跑 `x-basalt query "TABLE rating WHERE rating"` → **零命中**（`rating` 不是已知字段，直接报「不支持的查询字段」）。**本设计落地后**，无论 `rating` 来自 frontmatter 还是正文 inline，`WHERE rating > 3` 都能查到——两处**合并成同一个字段**（见 §3 与 §6.3）。

## 2. 现状缺口

Dataview 三元元数据模型（frontmatter / inline / implicit），x-basalt 现只有 **frontmatter + implicit 两元，完全缺 inline fields**：解析层无 `::` 逻辑、索引层无表、查询层无通道。后果——凡是用行内 `key:: value` 注入元数据的整类笔记对 x-basalt **不可查**（feature-gap §A，列为「元数据采集层最关键缺口」）。本设计补齐这一元。

## 3. 关键设计洞察：查询文法零改动

Dataview 把 inline 字段与 frontmatter 标量并入**同一字段命名空间**——用户写 `WHERE rating > 4`，`rating` 既可能来自 frontmatter 也可能来自 inline。故 DQL 词法/文法（`src/query/tokens.ts` / `src/query/parser.ts`）**不动**，只改三处：解析笔记（`src/parser/`）、建表与写入（`src/indexer/`）、字段→SQL 解析（`src/query/sql-generator.ts`）。改动贴着现有 **tags 管线**（parser 提取 → indexer 独立表 → query 子查询聚合）走，路径成熟、风险可控。

## 4. 决策 D1–D5（待拍板，附推荐默认）

拍板即随本 spec 冻结；实现期不得再改，改需走修订并按 §9 同步真相源。

| # | 决策点 | 推荐默认 | 理由 / 取舍 |
|---|---|---|---|
| **D1** | frontmatter 与 inline 同名 key 优先级 | **frontmatter 胜，inline 兜底**（`COALESCE(fm, inline)`） | frontmatter 是显式元数据头，更权威、结果可预测；官方合并语义偏模糊，取确定性 |
| **D2** | inline 值类型 | **v1 一律 TEXT，字典序比较** | 同现有 ISO 日期近似口径；`rating:: 5` 可 `= "5"`/`> "4"`，但 `10 vs 9` 字典序会错——guide 显式警示，数值/日期类型化列 backlog |
| **D3** | 多值同名 key（一篇里 `k:: a` 出现多次） | **v1 last-wins 单值** | 列表语义需改字段返回形状，成本大；先单值，列表列 backlog。落点见下方澄清 |
| **D4** | key 字符集 | **v1 仅索引且可查 `[A-Za-z0-9_]+` 的 key** | 与查询层字段名白名单 `^[A-Za-z0-9_]+$` 对齐 → 文法零改动；带空格/连字符 key（`reading time::`）v1 不解析，列 backlog |
| **D5** | 是否加 `file.inlineFields` 整块对象字段（对标 `file.frontmatter`） | **v1 不做** | 低频；先把「按 inline 字段查/筛」这条主路径打通 |

> **D3 落点澄清（spec 化时收口原 plan 的含糊处）**：last-wins 在 **parser 提取期去重**兑现——每 `file × key_norm` 只保留最后一次出现（`line_number` 即最后出现行），故 `inline_fields` 表内每键至多一行；§6.3 子查询的 `LIMIT 1` 仅是防御性护栏，**不承担语义**（裸 `LIMIT 1` 无 `ORDER BY` 时行序不保证，若靠它实现 last-wins 是错的）。

## 5. 子集边界（v1 纳入 / backlog 唯一清单）

**纳入（v1）：**
- 解析 3 种 Dataview inline 形态（整行 / 方括号 / 圆括号）；代码区不解析（复用现有 `maskCode`）。
- 新增 `inline_fields` 表，随 parser 落地；scan/watch 增量与 rebuild 全量 **delete-in-lockstep**（与 tags/tasks 同步删）。
- 查询期：裸字段名解析为 **frontmatter ∪ inline**，并让 `WHERE field` 真值、`field = null` 存在性把 inline 也算进来。硬约束 6：查询期 JOIN/子查询实时算，无物化视图。

**Backlog（v1 不做；本清单为唯一权威，plan 不再重复）：**
- 多值同名 key → 列表（D3 取 last-wins）；
- inline 值类型化（数值/日期强类型比较；D2 取 TEXT）；
- 带空格/连字符 key 的可查询化（需扩文法；D4 取白名单字符集）；
- `file.inlineFields` 聚合对象字段（D5 不做）；
- meta 层写回 inline。

## 6. 规范化产物（冻结后为唯一权威定义，实现按此落码）

### 6.1 三形态文法与正则（parser）

- 提取在 **`maskCode` 后**的正文上跑（代码区已等长掩码，天然不误吃）。
- 整行形态：`^\s*(?:[-*]\s+)?([A-Za-z0-9_]+)\s*::\s*(.*)$`（允许列表项前缀 `- k:: v`）。
- 方括号形态：`\[([A-Za-z0-9_]+)\s*::\s*([^\]]*)\]`；圆括号形态：`\(([A-Za-z0-9_]+)\s*::\s*([^)]*)\)`。
- key 字符集按 D4；去重/多值按 D3（提取期 last-wins，见 §4 澄清）。
- 注释分界（AGENTS「规范来源分界」硬要求）：规范点标 `// === Obsidian 规范来源: Dataview inline fields（key:: value 三形态）===`，自建正则部分标 `// === 自建实现 ===`。

### 6.2 `inline_fields` 表 DDL（indexer，镜像 tags 表风格）

```sql
CREATE TABLE IF NOT EXISTS inline_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path   TEXT NOT NULL,
  key         TEXT NOT NULL,        -- 原始 key（trim 后，保留大小写）
  key_norm    TEXT NOT NULL,        -- key 的小写形式，查询连接键
  value       TEXT NOT NULL,        -- 原始值文本（v1 不类型化，见 D2）
  line_number INTEGER NOT NULL      -- 1-based 正文行号（last-wins 后为最后出现行）
);
CREATE INDEX IF NOT EXISTS idx_inline_fields_file_path ON inline_fields(file_path);
CREATE INDEX IF NOT EXISTS idx_inline_fields_key_norm  ON inline_fields(key_norm);
```

- **生命周期**：随 parser 落地；scan/watch 增量与 rebuild 全量 delete-in-lockstep——凡删 tags/tasks 处必同步删 inline_fields，否则 scan 后残留旧字段（回归高危点）。
- **硬约束 6 自查**：本表仅存原始提取文本，字段合并/解析在查询期实时算，无物化视图。

### 6.3 字段解析 SQL（query，文法不动）

- `fieldToSql` 的 `default` 分支（frontmatter 标量）改为按 D1 优先级合并：

  ```
  COALESCE(
    json_extract(f.frontmatter, '$.<k>'),
    (SELECT value FROM inline_fields WHERE file_path = f.path AND key_norm = '<klower>' LIMIT 1)
  )
  ```

  `<k>` 先经 `^[A-Za-z0-9_]+$` 白名单校验后内联（无注入，同现有 `json_extract` 约定）；`<klower>` = `<k>` 小写，同样白名单后内联，无注入面。`LIMIT 1` 为防御性护栏（语义见 §4 D3 澄清）。
- `truthySql` 的 `default`（frontmatter 标量真值）：value/type 表达式改指向上面的 COALESCE 结果；两侧都无 → falsy。
- `compileWhere` 的 `isnull` `default` 分支：`= null` / `!= null` 存在性同样对 COALESCE 结果判 `IS NULL`。
- `file.frontmatter` / `file.tags` / inlinks / outlinks / tasks 等既有字段**不变**。

## 7. 安全

- **注入面**：key 经 `^[A-Za-z0-9_]+$` 白名单校验后才内联进 SQL / json path，同现有 `json_extract` 约定，无新增注入面；value 恒走参数化或子查询列，不拼接。
- **ReDoS**：§6.1 三条正则均线性、无嵌套量词；测试须含超长行对抗用例。
- **测试维度**（对齐 AGENTS「复杂模块重测试」）：key/value 注入、`::` 正则 ReDoS、边界值、异常输入、错误定位——用例落 plan 各阶段，测试号回写覆盖矩阵。

## 8. 已知限制与语义差异（guide / 文档须显式警示）

- **[语义]** D1 frontmatter-wins 与官方 Dataview 合并语义有细微差异；按 codebase 确定性取舍，本 spec 即为注明处。
- **[类型]** v1 TEXT 字典序比较对数值/日期是近似（同现有 ISO 取舍）；`rating > "4"` 可用但 `10 vs 9` 字典序会错——`querying-dql` guide 须显式警示。
- **[模型]** 「无 frontmatter 只有 inline」的笔记 v1 可查（这正是目标）；但 inline 值不进 `file.frontmatter` 对象（D5 不做 `file.inlineFields`）。
- Backlog 见 §5。

## 9. 真相源 rebase 地图（拍板冻结后与实现同批同步）

| # | 文件 | 变更 |
|---|---|---|
| 1 | `docs/specs/2026-06-27-dql-subset-frozen.md` | 新增条目 **#28 inline fields**（P0 挂 🚧 占位、P4 翻 ✅）；「隐式字段映射」段补「frontmatter 标量 = COALESCE(fm, inline)」 |
| 2 | `docs/specs/2026-06-26-coverage-matrix.md` | inline fields 从 ❌ 翻 ✅ 并挂测试号（P4，测试绿后） |
| 3 | `docs/guides/querying-dql.md` | 新增 inline fields 小节（三形态、与 frontmatter 同命名空间、优先级 D1、类型 D2 / 多值 D3 限制警示） |
| 4 | `docs/guides/obsidian-syntax.md` | inline field 语法说明 |
| 5 | `skills-def/biz-dql-subset/SKILL.md` + `skills-def/biz-obsidian-spec/SKILL.md` | 补 inline fields → `pnpm run skills:install` 重装 |
| 6 | `skill-data/core.json5` / `skill-data/obsidian-base-spec.json5` | 产品运行时召回补 inline fields |
| 7 | 根 `TODO.md` | feature-gap 高频刚需清单里 inline fields 勾掉并链接 plan |

执行切口与验收见实现计划 P0 / P4。

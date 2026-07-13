---
timestamp: 2026-07-01T06:48:10Z
type: spec
title: DQL 真值/存在性语义补正设计（unary `!` + 裸字段真值 → isTruthy）
description: 把 x-basalt DQL 子集缺失的一元 `!` 与裸字段真值判断补齐为对标官方 Dataview 的 isTruthy 语义，并厘清与 `= null`/`!= null` 的语义分工；含文法/AST/SQL 设计、真相源 rebase 地图与实施/测试计划
tags:
  - spec
  - dql
  - truthy
  - dataview
  - x-basalt
---

# DQL 真值/存在性语义补正设计（unary `!` + 裸字段真值 → isTruthy）

> 日期：2026-07-01 · 类型：语义补正设计（先于代码）
> 父冻结规格：[`2026-06-27-dql-subset-frozen.md`](2026-06-27-dql-subset-frozen.md)（本设计对其 #10 行做修订、并新增 #25/#26）
> 关联能力对标：[`../research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](../research/2026-06-30-feature-gap-vs-dataview-obsidian.md)（本项为该轮 deep-research 的**盲区补录**）
> 真相源纪律：本设计冻结后，按 §7 rebase 地图同步 `skills-def/biz-dql-subset/SKILL.md` + `skills-data/obsidian-base-spec.json5` + research/architecture/plan/coverage，并 `pnpm run skills:install` 重装。

## 1. 触发（dogfood 实况）

用户问「有多少篇笔记没有 `index`？」，chat agent 连试 5 句才蒙对：

| 试 | 写法 | 结果 |
|---|---|---|
| 1 | `WHERE !index` | ✗ 词法错误 `unexpected character !` |
| 2 | `WHERE index = null` | ✓ 406 |
| 3 | `WHERE index`（裸字段真值） | ✗ 语法错误 `Expecting Op but found ''` |
| 4 | `WHERE index != null` | ✓ 0 |

模型自然写出的两种官方惯用法（`!field`、裸 `field`）**全部报错**，而唯一能用的 `= null`/`!= null` 既未在 chat 读到的规范里出现、且**语义并不等价**于官方 `!field`（见 §3.3）。这不是模型笨，是子集缺算子 + 真相源缺口 + 错误引导回指一份没有答案的文档三者叠加。

## 2. 权威语义确证（对标 blacksmithgu/obsidian-dataview 源码）

经 deepwiki 对官方仓库源码问答确证（`src/expression/parse.ts` / `context.ts` / `src/data-model/value.ts`）：

- **`!field` 是官方文法一等公民**：解析期产出 `NegatedField` AST 节点；求值时对子表达式取 `Values.isTruthy()` 再取反。
- **裸 `field` 真值判断是官方推荐写法**（文档原例 `WHERE due AND due < date(today)`、`WHERE !completed AND …`）；WHERE 子句本身期望布尔，字段被隐式真值强制。
- **`Values.isTruthy()` 真值表**（`value.ts`）：

  | 类型 | falsy 当且仅当 |
  |---|---|
  | null | 恒 falsy |
  | number | `= 0` |
  | string | 空串 `""` |
  | boolean | `false` |
  | array | 空数组 `[]` |
  | object | 无键 `{}` |
  | link | path 为空 |
  | date | 毫秒值 `0` |
  | duration | 秒值 `0` |
  | html/widget/function | 恒 truthy |

- **缺键 vs 显式 null**：官方求值时**两者都归 `null`、都 falsy、不作区分**（`Context.evaluate` 查不到键即返回 `null`）。→ x-basalt 也无需在语义层区分二者。
- **`!= null` 与真值并不等价**（官方原话）：`WHERE 0` 为假，`WHERE 0 != null` 为真。故 `field != null` 对「存在但为 falsy 值」的判断与 `!field`/裸字段相反。

> **web 多源佐证（deep-research `wf_ab18b7c3`，5 角度 / 99 agent / 多票对抗验证）已回，结论与本节一致并强化**：
> - `!field` 是官方 `parse.ts` 一等文法产生式 `negatedField = P.seqMap(P.string('!'), indexField, Fields.negate)`——**非特例**；`isTruthy()` 是 WHERE 唯一布尔门（`engine.ts` 无第二条布尔路径）。
> - 缺键（`undefined`）与显式 `null` 官方不可区分：`isNull(v)= v===null||v===undefined`，且 `compareValue()` 先把 `undefined` 归一为 `null` 再比较。
> - 原则性设计判词（原文）：*"faithfully implement a general `isTruthy()` abstraction and compose unary `!` over it — the Lox/Crafting-Interpreters archetype — rather than special-casing individual query patterns"*——正是本设计 §4 的取舍。
> - 额外收获：null 传播陷阱 `null <= date(today)` → true（会静默混入无该字段的笔记），官方文档给的护栏就是裸字段真值 `WHERE field AND field <= value`——反证「裸字段真值」是刚需而非可选糖。
> - 真正的键存在性（不塌缩到真值）官方仅 `contains(object, key)` 提供，且只作用于对象子属性、不适用顶层 frontmatter——故顶层字段的 `= null` 塌缩不可避免，与本设计一致。

## 3. 问题定性（三个洞）

1. **无一元 `!`**：`tokens.ts` 的 `Op = /!=|<=|>=|=|<|>/` 无独立 `!`，`!field` 死在词法。
2. **无裸字段真值**：`parser.ts` 的 `primary` 消费 Identifier 后强制要求跟 `(` / `REGEXP` / `Op`，裸字段死在语法。
3. **`= null` 是语义偏离**：现 `isnull` 映射 `IS NULL`/`IS NOT NULL`，仅判 null；官方 `!field`/裸字段还要把 `0`/`""`/`[]`/`{}`/`false` 判为 falsy。当前把 `= null` 当作唯一存在性惯用法，在 falsy 值上会**数错**。

三者都违反冻结规格自立的原则——「严格对标官方 Dataview；子集只做少而正确的取舍（**暂不实现=报错，而非语义偏离**）」。#3 恰是被明令禁止的「语义偏离」。

## 4. 决策：补通用算子，不特化反例

**选定：忠实实现两个通用算子——一元 `!` 与裸字段真值——并映射到官方 `isTruthy` 语义。** `= null`/`!= null` 保留，重新定位为**显式 null 比较**（与真值判断语义分工明确，见 §5）。

被否方案：

- ✗ **只补文档、加 `index != null` 示例**（初版建议）：过拟合单一 case，且在 falsy 值上语义错误。
- ✗ **补 `!`/裸字段但仍映射 `IS NULL` 语义**（省事）：同样偏离官方（`0`/`""`/`[]` 判错），仍违反「不得偏离官方语义」。
- ✓ **isTruthy 全保真（json_type CASE）**：一个 SQL 辅助函数 `truthySql` 收口，落在冻结规格既定 mandate 内。成本可控、可测、无过拟合。

## 5. 语义规格

### 5.1 两类算子分工（务必在真相源里讲清）

| 意图 | 写法 | 语义 |
|---|---|---|
| 有意义地「有」某属性 | `WHERE field` | isTruthy(field) |
| 有意义地「没有」某属性 | `WHERE !field` | NOT isTruthy(field) |
| 键存在且值非 null（含 falsy 值如 0/""） | `WHERE field != null` | field IS NOT NULL |
| 键缺失或值为 null | `WHERE field = null` | field IS NULL |

**分歧点（务必在文档给出对照）**：一篇 `index: 0` / `index: ""` / `index: []` 的笔记——`!index` 判为「没有」，而 `index != null` 判为「有」。回答「有多少篇没有 index」应默认用 `!index`（贴合用户直觉），除非显式要「键是否存在」才用 `= null`。

### 5.2 缺键与显式 null 同归 falsy（对齐官方，不区分）

## 6. 文法 / AST / SQL 设计

### 6.1 tokens.ts — 新增 `Bang`

```ts
/** 一元逻辑取反 `!`（真值否定）。须置于 allTokens 中 Op 之后：
 *  `!=` 由 Op 的多字符交替先吃；孤立 `!`（后随非 `=`）Op 不匹配，回退到 Bang。 */
export const Bang = createToken({ name: "Bang", pattern: /!/ });
```

`allTokens` 顺序：`… Op, Bang, LParen, …`（**Op 在前**保证 `!=` 归 Op，孤立 `!` 归 Bang）。

### 6.2 ast.ts — 新增 `truthy` 节点

```ts
export type WhereExpr =
  | { kind: "and" | "or"; left: WhereExpr; right: WhereExpr }
  | { kind: "not"; expr: WhereExpr }
  | { kind: "truthy"; field: string }               // 新增：裸字段真值（isTruthy）
  | { kind: "compare"; field: string; fn?: ScalarFn; op: CompareOp; value: string | number | boolean }
  | { kind: "isnull"; field: string; negated: boolean }   // 保留：显式 null 比较
  | { kind: "call"; fn: StringFn | "regexmatch"; field: string; arg: string };
```

统一模型：`!field` = `not(truthy(field))`；裸 `field` = `truthy(field)`；`!(expr)` / `NOT (expr)` = `not(expr)`。与官方 `NegatedField` 包裹真值一致。

### 6.3 parser.ts

- `notExpr`：前缀取反接受 **`NOT` 关键字或 `!`(Bang)**（二者等价，均包裹后随 primary）：

  ```ts
  notExpr = this.RULE("notExpr", () => {
    let neg = false;
    this.OPTION(() => { this.OR([{ ALT: () => this.CONSUME(Not) }, { ALT: () => this.CONSUME(Bang) }]); neg = true; });
    const inner = this.SUBRULE(this.primary);
    return neg ? { kind: "not", expr: inner } : inner;
  });
  ```

- `primary`（Identifier 开头分支）：消费 head 后，将「尾随 `(`/`REGEXP`/`Op` 部分」整体裹进 `OPTION`；**未跟任何尾随 token → 返回 `{kind:"truthy", field: head}`**。裸字段的 follow 集（`AND`/`OR`/`)`/子句关键字/EOF）不与 `(`/`REGEXP`/`Op` 冲突，chevrotain 前瞻可区分，无歧义。

### 6.4 sql-generator.ts — `truthySql` 复刻 isTruthy

新增 `case "truthy": return { sql: truthySql(expr.field), params: [] };`，`not` 之上包 `(NOT …)`（CASE 恒返回 0/1，无 NULL 分支，`NOT` 安全）。

```ts
function truthySql(field: string): string {
  // 任务上下文的 completed 与 compare 分支一致处理（可选，边界）
  const direct = FILE_COLUMNS[field];
  if (direct !== undefined) return `(${direct} IS NOT NULL AND ${direct} <> '')`;   // 文件标量列
  if (["file.tags","file.inlinks","file.outlinks","file.tasks"].includes(field)) {  // 隐式聚合数组
    const { expr } = fieldToSql(field);
    return `(json_array_length(${expr}) > 0)`;
  }
  if (!/^[A-Za-z0-9_]+$/.test(field)) throw new DqlSyntaxError(`不支持的查询字段: ${field}`, 0);
  const P = `'$.${field}'`;                 // 白名单校验后内联，无注入面（同现有 json_extract 约定）
  const v = `json_extract(f.frontmatter, ${P})`;
  const t = `json_type(f.frontmatter, ${P})`;
  return `(CASE
    WHEN ${t} IS NULL THEN 0
    WHEN ${t} = 'null' THEN 0
    WHEN ${t} = 'true' THEN 1
    WHEN ${t} = 'false' THEN 0
    WHEN ${t} IN ('integer','real') THEN (${v} <> 0)
    WHEN ${t} = 'text' THEN (length(${v}) > 0)
    WHEN ${t} = 'array' THEN (json_array_length(f.frontmatter, ${P}) > 0)
    WHEN ${t} = 'object' THEN ((SELECT count(*) FROM json_each(f.frontmatter, ${P})) > 0)
    ELSE 1 END)`;
}
```

SQLite 语义核对：`json_type(X,P)` 缺路径→SQL NULL（缺键 falsy）；布尔→`'true'`/`'false'`；数值→`'integer'`/`'real'`；串→`'text'`（`length>0`）；数组→`json_array_length>0`；对象→`json_each` 计数 `>0`。与 §2 真值表逐条对齐。

## 7. 真相源 rebase 地图（与本设计同批落地）

| # | 文件 | 变更 |
|---|---|---|
| 1 | `docs/specs/2026-06-27-dql-subset-frozen.md` | #10 行由「唯一存在性写法」改为「显式 null 比较」；新增 #25 一元 `!`、#26 裸字段真值→isTruthy；AST 契约加 `truthy`；「仍不做」删去对真值的隐含排除 |
| 2 | `docs/specs/2026-06-26-coverage-matrix.md` | WHERE 段新增「一元 `!` / 裸字段真值（isTruthy）」行；§总结覆盖率口径微调 |
| 3 | `docs/specs/2026-06-27-dql-grammar-tool-decision.md` | 附注：文法新增 `Bang` token + 裸字段 atom，chevrotain 无缝支持 |
| 4 | `docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md` | §1B 补录**算子级 gap**（前轮盲区）：`!`/裸真值缺失、`=null` 偏离；标记由本设计 resolved |
| 5 | `docs/architecture/2026-06-28-overview.md` | §5 DQL 编译管线：WHERE atom 增真值节点、isTruthy→SQL 映射一句 |
| 6 | `docs/plans/2026-06-26-dql-kernel-steps.md` | 新增步 **S2.15b 真值/一元 `!`**（TDD：先测后码，含 falsy 值对照与优先级用例） |
| 7 | `skills-def/biz-dql-subset/SKILL.md` | 「支持的子集/操作符」补 `!`+裸真值+isTruthy；`= null` 定位为显式 null 比较；「非目标」相应更新 |
| 8 | `skills-data/obsidian-base-spec.json5` | DQL 规则描述补存在性惯用法（`!field`/裸字段）与 `=null` 分歧对照 + 示例；`pnpm run skills:install` 重装 |
| 9 | `skills-data/core.json5` | DQL 基础一句：判有无优先 `!field`/裸字段 |
| 10 | `docs/guides/querying-dql.md`、`docs/guides/obsidian-syntax.md` | 用户向新增「判断属性有无 / 真值 vs `= null`」小节 |
| 11 | `src/chat/tool-errors.ts` | dql 建议从「回指文档」改为内联干货（判有无用 `!field`/裸字段；不再自我打转）|

## 8. 实施与测试计划（开发阶段）

**代码**（TDD，红→绿）：
1. `tokens.ts` 加 `Bang`（Op 后）→ 词法测：`!x`→Bang、`!=`→Op、`x!=1` 正常。
2. `ast.ts` 加 `truthy`。
3. `parser.ts` `notExpr` 收 `!`、`primary` 收裸字段 → parser 测：`WHERE index` / `WHERE !index` / `!a AND b`（优先级）/ `!(a=1)` 的 AST 形状。
4. `sql-generator.ts` `truthySql` + `case "truthy"` → sql-gen 单元测：frontmatter 标量各类型（null/0/""/非空/数组空非空/对象）、file.* 列、聚合字段。
5. 端到端 query 测：`!index` 与 `index=null` 在「存在但 falsy」上结果分歧的对照用例（锁死 §5.1 语义）。

**验证门**：`pnpm run typecheck` + `pnpm test`（现 272+ 绿，不回归）+ `pnpm run lint`；改动文件 `pnpm run format`。skills 改完 `pnpm run skills:install`。

## 9. 影响面 / 风险 / 回滚

- **向后兼容**：纯新增语法（原 `WHERE index` 报错→现合法）；不改既有 `= null`/`compare`/`call` 行为。唯一行为变化是「原本报错的输入现在有意义」，非破坏性。
- **风险**：`truthySql` 的 SQLite `json_type`/`json_each` 依赖 frontmatter 列为合法 JSON——与现有 `json_extract` 用法同前提，无新增假设。
- **回滚**：`truthySql` 与 `truthy` 节点隔离，移除即回到旧行为；文档 rebase 可独立 revert。

## 10. openQuestions

1. `!field = value` 的优先级：本设计沿用「`!`/`NOT` 包裹整个 primary」（→ `NOT (field = value)`），与官方「一元高于比较」有极端边界差异；`!field=value` 属病态输入，暂按 codebase 一致性取舍，文档注明。
2. TASK 上下文 `WHERE completed`（裸真值）是否也走 `k.status IN ('x','X')` 特判——低频，实施时顺带处理或明确报错。
3. `file.size = 0` 的真值（数值列按「非空」近似为 truthy，与官方 number `0` falsy 有极端差异）——file.* 标量真值属罕见用法，文档注明近似。

## 11. 2026-07-02 补录：`file.frontmatter` 顶层存在性

**收口 §2 末尾遗留的开放点**（"真正的键存在性……官方仅 `contains(object, key)` 提供，且只作用于对象子属性、不适用顶层 frontmatter——故顶层字段的 `= null` 塌缩不可避免"）：dogfood 场景库 `messy/no-index-count` 坐实这不只是理论缺口——chat 实测直接写 `WHERE file.frontmatter = null` 试图问"完全没有 frontmatter"，命中「不支持的查询字段」报错，退化为逐篇 `meta_get` 试探、撞步数顶（详见 `docs/plans/2026-07-02-deterministic-eval-gaps.md`）。

**方案**：把 `file.frontmatter` 补成合法隐式字段，语义定义为**顶层键计数**（`FM_KEY_COUNT = (SELECT COUNT(*) FROM json_each(f.frontmatter))`），与既有「一元 `!` / 裸字段真值 / `= null`」三套惯用法自然收敛：

| 写法 | SQL | 含义 |
|---|---|---|
| `WHERE file.frontmatter` | `FM_KEY_COUNT > 0` | 有 ≥1 个顶层键 |
| `WHERE !file.frontmatter` | `NOT (FM_KEY_COUNT > 0)` | 无任何顶层键 |
| `WHERE file.frontmatter = null` | `FM_KEY_COUNT = 0` | 同上，`isnull` 惯用法 |
| `WHERE file.frontmatter != null` | `FM_KEY_COUNT > 0` | 同「有」 |
| `TABLE file.frontmatter` | `f.frontmatter`（json 列） | 整块 frontmatter 对象 |

**为何不能走通用列真值 / 通用 `IS NULL`**：`files.frontmatter` schema 上 `NOT NULL`，无 `---` 与空 `---\n---` 都归一存字面 `'{}'`（索引层已丢失二者区别，见 `src/parser/frontmatter.ts`）——若走 `FILE_COLUMNS` 的「非空字符串即真」通用判断，`'{}'` 会被误判为真；若走通用 `isnull` 的 `IS NULL`，该列永不为 SQL NULL、恒假。故 `fieldToSql`/`truthySql`/`compileWhere` 的 `isnull` 分支均需对 `file.frontmatter` 做特判（见 `src/query/sql-generator.ts` FM_KEY_COUNT 常量注释）。

**已知限制（不改变本设计 §2 的既有结论）**：「完全无 frontmatter」在当前 schema 下只能定义为「无顶层键」，无法进一步区分「根本没写 `---`」与「写了空 `---\n---`」——两者索引层都存 `'{}'`。若产品需要区分，需扩 `files` 表加列（超出本次范围）。

**测试**：`tests/query-parser.test.ts`（AST 形状）、`tests/sql-generator.test.ts`（SQL 形态：`FM_KEY_COUNT` 出现、不误走通用真值/`IS NULL`）、`tests/query.test.ts`（端到端三篇对照：有键 / 空围栏 / 无围栏）。

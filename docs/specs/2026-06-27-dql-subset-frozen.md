# 扩展后 DQL 目标子集冻结（S2.2a）

> 日期：2026-06-27 · 类型：子集边界冻结（S2.2a 产出，先于代码）
> 父计划：[`../plans/2026-06-26-dql-kernel-steps.md`](../plans/2026-06-26-dql-kernel-steps.md) S2.2a/S2.2b
> 工具决策：[`2026-06-27-dql-grammar-tool-decision.md`](2026-06-27-dql-grammar-tool-decision.md)（chevrotain）
> 真相源：本表冻结后由 **S2.2b** 同步写入 `skills-def/biz-dql-subset/SKILL.md` + research §3，并对齐 `tests/query.test.ts` 断言。

## 决策来源

在原 MVP「严格子集」基础上扩展。重特性范围与函数集经 2026-06-27 与用户对齐：
- **本轮纳入**重特性：**TASK 查询类型、GROUP BY、FLATTEN**（全纳入，贴官方 dataview，撑代表作纵深）。
- 内置函数集：**日期 + 常用字符串/数值**（date today/now、lower/upper、length、round）。
- 规范对标原则：严格对标官方 Obsidian/Dataview；自定义口径与官方无冲突时以官方为准。

## 冻结裁决表（每个「纳入」项附 AST→SQL 策略，证明可实现）

| # | DQL 特性 | 裁决 | AST→SQL 策略要点 |
|---|---|---|---|
| 1 | `LIST` | ✅ | columns 默认 `file.link`/`file.name`/`file.path`；行=文件 |
| 2 | `TABLE f1, f2, …` | ✅ | 显式列；隐式字段/frontmatter 映射见下「隐式字段」 |
| 3 | **`TASK [FROM …] [WHERE …]`** | ✅ 本轮 | 行=任务：`JOIN tasks ON tasks.file = files.path`，返回 `{text,status,line,file,…}`；FROM/WHERE 复用文件过滤（tag/folder/link 经 files） |
| 4 | `FROM #tag` | ✅ | `tag = 'x' OR tag LIKE 'x/%'`（前缀含嵌套），JOIN tags |
| 5 | `FROM "folder"` | ✅ | `files.path LIKE 'folder/%'` |
| 6 | `FROM [[link]]` | ✅ | 反链：`JOIN links ON links.target = <resolved>`（basename 近似，见假设） |
| 7 | `FROM` and/or 多源 | ❌ 不做 | goal 范围外；遇到报 `DqlSyntaxError` |
| 8 | 比较 `= != < > <= >=` | ✅ | 参数化绑定；列来源见隐式字段表 |
| 9 | `AND / OR / NOT` + 括号 | ✅ | 递归 WHERE → 嵌套 `AND/OR/NOT (...)` |
| 10 | **`field = null` / `!= null`** | ✅ 本轮 | → `<col> IS NULL` / `IS NOT NULL`（不参数化 null） |
| 11 | **日期比较**（frontmatter 日期 / due_date） | ✅ 本轮 | ISO 字典序：`json_extract(...) >= ?`，绑定 ISO 串 |
| 12 | `contains/icontains/startswith/endswith` | ✅（补完整） | 标量→LIKE（i* 加 `lower()` 两侧）；数组字段(tags/inlinks/outlinks)→JOIN 命中；LIKE 通配符 `%_` 转义 + `ESCAPE` |
| 13 | `regexmatch(field,"pat")` | ✅（补防护） | 自定义 `REGEXP` 函数；加 pattern 长度上限 + 执行防 ReDoS |
| 14 | **内置 `date(today)` / `date(now)`** | ✅ 本轮 | generator 端求值为 ISO 串后**参数化绑定**（确定性、可测） |
| 15 | **内置 `lower/upper`** | ✅ 本轮 | → SQL `lower()/upper()` |
| 16 | **内置 `length(x)`** | ✅ 本轮 | 字符串→`length()`；数组/tasks→`json_array_length()` 或 COUNT |
| 17 | **内置 `round(x[,n])`** | ✅ 本轮 | → SQL `round()` |
| 18 | **多键 `SORT a ASC, b DESC`** | ✅ 本轮 | → `ORDER BY a ASC, b DESC`；对聚合 JSON 列排序报错 |
| 19 | `LIMIT n` | ✅（补校验） | `LIMIT ?`；`n<0` parse 期报错 |
| 20 | **`WITHOUT ID`** | ✅ 本轮 | 列控制：移除默认 id/file.link 列 |
| 21 | **`GROUP BY <expr>`** | ✅ 本轮 | `GROUP BY <expr>`；非分组列 `json_group_array(...)` 聚合为数组（对齐 dataview「分组后 rows 成列表」） |
| 22 | **`FLATTEN <arrayField>`** | ✅ 本轮 | `, json_each(<arraycol>)` 笛卡尔展开为多行；展开值作新列可被 WHERE/SORT 引用 |
| 23 | `CALENDAR` | ❌ 不做 | goal 范围外 |
| 24 | DataviewJS（`dataviewjs` 块） | ❌ 不做 | goal 范围外（需运行时执行任意 JS，安全问题） |

## 隐式字段映射（沿用真相源，不变）

`file.name/path/folder/extension/size/mtime/ctime` = files 列；`file.tags` = tags 聚合；`file.inlinks` = links 反向 JOIN；`file.outlinks` = links 正向 JOIN（含 embed）；`file.tasks` = tasks 关联；frontmatter 标量 = `json_extract(files.frontmatter,'$.<k>')`。**硬约束**：inlinks/outlinks 无物化视图，查询期 JOIN 实时计算。

## 扩展后 AST 契约草案（S2.2c 落 `src/query/ast.ts`）

```ts
type QueryType = "LIST" | "TABLE" | "TASK";                 // +TASK
interface DqlQuery {
  type: QueryType;
  fields: string[];
  from?: DqlSource;                                         // 单源不变
  where?: WhereExpr;                                        // +null/日期/函数节点
  sort?: { field: string; dir: "ASC" | "DESC" }[];         // 单键 → 多键数组
  groupBy?: { expr: string };                              // 新增
  flatten?: { field: string };                            // 新增
  withoutId?: boolean;                                     // 新增
  limit?: number;
}
// WhereExpr 增：{ kind:"isnull"; field; negated } | 函数调用扩到内置标量函数
```

## 仍不做（明确报错而非静默）

`FROM` and/or 多源、`CALENDAR`、DataviewJS、`length()` 之外的任意聚合/数值表达式运算（如 `a + b`）—— 超子集一律抛带位置 `DqlSyntaxError`。

## S2.2b 衔接（防分叉纪律）

1. 改 `skills-def/biz-dql-subset/SKILL.md`「支持的子集 / 非目标」段到本表；`pnpm run skills:install` 重装。
2. 改 research §3 子集描述。
3. 调整 `tests/query.test.ts` 中「非子集报错」断言：原把多键 SORT / TASK / GROUP BY 等当报错的用例，迁移到新边界（这些现在是合法子集；仅 FROM and-or / CALENDAR / DataviewJS / 未知字段仍报错）。

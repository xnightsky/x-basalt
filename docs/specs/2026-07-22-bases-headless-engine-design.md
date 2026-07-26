---
type: design
title: Obsidian Bases 无头执行引擎设计
description: 冻结 x-basalt 首期 .base Markdown conformance 的模块边界、语义子集、结果与诊断契约、安全预算和阶段扩展条件
tags:
  - design
  - obsidian
  - bases
  - headless
  - query-engine
timestamp: 2026-07-22T10:50:29Z
sha256: fde5eb320fcc7b3164c05684b8a416b66bf0082a9d7c34fee55e74cd4f42ed91
---

# Obsidian Bases 无头执行引擎设计

> 日期：2026-07-22
> 状态：实现前设计冻结；P1 之外的阶段仍需独立计划。
> 调研：[`../research/2026-07-22-obsidian-bases-headless-engine-research.md`](../research/2026-07-22-obsidian-bases-headless-engine-research.md)
> 验收矩阵：[`../testing/2026-07-22-bases-scenario-matrix.md`](../testing/2026-07-22-bases-scenario-matrix.md)

## 1. 产品契约

x-basalt 新增一个**无 GUI、无 Obsidian 运行时、只读执行 `.base` 的库层**。首个实现级别命名为：

```text
x-basalt Bases Markdown conformance 2026-07
```

它回答：“对当前 SQLite 索引中的 Markdown 笔记，指定 `.base` view 会返回哪些行和列？”

它不承诺：

- 渲染 table/cards/list/map；
- 控制 Obsidian App；
- 复刻官方 CLI 输出字节；
- 查询附件和其他非 Markdown 文件；
- 运行任意 JavaScript 或插件函数；
- 在没有显式上下文时模拟 GUI `this`。

## 2. 硬边界

1. 不 import `obsidian`、不引入其类型包、不调用 `obsidian://`。
2. 不依赖官方 CLI、Electron、浏览器、metadata cache 或 Dataview evaluator。
3. `.base` 与可选 `.obsidian/types.json` 只经 `fs` 读取；P1 不写任何 vault 文件。
4. expression 禁止 `eval`、`new Function`、`vm` 或动态 import。
5. SQLite 查询全部参数化；未知语法、函数、字段和 view 类型显式诊断。
6. links/tags/backlinks 等仍通过现有表查询期计算，不物化 Obsidian cache。
7. 现有 DQL 结果集继续只含 `.md`；Bases all-files 不得通过改变旧 `files` 语义偷渡。

## 3. 模块边界

新增一级模块 `src/base/`，与 `src/query/` 平级：

```text
src/base/
  ast.ts             # BaseDocument / BaseExpr / runtime value 类型
  document.ts        # YAML Document -> schema；保留 source span
  tokens.ts          # Bases expression tokens
  parser.ts          # expression -> BaseExpr（Chevrotain）
  functions.ts       # 白名单函数注册表与签名
  values.ts          # typed equality/truthiness/compare/property access
  planner.ts         # view 选择、filter 合并、公式依赖图
  source.ts          # SQLite -> BaseRow；复用现有 tags/links/file metadata
  evaluator.ts       # 带预算的纯 AST 解释器
  engine.ts          # BaseEngine.query()
  errors.ts          # 结构化错误/诊断辅助
  index.ts           # 公共出口
```

依赖方向：

```text
cli / future MCP
  -> base engine
       -> base document/parser/evaluator
       -> better-sqlite3（只读）
       -> utils/path（路径与链接键）
       -> diagnostic（稳定诊断形状）
```

禁止依赖：

- `base -> cli/chat/orchestrator/meta`
- `query -> base` 或 `base -> query parser/AST`
- `parser(markdown) -> base`（P1）

允许抽取的共享原语仅限：安全正则、路径键、SQLite 只读连接辅助、分页元数据；不得把两套语言 AST 合并成“通用表达式”大抽象。

## 4. 公共 API

```ts
export interface BaseQueryOptions {
  basePath: string;
  view?: string;
  dbPath: string;
  vaultRoots: string[];
  contextFile?: string;
  clock?: () => Date;
  limits?: Partial<BaseExecutionLimits>;
}

export interface BaseQueryResult {
  conformance: "bases-markdown-2026-07";
  base: string;
  view: string;
  columns: string[];
  total: number;
  rows: Record<string, BaseOutputValue>[];
  diagnostics: BasaltDiagnostic[];
}

export class BaseEngine {
  query(options: BaseQueryOptions): BaseQueryResult;
  close(): void;
}
```

契约：

- `base`、`contextFile` 与 row 内 file path 都是 vault 相对 POSIX 路径；
- `total` 是 filter 后、limit 前行数；
- `rows.length <= limit`；
- 未显式 sort 时按 `file.path ASC` 做 x-basalt 稳定 tie-break，并给 info diagnostic；
- Link/File/Date 等输出必须序列化为稳定 JSON 形状，不能泄漏类实例。

建议输出值：

```ts
type BaseOutputValue =
  | null
  | string
  | number
  | boolean
  | BaseOutputValue[]
  | { type: "link"; path: string; display?: string; subpath?: string }
  | { type: "date" | "datetime"; value: string }
  | { [key: string]: BaseOutputValue };
```

## 5. 文档 schema 子集

P0/P1 支持：

```yaml
filters: <filter>
properties:
  <property-ref>:
    displayName: <string>
views:
  - type: table
    name: <non-empty string>
    filters: <filter>
    order: [<property-ref>, ...]
    sort:
      - property: <property-ref>
        direction: ASC | DESC
    limit: <non-negative integer>
```

P1 解析但不执行、并给 `base/unsupported-feature`：

- `formulas`
- 顶层与 view `summaries`
- `groupBy`
- `type: cards/list/map` 与插件 view

未知顶层 key 作为 warning 保留，便于向前兼容；未知已知结构内部 key 根据是否影响结果分别 warning/error。重复 view name 直接 error，避免命名选择歧义。

## 6. Filter 对象

```ts
type BaseFilter =
  | { kind: "expr"; expr: BaseExpr; source: SourceSpan }
  | { kind: "and" | "or" | "not"; children: BaseFilter[]; source: SourceSpan };
```

规则：

- 字符串是 expression filter；
- 对象只能包含 `and`、`or`、`not` 中一个键；
- value 必须是 filter 数组；
- `and: []` 为 true，`or: []` 为 false，`not: []` 为 true；该口径实现前需用 oracle 验证，若官方不稳定则空数组直接拒绝；
- `not` 表示“不满足其中任何一项”，等价 `NOT (child1 OR child2 ...)`；
- global filter 与 view filter 组合为外层 AND。

## 7. P1 expression grammar

### 7.1 支持

- literal：null、boolean、number、quoted string、list；
- property：`status`、`note.status`、`note["Review Status"]`；
- file property：name/basename/path/folder/ext/size/ctime/mtime/properties/tags/links；
- unary：`!`；
- binary：`&& || == != < > <= >=`；
- 括号；
- 白名单函数/方法调用；
- 只读属性/列表索引访问。

### 7.2 P1 不支持

- 任意标识符调用、成员动态调用、constructor/prototype；
- regex literal；
- 算术、duration、Link/File 构造；
- `formula.*`；
- list `filter/map/reduce/flat/sort/unique/join`；
- `this`（除非后续阶段显式 context）；
- HTML/image/icon/random。

### 7.3 优先级

从低到高：

1. `||`
2. `&&`
3. `== !=`
4. `< > <= >=`
5. unary `!`
6. postfix property/index/call
7. primary

不复用 DQL token：DQL 用 `=`、`AND/OR/NOT`，Bases 用 `==`、`&&/||/!`，错误提示也必须分别指向各自规范。

## 8. P1 值语义

### 8.1 Missing 与 null

内部保留 `MISSING` sentinel，不能在读取时立刻塌成 null：

- `file.hasProperty(name)` 只看 key 是否存在；
- 直接投影 missing 输出 null；
- equality/truthiness 的精确合并规则由 `BASE-PROP-004` oracle 冻结；
- diagnostic 可区分 missing、explicit-null 与 type-mismatch。

### 8.2 类型来源

优先级：

1. `.obsidian/types.json` 中已识别的显式类型；
2. 官方保留字段规则（tags/aliases/cssclasses 为 list，tags 具 tag 语义）；
3. YAML runtime type 与严格日期格式推断；
4. 其余字符串为 text。

显式类型与实际值冲突时不强制转换，产生 `base/property-type-mismatch`。比较/函数若需要对应类型则该行表达式为 error value，由 engine 汇总诊断。

### 8.3 equality 与排序

- 同类型 primitive 按值比较；
- 数字不与数字字符串隐式相等；
- 列表按元素递归相等；
- object 只允许 `==/!=`，P1 可按结构递归；
- Link/File/Date equality 后置到 P2；
- 多键 sort 稳定执行，最终用 `file.path` tie-break；
- null/missing/error 的排序位置在实现前由 oracle 固化，不能照搬 SQLite 默认。

## 9. P1 函数白名单

| 类型   | 函数/方法                                                                           |
| ------ | ----------------------------------------------------------------------------------- |
| global | `if`、`list`、`number`                                                              |
| any    | `isTruthy`、`isType`、`toString`                                                    |
| string | `contains`、`containsAll`、`containsAny`、`startsWith`、`endsWith`、`lower`、`trim` |
| list   | `contains`、`containsAll`、`containsAny`、`isEmpty`                                 |
| object | `isEmpty`、`keys`、`values`                                                         |
| file   | `hasTag`、`inFolder`、`hasLink`、`hasProperty`                                      |

函数注册项必须声明：name、receiver type、arity、return type、实现、P1 scenario IDs。未知函数按源位置报 `base/unknown-function`。

`if` 采用 lazy branch：只计算被选择分支，避免未选分支的错误污染结果；该行为需 oracle 验证。

## 10. 数据源

`BaseRowSource` 从现有 DB 生成每篇 Markdown 的运行时行：

```ts
interface BaseRow {
  note: Record<string, BaseValue>;
  file: BaseFileValue;
}
```

映射：

| Bases 字段                                          | 当前来源                                   |
| --------------------------------------------------- | ------------------------------------------ |
| note / file.properties                              | `files.frontmatter` JSON                   |
| file.name/basename/path/folder/ext/size/ctime/mtime | `files`                                    |
| file.tags                                           | `tags` 聚合，含 frontmatter 与 inline tags |
| file.links                                          | `links` 按 source 聚合，含 embed           |
| file.hasLink                                        | `links` + `utils/path` 路径感知匹配        |
| file.hasTag                                         | `tags` 精确或 nested prefix                |

P1 不把 Dataview inline field 合入 note property：官方 Bases 不支持 Dataview inline fields。现有 DQL 的 frontmatter-wins/inline-fallback 只属于 DQL，不得泄漏到 Bases。

P1 每次执行可一次性读取候选 Markdown 行并在 evaluator 中 filter。只有真实性能证据出现后才做 SQL predicate pushdown；下推必须通过同一场景集证明与 evaluator 等价。

## 11. 诊断契约

沿用 `BasaltDiagnostic`，rule 前缀统一为 `base/`：

- `base/invalid-yaml`
- `base/invalid-schema`
- `base/view-required`
- `base/view-not-found`
- `base/duplicate-view-name`
- `base/unsupported-view-type`
- `base/unsupported-feature`
- `base/markdown-only-dataset`
- `base/unknown-property`
- `base/unknown-function`
- `base/expression-syntax`
- `base/property-type-mismatch`
- `base/formula-cycle`（P2）
- `base/execution-budget`
- `base/dynamic-context-required`

位置规则：

- YAML 结构问题指向 key/value 的 `.base` 完整文件位置；
- expression 问题 = YAML scalar 起点 + expression UTF-16 offset；
- runtime 行级问题的主位置仍指表达式，同时 message/target 附 row `file.path`；
- 不使用 Markdown body 相对行号。

error 阻止结果或使对应表达式失败；warning/info 可随结果返回。CLI 的退出码策略留给薄出口计划，不进入引擎语义。

## 12. 安全与预算

```ts
export interface BaseExecutionLimits {
  maxDocumentBytes: number;
  maxYamlAliases: number;
  maxFilterDepth: number;
  maxExpressionNodes: number;
  maxCallDepth: number;
  maxRows: number;
  maxCollectionItems: number;
  maxOperations: number;
}
```

首期默认值实现时通过 fixture/benchmark 校准，但必须存在硬上限。每次 AST 节点访问、函数调用、列表元素比较和行过滤都扣 operations；耗尽后抛 `base/execution-budget`，不得返回部分结果冒充成功。

属性访问器禁止：

- `__proto__`
- `prototype`
- `constructor`
- 非 own property
- symbol / getter / host object 原型方法

YAML 使用安全 schema；限制 alias 数量与文档尺寸。Base 路径 resolve 后必须仍在某个 vault root 内。

## 13. P2/P3 扩展顺序

### P2 typed formulas

1. Date/DateTime/Duration、Link/File runtime value；
2. 算术与 method chaining；
3. formula 依赖图、cycle diagnostic；
4. list filter/map/reduce 隐式作用域；
5. groupBy 与 summaries；
6. `today/now` 注入 clock；正则最后评估。

### P3 host/all-files

1. 独立设计 `vault_entries`/附件索引，证明 DQL 不变；
2. all-files BaseRowSource；
3. Markdown `base` code block parser 节点；
4. 显式 `contextFile` 与 `this`；
5. `.base` embed 的 view/context 解析；
6. 纯函数插件扩展注册（若有真实需求）。

## 14. 不做

- 追求官方所有 GUI view 的视觉兼容；
- 用官方 CLI 兜底执行不支持语法；
- 自动改写旧 `.base`；
- 写 `.obsidian/types.json`；
- 把 `.base` 变成 DQL 文本翻译器；
- 自动把 Dataview inline fields 当 Bases properties；
- 未经场景验证就标注“完整兼容”。

## 15. 实现前置验收

开始 P0 代码前必须：

1. 用户确认首期 Markdown-only 兼容口径；
2. 为 `BASE-DOC-*` 与 P1 主路径建立 fixture 空壳；
3. 对 `BASE-PROP-004`、`BASE-RESULT-002` 做官方串行 oracle；
4. 建执行计划并同步 TODO；
5. 明确 API 先于 CLI，避免业务逻辑落回 `src/cli.ts`。

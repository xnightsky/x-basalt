---
type: spec
title: Bases 语法参考（x-basalt 口径）
description: .base 文件格式、views 配置、filter 对象、表达式文法、函数白名单、值与类型语义的单一语法真相源，逐项标注实现状态
tags:
  - spec
  - bases
  - obsidian
  - syntax
  - x-basalt
timestamp: 2026-07-27T18:54:40Z
sha256: 0c11eadb4123aac5d43230c762ea610d48659f352467b117d83335afeba69bf8
---
# Bases 语法参考（x-basalt 口径）

> 日期：2026-07-26 · 官方快照：2026-07-22（[Bases syntax](https://obsidian.md/help/bases/syntax) / [Functions](https://obsidian.md/help/bases/functions) / [Views](https://obsidian.md/help/bases/views) / [Properties](https://obsidian.md/help/properties)）。
> 本文是 `.base` 语法在 x-basalt 的**单一语法真相源**：每项语法标注实现状态（【P0 ✅】/【P1 ✅】/【P2a ✅】/【P1】/【P2】/【P3】/【不做】/【待 oracle】），逐项状态与实现时间见 [`../testing/2026-07-26-bases-implementation-status.md`](bases-status.md)。
> 设计契约：[`2026-07-22-bases-headless-engine-design.md`](bases-engine.md)；场景编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md)。
> 分期总口径：首期 = **Bases Markdown conformance 2026-07**（只把 Markdown 笔记作为记录、只支持 table view 查询语义，不渲染布局、不含附件数据集）。

## 1. 文件格式

`.base` 是合法 YAML，UTF-8，无 schema version 字段（演进政策见 §8）。

### 1.1 顶层 key

| key          | 类型                    | 语义                       | 状态                              |
| ------------ | ----------------------- | -------------------------- | --------------------------------- |
| `filters`    | filter（§3）            | 全局过滤，与 view filter 以 AND 合并 | 【P0 ✅ 结构校验】【P1 ✅ 求值】 |
| `properties` | map                     | 属性显示配置（§2.2）       | 【P0 ✅ 结构记录】                |
| `views`      | array（必填、非空）     | 视图列表（§2）             | 【P0 ✅ 结构校验】                |
| `formulas`   | map                     | 派生属性定义（§6）         | 【P2a ✅ 执行】（依赖图拓扑 + 循环诊断 + clock 注入） |
| `summaries`  | map                     | 自定义汇总（`values` 隐式作用域） | 【P2b ✅ 执行】（SUM-002 空值剔除/越权口径暂定，待 oracle） |
| 未知顶层 key | 任意                    | 向前兼容：warning + 原值保留，不影响已知字段 | 【P0 ✅】       |

诊断口径：`views` 缺失/空 → `base/view-required`；未知顶层 key → warning。

> 官方快照漂移记录（2026-07-27 观察）：现网官方文档新增 `%` 取模、`date()`/`link()` 构造、duration 字符串后缀形态（`"1 day"` 与短单位 y/M/d/w/h/m/s）——晚于本仓 2026-07-22 冻结快照，未采纳；快照升级时需专项对齐（含 P2a `1day` token 形态复核）。

### 1.2 properties 段

```yaml
properties:
  status:
    displayName: 状态
  note["Review Status"]:
    displayName: 评审状态
```

key 是 property-ref（§4.1），value 目前只有 `displayName`。【P0 ✅ 结构记录；语义消费（列头显示名）属后续 CLI/渲染层】

## 2. views

```yaml
views:
  - type: table
    name: All
    filters: <filter>
    order: [<property-ref>, ...]
    sort:
      - property: <property-ref>
        direction: ASC | DESC
    limit: <非负整数>
```

| key       | 状态                                                            |
| --------- | --------------------------------------------------------------- |
| `type`    | 【P0 ✅ 校验】**必填**；`table` 支持；`cards`/`list`/`map` 报 `base/unsupported-feature`；未知/插件 type 报 `base/unsupported-view-type`，不按 table 猜测；**键缺失报 `base/invalid-schema`——缺失与未知同口径，同样不按 table 猜测**（2026-07-27 review 修正：此前缺失静默当 table 执行） |
| `name`    | 【P0 ✅ 校验】**必填**且为非空字符串；重名报 `base/duplicate-view-name`；**键缺失报 `base/invalid-schema`**（2026-07-27 review 修正：此前缺失得 `name=""` 且逃过重名判定） |
| `filters` | 【P0 ✅ 结构校验】【P1 ✅ 求值】                                 |
| `order`   | 【P0 ✅ 结构记录】【P1 ✅ 投影】                                 |
| `sort`    | 【P0 ✅ 结构记录（direction 仅 ASC/DESC）】【P1 ✅ 执行】        |
| `limit`   | 【P0 ✅ 校验非负整数】【P1 ✅ 执行】                             |
| `groupBy` | 【P2b ✅】view 级 `{ property, direction }`，标量键；list/tag 键暂定报 `base/unsupported-feature`（待 oracle GROUP-002） |
| `summaries` | 【P2b ✅】view 级 `<property-ref> → 15 内置汇总名/顶层自定义名`（未知名报 `base/unknown-function`） |

view 选择规则：未指定取 `views[0]`（默认 view）；指定不存在报 `base/view-not-found`（suggestions 列可用名）。【P0 ✅】

## 3. filter 对象

filter 是递归结构，两种形态：

```yaml
# 形态一：表达式字符串
filters: status == "active" && file.inFolder("Projects")

# 形态二：and / or / not 单键对象，值为 filter 数组
filters:
  and:
    - status == "active"
    - or:
        - type == "project"
        - type == "area"
    - not:
        - archived == true
```

规则（对齐官方）：

- 对象**只能含 `and`/`or`/`not` 中一个键**，值必须是 filter 数组；违反 → `base/invalid-schema`。【P0 ✅】
- 全局 filter 与 view filter 组合为外层 AND。【P1 ✅】
- `not` = 「不满足其中任何一项」，等价 `NOT (child1 OR child2 ...)`。【P1 ✅】
- 空数组：`and: []` → true、`or: []` → false、`not: []` → true。【待 oracle：官方口径未冻结；P1 遇空数组直接报 `base/unsupported-feature` 拒绝】
- 嵌套深度受 `maxFilterDepth`（默认 32）预算限制，超限报 `base/execution-budget`。【P0 ✅】

## 4. 表达式语言

Bases 表达式**不是 DQL**：比较用 `==`，布尔用 `&& || !`（DQL 用 `=` 与 `AND/OR/NOT`），两套 token/AST 不共用（`src/base/tokens.ts`/`parser.ts` 独立于 `src/query/`），错误提示分别指向各自规范。

### 4.1 属性引用（property-ref）

| 形态                    | 语义                                   | 状态   |
| ----------------------- | -------------------------------------- | ------ |
| `status`                | note property 简写                     | 【P1 ✅】 |
| `note.status`           | note property 显式                     | 【P1 ✅】 |
| `note["Review Status"]` | 带空格/特殊字符属性名                  | 【P1 ✅】 |
| `file.name` 等          | file property（§4.2）                  | 【P1 ✅】 |
| `formula.name`          | 公式属性                               | 【P2a ✅】 |
| `this.*`                | 动态上下文（§7）                       | 【P3】 |

Unicode 属性名合法（`note["状态"]` / `状态`）。

### 4.2 file property 清单

`name` / `basename` / `path` / `folder` / `ext` / `size` / `ctime` / `mtime` / `properties` / `tags` / `links`（`backlinks` 官方后续版本新增，【P2 评估】）。

note property 来自 Markdown frontmatter；file property 对所有受支持文件有效（首期数据集只有 Markdown，见 §7）。P1 口径：`ctime`/`mtime` 输出 epoch 毫秒 number（无 Date runtime value）；`name` 带扩展名、`basename` 不带。P2a 起：ctime/mtime 在与日期混合的算术语境包装为 datetime（`wrapEpochForArith`）。

### 4.3 字面量与运算符

- literal：null、boolean、number、引号字符串、list。【P1 ✅】
- 一元：`!`；二元：`&& || == != < > <= >=`；括号；白名单函数/方法调用；只读属性/列表索引访问。【P1 ✅】
- 优先级（低 → 高）：`||` → `&&` → `== !=` → `< > <= >=` → `+ -` → `* /` → 一元 `!` / `-` → postfix 属性/索引/调用 → primary。【P1 ✅ + P2a ✅ 算术层】
- 算术（`+ - * /`、一元 `-`）与 duration 字面量（`<number><unit>`，单位 millisecond/second/minute/hour/day/week/month/year 含复数）。【P2a ✅】
- Link/File 构造字面量。【不做（P2a 评估：无真实需求；frontmatter wikilink 值 → Link 的机制见 §5.3）】
- regex literal。【P2 最后评估】

### 4.4 函数/方法白名单

方法按运行时类型分派；调用白名单外函数报 `base/unknown-function`（名字核对 【P0 ✅ 浅扫描】，receiver/arity 校验 【P1 ✅】）。名单单一真相源：`src/base/expressions.ts` 的 `BASE_FUNCTION_NAMES`（`src/base/functions.ts` 注册表模块加载即与该集合做一致性自检）。

| 类别   | 函数/方法                                                                           | 状态   |
| ------ | ----------------------------------------------------------------------------------- | ------ |
| global | `if`、`list`、`number`                                                              | 【P1 ✅】 |
| global | `max`、`min`（变长 number 参，不收单 list 参）                                       | 【2026-07-28 ✅】 |
| any    | `isTruthy`、`isType`、`toString`                                                    | 【P1 ✅】 |
| string | `contains`、`containsAll`、`containsAny`、`startsWith`、`endsWith`、`lower`、`trim` | 【P1 ✅】 |
| string | `replace`、`repeat`、`reverse`、`slice`、`split`、`title`、`isEmpty`                | 【2026-07-28 ✅】 |
| list   | `contains`、`containsAll`、`containsAny`、`isEmpty`                                 | 【P1 ✅】 |
| list   | `reverse`、`slice`                                                                  | 【2026-07-28 ✅】 |
| object | `isEmpty`、`keys`、`values`                                                         | 【P1 ✅】 |
| file   | `hasTag`、`inFolder`、`hasLink`、`hasProperty`                                      | 【P1 ✅】 |
| time   | `today`、`now`（clock 注入，测试必须注入固定 clock）                                | 【P2a ✅】 |
| list 高阶 | `filter`/`map`/`reduce`（隐式 `value`/`index`/`acc` 作用域，非 JS lambda）、`flat`/`sort`/`unique`/`join`、`mean` | 【P2b ✅】 |
| number | `round`（0..1 参，小数位缺省 0）                                                   | 【P2b ✅；2026-07-28 由 `any` 组迁入独立 `number` 分派组】 |
| number | `abs`、`ceil`、`floor`、`toFixed`（返 string）、`isEmpty`（恒 false）               | 【2026-07-28 ✅】 |
| 渲染   | `escapeHTML`（string）、`html`/`image`/`icon`（global）                             | 【2026-07-28 ✅ 白名单内显式拒绝：`base/unsupported-feature`「无头内核不渲染」，不再报 unknown-function】 |
| 杂项   | `random`、regex（`matches`）                                                        | 【`random` 与字节稳定冲突，待拍板；regex 见片 4 计划】 |

语义要点：`if()` lazy branch（只计算被选择分支）【P1 ✅ 暂定 lazy 实现，待 oracle 校正】；list 成员比较用 typed equality；`number()` 转换失败行为【P1 ✅ 冻结为行级类型错误】。

2026-07-28 覆盖率片一的自建口径（官方未定义，标注待 oracle）：`replace` 为**字面子串全局替换**（非 regex；替换文本内 `$&` 不展开；空子串报错）；`slice`（string/list）负索引与越界钳制沿用 JS 语义；`reverse`（string）按 code point 反转（不拆代理对，字素簇仍会拆）；`title` 为「按空白切词 + 词首大写 + 词余小写」；`repeat`/`replace`/`split` 的产物规模受 `maxCollectionItems` 约束（string 计字符数），`repeat` 在**分配之前**预检。

### 4.5 明确不支持（报诊断，不静默忽略）

任意标识符调用、成员动态调用、`constructor`/`prototype`/`__proto__` 访问、regex literal、`this`（无显式 context 时报 `base/dynamic-context-required`）。【P0 ✅ 浅扫描覆盖未知函数名；其余 P1 ✅ 文法/求值层拒绝；`formula.*` 自 P2a 起可求值】

## 5. 值与类型语义

### 5.1 类型来源优先级

1. `.obsidian/types.json` 已识别的显式类型（可选只读，缺失/非法回退并 warning，永不写回）；
2. 官方保留字段规则（`tags`/`aliases`/`cssclasses` 为 list，`tags` 具 tag 语义）；
3. YAML runtime type 与严格日期格式推断；
4. 其余字符串为 text。

显式类型与实际值冲突不强制转换，产 `base/property-type-mismatch`。【P2b ✅ types.json 可选只读（TYPE-001..003：显式优先 / 缺失回退 info / 非法 warning 不写回）；声明冲突 TYPE-004 暂定（行级 warning + 值按运行时类型参与），待 oracle。第 3 条严格日期推断已随 P2a 落地（`parseDateLike`：`YYYY-MM-DD` → date、`YYYY-MM-DDTHH:mm[:ss]` → datetime，非严格匹配保持字符串）】

### 5.2 missing 与 null

内部保留 MISSING sentinel，读取时不立刻塌成 null：`file.hasProperty(name)` 只看 key 是否存在；直接投影 missing 输出 null；equality/truthiness 精确合并规则【待 oracle：BASE-PROP-004 冻结】；诊断可区分 missing / explicit-null / type-mismatch。【P1 ✅ 机制（MISSING 不塌缩、hasProperty、投影 null、行级类型错误诊断）；truthiness/equality 合并为暂定口径，待 oracle 校正】

### 5.3 equality 与排序

同类型 primitive 按值比较；数字不与数字字符串隐式相等；列表按元素递归相等；object 只允许 `==/!=`；Link/File/Date equality【P2a ✅：Date/Duration 按 epoch/毫秒，Link 按 path+subpath 路径感知；date vs datetime 跨精度比较暂定统一 epoch，待 oracle BASE-TYPE-005；frontmatter wikilink 值 → Link 为暂定机制，待 oracle BASE-TYPE-006】；多键 sort 稳定执行、`file.path` 最终 tie-break；null/missing/error 排序位置【待 oracle：BASE-RESULT-002 冻结，不照搬 SQLite 默认；P1 暂定恒排最后（与方向无关）】。【P1 ✅（除 null 排序位置外）】

## 6. formulas

```yaml
formulas:
  age: (now() - file.ctime) / 1day
```

公式可引用 note/file 属性与其它公式；依赖图拓扑排序（Kahn，与 YAML 键序无关）、循环报 `base/formula-cycle`（含完整循环链）；图节点/深度上限（`maxFormulaNodes`/`maxFormulaDepth`，SEC-006）。引用以 `formula.name` 使用；公式运行时类型错误 → 行级 warning + cell null。【P2a ✅ 全部】

## 7. 数据集与动态上下文边界

- **数据集**：官方默认包含 vault 全部文件；x-basalt 首期只含 Markdown 笔记，查询恒附 `base/markdown-only-dataset` conformance warning，附件不作为行。【P1 ✅：BASE-DATA-001/002】all-files（附件行、附件 links/backlinks）【P3，先独立 indexer schema 决策，证明不改既有 DQL `.md` 数据集】。
- **`this`**：随 GUI 宿主变化（独立打开=Base 文件；嵌入 note/Canvas=嵌入者；sidebar=当前活动文件）。无头执行无「当前活动文件」：无显式 context 遇 `this` 报 `base/dynamic-context-required`；后续以显式 `contextFile` 参数实现可重复语义。【P3】
- **嵌入 `base` code block**：Markdown fenced block 形态【P3】，首期只支持独立 `.base` 文件。
- **`![[View.base#Name]]` embed**：view 名与显式宿主 context 解析【P3】。

## 8. 演进与版本政策

Bases 在 1.9 early access 期间多次破坏性变更（snake_case → camelCase、表达式改方法链、属性引用改 `note["…"]`、新增 `properties` 段），且 `.base` 无 schema version 字段。x-basalt 对策：

- 以「官方文档快照日期 + conformance id（`bases-markdown-2026-07`）」标版本；
- 未知函数/字段/顶层结构一律报诊断，不静默忽略、不静默迁移（旧 snake_case 函数报 `base/unknown-function`）；
- 测试保留历史破坏性语法作为明确拒绝用例；
- 函数表数据驱动：新增实现只扩表白名单与用例，不放宽任意调用。

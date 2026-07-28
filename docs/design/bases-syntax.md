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
timestamp: 2026-07-28T08:34:36Z
sha256: 865b04284e08622d41115a0afc421a257dd602b21da7388e5d4f26d0b8adcc15
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
| `summaries`  | map                     | 自定义汇总（`values` 隐式作用域） | 【P2b ✅ 执行】（SUM-002：当前剔除空值 + 按 limit 前全量；**官方两条都相反，已决定跟官方、实现待落**，见 [vs-official §5.4](bases-vs-official.md)） |
| 未知顶层 key | 任意                    | 向前兼容：warning + 原值保留，不影响已知字段 | 【P0 ✅】       |

诊断口径：`views` 缺失/空 → `base/view-required`；未知顶层 key → warning。

> 官方快照漂移记录（2026-07-27 观察，2026-07-28 部分采纳）：现网官方文档新增 `%` 取模、`date()`/`link()` 构造、duration 字符串后缀形态（`"1 day"` 与短单位 y/M/d/w/h/m/s）——均晚于本仓 2026-07-22 冻结快照。
> 采纳进度：**`date()`/`duration()`（片二）与 `link()`/`file()`（片三）已于 2026-07-28 采纳**；duration 字符串形态**只在 `duration()` 入参处生效**，表达式字面量仍只认 `1day` 单 token 形态（§4.3 不变）；**`%` 取模仍不采纳**（文法层继续拒绝）。
> 文法注记：`file` 是关键字 token（根引用 `file.name`），`file(...)` 的调用形态由 `rootRef` 的专门分支支持；`note(`/`formula(`/`this(` 同样进入该分支，但名字不在白名单 → `base/unknown-function`。

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
| `groupBy` | 【P2b ✅ 标量键】【2026-07-28 ✅ list/link 键，GROUP-002】`{ property, direction }`；**list 键扇出**（一行进入其每个元素的组，行内元素先去重、空 list 视同 MISSING 键），link 为标量键（路径感知相等，组序按归一 path）。扇出使「组内行数之和 ≥ rows.length」，顶层 rows 仍平铺一份且**恒为 `file.path` 稳定序**——官方顶层行序随分组键变动，本仓 2026-07-28 决定**不跟**（documented boundary，见 [vs-official §5.3](bases-vs-official.md)）。扇出本身仍是暂定口径 |
| `summaries` | 【P2b ✅】view 级 `<property-ref> → 15 内置汇总名/顶层自定义名`（未知名报 `base/unknown-function`）；【2026-07-28 ✅ SUM-002 收口】与 groupBy 同现时另产 `groups[].summaries`，**计算集 = 该组 limit 后的行**（顶层仍为 filter 后 limit 前全量） |

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
- 空数组：`and: []` → true、`or: []` → false、`not: []` → true。【✅ 2026-07-28 经 oracle ④ 冻结（官方 1.12.7 实测，稳定可重放）；此前的「P1 遇空数组直接报 `base/unsupported-feature` 拒绝」已撤销】
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
| `this.*`                | 显式动态上下文（§7）                   | 【2026-07-28 ✅ BASE-CTX-001】需显式 `contextFile`；不给则报 `base/dynamic-context-required` |

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
- regex literal（`/…/`）。【不做：正则以**字符串**入参走 `string.matches(pattern)`，见 §4.4；字面量形态会让文法层多一套转义规则，收益不抵成本】

### 4.4 函数/方法白名单

方法按运行时类型分派；调用白名单外函数报 `base/unknown-function`（名字核对 【P0 ✅ 浅扫描】，receiver/arity 校验 【P1 ✅】）。名单单一真相源：`src/base/expressions.ts` 的 `BASE_FUNCTION_NAMES`（`src/base/functions.ts` 注册表模块加载即与该集合做一致性自检）。

| 类别   | 函数/方法                                                                           | 状态   |
| ------ | ----------------------------------------------------------------------------------- | ------ |
| global | `if`、`list`、`number`                                                              | 【P1 ✅】 |
| global | `max`、`min`（变长 number 参，不收单 list 参）                                       | 【2026-07-28 ✅】 |
| any    | `isTruthy`、`isType`、`toString`                                                    | 【P1 ✅】 |
| string | `contains`、`containsAll`、`containsAny`、`startsWith`、`endsWith`、`lower`、`trim` | 【P1 ✅】 |
| string | `replace`、`repeat`、`reverse`、`slice`、`split`、`title`、`isEmpty`                | 【2026-07-28 ✅】 |
| string | `matches(pattern)`（正则，pattern 为字符串）                                        | 【2026-07-28 ✅ BASE-SEC-004】子串命中语义；ReDoS 三层防护（静态拒绝无界量词套无界量词/交替与反向引用 → 限长 pattern 200 / 被匹配串 10000 → 有界编译缓存）；非法或不安全一律行级 `base/invalid-regex`，**不静默降级为不匹配**（与 DQL 侧 `regexmatch` 有意不同） |
| list   | `contains`、`containsAll`、`containsAny`、`isEmpty`                                 | 【P1 ✅】 |
| list   | `reverse`、`slice`                                                                  | 【2026-07-28 ✅】 |
| object | `isEmpty`、`keys`、`values`                                                         | 【P1 ✅】 |
| file   | `hasTag`、`inFolder`、`hasLink`、`hasProperty`                                      | 【P1 ✅】 |
| time   | `today`、`now`（clock 注入，测试必须注入固定 clock）                                | 【P2a ✅】 |
| global | `date(v)`、`duration(v)` 构造                                                       | 【2026-07-28 ✅】`date`：严格 ISO 字符串（与 frontmatter 推断同一函数）/ date 幂等 / number 按 epoch 毫秒（自建扩展）。`duration`：`"1day"`/`"1 day"`/`"2 hours"` 长单位（大小写不敏感、允许复数）与官方短单位 `y M w d h m s`（**大小写敏感**：`M`=月、`m`=分）/ duration 幂等 / number 按毫秒（与输出形状互逆） |
| date   | `format(fmt)`、`time()`、`relative()`、`isEmpty()`                                  | 【2026-07-28 ✅ 新增 `date` 分派组】 |
| global | `file(path)`、`link(target, display?)` 构造                                          | 【2026-07-28 ✅】`file`：**在当前查询行集内**三级解析（精确 path → pathKey → bare basename），解析不到 → MISSING。`link`：纯值构造，**不解析行集**，悬空链接合法 |
| link   | `asFile()`                                                                          | 【2026-07-28 ✅ 新增 `link` 分派组】悬空 → MISSING |
| file   | `asLink(display?)`、`linksTo(x)`                                                     | 【2026-07-28 ✅】`linksTo` 收 string/link/file：前两者走与 `hasLink` 同一文本匹配，**file 入参走解析**（比解析后的 path，故 bare `[[A]]` 也算命中） |
| list 高阶 | `filter`/`map`/`reduce`（隐式 `value`/`index`/`acc` 作用域，非 JS lambda）、`flat`/`sort`/`unique`/`join`、`mean` | 【P2b ✅】 |
| number | `round`（0..1 参，小数位缺省 0）                                                   | 【P2b ✅；2026-07-28 由 `any` 组迁入独立 `number` 分派组】 |
| number | `abs`、`ceil`、`floor`、`toFixed`（返 string）、`isEmpty`（恒 false）               | 【2026-07-28 ✅】 |
| 渲染   | `escapeHTML`（string）、`html`/`image`/`icon`（global）                             | 【2026-07-28 ✅ 白名单内显式拒绝：`base/unsupported-feature`「无头内核不渲染」，不再报 unknown-function】 |
| 杂项   | `random`                                                                            | 【2026-07-28 ❌ 白名单内显式拒绝：`base/unsupported-feature`「与字节稳定保证冲突」。用户拍板不注入种子、不放弃字节稳定——「同一输入必得同一输出」是本引擎核心契约】 |


语义要点：`if()` lazy branch（只计算被选择分支）【P1 ✅ 暂定 lazy 实现，待 oracle 校正】；list 成员比较用 typed equality；`number()` 转换失败行为【P1 ✅ 冻结为行级类型错误】。

片二 date 组的自建口径（暂定，待 oracle）：`format` 只做**与语言无关的数字 token**（`YYYY YY MM M DD D HH H mm m ss s`，全部按 UTC），分词按**同字符最长游程**（moment 真实语法，`MMMM` 是独立 token 而非 `MM`×2），本地化 token（`MMMM`/`dddd`/`A`/`Z`）与未实现 token 一律报错、不静默给一种语言，字面文本用 `[方括号]` 转义；`time()` 返回**当日 UTC 零点起的 duration**（可比较可算术，要字符串用 `format("HH:mm")`），date 精度恒为 0；`relative()` 用**固定英文**固定阶梯（`3 days ago` / `in 2 hours` / `just now`，month=30day、year=365day 与值域约定同源），时间源恒为注入 clock——官方该函数输出随界面语言变，本就不是稳定 schema，不复刻。

2026-07-28 覆盖率片一的自建口径（官方未定义，标注待 oracle）：`replace` 为**字面子串全局替换**（非 regex；替换文本内 `$&` 不展开；空子串报错）；`slice`（string/list）负索引与越界钳制沿用 JS 语义；`reverse`（string）按 code point 反转（不拆代理对，字素簇仍会拆）；`title` 为「按空白切词 + 词首大写 + 词余小写」；`repeat`/`replace`/`split` 的产物规模受 `maxCollectionItems` 约束（string 计字符数），`repeat` 在**分配之前**预检。

### 4.5 明确不支持（报诊断，不静默忽略）

任意标识符调用、成员动态调用、`constructor`/`prototype`/`__proto__` 访问、regex literal、`this`（**无显式 `contextFile` 时**报 `base/dynamic-context-required`）、Markdown 内嵌 ` ```base ` 代码块与 `![[View.base#Name]]` embed（入口形态检查处报 `base/unsupported-feature`，消息含替代写法）。【P0 ✅ 浅扫描覆盖未知函数名；其余 P1 ✅ 文法/求值层拒绝；`formula.*` 自 P2a 起可求值】

## 5. 值与类型语义

### 5.1 类型来源优先级

1. `.obsidian/types.json` 已识别的显式类型（可选只读，缺失/非法回退并 warning，永不写回）；
2. 官方保留字段规则（`tags`/`aliases`/`cssclasses` 为 list，`tags` 具 tag 语义）；
3. YAML runtime type 与严格日期格式推断；
4. 其余字符串为 text。

显式类型与实际值冲突不强制转换，产 `base/property-type-mismatch`。【P2b ✅ types.json 可选只读（TYPE-001..003：显式优先 / 缺失回退 info / 非法 warning 不写回）；声明冲突 TYPE-004 暂定（行级 warning + 值按运行时类型参与），待 oracle。第 3 条严格日期推断已随 P2a 落地（`parseDateLike`：`YYYY-MM-DD` → date、`YYYY-MM-DDTHH:mm[:ss]` → datetime，非严格匹配保持字符串）】

### 5.2 missing 与 null

内部保留 MISSING sentinel，读取时不立刻塌成 null：`file.hasProperty(name)` 只看 key 是否存在；直接投影 missing 输出 null；equality/truthiness 精确合并规则【✅ 2026-07-28 经 oracle BASE-PROP-004 冻结：truthiness 六形态全假（原口径一致）；**equality 上 MISSING 与 null 合并**（`missing == null` 为真，原口径相反，已按官方校正）；`isType("null")` 有意不跟随合并】；诊断可区分 missing / explicit-null / type-mismatch。【P1 ✅ 机制（MISSING 不塌缩、hasProperty、投影 null、行级类型错误诊断）】

### 5.3 equality 与排序

同类型 primitive 按值比较；数字不与数字字符串隐式相等；列表按元素递归相等；object 只允许 `==/!=`；Link/File/Date equality【P2a ✅：Date/Duration 按 epoch/毫秒，Link 按 path+subpath 路径感知；date vs datetime 跨精度比较暂定统一 epoch，待 oracle BASE-TYPE-005；frontmatter wikilink 值 → Link 为暂定机制，待 oracle BASE-TYPE-006】；多键 sort 稳定执行、`file.path` 最终 tie-break；null/missing/error 排序位置【✅ 2026-07-28 经官方 oracle BASE-RESULT-002 冻结：**恒排最后，与方向无关**（不照搬 SQLite 默认）；同日修掉 DESC 下空值排最前的实现漂移】。【P1 ✅】

## 6. formulas

```yaml
formulas:
  age: (now() - file.ctime) / 1day
```

公式可引用 note/file 属性与其它公式；依赖图拓扑排序（Kahn，与 YAML 键序无关）、循环报 `base/formula-cycle`（含完整循环链）；图节点/深度上限（`maxFormulaNodes`/`maxFormulaDepth`，SEC-006）。引用以 `formula.name` 使用；公式运行时类型错误 → 行级 warning + cell null。【P2a ✅ 全部】

## 7. 数据集与动态上下文边界

- **数据集**：官方默认包含 vault 全部文件；x-basalt 首期只含 Markdown 笔记，查询恒附 `base/markdown-only-dataset` conformance warning，附件不作为行。【P1 ✅：BASE-DATA-001/002】all-files（附件行、附件 links/backlinks）【P3，先独立 indexer schema 决策，证明不改既有 DQL `.md` 数据集】。
- **`this`**：官方随 GUI 宿主变化（独立打开=Base 文件；嵌入 note/Canvas=嵌入者；sidebar=当前活动文件）——那种隐式环境状态不可重复、不可测，x-basalt **不做**（BASE-CTX-004 ❌）。取而代之：**显式 `contextFile` 参数**（CLI `--context-file`），在当前查询行集内解析（口径同 `file(path)`：完整路径 / 去扩展名忽略大小写 / bare basename）；`this.file.*` 取上下文行 file 字段、`this.<属性>` 取其 note 属性、裸 `this` 为其 note 对象；公式体内同样可用，自定义汇总的 `values` 作用域仍拒绝（禁访问行外状态）。给了却解析不到 → `base/dynamic-context-required`（error）+ 空结果，不静默当没给。【2026-07-28 ✅ BASE-CTX-001】
- **嵌入 `base` code block**（BASE-CTX-002）与 **`![[View.base#Name]]` embed**（BASE-CTX-003）：【2026-07-28 ❌ 不做】两者本质是「在 Obsidian 界面里渲染」的形态，无头执行拿不到宿主上下文、产物无消费方（用户拍板）。但**不静默**：入口形态检查（读文件之前，按路径形态判定）报 `base/unsupported-feature`，消息说清不做的理由与替代写法（`#锚点` → 改用 `--view`；非 `.base` 扩展名 → 把查询定义单独存成 `.base`）。

## 8. 演进与版本政策

Bases 在 1.9 early access 期间多次破坏性变更（snake_case → camelCase、表达式改方法链、属性引用改 `note["…"]`、新增 `properties` 段），且 `.base` 无 schema version 字段。x-basalt 对策：

- 以「官方文档快照日期 + conformance id（`bases-markdown-2026-07`）」标版本；
- 未知函数/字段/顶层结构一律报诊断，不静默忽略、不静默迁移（旧 snake_case 函数报 `base/unknown-function`）；
- 测试保留历史破坏性语法作为明确拒绝用例；
- 函数表数据驱动：新增实现只扩表白名单与用例，不放宽任意调用。

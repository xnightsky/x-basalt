---
type: testing
title: Bases P1 争议语义官方 oracle 操作手册
description: Bases 争议语义官方 oracle：2026-07-28 已执行完毕（Obsidian 1.12.7，26 view 全部两次一致）。含取证路径（官方 CLI eval 读 Bases 内部对象，base:query 命令吐不出结果）、三个会静默产出错误数据的坑、①..⑨ 官方结论与 19 一致/7 分歧的对照、以及尚未动手的校正待办
tags:
  - testing
  - bases
  - oracle
  - conformance
timestamp: 2026-08-03T00:48:56Z
sha256: a4b61f2c4d779e97268a4886774f7b588519f5018c2eb69afa9c7d13bfd8baa9
---
# Bases P1 争议语义官方 oracle 操作手册（runbook）

> 2026-07-27 起草 · 2026-07-28 执行完毕 · 协议真相源：[`2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md) §8（本手册是其逐步具体化，不替代协议）。
> 用途：把「暂定口径」跑一遍官方 oracle，校正 x-basalt 语义与锁定测试。
> **执行方式：脚本化**（Obsidian 官方 CLI 的 `eval` 入口，见 §0.2）。26 个 view 的遍历全自动，唯一人工是首次打开一次 fixture vault。
>
> 关于 `AGENTS.md`「严禁引入 Electron / Puppeteer / Playwright 等 GUI 自动化工具」：那条约束的对象是**产品依赖**——x-basalt 本身仍是零 GUI 依赖的纯 Node CLI，取证用的是 Obsidian 官方 CLI 且不进产品依赖树。本手册初版写的「项目硬约束禁 GUI 自动化，只能人工串行」把约束对象搞错了，是 §0.1 那次误判的一部分。

## 0. 状态：✅ 已执行（2026-07-28，Obsidian 1.12.7；2026-08-02/03 第二轮，Obsidian 1.13.4）

**首轮 26 个 view 两次一致；第二轮 38 + 49 view 两次一致（无 `implementation-defined`）。
首轮结论见 §4，round-2 判定见 §4.11，分歧清单见 §4.0。**

### 0.1 推翻了什么（原暂缓决策的三条依据，两条不成立）

本手册 2026-07-28 上午曾判定「⏸ 暂缓执行」，理由是官方无取证路径、只能人工串行点 GUI。当天下午实测推翻了它：

| 原依据 | 复核结果 |
| --- | --- |
| ① 官方文档只覆盖八类争议中的一类 | **仍然成立**——但它只说明「不能靠读文档定论」，不说明「不能取证」。 |
| ② 官方 API 只暴露渲染与算好的结果，求值引擎不对外，绕不开 GUI | **恰恰是充分条件**。oracle 要的从来就是「同一个 `.base`，官方算出什么行」，不需要求值引擎内部。「已算好的结果」正是答案本身。 |
| ③ Bases 仍在快速演进，此刻冻结易被作废 | **被消解**。取证既然是脚本，每次 Obsidian 升级后重跑即可，从「一次性人工冻结」变成「可回归的对照」。 |

准确的表述是：**绕不开 Obsidian App 进程（不是无头），但绕得开人。** 原判断把「需要 App」误推成了「需要人逐个点」，成本估计因此差了一个数量级——26 个 view 从「攒一次人工」变成一条命令几分钟。

### 0.2 取证路径

官方 CLI（1.12+，设置里开「命令行界面」）的 `eval` 可在运行中的 App 里执行任意 JS：

```
app.workspace.activeLeaf.view.controller
  ├── getQueryViewNames()          列出该 .base 的全部 view
  ├── selectView("<view名>")        切 view
  ├── .view.rows[].entry.file.path  该 view filter+sort+limit 之后的最终行集
  ├── .view.groups                  groupBy 分桶
  ├── .view.footerSummary.cells     汇总行（renderedValue / entries）
  └── .errors                       求值错误
```

**官方 CLI 有 `base:query file= view= format=json` 命令，但它吐不出结果**——用无 filter 的基线 view 验证过，返回空、退出码 0。所以走 `eval` 读内部对象，不走它。

取证时的三个坑（都会静默产出错误数据，不会报错）：

1. **`selectView` 后不能立刻读。** `viewName` 立刻变成新值，但 `view.rows` 要等异步重算——只等名字会读到**上一个 view 的行集**，整份结果错位一格（`empty-and`/`empty-or`/`empty-not` 三连最明显：错位版给出 12/12/0，正确值是 12/0/12）。判据要用「rows 连续两轮不变」。
2. **「连跑两次」不能直接调两次。** 已停在该 view 上时 `selectView` 是空操作，第二次会立刻命中缓存返回，两次必然相同——稳定性检查形同虚设。要绕到另一个 view 再切回，强制重算。
3. **汇总是懒计算的。** `renderedPlaceholder === true` 时读到的 `null` 不是结果，要等它算完。

### 0.3 重跑条件

Obsidian 升级后重跑（本手册结论绑定 1.12.7 + §2 的 fixture 指纹）。dogfood 出现由某条口径导致的错误结果时，可只针对该条定点重跑。

## 1. 语义清单与官方结论（①..⑨ 已冻结，2026-07-28）

> 「x-basalt 口径」列记的是**跑 oracle 之前**的暂定口径，保留原文以便看清偏差在哪；
> 「官方」列是本轮实测结论，详细数据见 §4。

| # | 争议语义 | 场景编号 | x-basalt 暂定口径（跑前） | 官方（1.12.7 实测） | 判定 |
| --- | --- | --- | --- | --- | --- |
| ① | missing/null/空串/0/false/空列表 truthiness 与 == 合并 | BASE-PROP-004 | falsy = MISSING/null/false/0/""/空列表；`missing == null` 为 false | truthiness **同**；但 `missing == null` 为 **true**（MISSING 与 null 合并） | truthiness ✅ 可转正 / equality ✅ 2026-07-28 已跟官方校正 |
| ② | 多键 sort 的 null/missing 位置 | BASE-RESULT-002 | null/missing 恒排最后（与方向无关） | 恒排最后，**与方向无关** | ✅ 已校正（2026-07-28）：口径本与官方一致，是**实现没做到**（DESC 时排最前），当 bug 修 |
| ③ | `if()` lazy branch | 设计 §9 | lazy：只计算被选择分支 | lazy | ✅ |
| ④ | 空 filter 数组 and/or/not | 设计 §6 | P1 拒绝（`base/unsupported-feature`） | `and:[]`=真 / `or:[]`=假 / `not:[]`=真，稳定可重放 | ✅ 2026-07-28 已跟官方校正 |
| ⑤ | date vs datetime 跨精度比较 | BASE-TYPE-005 | 统一按 UTC epoch 比较（P2a 落地） | 行集一致 | ✅ |
| ⑥ | frontmatter wikilink → Link 值与相等 | BASE-TYPE-006 | `[[t]]`/`[[t\|d]]`/`[[t#sub]]` → Link value，按 path+subpath 相等（P2a 落地） | 行集一致 | ✅ |
| ⑦ | list/tag 分组键一行多组 | BASE-GROUP-002 | **扇出**：一行进入其每个元素的组；行内元素先去重、空 list 视同 MISSING 键 | 顶层 rows 12 行（无重复计入），但**顺序随分组键变动** | ❌ 顶层顺序分歧 → **决定不跟**（boundary） |
| ⑧ | 自定义 summary 的 `values` 边界（空值剔除 / limit 前后） | BASE-SUM-002 | 暂定剔除 null/missing、按 limit 前全量（P2b 落地） | **含** null/missing（计入分母）、按 **limit 后** | ❌ 两维度都相反 → **决定跟官方**；(b) ✅ 2026-07-29 已落，(a) 待前置取证 |
| ⑨ | 字符串→日期推断是否作用于 `+`（拼接语境） | 语法 §5.1 / 设计 §8.3 | 推断对全部非短路二元运算生效，故 `due + " 备注"` 报行级类型错误而非拼接 | **`+` 根本不做字符串拼接**，string+string 也得空 | ❌ 原命题不成立 → **决定不跟**（保留超集 + boundary） |
| ㉗ | **默认数据集**（本轮新发现，原不在清单） | BASE-DATA-001/002 | 默认 md-only，`.base` 不为行 | `.base` 文件**自身也是行** | ❌ → **决定不改默认值**（boundary + 文档） |

### 1.1 2026-07-28 函数覆盖率批次新增的暂定口径（⑩ 起）

> 逐条实现细节见[实现状态追踪 §6](bases-status.md) 各片明细。
> **fixture ✅ 2026-07-29 已补齐**（§1.3），下表的 `fixture view` 列即取证入口。

| # | 暂定口径 | 出处 | fixture view |
| --- | --- | --- | --- |
| ⑩ | `string.title()` = 按空白切词 + 词首大写 + 词余小写 | 片一 | `types::str-list-methods` |
| ⑪ | `slice(start, end?)`（string/list）负索引与越界钳制沿用 JS 语义 | 片一 | `types::str-list-methods` |
| ⑫ | `replace(a, b)` 为**字面子串全局替换**（非 regex，`$&` 不展开，空串报错） | 片一 | `types::str-list-methods` |
| ⑬ | `reverse()`（string）按 code point 反转（字素簇仍会拆） | 片一 | `types::str-list-methods` |
| ⑭ | `number.isEmpty()` / `date.isEmpty()` 恒 false | 片一/片二 | `types::is-empty-nonstring` |
| ⑮ | `date.time()` 返回**当日 UTC 零点起的 duration**（而非 `"HH:mm"` 字符串） | 片二 | `types::date-methods` |
| ⑯ | `date.format()` 只做数字 token，本地化 token 报错；同字符游程分词 | 片二 | `types::date-methods` + `date-format-localized`（隔离） |
| ⑰ | `date.relative()` 固定英文 + 固定阶梯（month=30d / year=365d） | 片二 | `types::date-methods` |
| ⑱ | `date(number)` 按 epoch 毫秒、`duration(number)` 按毫秒（自建扩展） | 片二 | `types::ext-constructors`（隔离） |
| ⑲ | `file(path)` 只在**当前查询行集**内解析；同键多文件取 path 升序第一个 | 片三 | `types::file-fn-resolve` |
| ⑳ | `linksTo(file 值)` 走解析、`linksTo(string/link)` 走文本匹配 | 片三 | `types::file-fn-resolve` |
| ㉑ | `matches` 的 ReDoS 静态判据（哪些正则被拒）与「非法即报诊断」 | 片四 | ❌ **不可取证**（见 §1.3） |
| ㉒ | 组级汇总 `groups[].summaries` 计算集 = 该组 **limit 后**的行 | 片五 | `group-summary::group-limit-summary` |
| ㉓ | 分组键组序：可比标量 < link < null/MISSING | 片五 | `group-summary::group-desc-nullpos` |

### 1.2 2026-07-28 调研补登记：此前漏登的暂定口径（㉔ 起）

> 这三条在源码注释里已自认「官方未明示/官方未定义」，但**从未进入本手册的观察清单**——即本手册 §1 此前并非争议全集。
> fixture ✅ 2026-07-29 已补齐（§1.3）。

| # | 暂定口径 | 落点 | fixture view |
| --- | --- | --- | --- |
| ㉔ | `Median` 汇总：偶数个样本取中间两值的**均值**（而非取下中位） | `src/base/summaries.ts:118` | `group-summary::agg-median-even` |
| ㉕ | `Stddev` 汇总：取**总体**标准差（÷n），非样本标准差（÷(n−1)） | `src/base/summaries.ts:128` | `group-summary::agg-stddev` |
| ㉖ | Duration 的 `month` = 30 day、`year` = 365 day 固定换算，作用于**全部 duration 算术**（非仅 `date.relative()`）——⑰ 只登记了 `relative()` 的阶梯，登记面窄于实际影响面 | `src/base/values.ts:144` | `types::duration-units` |

### 1.3 fixture 补齐（2026-07-29）

原缺口是「⑩..㉖ 共 17 条无 view」。现已补 **12 个 view**覆盖其中 16 条，全部在 x-basalt 侧跑通、有确定读数、无 error 级诊断。

**为什么 17 条只用了 12 个 view**：这批的判据**全在投影列的值里**，不在行集里，而取证脚本已经在采 `cells`（2026-07-28 为定论 ③⑧⑨ 加的）。所以一个 view 挂一批常量表达式列，一次渲染就读回多条口径的答案——不必一条一个 view。

**三条硬约束**（违反任何一条都会让既有 26 条观察记录作废或读数失真）：

1. **只往已有 `.base` 加 view，绝不新建 `.base` 文件。** 官方默认数据集把 `.base` 自身也算作行，每多一个文件所有无 filter view 的行数就 +1。
2. **同理不新增 `.md`。** 口径⑲⑳ 需要一篇有正文出链的笔记，解法是往**已有的** `CaseE.md` 正文里加一行 `[[CaseB]]`——改内容不改文件数，既有行集不动。（`fixtureHashes` 会变，那是有意的：提醒重跑时 fixture 已不是上次那份。）
3. **filter 用 `file.path` 不用 `file.name`。** 官方渲染 `file.name` 不带扩展名、x-basalt 带（§4 注），拿它做 filter 会两边行集不同。

**隔离原则**：已知会报错或可能是本仓自建扩展的表达式**单独占一个 view**——官方遇到不认识的函数可能整个 view 求值失败，混在一起会把同伴的读数一起废掉。据此隔离了三个：`mean-mixed-list`（⑧(a) 前置，最不能被连坐）、`date-format-localized`（⑯ 本地化 token，本仓已知报错）、`ext-constructors`（⑱ 自建扩展，官方很可能没有）。x-basalt 侧实测是列级隔离（同 view 一列报错不影响其他列），官方是否如此未知，故按最坏情况处理。

**㉑ 判定为不可取证**：`matches` 的 ReDoS 静态判据是**本仓自己的安全策略**（三层防护，拒绝哪些正则由本仓定），官方没有对应语义可观察。它的终局直接是 documented boundary，不需要 view。

**补 view 时顺带确认的一处本仓不一致**（㉓ 的漏登维度）：`group-desc-nullpos` 实测组序为 `null[4] → 2 → 1`，**空值组排最前**。即顶层 sort 的空值恒排最后（② 已校正冻结），而 `groupBy.direction: DESC` 仍把整个次序取反、连空值组一起翻。官方若两个方向都把空值组排最后 → 与 ② 同源按 bug 修；若也取反 → 维持现状 + 落文档。

**fixture 缺口现状：⑩..㉖ 中 16 条已有 view，㉑ 判定不可取证。** view 总数 26 → 38，下次取证会连既有 26 条一起重跑（免费回归）。

## 2. 前置

1. Obsidian ≥ 1.12，设置 → 通用里打开「命令行界面」（`%APPDATA%\obsidian\obsidian.json` 里可见 `"cli": true`）。
2. 把 `tests/fixtures/bases/oracle/` **整个目录复制为独立 vault**——不能直接开主仓 fixture：Obsidian 会在 vault 根建 `.obsidian/`，那会污染仓库。
3. vault 里**只能有 fixture 的文件**。官方默认数据集连 `.base` 自身都算行，多一个残留的试验文件就多一行，结论不可复现。
4. 记录版本与 fixture 指纹随观察记录留档：
   - `git hash-object tests/fixtures/bases/oracle/views/*.base tests/fixtures/bases/oracle/notes/*.md`
5. 用 Obsidian 打开该 vault（这一步是人工的，见 §3）。

## 3. 执行（可脚本化，不必人工逐个点）

**26 个 view 的遍历是全自动的**：按 §0.2 的路径 `getQueryViewNames()` → `selectView()` → 读 `view.rows` / `view.groups` / `view.footerSummary`，逐 view 走一遍即可。

要求两条（沿用协议 §8 第 7 条）：

1. 每个 view **连跑两次**，结果不一致即标 `implementation-defined`，不得靠单次观察冻结强结论。**注意 §0.2 的坑 2**——直接调两次会命中缓存，必须绕到另一个 view 再切回强制重算，否则这道检查形同虚设。
2. 读取前确认已收敛（§0.2 坑 1、坑 3），否则会读到上一个 view 的行集或未算完的汇总。

唯一的人工是**首次打开 vault**：用 URI 自动切库在 Windows 上实测不稳（`obsidian://new?path=` 只注册不切窗口，`cmd /c start` 发的 URI 会变形成 "Vault not found" 弹窗），把这一环换成一次点击反而让整体可重跑。

view 清单（26 个）：truthiness.base × 8（truthy-missing / truthy-explicit-null / truthy-empty-string / truthy-zero / truthy-false / truthy-empty-list / eq-missing-null / eq-explicit-null-null）、sort-null.base × 2（sort-asc / sort-desc）、if-lazy.base × 2（if-lazy / if-lazy-false-branch）、empty-filter.base × 3（empty-and / empty-or / empty-not）、types.base × 7（date-eq-literal / date-lt-datetime / datetime-lt-date / link-eq-wikilink / link-projection，P2a 新增；concat-plain-string / concat-date-string，2026-07-27 review 新增；样本 CaseE）、group-summary.base × 4（group-by-tags / group-by-list-prop / summary-custom / summary-custom-limited，P2b 新增，样本 CaseF 与 CaseB/C）。

## 4. 观察记录（2026-07-28 · Obsidian 1.12.7 · 26 view 全部两次一致）

> 对照口径：x-basalt 侧固定用 `--conformance bases-all-files-2026-07`。
> 原因见 §4.0 的 ㉗ —— 官方默认数据集把 `.base` 文件**自身**也算作行，默认 md-only 无法对齐。
> 下表「官方命中」里的 `*.base` 指的就是这 6 个 fixture 自身。

### 4.0 分歧总表（19 一致 / 7 分歧）

> 「x-basalt」列是**取证当时（校正前）的实现行为**，作为观察记录不改写；
> 逐条的校正结果看「判定」列与 §5。

| # | 语义 | 官方 | x-basalt（校正前） | 判定 |
| --- | --- | --- | --- | --- |
| ① truthy | 六形态 truthiness | 全 falsy | 全 falsy | ✅ **一致，可转正** |
| ① eq | `X == null` 与 MISSING | **MISSING 与 null 合并**，命中全部行 | 区分二者 | ✅ 2026-07-28 已校正（跟官方） |
| ② | null/missing 排序位 | ASC/DESC **都排最后** | ASC 最后、**DESC 最前** | ✅ 2026-07-28 已校正（原 ❌ DESC 分歧） |
| ③ | `if()` 惰性 | lazy（未选分支不求值） | lazy | ✅ 一致 |
| ④ | 空 filter 数组 | `and:[]`=真 / `or:[]`=假 / `not:[]`=真 | 三个都报 `unsupported-feature` | ✅ 2026-07-28 已校正（跟官方） |
| ⑤ | date/datetime 跨精度比较 | 见 §4.5 | 同 | ✅ 一致 |
| ⑥ | wikilink → Link | 见 §4.5 | 同 | ✅ 一致 |
| ⑦ | list 分组键扇出 | 顶层 rows 顺序随分组键变动 | 保持 `file.path` 序 | ❌ 分歧 · **决定不跟**（2026-07-28，boundary） |
| ⑧ | summary `values` 边界 | **含 null/missing**（计入分母）、按 **limit 后** | (a) 剔除 null/missing；(b) ✅ 已改为 limit 后 | ❌ 两维度都分歧 · **决定跟官方**（2026-07-28）；**(b) ✅ 2026-07-29 落地**，(a) 待前置取证 |
| ⑨ | `+` 的拼接语境 | **`+` 根本不做字符串拼接**，string+string 也得空 | string+string 正常拼接 | ❌ 分歧 · **决定不跟**（2026-07-28，保留超集 + boundary） |
| ㉗ | **默认数据集**（原 26 条外，本轮新发现） | `.base` 文件**自身也是行** | 默认 md-only 排除 | ❌ 分歧 · **决定不改默认值**（2026-07-28，boundary + 文档） |

### 4.1 ① truthiness / equality（CaseA 六形态显式值；CaseB/C 缺这些属性；CaseD 全缺）

| view | 官方命中 | x-basalt | 结论 |
| --- | --- | --- | --- |
| truthy-missing | 0 行 | 0 行 | MISSING → falsy ✅ |
| truthy-explicit-null | 0 行 | 0 行 | null → falsy ✅ |
| truthy-empty-string | 0 行 | 0 行 | `""` → falsy ✅ |
| truthy-zero | 0 行 | 0 行 | `0` → falsy ✅ |
| truthy-false | 0 行 | 0 行 | `false` → falsy ✅ |
| truthy-empty-list | 0 行 | 0 行 | `[]` → falsy ✅ |
| eq-missing-null | **全部 12 行** | 0 行 | ❌ 官方 `missing == null` 为 **true** |
| eq-explicit-null-null | **全部 12 行** | 1 行（仅 CaseA） | ❌ 官方对**没有该属性**的行也判 true |

**结论**：truthiness 六形态与 x-basalt 完全一致，暂定口径可转正。但 equality 相反——官方把 MISSING 与 null **合并**，`X == null` 对缺失属性同样成立；x-basalt 区分二者（§1 记的「`missing == null` 为 false」确是当前实现，与官方不符）。

> **✅ 2026-07-28 已跟官方校正**。合并落在 `typedEqual`（值域唯一的相等语义），故分组分桶、
> `unique()`、`contains()`、Unique 汇总一并生效——这层外推是本仓的决定而非官方读数，理由与代价
> 写在 [`bases-vs-official.md` §5.1](bases-vs-official.md)。`isType("null")` 有意不跟随
> （官方没覆盖 isType，不外推）；区分 missing 与 null 的能力仍在 `file.hasProperty()`。
> 回归用例：`tests/base-evaluator.test.ts`（运算符层）+ `tests/base-engine.test.ts`
> （`props.base` 的 `eq-null` / `ne-null`，锁行集互补），均标注 oracle ①。

### 4.2 ② null 排序位置（CaseA=null、CaseB=1、CaseC=2、CaseD 缺失）

| view | 官方行序 | x-basalt 行序 |
| --- | --- | --- |
| sort-asc | B(1) · C(2) · A(null) · D · E · F · 6×base | 同 ✅ |
| sort-desc | **C(2) · B(1) · A(null)** · D · E · F · 6×base | **A(null) · D · E · F · 6×base · C(2) · B(1)** ❌ |

**结论**：官方 null/missing **恒排最后，与方向无关**——这正是 §1 登记的 x-basalt 口径，但**实现没做到**：DESC 时 x-basalt 把 null/missing 排到了最前。属实现与自身登记口径的漂移，且官方站在登记口径那边。

> **✅ 2026-07-28 已校正**（当 bug 修，非「跟不跟官方」的选择题）。根因：engine 用 `-sortKeyCompare(a,b)`
> 实现 DESC，空值组的 rank 差被一起翻转。现由 `sortKeyCompareDirected(a, b, direction)` 施加方向——
> 任一侧落在空值/不可比较组时直接给「空值在后」的定序，方向只作用于两侧都可比的情形。
> 回归用例：`tests/base-engine.test.ts`（`sort.base` 的 `null-last-asc` / `null-last-desc` 两 view）
> 与 `tests/base-values-date.test.ts`（纯函数层），均标注 oracle ②。

### 4.3 ③ if() lazy

| view | 官方 | x-basalt | 结论 |
| --- | --- | --- | --- |
| if-lazy（`if(true,"ok",1 < "x") == "ok"`） | 12 行，errors 空 | 12 行 | lazy ✅ |
| if-lazy-false-branch（`if(false,1 < "x","fallback") == "fallback"`） | 12 行，errors 空 | 12 行 | lazy ✅ |

**结论**：未选分支的确定性类型错误（`1 < "x"`）既没污染结果也没产生诊断 → **官方 lazy，与 x-basalt 一致**。

### 4.4 ④ 空 filter 数组

| view | 官方 | x-basalt | 结论 |
| --- | --- | --- | --- |
| empty-and | **12 行（全部）** | 0 行 + `base/unsupported-feature` | ❌ 官方 `and: []` 恒 true |
| empty-or | **0 行** | 0 行 + `base/unsupported-feature` | ⚠️ **巧合相同**：官方是恒 false，x-basalt 是报错返回空，成因不同 |
| empty-not | **12 行（全部）** | 0 行 + `base/unsupported-feature` | ❌ 官方 `not: []` 恒 true |

**结论**：官方按空集的布尔代数默认值处理（`and:[]`=真、`or:[]`=假、`not:[]`=真），全部稳定可重放，**没有 implementation-defined 的余地**。x-basalt 的「P1 拒绝」不成立。

> **✅ 2026-07-28 已跟官方校正**。「P1 拒绝」本就不是语义主张、而是「没有裁判先不猜」的占位，
> 裁判到位即撤。改动只是删掉 `planner.ts` 里那段拒绝——求值侧 `evalFilter` 的 `every`/`some`
> 天然就是这三个默认值，一行没改。回归用例：`tests/base-engine.test.ts`（`empty-filter.base`
> 三个 view），额外断言「无 error 诊断」——因为 `empty-or` 校正前后都是 0 行，**行数相同但成因不同**
> （旧：拒绝返回空；新：恒假），只比行数会漏判。

### 4.5 ⑤⑥ date/datetime 比较与 wikilink → Link（样本 CaseE）

| view | 官方 | x-basalt | 结论 |
| --- | --- | --- | --- |
| date-eq-literal | 1 行（CaseE） | 同 | ✅ |
| date-lt-datetime | 0 行 | 同 | ✅ |
| datetime-lt-date | 1 行（CaseE） | 同 | ✅ |
| link-eq-wikilink | 1 行（CaseE） | 同 | ✅ |
| link-projection | 12 行 | 同 | ✅ |

**结论**：行集完全一致，⑤⑥ 暂定口径可转正（⑥ 本就与官方文档相符）。

### 4.6 ⑦ list 分组键扇出（CaseF：tags=[project,area]、scores=[1,2,3]）

| view | 官方顶层 rows 顺序 | x-basalt |
| --- | --- | --- |
| group-by-tags | A·B·C·D·E·6×base·**F（最后）** | A·B·C·D·E·**F**·6×base（`file.path` 序） |
| group-by-list-prop | **F（最前）**·A·B·C·D·E·6×base | 同上（`file.path` 序） |

**结论**：两边都是 12 行（没有因扇出而重复计入顶层），但**官方顶层 rows 的顺序受分组键影响**，x-basalt 保持 `file.path` 稳定序。分组内容本身是否一致需比 `groups[]`，本轮只确证了顶层顺序分歧。

> ⚠️ **观察记录里的 `groups` 字段不可用**（2026-07-28 校正轮复核时发现）：它对
> `summary-custom` 这个**根本没有 `groupBy`** 的 view 也报了 1 个组，且所有组的 `key` 全为 `null`、
> `rows` 全为空。即 `controller.view.groups` 这条读取路径没取对（或同样存在 §0.2 坑 1 那类未收敛问题）。
> **本轮关于分组，实测到手的只有顶层行序这一个信号，官方的分组内容与组序都没测到。**
> 补 ⑦ 的取证时，第一件事是把 `groups` 的读取路径修对——否则「跟官方」连跟什么都定不下来。
> 这也是 ⑦ 决定不跟的首要理由（[vs-official §5.3](bases-vs-official.md)）。

### 4.7 ⑧ 自定义 summary 的 values 边界（`meanOfValues: values.mean()` 作用于 `sortable`）

样本 `sortable`：CaseA=null、CaseB=1、CaseC=2，其余 9 行缺失。

| view | 官方 | x-basalt | 结论 |
| --- | --- | --- | --- |
| summary-custom（全量 12 行） | **0.25**（entries=12） | **1.5** | ❌ 0.25 = (1+2)/**12** → 官方把 null/missing **计入分母**；x-basalt 1.5 = mean(1,2) → 剔除 |
| summary-custom-limited（limit 1） | **null**（entries=1） | **1.5** | ❌ 官方按 **limit 后**的行集汇总；x-basalt 按 limit 前全量 |

**结论**：x-basalt 口径⑧「剔除 null/missing、按 limit 前全量」**两条都与官方相反**。

> 上表是 2026-07-28 的原始观察，**不随实现改动而改写**（观察记录即真相源）。后续处置：
> (b) 已于 2026-07-29 跟官方落地（顶层计算集改 limit 后），(a) 仍待前置取证——见 §5 校正表。

### 4.8 ㉗ 默认数据集（原清单之外，本轮新发现）

无 filter 的基线 view 官方返回 **13 行**（12 个 fixture 文件 + 临时探针），其中包含 `.base` 文件**自身**。x-basalt 默认 `bases-markdown-2026-07` 只把 `.md` 当行并恒发 `markdown-only-dataset` warning，需切 `bases-all-files-2026-07` 才对齐。

**这条不在原 26 条暂定口径里**，但它是行集级别的差异，影响面比多数已登记条目都大。

### 4.9 ⑨ 拼接语境（样本 CaseE：due="2026-07-27"、label="报告"）

> **原读法已被推翻。** §4 旧版写的是「`concat-plain-string` 先验证官方 string+string 拼接可用，在此前提下再看 `concat-date-string`」——这个前提不成立。

| view | 列表达式 | 官方 | x-basalt |
| --- | --- | --- | --- |
| concat-plain-string | `label + " 备注"`（string + string） | **空**，无错误 | `"报告 备注"`（正常拼接） |
| concat-date-string | `due + " 备注"`（date + string） | **空**，无错误 | `null` + `base/property-type-mismatch` |

官方把表达式**解析了**（`columnInfo` 键被规范化成 `note.label + " 备注"`），`entry.getByIdentifier("label")` 也确实取得到 `"报告"`——但 `+` 的求值结果为空。

**结论**：问题不是「官方在拼接语境是否做日期推断」，而是**官方的 `+` 根本不做字符串拼接**。所以 x-basalt 的 string+string 拼接是**超集行为**（官方没有），date+string 则是两边都不产出拼接串、但**失败形态不同**（官方静默空、x-basalt 报行级类型错误）。

### 4.10 校正后复跑对照（2026-07-28，第一批 ①②④ 落地后）

同一份官方观察记录、同一个对照器（`parity/bases-oracle-diff.mjs`，固定 `--conformance bases-all-files-2026-07`）：

```
一致 24 · 存疑一致 0 · 分歧 2 · 跑不动 0  （共 26）
```

**分歧 7 → 2，且无新增分歧。** 消掉的五个 view：`eq-missing-null` / `eq-explicit-null-null`（①）、
`sort-desc`（②）、`empty-and` / `empty-not`（④）；`empty-or` 本就行数相同，现在成因也对齐了。
剩余两条都是 ⑦（`group-by-tags` / `group-by-list-prop` 的顶层行序），已决定不跟（[vs-official §5.3](bases-vs-official.md)）。

**这次复跑不需要 Obsidian 在跑**——对照器读的是 §4 冻结下来的观察记录，只需主仓 `pnpm build`。
需要重新取证（换 Obsidian 版本、补 view）时才要 App。

⚠️ 复跑**没有覆盖** ⑧ 与 ⑨：对照器只比行集不比列值，而这两条的判据都在列值/汇总里。

### 4.11 第二轮取证（2026-08-02/03 · Obsidian 1.13.4 · 38 + 49 view）

> 前提变化：会话中 Obsidian 自更新到 **1.13.4**（installer 仍记 1.12.7），结论的版本绑定因此刷新。
> fixture 新增 **34 个 filter 上下文 view**（types.base，文件数未变），观察记录冻结在 evals 私有仓
> `parity/oracle-observations/`（`2026-08-02-bases-oracle.json` 38 view 全量 +
> `2026-08-02-bases-oracle2.json` 49 view types）。

**为什么改 filter 上下文**：1.13.4 实测把 `note.<expr>` / 裸表达式**列**当属性列处理——不求值、
无错误、渲染为空（`cachedFormulaOutputs={}`、propertyEditor 空），07-29 那批「表达式列」view
判不出函数值。filter 会求值（round-1 date-eq-literal 已证），故新 view 全部用 filter 谓词：
真 → 12 行、假 → 0 行；官方对不认识的函数**静默 0 行（errors 恒空）**，故关键处补对照组钉机制。

**判定（⑩..㉖ 逐条）**：

| # | 官方 1.13.4 实据 | 判定 |
| --- | --- | --- |
| ⑩ | `"hello world foo".title() == "Hello World Foo"` 12 行 | ✅ 一致 |
| ⑪ | slice 负索引 / end 排他 / 越界钳制三谓词全 12 行；`list(...)` 字面量不可用 | string ✅ 一致；list 侧本仓超集 → boundary |
| ⑫ | 全局字面替换 12 行、只替首个 0 行 | ✅ 一致（非 regex） |
| ⑬ | BMP `"abc".reverse()=="cba"` 12 行；astral `"a💩b".reverse()=="b💩a"` **0 行** | 官方对代理对处理 ≠ code point → boundary（本仓保 code point 安全差异） |
| ⑭ | number / date `isEmpty()==false` 各 12 行 | ✅ 一致 |
| ⑮ | `time()=="10:30:00"` **12 行**、`=="10:30"` 0、`==37800000` 0 | ❌ 官方返回 `"HH:mm:ss"` 字符串 → ✅ **2026-08-03 已跟**（time() 已改字符串） |
| ⑯ | 数字 token 两谓词 12 行；`format("MMMM")=="七月"` **12 行** | 数字 token ✅；本地化 token 官方随界面语言 → boundary（本仓稳定数字 token） |
| ⑰ | relative 依赖时钟/界面语言，未取证 | 维持本仓口径 + boundary |
| ⑱ | `date(1000)` / `duration(1000)` 两候选均 0 行；`date()==date()` 对照 12 行 | 官方不支持 number 构造 → 本仓超集 boundary |
| ⑲ | `file("CaseB").path == "notes/CaseB.md"` 12 行 | ✅ 一致（路径形态相同） |
| ⑳ | `file.linksTo(file(...))` / `file.linksTo("CaseB")` 均 0 行 | 官方不可观测/不支持 → boundary |
| ㉖ | `duration("1 year")==duration("365 days")` 12 行；month：31d 12 / 30d 0 / 28d 0 | year ✅ 一致；month ❌ 官方 31d → ✅ **2026-08-03 已跟**（relative 阶梯同步） |
| ⑧(a) | `list(1,2).mean()==1.5` **0 行**、`list(1,2,null).mean()==1/1.5` 均 0、`list(1,2).isEmpty()==false` **0 行** → `list()` 非字面量；汇总通道 `values.mean()`=**0.25（entries=12）** | M1 机制成立：values 含空值、计分母 → ✅ **2026-08-03 已跟**（breaking：`[1,2,null].mean()` 报错 → 1） |
| ⑦ | groups 实读：`groupedDataCache` 按**整组键列表**成组——tags 两组 `[]`(11 行)/`["#project","#area"]`(CaseF)；list-prop 两组 `[1,2,3]`(CaseF)/`null`(11 行)；顶层行序随分组重排（3 个 DIFF） | 官方**不扇出** → ✅ **2026-08-03 已跟**（键/组序对齐官方；顶层行序保留 file.path 稳定序 → boundary，见 vs-official §5.8） |
| ㉓ | `group-desc-nullpos` 组序 **2 → 1 → null**（DESC） | 空值组恒最后、与方向无关（与 ② 同源）→ **当 bug 修**，`groupKeyCompareDirected` 已落地 |

**工具侧三处修复（本轮暴露）**：

1. **多行 eval 载荷崩 CLI/主进程**：round-2 的 READ_RESULT 改成多行（4595B/112 换行）后第一次
   真跑就崩——Obsidian CLI 解析器截断多行 `code=` 参数，主进程 JSON.parse 弹错、socket 通道整体
   卡死。修复：`evalJson` 发送前统一压单行（去注释 + 折叠空白）。教训：**CLI 载荷必须单行**
   （round-1 READ_RESULT 恰好单行 902B 所以没踩到）。
2. **1.13.4 groups 新结构**：`v.groups` 变成渲染表格组件，真实分组数据移到
   `v.data.groupedDataCache = [{key:{data}, entries:[...]}]`（key.data 为整组键列表）。
   READ_RESULT 加该路径 + 离线自检用例（11 项全过）。
3. **diff 假分歧**：对照器拿 `total`（= filter 后 limit 前行数，契约）当行数比，带 limit 的
   view 全报假分歧；改按 `rows.length`，且 file.path 列按 basename 归一。修后对照：
   **一致 27 · 存疑一致 8 · 分歧 3（全为 ⑦ 行序家族）· 跑不动 0**（38 view）。

## 5. 校正（第一批 ✅ / 第二批决策已出 · ⑧(b) ✅ / round-2 判定已出：㉓⑮㉖⑧(a) ✅ 已修/已落地）

> 取证轮只做取证、一行实现没改；**校正轮（2026-07-28）**：第一批 ①②④ 已落实现 + 回归用例
> （复跑对照见 §4.10，分歧 7 → 2、无新增）；第二批 ⑦⑧⑨㉗ 决策已出——⑦⑨㉗ 落 documented
> boundary（维持现状，无代码改动），⑧ 决定跟官方，其中 **(b) 计算集改 limit 后已于 2026-07-29
> 落地**（test 892 → 893），**(a) 空值计入分母仍卡在前置取证**（见 vs-official §5.4）。
> 每条都单独判断「跟官方」还是「落 documented boundary」，不存在无脑对齐；
> 判断理由逐条写进 [`bases-vs-official.md`](bases-vs-official.md) §5。

> **round-2 校正（2026-08-02/03）**：㉓ 组序 DESC 空值恒最后 → **已按 bug 修**
> （`groupKeyCompareDirected`，engine.ts，组序实测对齐官方 2→1→null）；⑮ `time()` 返回
> `"HH:mm:ss"`、㉖ month=31d、⑧(a) mean 计分母 → **跟官方，✅ 2026-08-03 已落地**；⑬⑯⑱⑳⑪⑰ →
> documented boundary（vs-official §5.7 起逐条落档）；⑦ 官方不扇出 → ✅ **2026-08-03 已跟**
> （顶层行序保留稳定序 → boundary）。

| # | 差异 | 落点 | 取舍与状态 |
| --- | --- | --- | --- |
| ① eq | MISSING 与 null 是否合并 | `src/base/values.ts`（`typedEqual`） | **跟官方** ✅ 2026-07-28：影响任何 `== null` / `!= null` 的 filter，静默改变行集，属最危险的一类。合并落在值域唯一的相等语义上（分组/`unique`/`contains` 一并生效），`isType("null")` 有意不跟随——取舍见 [vs-official §5.1](bases-vs-official.md) |
| ② | DESC 时 null/missing 排到了最前 | `src/base/values.ts`（`sortKeyCompareDirected`） | **按自己登记的口径修** ✅ 2026-07-28——不是「跟不跟官方」，是实现与 §1 登记口径的漂移，官方恰好站在登记口径那边 |
| ④ | 空 filter 数组当前是拒绝 | `src/base/planner.ts` | **跟官方** ✅ 2026-07-28：`and:[]`=真 / `or:[]`=假 / `not:[]`=真，官方稳定可重放，「P1 拒绝」没有依据了 |
| ⑦ | 分组时顶层 rows 顺序 | `src/base/engine.ts`（groupBy） | **不跟** · boundary（2026-07-28 决策）：本轮只测到顶层行序、**没测到官方的分组内容与组序**（观察记录的 `groups` 字段是坏的，见 §5.2），跟等于照抄症状；且会牺牲字节稳定契约。理由全文 [vs-official §5.3](bases-vs-official.md) |
| ⑧ | summary values 的两个维度 | `src/base/engine.ts`（summaries 取值集）/ `src/base/functions.ts`（`list.mean`） | **跟官方**（2026-07-28 决策）：**(b) limit 后 ✅ 2026-07-29 已落地**（`filtered` → `limited`，锁定用例翻为 `limitAfter`；顺带统一顶层/组级口径并共用一份 `perRowValues`，消掉重复求值与重复诊断）；**(a) ✅ 2026-08-03 已落地**（round-2 取证：`list()` 官方非字面量、直测关闭；汇总通道 `values.mean()`=0.25/entries=12 证实计分母 → `list.mean()` 改「非 number 不计分子、计分母」+ values 作用域含空值，breaking）。理由全文 [vs-official §5.4](bases-vs-official.md) |
| ⑨ | `+` 是否做字符串拼接 | `src/base/evaluator.ts`（`upgradeStringOperand`） | **不跟** · boundary（2026-07-28 决策）：官方那里是**静默的空**（没实现的洞，不是语义），砍掉纯亏；与本仓「不静默」立场一致。理由全文 [vs-official §5.5](bases-vs-official.md) |
| ㉗ | 默认数据集是否含 `.base` 自身 | `src/base/engine.ts`（conformance 默认值） | **不改默认值** · boundary（2026-07-28 决策）：差异不静默（恒发 `markdown-only-dataset` warning），且官方读数只证明 `.base` 是行、**没证明附件也是行**（fixture 无附件样本），切默认等于顺带断言未取证的事；要对齐一条 flag 即可。理由全文 [vs-official §5.6](bases-vs-official.md) |

配套动作（改哪条做哪条，不要一次性全改）：

1. 定位对应的锁定测试：`rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`，改写后**删除该条的「待 oracle」标注**。
2. 状态文档 [`bases-status.md`](bases-status.md) §3 / §6 对应行同步。
3. 决定「不跟官方」的，必须在 [`bases-vs-official.md`](bases-vs-official.md) 落 documented boundary，写清**为什么**不跟——不能只留一句「有意差异」。

**⑩..㉖ 这 17 条仍无 fixture view**（见 §1.1 / §1.2）。取证既然已经脚本化，补 view 的成本就是唯一门槛了——但「近零」有个前提：

> **只往已有 `.base` 里加 view，不新建 `.base` 文件。** §2 前置第 3 条的推论：官方默认数据集把
> `.base` 自身算作行，每新建一个文件，所有无 filter view 的行数就 +1，**§4 这 26 条观察记录当场全部作废、
> 要整批重跑**。加进已有文件则文件数不变、既有行集不动，重跑反而是一次免费回归。
> 这条同样适用于 ⑧(a) 的前置取证（[vs-official §5.4](bases-vs-official.md)）。

### 5.1 校正 ② 时暴露的新登记缺口：**组序的方向维度**

㉓ 登记的是分组键**组序的相对次序**（可比标量 < link < null/MISSING），**没登记它是否与方向无关**。
② 修完后两处并不一致：顶层 sort 的空值恒最后（已由官方冻结），而 `groupBy.direction: DESC`
仍是对整体组序取反、空值组因此翻到最前（`src/base/engine.ts` 的 `groupKeyCompare` 调用处）。

本轮**有意不动它**——官方 oracle 只覆盖了顶层 rows 顺序（⑦），组序在 DESC 下的空值位置无观察数据，
照 §6 红线「取证跑不通时不猜测补齐」。补 ㉓ 的 fixture view 时一并把方向维度取证掉，再决定是否对齐 ②。

## 6. 红线

- 原始 App 输出**不是** x-basalt 公共 API；结论必须人工审查后才转期望快照。
- 某 view 两次结果不一致 → 标 `implementation-defined`：维持 x-basalt 口径并注释「官方不稳定」，测试只锁自一致性。（本轮 26 个 view 无一触发。）
- 取证跑不通时不猜测补齐——维持暂定口径，状态文档保持 ⏸。
- **行数相同 ≠ 口径一致**：`empty-or` 两边都是 0 行，但官方是逻辑恒假、x-basalt 是报错返回空。判定前先看诊断与列值。

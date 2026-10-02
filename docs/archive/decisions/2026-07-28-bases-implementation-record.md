---
type: record
title: Bases 首次函数补齐与 oracle 阶段记录
description: 从 docs/design/bases-status.md 摘出的历史章节与旧导言，保留当时证据、版本及纠偏；当前契约和未完成义务仍由来源文档维护。
tags:
  - archive
  - history
  - x-basalt
timestamp: 2026-10-02T11:25:55Z
sha256: 48336294b4bb0d85192de28cb91d41ee8ce9ce7b0f2dc3d45b92741fc6289483
---
# Bases 首次函数补齐与 oracle 阶段记录

> 归档于 2026-10-02；来源：[docs/design/bases-status.md](../../design/bases-status.md) 的下列原章节。仅保留当时过程、提案或观察，不代表当前实现；有效契约与后续义务以来源文档及根 TODO 为准。

保留来源章节的原读数、旧选择与纠偏经过；章节中的“当前”“待实施”均按原阶段基线阅读，不作为归档后的新授权。

## 3. P1 前置 oracle ✅ 取证完成 / 第一二批校正 ✅ 已落地（round-2 判定已出）

> **2026-07-28：26 个 view 全部取证完毕**（Obsidian 1.12.7，每个 view 连跑两次全部一致，无 `implementation-defined`）。
> 同日上午曾判「⏸ 整体暂缓、不再排期」，当天下午被推翻——官方 CLI 的 `eval` 能读到 Bases 算好的行集，
> 取证可脚本化、不需要人逐个点。误判复盘见 [runbook §0.1](../../design/bases-oracle-runbook.md)。
> **2026-07-28 校正轮**：结论明确的第一批三条（① equality / ② sort 空值位 / ④ 空 filter 数组）已落实现 + 回归用例；
> ⑦⑧ 的后续校正已落地；本表按日期保留观察与取舍，旧观察不是当前实现描述。逐条决定见 [runbook §5](../../design/bases-oracle-runbook.md) 与 [vs-official §5](../../design/bases-vs-official.md)。
> **2026-08-02/03 round-2**（Obsidian 1.13.4，38 + 49 view 两次一致）：⑩..㉖ 全部出判定——
> ㉓⑮㉖⑧(a) ✅ 已修/已落地、⑦ 已于 2026-08-03 跟整列表键内容/组序、顶层行序保留 boundary；⑬⑯⑱⑳⑪⑰ 落
> documented boundary。判定明细见 [runbook §4.11](../../design/bases-oracle-runbook.md)。

| 争议语义 | 场景编号 | 官方结论 | 状态 |
| ---- | ---- | ---- | ---- |
| missing/null/空串/0/false/空列表 truthiness | BASE-PROP-004 | 六形态全 falsy，**与实现一致** | ✅ 可转正 |
| `X == null` 与 MISSING 是否合并 | BASE-PROP-004 | **合并**（`missing == null` 为 true） | ✅ 2026-07-28 已校正（跟官方；合并落在 `typedEqual`，分组/`unique`/`contains` 一并生效，`isType("null")` 有意不跟随；取舍见 [vs-official §5.1](../../design/bases-vs-official.md)） |
| 多键 sort 的 null 位置 | BASE-RESULT-002 | 恒排最后，与方向无关 | ✅ 2026-07-28 已校正（当 bug 修：`sortKeyCompareDirected` 让方向只作用于可比值，空值组恒最后；回归用例 `base-engine.test.ts` / `base-values-date.test.ts` 标 oracle ②） |
| 空 filter 数组（and:[]/or:[]/not:[]） | 设计 §6 | `and:[]`=真 / `or:[]`=假 / `not:[]`=真 | ✅ 2026-07-28 已校正（跟官方；planner 放行空数组，语义由 evalFilter 的 every/some 天然给出） |
| `if()` lazy branch | 设计 §9 | lazy，**与实现一致** | ✅ 可转正 |
| 二元运算的字符串→日期推断是否作用于 `+` | 语法 §5.1 / 设计 §8.3 | **原命题不成立**：官方 `+` 根本不拼接字符串，string+string 也得空 | ✅ 2026-07-28 决策：**不跟**，保留超集 + [documented boundary](../../design/bases-vs-official.md)（官方那里是静默的空，砍掉纯亏） |
| 自定义 summary 的 `values` 边界 | BASE-SUM-002 | **含** null/missing（计入分母）、按 **limit 后** | ✅ 2026-07-28 决策 + 2026-08-03 全部落地：(b) limit 后、(a) `list.mean()` 计分母 + values 含空值（官方 `values.mean()`=0.25/entries=12 定案），见 [vs-official §5.4](../../design/bases-vs-official.md) |
| list 分组键扇出的顶层行序 | BASE-GROUP-002 | 顶层 rows 顺序随分组键变动 | ✅ 2026-07-28 决策：**不跟**，保 `file.path` 稳定序 + [documented boundary](../../design/bases-vs-official.md)（本轮只测到顶层行序，官方分组内容/组序**没测到**——观察记录 `groups` 字段是坏的） |
| **默认数据集是否含 `.base` 自身** | BASE-DATA-001/002 | **含**（`.base` 文件自身也是行） | ✅ 2026-07-28 决策：**不改默认值** + [documented boundary](../../design/bases-vs-official.md)（差异恒发 warning 不静默；官方读数没证明附件也是行，切默认等于断言未取证的事） |
| 分组组序的方向维度（DESC 空值位） | ㉓ | DESC 组序 **2 → 1 → null**，空值组恒最后 | ✅ 2026-08-02 已校正（当 bug 修：`groupKeyCompareDirected`，与 ② 同源；回归用例 `group-missing.base :: byAreaDesc` 标 oracle ㉓） |
| ⑩ title / ⑪ slice（string）/ ⑫ replace / ⑭ isEmpty / ⑲ file().path | 函数覆盖率片 | 与本仓期望串**逐字一致** | ✅ 2026-08-02 可转正（filter 谓词 12 行命中；⑪ list 侧官方 `list()` 非字面量 → 本仓超集 boundary） |
| ⑮ `date.time()` 返回形态 | 片二 | 官方返回 `"HH:mm:ss"` **字符串** | ✅ 2026-08-03 已落地（跟官方；原 duration 毫秒已翻） |
| ㉖ duration month 换算 | 片二 | month=**31d**（year=365d 一致） | ✅ 2026-08-03 已落地（跟官方；原 30d，relative 阶梯同步） |
| ⑦ 分组内容（round-2 新实据） | BASE-GROUP-002 | 官方按**整组键列表**成组、**不扇出**（tags：`[]` / `["#project","#area"]`；list-prop：`[1,2,3]` / null） | ✅ 2026-08-03 已跟：整组键列表成组不扇出（顶层行序保留稳定序 → boundary，见 [vs-official §5.8](../../design/bases-vs-official.md)） |
| ⑬ astral reverse / ⑯ format 本地化 / ⑱ number 构造器 / ⑳ linksTo / ⑪ list 字面量 / ⑰ relative | 函数覆盖率片 | 官方不可跟（非 code point / 随界面语言 / 不支持 / 不可观测 / 非字面量 / 时钟语言依赖） | ✅ 2026-08-02 决策：**不跟** + [documented boundary](../../design/bases-vs-official.md) §5.12（本仓保安全/稳定超集） |

> 取证方式与三个会静默出错的坑见 [runbook §0.2](../../design/bases-oracle-runbook.md)。原始观察数据由取证侧留档（不入本仓：机器生成、体量大，且与 §4 的人读结论重复存放必然漂移）。
> **⑩..㉖ 已全部有 fixture view 并完成 round-2 取证**（34 个 filter 上下文 view，见 runbook §4.11）；
> 原 round-2 收尾已结束；尚未确认的 oracle 项仍逐项保留。2026-10-01 新复现的执行缺口见根 TODO 与局部调研，不自动进入修复实施。
> 校正清单 `rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`。

## 6. 函数覆盖率补齐 ✅ 2026-07-28（六片全部落地，[计划](../plans/2026-07-28-bases-functions.md)）

> 缺口全在**叶子函数**：注册表 / 名字真相源 / 运行时分派三处骨架已成型，补函数 = 扩表 + 扩分派组 + 补用例。
> 每片完成后本表翻标（日期 + 测试文件）。
>
> **测试分两层**：各片的求值层单测（合成 BaseRow，锁语义细节）+ `tests/base-functions-e2e.test.ts`
> （经 BaseEngine 跑真实索引，锁「函数在真查询里确实能用」）。后者是**补漏检**而非补覆盖率——
> 变异检验实测：删掉 `engine.ts` 的 `resolveFile:` 注入行，只有单测时 880 例仍全绿，
> 而 `file()`/`link().asFile()` 在真实查询里已经报错。CLI `--context-file` 同理，见 `tests/base-cli.test.ts`。

| 片 | 内容 | 状态 |
| ---- | ---- | ---- |
| 片一 | 机械叶子 16 个 + 渲染类 4 个显式拒绝 + `round` 归组 | ✅ 2026-07-28（`tests/base-functions-leaf.test.ts` 18 用例；838 全量绿） |
| 片二 | Date/Duration 族 6 个（`date()`/`duration()`/`format`/`time`/`relative`/`isEmpty`），新增 `date` 分派组 | ✅ 2026-07-28（`tests/base-functions-date.test.ts` 11 用例；850 全量绿） |
| 片三 | Link/File 互转 5 个（`asFile`/`linksTo`/`asLink`/`file()`/`link()`） | ✅ 2026-07-28（`tests/base-functions-link.test.ts` 8 用例；858 全量绿。**含文法改动**：`file(...)` 调用形态） |
| 片四 | `matches`（regex）+ ReDoS 防护 | ✅ 2026-07-28（`tests/base-functions-regex.test.ts` 8 用例；866 全量绿） |
| 片五 | list/link 当分组键 + 自定义汇总收口 | ✅ 2026-07-28（`tests/base-group-summary.test.ts` +4 用例；870 全量绿） |
| 片六 | 显式 `contextFile` + `this.*` 求值 | ✅ 2026-07-28（`tests/base-context.test.ts` 10 用例；880 全量绿。CTX-002/003 落成**入口形态诊断**，CTX-004 由「不给即拒绝」覆盖） |

### 片一明细 ✅ 2026-07-28

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| string `replace`/`repeat`/`reverse`/`slice`/`split`/`title`/`isEmpty` | BASE-EXPR-003 | ✅ 2026-07-28（自建口径见语法 §4.4 尾注，待 oracle） |
| number 分派组新增（`receiverGroupOf` 返 `"number"`）+ `abs`/`ceil`/`floor`/`toFixed`/`isEmpty` | BASE-EXPR-005 | ✅ 2026-07-28（`toFixed` 返 string；`isEmpty` 恒 false） |
| `round` 由 `any` 组迁入 `number` 组 | BASE-SUM-001 | ✅ 2026-07-28（语义不变；`"x".round()` message 由「参数类型错误」变「类型 string 不支持方法」，rule 不变） |
| list `reverse`/`slice`（`reverse` 产新数组，不污染行状态） | BASE-EXPR-004 | ✅ 2026-07-28 |
| global `max`/`min`（变长 number 参） | BASE-EXPR-005 | ✅ 2026-07-28 |
| 渲染类 `escapeHTML`/`html`/`image`/`icon` 白名单内显式拒绝 | 设计 §1 | ✅ 2026-07-28（新增 `BaseUnsupportedError` → `base/unsupported-feature`，与 `property-type-mismatch` 分开，读出方可据 rule 区分「用错类型」与「本引擎不做」） |
| `repeat`/`replace`/`split` 产物规模预算（string 计字符数，`repeat` 分配前预检） | BASE-SEC-005 延伸 | ✅ 2026-07-28 |
| `random()` × 字节稳定冲突 | 语法 §4.4 | ✅ 2026-07-28 **直接拒绝**（用户拍板；白名单内报 `base/unsupported-feature`，消息说明是契约冲突而非「不渲染」，与渲染类分开断言） |

### 片六明细 ✅ 2026-07-28（BASE-CTX-001；CTX-002/003/004 ❌ 不做 + 诊断）

> 测试：`tests/base-context.test.ts`（10 用例）+ fixture `views/context.base`。CLI 增 `--context-file`。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 显式 `contextFile` 驱动 `this.*`（filter / 投影 / 公式体内） | BASE-CTX-001 | ✅ 2026-07-28（`this.file.*` 取上下文行 file 字段、`this.<属性>` 取其 note 属性、裸 `this` 为其 note 对象；note 读取与 `note.<key>` **共用 `evalNoteKey`**，防两处类型升级链分叉） |
| contextFile 路径解析口径 = `file(path)` | BASE-CTX-001 | ✅ 2026-07-28（复用同一个 `createFileResolver`，不造第二套路径口径；完整路径 / 去扩展名忽略大小写 / bare basename 三种写法等价，专项用例） |
| 给了 contextFile 却解析不到 → error + 空结果 | BASE-CTX-001 | ✅ 2026-07-28（**不静默当没给**——否则 `this.*` 会退化成「需要上下文」的误导性诊断） |
| 自定义汇总 `values` 作用域内 `this.*` 仍拒绝 | SUM-002 延伸 | ✅ 2026-07-28（该语境有意不注入 contextRow，与 note/file/`file()` 同一「禁访问行外状态」原则） |
| 入口形态检查（CTX-002/003 的诊断落点） | BASE-CTX-002/003 | ✅ 2026-07-28（**在读文件之前**按路径形态判定：带 `#` → 指向 `--view`；非 `.base` 扩展名 → 指向「单独存成 .base」。专项用例断言指向不存在的 `.md` 时仍给形态诊断而非 ENOENT/invalid-yaml） |

### 片五明细 ✅ 2026-07-28（历史过程；当前见 §3/§4）

> 下面的扇出与空列表口径已于 2026-08-03 被整列表键、不扇出取代；保留当时实现过程，不作为当前支持说明。

> 测试：`tests/base-group-summary.test.ts`（+4 用例，共 22）。fixture `group-list.base` 由「拒绝场景」改写为扇出/link/空 list 五个 view。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| list 分组键**扇出**（一行进入其每个元素的组） | BASE-GROUP-002 | ✅ 2026-07-28（`groupBy: tags` 的自然语义；**代价：组内行数之和 ≥ `rows.length`**，已写进 `BaseQueryResult.groups` 契约与 use 文档；顶层 `rows` 仍平铺一份不变。暂定口径待 oracle） |
| 行内元素先 typedEqual 去重 | BASE-GROUP-002 | ✅ 2026-07-28（`[a, a]` 不得把同一行塞进同一组两次） |
| 空 list 键视同 MISSING（单独成组） | BASE-GROUP-002 | ✅ 2026-07-28（**不静默丢行**——专项用例断言 6 行全在） |
| link 为**标量**键（不扇出） | BASE-GROUP-002 | ✅ 2026-07-28（路径感知相等分组；新增 `groupKeyCompare`——`sortKeyCompare` 对 link **抛类型错误**，分组只需确定性组序，故按归一 `path`+`subpath` 定序，序为「可比标量 < link < null/MISSING」） |
| 组级汇总 `groups[].summaries` | BASE-SUM-002 | ✅ 2026-07-28（**口径变更留档**：P2b 曾判「组级汇总属官方 UI 形态，无头 JSON 暂不做」，片五 GROUP-002 落地后 groups 成一等产物，「有组没有组的汇总」是半个功能故补上。计算集 = 该组 **limit 后**的行；顶层自 2026-07-29 起同为 limit 后（oracle⑧(b)），两者口径已统一并共用同一份逐行求值） |

### 片四明细 ✅ 2026-07-28（BASE-SEC-004）

> 测试：`tests/base-functions-regex.test.ts`（8 用例）。新增 `src/base/regexp.ts` 与 rule `base/invalid-regex`。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| `string.matches(pattern)`（pattern 为**字符串**，子串命中语义） | BASE-EXPR-003 / BASE-SEC-004 | ✅ 2026-07-28（正则**字面量** `/…/` 仍在文法层拒绝，语法 §4.3 由「P2 最后评估」翻为「不做」） |
| 防护①：静态拒绝灾难性回溯构造 | BASE-SEC-004 | ✅ 2026-07-28（判据 = **无界量词**作用于分组且分组体内含无界量词或顶层交替；命中 `(a+)+`/`(a*)*`/`(a\|a)*`/`(a\|ab)+`，放行 `(\d+)?`/`(foo)+`/`[a-z]+@[a-z]+`。充分不必要，故必须叠加防护②③） |
| 防护①附：反向引用（`\1` / `\k<name>`）一律拒绝 | BASE-SEC-004 | ✅ 2026-07-28（先剥成对转义再检测，「转义反斜杠 + 字面 1」不被误杀，专项用例） |
| 防护②：限长（pattern 200 / 被匹配串 10000，与 DQL 侧同档） | BASE-SEC-004 | ✅ 2026-07-28 |
| 防护③：有界编译缓存（上限 64，超限整表清空） | 设计 §12 延伸 | ✅ 2026-07-28（逐行匹配不重复编译；不做无界增长——沿用 review 批次「解析缓存无界」的教训） |
| 新 rule `base/invalid-regex`（非法/不安全一律行级诊断） | 设计 §11 | ✅ 2026-07-28（**与 DQL 侧 `regexmatch` 策略有意不同**：那边非法正则降级为「不匹配」且不报错，Bases 侧硬约束是不静默忽略） |

### 片二明细 ✅ 2026-07-28（历史过程）

> `date.time()` 已于 2026-08-03 从 duration 改为 `HH:mm:ss` 字符串，month 为 31d；当前口径与本轮已跑测试见 §3 和局部调研，下表保留首次实现时的选择。

> 测试：`tests/base-functions-date.test.ts`（11 用例）。**快照口径变化**：`date()`/`duration()` 晚于 2026-07-22 冻结快照，本片显式采纳，语法 §1.1 漂移记录已同步（`%` 取模仍不采纳）。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| global `date(v)` 构造（严格 ISO / date 幂等 / number 按 epoch 毫秒） | BASE-TYPE-005 | ✅ 2026-07-28（与 frontmatter 推断复用同一 `parseDateLike`，保证「属性里能识别的」与「`date()` 能构造的」是同一集合） |
| global `duration(v)` 构造（长单位 + 官方短单位 + number 按毫秒） | BASE-TYPE-005 | ✅ 2026-07-28（新增值层 `parseDurationLike`；短单位**大小写敏感**：`M`=月/`m`=分，大写变体 `D`/`Y` 一律拒绝——混淆代价是量级级错误） |
| date 分派组新增（`receiverGroupOf` 返 `"date"`） | 设计 §9 | ✅ 2026-07-28（duration/link 仍只命中 `any`；内部字段 epochMs/precision 依旧不外露） |
| `date.format(fmt)` | BASE-TYPE-005 | ✅ 2026-07-28（数字 token 子集 + 同字符游程分词 + `[字面量]` 转义；本地化 token 报错——见下方「实测非显然点」） |
| `date.time()` → 当日 UTC 零点起的 duration | BASE-TYPE-005 | ✅ 2026-07-28（暂定口径：选 duration 而非 `"HH:mm"` 字符串，可比较可算术；date 精度恒 0） |
| `date.relative()` | BASE-TYPE-005 / BASE-FORM-006 | ✅ 2026-07-28（固定英文 + 固定阶梯，时间源恒为注入 clock；官方输出随界面语言变，不复刻） |
| `date.isEmpty()` 恒 false | BASE-TYPE-005 | ✅ 2026-07-28 |

### 片三明细 ✅ 2026-07-28

> 测试：`tests/base-functions-link.test.ts`（8 用例）。**含文法改动**（片六原本被认为是唯一动 parser 的一片，实际本片先动了）：`file` 是关键字 token，`file(...)` 此前直接语法错误；`rootRef` 增加「根 token 后随 `(` → 全局调用」分支。

| 项 | 场景编号 | 状态 |
| ---- | ---- | ---- |
| 文法：`file(...)` 调用形态；`note(`/`formula(`/`this(` 走同一分支报 `base/unknown-function` | 设计 §7 | ✅ 2026-07-28（既有 `file.name` / 裸 `file` / `file["name"]` / `file.hasTag(...)` 零回归，专项用例锁定） |
| global `file(path)`：行集内三级解析（精确 path → pathKey → bare basename） | BASE-FILE-001 | ✅ 2026-07-28（新增 `createFileResolver`；解析范围 = 当前查询行集，不查库不碰 FS，故 markdown 模式解析不到附件；解析不到 → MISSING 不伪造空 file 值） |
| global `link(target, display?)`：纯值构造 | BASE-TYPE-006 | ✅ 2026-07-28（**不解析行集**，悬空链接合法——与 `file()` 的「解析不到 → MISSING」是有意的两种口径） |
| link 分派组新增 + `link.asFile()` | BASE-TYPE-006 / BASE-FILE-001 | ✅ 2026-07-28（用原始 target 走三级解析，bare `[[A]]` 可命中；悬空 → MISSING） |
| `file.asLink(display?)` | BASE-TYPE-006 | ✅ 2026-07-28（target 用完整 vault 相对路径，不受同名文件影响；`file → link → file` 往返用例锁定） |
| `file.linksTo(x)` | BASE-FILE-005 | ✅ 2026-07-28（string/link 入参走与 `hasLink` 同一匹配函数 `matchesAnyLink`；**file 入参走解析**，见下） |
| 无行集解析器语境（自定义汇总 `values` 作用域）→ `base/unsupported-feature` | SUM-002 延伸 | ✅ 2026-07-28（不静默 MISSING；`link()` 纯值构造在该语境照常可用） |

> **片三实测非显然点**：`file.linksTo(file("Beta"))` 起初返回 **false**——Alpha 里写的是 bare `[[Beta]]`，而 `file("Beta").path` 是 `Projects/Beta.md`，文本匹配走 qualified 分支比 `pathKey`（`"beta"` ≠ `"projects/beta"`），明明链上了却判否。定为两种入参两种语义：string/link = 文本目标（同 `hasLink`），**file = 那个具体文件**（把每条出链解析一遍比解析后的 path）。
> **另一处**（文法）：`rootRef` 里按 `callArgs` 提前 `return` 会让后半段属性路径 `OPTION` **永远不被录进 chevrotain 语法**（录制阶段会真的执行 OPTION 的 DEF，callArgs 被赋成 dummy 值），运行期 `file.name` 直接抛 `Cannot read properties of undefined`。规则必须单出口。

> **片二实测非显然点**（已在代码注释与测试里存证）：`format` 若按「最长已知 token 优先」扫描，`MMMM` 会被贪婪切成 `MM`+`MM` **静默输出 `0808`**——用户写 `MMMM` 要的是月名，静默给错数字比报错糟得多。改为按同字符最长游程整体查表后才落到正确诊断，测试用 `MMMM`/`dddd`/`DDDD`/`YYY` 四个游程锁定。

## 整理前导言（历史上下文）

# Bases 实现状态追踪

> 性质：**living 文档**——每完成/计划一个语法项就更新本表（状态 + 日期 + 计划链接），语法事实以 [`../specs/2026-07-26-bases-syntax.md`](../../design/bases-syntax.md) 为准，验收编号以 [`2026-07-22-bases-scenario-matrix.md`](../../design/bases-scenarios.md) 为准。
> 状态图例：✅ 已实现（标日期）｜📋 已建计划（标计划链接）｜🔜 待开计划（标阶段与前置条件）｜⏸ 暂缓（标触发条件）｜❌ 不做（标理由）。
> 更新纪律：翻状态必须同时更新对应计划/场景矩阵；声称 ✅ 的项必须有可追溯测试编号。


## 语法表校准前片段（不再是当前口径）

> 来源：`docs/design/bases-syntax.md` §1.1、§2、§4.4、§7。以下保留旧规范表述以便追溯；当前口径已在来源处校准。

| `summaries`  | map                     | 自定义汇总（`values` 隐式作用域） | 【P2b ✅ 执行】（SUM-002：计算集 ✅ 2026-07-29 已跟官方改为 **limit 后**；空值仍剔除，**官方计入分母、已决定跟但待前置取证**，见 [vs-official §5.4](../../design/bases-vs-official.md)） |

| `groupBy` | 【P2b ✅ 标量键】【2026-07-28 ✅ list/link 键，GROUP-002】`{ property, direction }`；**list 键扇出**（一行进入其每个元素的组，行内元素先去重、空 list 视同 MISSING 键），link 为标量键（路径感知相等，组序按归一 path）。扇出使「组内行数之和 ≥ rows.length」，顶层 rows 仍平铺一份且**恒为 `file.path` 稳定序**——官方顶层行序随分组键变动，本仓 2026-07-28 决定**不跟**（documented boundary，见 [vs-official §5.3](../../design/bases-vs-official.md)）。扇出本身仍是暂定口径 |

语义要点：`if()` lazy branch（只计算被选择分支）【P1 ✅ 暂定 lazy 实现，待 oracle 校正】；list 成员比较用 typed equality；`number()` 转换失败行为【P1 ✅ 冻结为行级类型错误】。

片二 date 组的自建口径（暂定，待 oracle）：`format` 只做**与语言无关的数字 token**（`YYYY YY MM M DD D HH H mm m ss s`，全部按 UTC），分词按**同字符最长游程**（moment 真实语法，`MMMM` 是独立 token 而非 `MM`×2），本地化 token（`MMMM`/`dddd`/`A`/`Z`）与未实现 token 一律报错、不静默给一种语言，字面文本用 `[方括号]` 转义；`time()` 返回**当日 UTC 零点起的 duration**（可比较可算术，要字符串用 `format("HH:mm")`），date 精度恒为 0；`relative()` 用**固定英文**固定阶梯（`3 days ago` / `in 2 hours` / `just now`，month=30day、year=365day 与值域约定同源），时间源恒为注入 clock——官方该函数输出随界面语言变，本就不是稳定 schema，不复刻。

- **数据集**：官方默认包含 vault 全部文件；x-basalt 首期只含 Markdown 笔记，查询恒附 `base/markdown-only-dataset` conformance warning，附件不作为行。【P1 ✅：BASE-DATA-001/002】all-files（附件行、附件 links/backlinks）【P3，先独立 indexer schema 决策，证明不改既有 DQL `.md` 数据集】。

---
type: plan
status: done
title: Bases 函数覆盖率计划（51% → ~90%）
description: 官方 68 个函数条目中未实现的 33 个分六片补齐——机械叶子函数、Date/Duration 族、Link/File 互转、regex+ReDoS、list 分组键、contextFile 上下文
tags:
  - plan
  - bases
  - functions
  - x-basalt
timestamp: 2026-08-06T23:58:46Z
sha256: 8bb5b0fb0135960f29d6b29d0ccc7b6331dc16d523da51802d56c2e4b0c44af7
---
# 计划：Bases 函数覆盖率（51% → ~90%）

> 2026-07-28 · 来源：用户目标「把 Bases 函数覆盖率从 51% 推到 ~90%」。
> 语法真相源：[`bases-syntax.md`](../../design/bases-syntax.md) §4.4；实现状态 living 文档：[`bases-status.md`](../../design/bases-status.md)；使用者全表：[`bases.md`](../../use/bases.md) §3.6。
> 前置：P0/P1/P2a/P2b/P3a + code review 修复全部落地，四门全绿（typecheck / lint / format / test **820**）。
> 骨架已齐（filter / 属性引用 / file 字段 / order-sort-limit / formulas / 类型系统 / groupBy / summaries / 附件数据集），**缺口全在叶子函数**。

## 背景与切口

官方 Bases 函数清单 68 个条目，本仓已实现 35（51%）。缺口不是架构缺失——注册表（`src/base/functions.ts`）、名字单一真相源（`src/base/expressions.ts` 的 `BASE_FUNCTION_NAMES`）、运行时分派（`src/base/evaluator.ts` 的 `receiverGroupOf`）三处已成型，补函数 = 扩表 + 扩分派组 + 补用例。

**每次增删函数必须同时碰的四处**（有模块加载期一致性自检，漏改直接 throw）：

1. `src/base/expressions.ts` 的 `BASE_FUNCTION_NAMES`——函数名单一真相源；
2. `src/base/functions.ts` 的 `ENTRIES`——注册表，加载时与 ①对账，缺名/多名即 throw；
3. `src/base/functions.ts` 的 `BaseFunctionReceiver` 类型——新增分派组时扩；
4. `src/base/evaluator.ts` 的 `receiverGroupOf()`——新增分派组时必改。

## 分片

| 片 | 内容 | 关键改动 | 状态 |
| --- | --- | --- | --- |
| 1 | 机械叶子函数 16 个 + 4 个渲染类拒绝 + `round` 归组 | 新增 receiver 组 `number` | ✅ |
| 2 | Date/Duration 族 6 个（`date()`/`duration()`/`format`/`time`/`relative`/`isEmpty`） | 新增 receiver 组 `date`，扩 duration 格式化 | ✅ |
| 3 | Link/File 互转 5 个（`asFile`/`linksTo`/`asLink`/`file()`/`link()`） | 行集 file 解析器 + **文法：`file(...)` 调用形态** | ✅ |
| 4 | `matches`（regex）+ ReDoS 防护（BASE-SEC-004） | 新增 `src/base/regexp.ts` + rule `base/invalid-regex` | ✅ |
| 5 | BASE-GROUP-002（list/link 分组键）+ BASE-SUM-002 收口 | engine 分组层：扇出分桶 + `groupKeyCompare` + 组级汇总 | ✅ |
| 6 | BASE-CTX-001 显式 `contextFile` + `this.*`（CTX-002/003/004 判❌不做 + 诊断） | engine/CLI 入参 + 入口形态检查，**未动 parser**（拍板缩范围后成立） | ✅ |

### 片 1 明细

- string：`replace` `repeat` `reverse` `slice` `split` `title` `isEmpty`
- number（**新组**）：`abs` `ceil` `floor` `toFixed` `isEmpty`
- list：`reverse` `slice`
- global：`max` `min`
- 渲染类白名单 + 显式拒绝：`escapeHTML`（string）/ `html` `image` `icon`（global）→ `base/unsupported-feature`「无头引擎不渲染」，比 `unknown-function` 的报错友好
- `round` 从 `"any"` 组迁到 `"number"` 组（官方是 number 方法）

## Decision Log

> 格式：#序号 · 决策 · 理由 · 可逆性。

### 片 1

1. **新增 receiver 组 `"number"`**（`receiverGroupOf` 对 `typeof v === "number"` 返 `"number"`）。理由：官方 number 方法族已达 6 个（abs/ceil/floor/round/toFixed/isEmpty），继续挂 `"any"` 会让每个 impl 都自验 receiver 类型，且 `"a".abs()` 得到的是「参数类型错误」而非「类型 string 不支持方法 abs」——后者才是正确诊断。可逆：改回一行。
2. **`round` 迁组的可观察变化**：`"x".round()` 由「函数 any.round 参数类型错误：receiver 须为 number」变为「类型 string 不支持方法 round」（rule 均为 `base/property-type-mismatch`，仅 message 变）。既有测试无此断言，不构成回归。
3. **渲染类四函数的拒绝层次**：放在 impl 而非 parser/planner，走行级 `base/unsupported-feature`。理由：与既有「不支持的写法必须报诊断，不静默忽略」一致，且行级路径已成型；新增 `BaseUnsupportedError` 值域异常类，evaluator 的 `evalCall` catch 分支映射为 `BASE_RULES.unsupportedFeature`（既有 `BaseTypeError` → `propertyTypeMismatch` 分支不动）。
4. **`escapeHTML` 挂 `"string"` 组**（非 `"any"`）。理由：官方签名即 string 方法；`5.escapeHTML()` 得到「类型 number 不支持方法」是正确诊断，不该被 unsupported 掩盖。
5. **`max`/`min` 变长 number 参数（arity 1..∞），不接受单 list 参**。理由：官方签名 `max(...values)` 为变长数值；`containsAll` 那种「单 list 也收」的糖是 string/list 成员语义的历史包袱，不外扩。非 number 参 → 行级类型错误，不静默跳过。可逆：加一行归一即可放开。
6. **`slice`（string/list）对齐 JS `Array.prototype.slice` 语义**，含负索引与越界钳制；`start`/`end` 须为整数（小数/NaN/Infinity → 类型错误，不静默取整）。理由：官方文档未定义负索引，JS 语义是最可预期的默认；标注为自建口径待 oracle。
7. **`reverse`（string）按 Unicode code point 反转**（`[...s].reverse().join("")`），不按 UTF-16 code unit。理由：按 code unit 会拆坏代理对产生非法字符串。组合字符簇（家族 emoji / 变音符）仍会被拆——已知限制，注释存证。
8. **`replace` 为字面子串全局替换**（非 regex；替换文本内的 `$&` 等不作特殊解释）。理由：本仓 regex 整体延到片 4（BASE-SEC-004 需 ReDoS 防护）；用 `split(needle).join(rep)` 实现以避开 `String.replaceAll` 的 `$` 展开。空 needle → 类型错误（避免 JS「每字符间插入」的诡异行为）。
9. **`title` 为「按空白切词 + 词首大写 + 词余小写」**。理由：与主流 title-case 实现一致，确定性且字节稳定。官方精确口径未知，标注暂定待 oracle。
10. **`repeat(n)`**：`n` 须为非负整数；产物长度受 `maxStringLength` 约束——本仓无该预算键，改为复用 `maxCollectionItems` 作为字符数上限检查（`ctx.checkCollectionSize(结果长度)`）。理由：`"x".repeat(1e9)` 是典型资源耗尽面，必须有闸；不新增预算键以免扩大配置面。
11. **`number.isEmpty()` 恒 `false`**（number 永不为空）。`string.isEmpty()` = 长度 0。MISSING/null receiver 仍走既有「`any` 组查不到 → 返回 MISSING」口径，不在本片改动（属 BASE-PROP-004 待 oracle 面）。
12. **`toFixed(digits?)` 返回 string**（对齐 JS 与官方）；`digits` 缺省 0，须 0..100 内整数。理由：超出 JS `toFixed` 定义域会抛 RangeError，须在 impl 内前置拦成行级类型错误。
13. **`split(sep)` 返回 list**，产物元素数过 `ctx.checkCollectionSize`；空分隔符按 JS 语义逐 code unit 切（与 `reverse` 不同——此处保 JS 兼容，注释存证差异）。

### 用户拍板（2026-07-28）

14. **`random()` → 直接拒绝**（不注入种子、不放弃字节稳定）。进白名单但 impl 抛 `BaseUnsupportedError` → `base/unsupported-feature`，消息说明是**契约冲突**而非「不渲染」（测试用 `doesNotMatch(/渲染/)` 锁住两类拒绝理由不串）。理由：「同一 DB + 同一 `.base` + 同一注入 clock 重跑 `JSON.stringify` 全等」是 x-basalt 相对官方 CLI 最硬的卖点（官方实测连自己重放都不一致），不为一个叶子函数让路。注入种子的方案被否：数值必然与官方不同，oracle 阶段这条永远无法比对，还要把 seed 塞进 CLI/API 契约。可逆：改 impl 即可换方案。
15. **片 6 只做 `contextFile`**（BASE-CTX-001），另三项判「❌ 不做 + 诊断」：` ```base ` 代码块（CTX-002）、`![[View.base#Name]]` embed（CTX-003）、sidebar/active-file 语义（CTX-004）。理由：这三项本质是「在 Obsidian 界面里渲染」的形态，无头执行拿不到宿主上下文、产物无消费方；砍掉它们**省掉整个 parser 改动**（片 6 由此不再是「唯一动 parser 的一片」）。显式 `contextFile` 已覆盖可重复的 `this.*` 语义。

## 硬约束（每片自检）

- 不用 `eval`；属性名走白名单、不进 SQL 字符串。
- 只读，永不写回用户 vault（不改 `.base`、不写 `.obsidian/types.json`）。
- 输出恒带 `conformance` 标记；自有扩展必须在 `diagnostics` 里显式承认。
- **字节稳定**：同 DB + 同 `.base` + 同注入 clock 重跑，`JSON.stringify` 全等。
- 不复刻官方输出字节（官方列名是本地化显示名，随界面语言变，非稳定 schema）。
- 不支持的写法必须报诊断，不静默忽略。

## 非目标

- **oracle 校正**（9 项暂定语义）——用户已决定放到全部功能做完之后一次性做。
- **`base_query` / 动态 base**——另一条线，记在根 `TODO.md` 🧪 段。
- 为对齐官方复刻其输出格式。

## 验收口径

每片完成后必须：

1. `pnpm typecheck && pnpm lint && pnpm run format:check && pnpm test` 四门全绿；
2. 更新 `docs/design/bases-status.md` 状态表（日期 + 测试编号）；
3. 更新 `docs/use/bases.md` §3.6 函数全表；
4. 提交在 **main 分支**，提交信息不带任何小尾巴。

全部做完后本文件 `git mv` 进 `docs/history/plans/`，frontmatter `status` 改 `done`。

## Evidence

> 每片完成后回填：四门输出、测试编号、新增用例数。

### 片 1 ✅ 2026-07-28

**四门**（全绿）：`pnpm typecheck` 无输出 · `pnpm lint` 零 warning · `pnpm run format:check` "All matched files use the correct format" · `pnpm test` **838 pass / 0 fail**（基线 820，+18）。

**测试**：新增 `tests/base-functions-leaf.test.ts` 18 个用例，编号 BASE-EXPR-003（string 组 7 例）/ BASE-EXPR-004（list 组 2 例）/ BASE-EXPR-005（number 组 + global 5 例）/ BASE-SUM-001（round 迁组 1 例）+ 渲染类拒绝 2 例 + 注册表一致性 1 例。

**改动落点**：

| 文件 | 改动 |
| --- | --- |
| `src/base/expressions.ts` | `BASE_FUNCTION_NAMES` +16 名（12 个真函数 + 4 个渲染类） |
| `src/base/functions.ts` | `BaseFunctionReceiver` 加 `"number"`；+18 条注册项（16 函数 + 4 渲染 − 2 同名复用）；`round` 迁组；新增 `expectStringReceiver`/`expectNumberReceiver`/`expectInteger`/`expectNonNegativeInteger`/`extremumOf`/`sliceArgs`/`rejectRenderFunction` |
| `src/base/values.ts` | 新增 `BaseUnsupportedError`（与 `BaseTypeError` 分开，让「用错类型」与「本引擎不做」在诊断 rule 层可区分） |
| `src/base/evaluator.ts` | `receiverGroupOf` 返 `"number"`；`evalCall` catch 增 `BaseUnsupportedError` → `base/unsupported-feature` 分支；产物规模预算 message 兼顾 string 字符数 |

**实测到的两处非显然点**（已在代码注释存证）：

1. `String.replaceAll` 会把替换文本里的 `$&`/`$1` 当替换模式展开——用 `split(needle).join(rep)` 规避，测试 `"ab".replace("a", "$&z") == "$&zb"` 锁定。
2. `toFixed(digits)` 越出 JS 定义域 0..100 抛的是 `RangeError` 而非 `BaseTypeError`，会穿透行级错误通道变成引擎级异常——impl 内前置拦成行级类型错误。

**验证过的不变量**：`list.reverse()` 不原地改行上的 note 属性数组（测试断言 `row.note.items` 反转后仍为原序）——否则同一行被多个表达式读取时结果依赖求值顺序，直接破坏字节稳定。

**片一补充（用户拍板后同批落地）**：`random()` 按决策 #14 显式拒绝，复用渲染类同一机制但消息独立；测试 19 例（+1）。

### 片 2 ✅ 2026-07-28

**四门**（全绿）：typecheck / lint 零 warning / format:check / `pnpm test` **850 pass / 0 fail**（片一后基线 839，+11）。

**测试**：新增 `tests/base-functions-date.test.ts` 11 用例（BASE-TYPE-005 为主，`relative` 兼 BASE-FORM-006 的 clock 注入纪律）。

**改动落点**：`values.ts` 新增 `parseDurationLike` + `DAY_MS`；`functions.ts` 新增 `expectDateReceiver`/`dateFormatTokens`/`formatDateValue`/`relativeFromNow` 与 6 条注册项；`evaluator.ts` 的 `receiverGroupOf` 对 date 返 `"date"`（duration/link 仍返 null）；`expressions.ts` +5 名。

**实测到的非显然点**（代码注释 + 测试双存证）：`format` 若按「最长已知 token 优先」扫描，`MMMM` 会被贪婪切成 `MM`+`MM` **静默输出 `0808`**——用户写 `MMMM` 要的是月名，静默给错数字比报错糟得多。改为按**同字符最长游程**整体查表（moment 的真实 token 语法）后才落到正确诊断；测试用 `MMMM`/`dddd`/`DDDD`/`YYY` 四个游程锁定。

**口径变化（需下游知晓）**：`date()`/`duration()` 晚于本仓 2026-07-22 冻结快照，本片显式采纳——语法 §1.1 漂移记录、`docs/use/bases.md` 顶部「已知官方后续变动」表同步改写。duration 字符串形态**只在 `duration()` 入参处生效**，表达式字面量仍只认 `1day` 单 token；`%` 取模仍不采纳。

### 片 2 新增 Decision Log

16. **`duration()` 短单位大小写敏感**（`M`=month、`m`=minute，照官方），大写变体 `D`/`Y`/`W`/`H`/`S` 一律拒绝而非归一。理由：`M`/`m` 混淆是 30 天 vs 1 分钟的量级级错误，大小写归一等于把这个陷阱变成静默错误。
17. **`date(number)` / `duration(number)` 为自建扩展**：前者按 epoch 毫秒（与算术层 `wrapEpochForArith` 对 ctime/mtime 的口径一致），后者按毫秒（与 `toOutputValue` 输出 duration 为毫秒数互为逆，可往返）。
18. **`time()` 返回 duration 而非 `"HH:mm"` 字符串**。理由：duration 是既有类型，可比较（`t > 12hours`）、可算术；字符串需求由 `format("HH:mm")` 覆盖，不开两条路。暂定，待 oracle。
19. **`relative()` 固定英文**、固定阶梯（year=365d / month=30d 沿用值域既有约定），时间源恒为注入 clock。理由：官方该函数输出随界面语言变，本就不是稳定 schema（设计 §14 已声明不复刻本地化显示串）；固定串至少保证字节稳定。
20. **`format` 只做数字 token**，本地化 token 报错。理由同上，且「静默给一种语言」比报错更糟。

### 片 3 ✅ 2026-07-28

**四门**（全绿）：typecheck / lint 零 warning / format:check / `pnpm test` **858 pass / 0 fail**（片二后基线 850，+8）。

**测试**：新增 `tests/base-functions-link.test.ts` 8 用例（BASE-FILE-001/005、BASE-TYPE-006 + 文法零回归专项 + 无解析器语境）。

**改动落点**：`parser.ts` 的 `rootRef` 增「根 token 后随 `(` → 全局调用」分支；`source.ts` 新增 `createFileResolver`（按需建三级索引）；`evaluator.ts` 的 `EvalContext`/`EvalState`/`fnCtx` 增 `resolveFile`；`engine.ts` 每次查询建一个解析器注入行求值上下文（**有意不注入自定义汇总语境**）；`functions.ts` +5 条注册项 + `matchesAnyLink` 提取（`hasLink`/`linksTo` 共用，防口径分叉）。

**⚠ 计划外的文法改动**：原以为片六是唯一动 parser 的一片，实际本片先动了——`file` 是关键字 token，`file(...)` 此前直接给「Expecting EOF but found '('」这种与用户意图无关的语法错误。改动被限制在 `rootRef` 一条规则内，并有「既有根引用形态零回归」专项用例。

**实测到的两处非显然点**（代码注释 + 测试双存证）：

1. **`file.linksTo(file("Beta"))` 起初返回 false**：Alpha 里写的是 bare `[[Beta]]`，而 `file("Beta").path` 是 `Projects/Beta.md`；文本匹配时目标含 `/` 会进 qualified 分支比 `pathKey`（`"beta"` ≠ `"projects/beta"`），明明链上了却判否。定为**两种入参两种语义**：string/link = 文本目标（同 `hasLink`），file = 那个具体文件（把每条出链解析一遍比解析后的 path）。
2. **chevrotain 规则必须单出口**：`rootRef` 里按 `callArgs` 提前 `return`，会让后半段属性路径 `OPTION` 永远不被录进语法（**录制阶段会真的执行 OPTION 的 DEF**，`callArgs` 被赋成 dummy 值 → 提前 return 生效），运行期 `file.name` 直接抛 `Cannot read properties of undefined (reading 'call')`。

### 片 3 新增 Decision Log

21. **`file()` 只在当前查询行集内解析**，不查库、不碰文件系统。理由：行集已在内存（零额外 IO），且语义自洽——`file()` 看得见的与查询数据集口径一致（markdown 模式解析不到附件，all-files 才能）。同键多文件取 path 升序第一个（行集本就 path ASC，「首次写入者胜」），不用「最近修改优先」这类会漂的规则。
22. **`file()` 解析不到 → MISSING；`link()` 悬空 → 合法 link 值**。两种口径有意不同：file 是「找一个存在的东西」，link 是「记一个指向」——wikilink 本就允许悬空。
23. **无解析器语境报 `unsupported-feature` 而非静默 MISSING**。唯一触发点是自定义汇总的 `values` 作用域（禁止访问行外状态）；静默 MISSING 会让用户以为「文件不存在」，而实际是「这里不许查」。

### 片 4 ✅ 2026-07-28（BASE-SEC-004）

**四门**（全绿）：typecheck / lint 零 warning / format:check / `pnpm test` **866 pass / 0 fail**（片三后基线 858，+8）。

**测试**：新增 `tests/base-functions-regex.test.ts` 8 用例。**改动落点**：新增 `src/base/regexp.ts`；`errors.ts` 追加 rule `base/invalid-regex`；`evaluator.ts` 的 `evalCall` catch 增一条映射分支；`functions.ts` +1 条注册项。

**关键取舍**：`matches` 的 pattern 是**字符串**，正则**字面量** `/…/` 继续在文法层拒绝——语法 §4.3 的「regex literal【P2 最后评估】」由此翻为「不做」（字面量形态要给文法层再加一套转义规则，收益不抵成本）。

### 片 4 新增 Decision Log

24. **ReDoS 三层防护，缺一不可**。JS 正则无超时机制，单靠任何一层都不够：①静态拒绝只挡经典形态（判据 = 无界量词作用于分组且分组体内含无界量词或顶层交替），是**充分不必要**条件；②限长让指数回溯没有足够输入触发；③有界缓存避免逐行重复编译成为新的开销面。根治需 re2 类线性引擎（外部依赖），本片不引入。
25. **静态判据刻意保守**：只在**外层量词无界**时才查分组体，于是 `(\d+)?`（外层 `?` 有上界）、`(foo)+`（体内无量词无交替）、`[a-z]+@[a-z]+`（量词不作用于分组）全部放行。过度激进会把常用正则误杀，那比不做防护更糟——放行集合有专项用例锁定。
26. **反向引用一律拒绝**（`\1`/`\k<name>`）：强制回溯且与量词组合极易指数化。检测前先剥掉成对转义，避免把「转义反斜杠 + 字面数字」误判成反向引用。
27. **非法正则报诊断而非静默不匹配**——与 DQL 侧 `regexmatch` 有意不同。那边在 SQLite 自定义函数内不便产诊断，只能降级为 0；Bases 侧的硬约束是「不支持/不合法的写法必须报诊断」，故新增专用 rule `base/invalid-regex`（而不是复用 `property-type-mismatch`：「正则写错了」和「值类型不对」是两类完全不同的修法）。

### 片 5 ✅ 2026-07-28（GROUP-002 + SUM-002 收口）

**四门**（全绿）：typecheck / lint 零 warning / format:check / `pnpm test` **870 pass / 0 fail**（片四后基线 866，+4）。

**测试**：`tests/base-group-summary.test.ts` +4 用例（共 22）；fixture `views/group-list.base` 由「list 分组键拒绝场景」改写为五个 view（扇出 / 跨行重叠 / 行内重复去重 / 空 list / link 标量键）。**未新增笔记 fixture**——改用 `list(status, area)`、`link(status)` 这类表达式分组键，避免动 vault 行数把其它测试的断言带偏。

**改动落点**：`engine.ts` 的分桶段（扇出 + 行内去重 + 空 list → MISSING）、新增 `groupKeyCompare`、`BaseQueryResult.groups` 契约扩写（含扇出警告与 `summaries?`）、summaries 段追加组级汇总。

### 片 5 新增 Decision Log

28. **list 分组键取「扇出」而非「整个 list 当一个复合键」**。理由：`groupBy: tags` 想要的就是「一篇多标签笔记出现在每个标签下」；复合键会把 `[a,b]` 和 `[b,a]` 分成两组，几乎没有可用场景。代价是**组内行数之和 ≥ `rows.length`**——这条写进了 `BaseQueryResult.groups` 契约与 use 文档，需要「每行恰好一次」的读出方用顶层 `rows`（其平铺行为完全不变，向后兼容）。暂定口径，待 oracle。
29. **link 是标量键，不扇出**。此前实现把 list 与 link 一并拒绝，容易让人以为 link 也是多值；实际它是单个值，按路径感知相等分组即可。
30. **新增 `groupKeyCompare` 而不是复用 `sortKeyCompare`**。后者对 link **抛类型错误**（link 无排序语义，那是正确的排序口径）；而分组只需要一个**确定性**组序，不需要语义序。故 link 之间按归一 `path`+`subpath` 字典序，整体序为「可比标量 < link < null/MISSING」——空值恒最后的既有口径不被 link 插队。
31. **组级汇总 `groups[].summaries` 的计算集 = 该组 limit 后的行**，与顶层 summaries 的「filter 后 **limit 前**全量」有意不同。理由：组本身就建立在 limit 后行集上，用 limit 前的集合去配 limit 后的组，会给出「组里看不见的行也算进了汇总」的怪结果。**这是对 P2b 决策的显式反转**（当时判「组级汇总属官方 UI 形态，无头 JSON 暂不做」）：片五后 groups 成为一等产物，有组没有组的汇总是半个功能。

### 片 6 ✅ 2026-07-28（BASE-CTX-001；CTX-002/003/004 ❌ 不做 + 诊断）

**四门**（全绿）：typecheck / lint 零 warning / format:check / `pnpm test` **880 pass / 0 fail**（片五后基线 870，+10）。

**测试**：新增 `tests/base-context.test.ts` 10 用例 + fixture `views/context.base`。

**改动落点**：`evaluator.ts` 新增 `evalNoteKey`（`note.<key>` 与 `this.<key>` 共用，防升级链分叉）与 `requireContextRow`，`EvalContext.contextRow` 打通；`engine.ts` 依 `contextFile` 在行集内解析上下文行并注入行求值/公式上下文，新增 `checkEntryForm` 入口形态检查；`cli.ts` 增 `--context-file`。**未动 parser**——拍板缩范围后这一片确实不需要文法改动（真正动 parser 的是片三的 `file(...)`）。

### 片 6 新增 Decision Log

32. **contextFile 复用 `file(path)` 的解析器**，不造第二套路径口径。于是「`--context-file` 能指到的」与「`file()` 能解析到的」永远是同一集合；完整路径 / 去扩展名 / bare basename 三种写法等价（专项用例）。
33. **给了 contextFile 却解析不到 → error + 空结果**，不静默当没给。静默会让后续 `this.*` 抛出「需要显式上下文」这条**误导性**诊断——用户明明给了。
34. **CTX-002/003 的诊断放在「读文件之前」的入口形态检查**，只看路径形态不读内容。否则把 `.md` 当 `.base` 传进来只会得到一句 YAML 解析失败，与用户意图完全无关；现在得到的是「不做 + 为什么 + 该怎么写」，`#锚点` 那条还直接给出可照抄的 `--view` 命令。
35. **自定义汇总的 `values` 作用域不注入 contextRow**：与 note/file 属性、`file()` 解析器同一条「禁止访问行外状态」原则，三者口径一致。

## 收口结论（2026-07-28）

- **注册表条目 35 → 68**：63 条可执行 + 5 条白名单内显式拒绝（`escapeHTML`/`html`/`image`/`icon` 渲染类、`random` 字节稳定冲突）。以本仓注册表口径计约 **93%**；与官方清单逐条对齐属 oracle 阶段的事，此处不声称。
- **新增分派组 3 个**：`number`（片一）、`date`（片二）、`link`（片三）。
- **新增诊断 rule 1 条**：`base/invalid-regex`（片四）。
- **契约扩展**：`groups[].summaries`（片五）、`BaseQueryOptions.contextFile` 起效 + CLI `--context-file`（片六）。
- **文法改动 1 处**：`rootRef` 支持 `file(...)` 调用形态（片三，非计划内——原以为片六才动 parser）。
- **四门**：typecheck / lint / format:check / test **880**（基线 820，+60）。
- **遗留**：本轮新增的自建口径（`title`、`slice` 负索引、`replace` 字面替换、`time()` 返 duration、`relative()` 固定英文、`format` token 子集、list 分组扇出、组级汇总计算集…）全部标注「暂定，待 oracle」，逐条见实现状态追踪 §6 各片明细。

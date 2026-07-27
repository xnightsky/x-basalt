---
type: plan
status: in-progress
title: Bases 函数覆盖率计划（51% → ~90%）
description: 官方 68 个函数条目中未实现的 33 个分六片补齐——机械叶子函数、Date/Duration 族、Link/File 互转、regex+ReDoS、list 分组键、contextFile 上下文
tags:
  - plan
  - bases
  - functions
  - x-basalt
timestamp: 2026-07-27T18:56:15Z
sha256: 65ac6ab981f1b770a6f327851c6abd3ad6e860b1596203ef1ffcc68f83d6dff8
---
# 计划：Bases 函数覆盖率（51% → ~90%）

> 2026-07-28 · 来源：用户目标「把 Bases 函数覆盖率从 51% 推到 ~90%」。
> 语法真相源：[`../design/bases-syntax.md`](../design/bases-syntax.md) §4.4；实现状态 living 文档：[`../design/bases-status.md`](../design/bases-status.md)；使用者全表：[`../use/bases.md`](../use/bases.md) §3.6。
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
| 1 | 机械叶子函数 16 个 + 4 个渲染类拒绝 + `round` 归组 | 新增 receiver 组 `number` | ⏳ |
| 2 | Date/Duration 族 6 个（`date()`/`duration()`/`format`/`time`/`relative`/`isEmpty`） | 新增 receiver 组 `date`，扩 duration 格式化 | ⏳ |
| 3 | Link/File 互转 5 个（`asFile`/`linksTo`/`asLink`/`file()`/`link()`） | links 表接线 | ⏳ |
| 4 | `matches`（regex）+ ReDoS 防护（BASE-SEC-004） | 正则执行预算 | ⏳ |
| 5 | BASE-GROUP-002（list/link 分组键）+ BASE-SUM-002 收口 | engine 分组层 | ⏳ |
| 6 | BASE-CTX-001..004（`contextFile`/`this`、` ```base ` 代码块、embed） | **唯一动 parser 的一片**，开工前须用户拍板范围 | ⏳ |

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

### 待用户拍板

- **`random()` × 字节稳定**：官方有 `random()`，与本仓「同 DB + 同 `.base` + 同注入 clock 重跑 `JSON.stringify` 全等」的硬保证直接冲突。三选一：注入种子 / 直接拒绝 / 放弃字节稳定。**片 1 尾声问用户**。
- **片 6 范围**：完整做（含 ` ```base ` 代码块与 `![[View.base#Name]]` embed，须改 parser）还是只做 `contextFile`、另三项判「不做 + 诊断」。**片 6 开工前问用户**。

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

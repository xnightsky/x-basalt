---
type: testing
title: Bases P1 争议语义官方 oracle 操作手册
description: 二十六项暂定口径的官方串行 oracle 手册：fixture vault、26 个 view 逐步执行、观察记录表与校正工作流；2026-07-28 起状态为 ⏸ 暂缓执行（官方文档不覆盖、官方 API 不暴露求值引擎、Bases 仍在快速演进），等官方后续实现情况再解冻
tags:
  - testing
  - bases
  - oracle
  - conformance
timestamp: 2026-07-28T02:54:35Z
sha256: 6c33987d2c571dbfdf154ba4f1f2f05882ec4cfee6e9ba4e55d69f2a81df9c96
---
# Bases P1 争议语义官方 oracle 操作手册（runbook）

> 2026-07-27 · 协议真相源：[`2026-07-22-bases-scenario-matrix.md`](bases-scenarios.md) §8（本手册是其逐步具体化，不替代协议）。
> 用途：把 P1 四项「暂定口径」一次跑完官方串行 oracle，校正 x-basalt 语义与锁定测试。
> **执行者：用户侧人工**（官方 `base:query` 依赖 Obsidian GUI；项目硬约束禁 GUI 自动化，本手册全部步骤只能人工串行执行）。

## 0. 状态：⏸ 暂缓执行（2026-07-28 冻结）

**决策：本手册暂不实施，全部暂定口径维持现状，等官方后续实现情况再定。** 下方 §2..§5 的步骤保持可用但不启动。

调研依据（2026-07-28）：

1. **官方文档不覆盖。** 官方 [`obsidian-help/en/Bases/Bases syntax.md`](https://github.com/obsidianmd/obsidian-help/blob/master/en/Bases/Bases%20syntax.md) 对本手册 §1 的八类争议只明确了一类——「frontmatter 中的 wikilink 自动识别为 Link 对象」「link 与 file/this 比较时，解析到同一文件即相等」（对应 ⑥，与 x-basalt 暂定口径一致）。truthiness、null 排序位、`if()` 惰性、空 filter 数组、date/datetime 跨精度比较、list 分组键、自定义 summary `values` 边界——**七类只字未提**，官方文档本身就没有可引用的口径。
2. **官方 API 不提供取证路径。** `obsidian-api` 的 Bases 面（`BasesView` / `BasesQueryResult` / `BasesEntry` / `Value` 家族）只暴露**渲染入口与已算好的结果**：filter/formula/sort 在 `BasesConfigFile` 里是不透明字符串，求值引擎（truthiness、比较、排序、`if` 分支）不对外。唯一贴边的钩子是 `NotNullValue.isTruthy()`，但它只在插件运行时里存在，仍然绕不开 App。**结论：本手册「只能人工串行跑 GUI」的前提没有被新 API 松动。**
3. **官方仍在快速变动，现在冻结的收益会被作废。** Bases 自 1.9.2 改过语法与文件格式；1.10.0 才加入 `group by`、表格 summaries 与首版 Bases API；1.10.3 又补 `reduce()`/`mean()`/`stddev()`/`median()`/`html()`；到 1.12.4 / 1.13.0 仍在改 Bases 行为与 API（`BaseOption#shouldHide` 是破坏性变更）。**在一个仍在加语义的目标上人工跑 26 个 view 冻结强结论，成本高且随时可能被下个版本推翻。**

解冻触发条件（满足任一即重启本手册）：

- 官方发布覆盖上述语义的规范文档或参考实现；
- 官方提供无需 GUI 的查询入口（CLI / 可脚本化 API）；
- dogfood 中出现**由某条暂定口径直接导致的错误结果**（此时只针对该条做定点 oracle，不必全量跑）。

## 1. 待冻结语义与 x-basalt 暂定口径

| # | 争议语义 | 场景编号 | x-basalt P1 暂定口径 | oracle fixture |
| --- | --- | --- | --- | --- |
| ① | missing/null/空串/0/false/空列表 truthiness 与 == 合并 | BASE-PROP-004 | falsy = MISSING/null/false/0/""/空列表；`missing == null` 为 false | `views/truthiness.base`（8 个 view） |
| ② | 多键 sort 的 null/missing 位置 | BASE-RESULT-002 | null/missing 恒排最后（与方向无关） | `views/sort-null.base`（ASC/DESC 各一） |
| ③ | `if()` lazy branch | 设计 §9 | lazy：只计算被选择分支 | `views/if-lazy.base`（2 个 view） |
| ④ | 空 filter 数组 and/or/not | 设计 §6 | P1 拒绝（`base/unsupported-feature`） | `views/empty-filter.base`（3 个 view） |
| ⑤ | date vs datetime 跨精度比较 | BASE-TYPE-005 | 统一按 UTC epoch 比较（P2a 落地） | `views/types.base`（date-eq-literal / date-lt-datetime / datetime-lt-date） |
| ⑥ | frontmatter wikilink → Link 值与相等 | BASE-TYPE-006 | `[[t]]`/`[[t\|d]]`/`[[t#sub]]` → Link value，按 path+subpath 相等（P2a 落地） | `views/types.base`（link-eq-wikilink / link-projection） |
| ⑦ | list/tag 分组键一行多组 | BASE-GROUP-002 | **扇出**：一行进入其每个元素的组；行内元素先去重、空 list 视同 MISSING 键（2026-07-28 覆盖率片五落地，此前为暂定拒绝） | `views/group-summary.base`（group-by-tags / group-by-list-prop） |
| ⑧ | 自定义 summary 的 `values` 边界（空值剔除 / limit 前后） | BASE-SUM-002 | 暂定剔除 null/missing、按 limit 前全量（P2b 落地） | `views/group-summary.base`（summary-custom / summary-custom-limited） |
| ⑨ | 字符串→日期推断是否作用于 `+`（拼接语境） | 语法 §5.1 / 设计 §8.3 | 推断对全部非短路二元运算生效，故 `due + " 备注"` 报行级类型错误而非拼接（2026-07-27 review 登记） | `views/types.base`（concat-plain-string 对照 / concat-date-string） |

### 1.1 2026-07-28 函数覆盖率批次新增的暂定口径（⑩ 起）

> 这批**没有现成 fixture view**——写 fixture 属 oracle 阶段的工作，本轮功能补齐未做。
> 逐条实现细节见[实现状态追踪 §6](bases-status.md) 各片明细；跑 oracle 前需先为下表补 view。

| # | 暂定口径 | 出处 |
| --- | --- | --- |
| ⑩ | `string.title()` = 按空白切词 + 词首大写 + 词余小写 | 片一 |
| ⑪ | `slice(start, end?)`（string/list）负索引与越界钳制沿用 JS 语义 | 片一 |
| ⑫ | `replace(a, b)` 为**字面子串全局替换**（非 regex，`$&` 不展开，空串报错） | 片一 |
| ⑬ | `reverse()`（string）按 code point 反转（字素簇仍会拆） | 片一 |
| ⑭ | `number.isEmpty()` / `date.isEmpty()` 恒 false | 片一/片二 |
| ⑮ | `date.time()` 返回**当日 UTC 零点起的 duration**（而非 `"HH:mm"` 字符串） | 片二 |
| ⑯ | `date.format()` 只做数字 token，本地化 token 报错；同字符游程分词 | 片二 |
| ⑰ | `date.relative()` 固定英文 + 固定阶梯（month=30d / year=365d） | 片二 |
| ⑱ | `date(number)` 按 epoch 毫秒、`duration(number)` 按毫秒（自建扩展） | 片二 |
| ⑲ | `file(path)` 只在**当前查询行集**内解析；同键多文件取 path 升序第一个 | 片三 |
| ⑳ | `linksTo(file 值)` 走解析、`linksTo(string/link)` 走文本匹配 | 片三 |
| ㉑ | `matches` 的 ReDoS 静态判据（哪些正则被拒）与「非法即报诊断」 | 片四 |
| ㉒ | 组级汇总 `groups[].summaries` 计算集 = 该组 **limit 后**的行 | 片五 |
| ㉓ | 分组键组序：可比标量 < link < null/MISSING | 片五 |

### 1.2 2026-07-28 调研补登记：此前漏登的暂定口径（㉔ 起）

> 这三条在源码注释里已自认「官方未明示/官方未定义」，但**从未进入本手册的观察清单**——即本手册 §1 此前并非争议全集。
> 同样无 fixture view。

| # | 暂定口径 | 落点 |
| --- | --- | --- |
| ㉔ | `Median` 汇总：偶数个样本取中间两值的**均值**（而非取下中位） | `src/base/summaries.ts:118` |
| ㉕ | `Stddev` 汇总：取**总体**标准差（÷n），非样本标准差（÷(n−1)） | `src/base/summaries.ts:128` |
| ㉖ | Duration 的 `month` = 30 day、`year` = 365 day 固定换算，作用于**全部 duration 算术**（非仅 `date.relative()`）——⑰ 只登记了 `relative()` 的阶梯，登记面窄于实际影响面 | `src/base/values.ts:144` |

**fixture 缺口合计：⑩..㉖ 共 17 条无 view**；现有 26 个 view 只覆盖 ①..⑨。

## 2. 前置（一次性）

1. 记录 Obsidian installer 与 App 版本：`__________`（填入观察表）。
2. 把 `tests/fixtures/bases/oracle/` **整个目录复制为独立 vault**（不用日常 vault；确认无社区插件、无其他 .base）。
3. 记录 fixture hash（在仓库根执行，填入观察表）：
   - `git hash-object tests/fixtures/bases/oracle/views/*.base tests/fixtures/bases/oracle/notes/*.md`
4. 预先启动 Obsidian 打开该 vault，**确认索引完成**（状态栏无 indexing 提示）。

## 3. 串行执行（逐 view，不并发）

对每个 `.base` 的**每个 view** 依次执行（串行、不让命令负责拉起 GUI）：

1. 运行 `base:query`（view 名见下表），保存：原始 JSON、stderr、退出码。
2. 每个 view **连跑两次**，确认结果一致；不一致即标 `implementation-defined`（协议 §8 第 7 条，不得靠单次观察冻结强结论）。

view 清单（26 个）：truthiness.base × 8（truthy-missing / truthy-explicit-null / truthy-empty-string / truthy-zero / truthy-false / truthy-empty-list / eq-missing-null / eq-explicit-null-null）、sort-null.base × 2（sort-asc / sort-desc）、if-lazy.base × 2（if-lazy / if-lazy-false-branch）、empty-filter.base × 3（empty-and / empty-or / empty-not）、types.base × 7（date-eq-literal / date-lt-datetime / datetime-lt-date / link-eq-wikilink / link-projection，P2a 新增；concat-plain-string / concat-date-string，2026-07-27 review 新增；样本 CaseE）、group-summary.base × 4（group-by-tags / group-by-list-prop / summary-custom / summary-custom-limited，P2b 新增，样本 CaseF 与 CaseB/C）。

## 4. 观察记录表（跑完逐项填写）

### ① truthiness / equality（样本：CaseA 六形态显式值；CaseB/C 这些属性缺失；CaseD 全缺）

| view | 官方命中行（file.name 列表） | 两次一致？ | 结论（truthy? == 合并?） |
| --- | --- | --- | --- |
| truthy-missing | | | |
| truthy-explicit-null | | | |
| truthy-empty-string | | | |
| truthy-zero | | | |
| truthy-false | | | |
| truthy-empty-list | | | |
| eq-missing-null | | | |
| eq-explicit-null-null | | | |

### ② null 排序位置（CaseA sortable=null、CaseB=1、CaseC=2、CaseD 缺失）

| view | 官方行序（file.name 顺序） | 两次一致？ | 结论（null/missing 位置） |
| --- | --- | --- | --- |
| sort-asc | | | |
| sort-desc | | | |

### ③ if() lazy

| view | 官方结果/错误 | 两次一致？ | 结论（lazy? eager 污染形态） |
| --- | --- | --- | --- |
| if-lazy | | | |
| if-lazy-false-branch | | | |

### ④ 空 filter 数组

| view | 官方命中行数/错误 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| empty-and | | | |
| empty-or | | | |
| empty-not | | | |

### ⑤⑥ date/datetime 比较与 wikilink → Link（P2a 新增，样本 CaseE）

| view | 官方结果 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| date-eq-literal | | | |
| date-lt-datetime | | | |
| datetime-lt-date | | | |
| link-eq-wikilink | | | |
| link-projection | | | |

### ⑦⑧ list 分组键与自定义 summary values（P2b 新增，样本 CaseF / CaseB/C）

| view | 官方结果 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| group-by-tags | | | |
| group-by-list-prop | | | |
| summary-custom | | | |
| summary-custom-limited | | | |

### ⑨ 拼接语境下的日期推断（2026-07-27 review 新增，样本 CaseE：due="2026-07-27"、label="报告"）

> 读法：`concat-plain-string` 先验证官方 string+string 拼接可用；在此前提下，
> `concat-date-string` 出错 ⇒ 官方拼接语境**同样**做日期推断（x-basalt 暂定口径正确）；
> 得到 `"2026-07-27 备注"` ⇒ 官方在拼接语境**抑制**推断，需按官方收窄 `upgradeStringOperand`。

| view | 官方结果 | 两次一致？ | 结论 |
| --- | --- | --- | --- |
| concat-plain-string | | | |
| concat-date-string | | | |

## 5. 校正工作流（拿到结论后）

1. 定位需改写的锁定测试（全部带「待 oracle」标注）：
   - `rg -n "oracle" tests/base-evaluator.test.ts tests/base-engine.test.ts`
   - 语义实现落点：`src/base/values.ts`（truthiness/equality/sortKeyCompare）、`src/base/evaluator.ts`（if lazy、`upgradeStringOperand` 拼接语境推断）、`src/base/planner.ts`（空数组拒绝）。
2. 按官方结论改写实现与测试，**删除对应「待 oracle」标注**，状态文档 [`2026-07-26-bases-implementation-status.md`](bases-status.md) §3 对应行翻 ✅。
3. 若某 view 两次结果不一致 → 该语义标 `implementation-defined`：x-basalt 维持暂定口径并注释「官方不稳定」，测试只锁定 x-basalt 自一致性。
4. 原始 JSON/stderr/版本/hash 随校正提交一并留存（放 `docs/history/oracle/` 新建日期目录）。

## 6. 红线

- 原始 App 输出**不是** x-basalt 公共 API；结论必须人工审查后才转期望快照。
- oracle 跑不通（官方 CLI 拉起失败/输出不稳定）时，不猜测补齐——维持暂定口径，状态文档保持 ⏸。

# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。已完成的不堆这——见 git log、`docs/plans/`、`docs/specs/`。


## 🔥 2026-07-22 Obsidian Bases 无头执行引擎（下一核心优先级）

方向已完成调研、场景矩阵与实现前设计冻结：

- 调研：[`docs/research/2026-07-22-obsidian-bases-headless-engine-research.md`](./docs/history/research/2026-07-22-obsidian-bases-headless-engine-research.md)
- 场景：[`docs/testing/2026-07-22-bases-scenario-matrix.md`](./docs/design/bases-scenarios.md)
- 规范：[`docs/specs/2026-07-22-bases-headless-engine-design.md`](./docs/design/bases-engine.md)
- 语法真相源：[`docs/specs/2026-07-26-bases-syntax.md`](./docs/design/bases-syntax.md)
- 实现状态追踪（living，逐项标记）：[`docs/testing/2026-07-26-bases-implementation-status.md`](./docs/design/bases-status.md)

定位：实现真正无 GUI、无 Obsidian 运行时的 `.base` 查询库层；官方 `base:query` 只作串行语义 oracle，不进入运行时依赖。首期明确为 **Bases Markdown conformance 2026-07**，不冒充 all-files 完整兼容。

> **下一步（2026-07-28 收口后）**：P0/P1/P2a/P2b/P3a、review 修复、**函数覆盖率六片**全部落地，四门（typecheck / lint / format / test **892**）皆绿。功能面已无明显缺口。
>
> **2026-07-28 下午：oracle 取证完成，①..⑨ 不再是「没与官方比对过」。** 26 个 view 全部跑完（Obsidian 1.12.7，两次一致），**19 一致 / 7 分歧**。同日上午的「整体暂缓」决策当天被推翻——取证可脚本化，绕不开 App 但绕得开人。
>
> **2026-07-28 晚：校正轮第一批落地 + 第二批出决策。** ①②④ 已改实现 + 回归用例（各一个提交），复跑对照 **分歧 7 → 2、无新增**；⑦⑨㉗ 决定不跟、落 documented boundary（[vs-official §5](./docs/design/bases-vs-official.md)）。
>
> **2026-07-29：把「不需要 Obsidian 就能做的」全部做完（test 892 → 893）。** ⑧(b) 计算集改 limit 后已落地（顺带统一顶层/组级口径、消掉重复求值与重复诊断）；取证脚本的 `groups` 读取路径已修（首轮 26 个 view 全采成空，且是静默的）+ 加离线自检；⑩..㉖ 的 fixture 补齐 **12 个 view 覆盖 16 条**（㉑ 判定不可取证）。
>
> **现在只剩一个动作：开一次 Obsidian 跑第二轮取证。** 一次跑完可同时定夺 ⑧(a)、⑩..⑳㉒..㉖ 共 16 条、以及 ⑦ 的分组内容与组序。

- [x] **P0 · document/schema/diagnostic**：`.base` YAML + view 选择 + filter 结构校验 + expression source span；先完成 `BASE-DOC-001..009`。计划：[`docs/plans/2026-07-26-bases-p0-document-schema.md`](./docs/history/plans/2026-07-26-bases-p0-document-schema.md)（2026-07-26 落地，含 SEC-007/008）
- [x] **P1 · Markdown query vertical slice**：独立 Bases AST/evaluator，支持 global+view filters、note/file properties、常用 file/string/list 方法、order/sort/limit 与稳定 JSON；不复用 DQL AST，不用 `eval`。计划：[`docs/plans/2026-07-26-bases-p1-markdown-query.md`](./docs/history/plans/2026-07-26-bases-p1-markdown-query.md)（2026-07-26 落地，含 SEC-001/002/003/009 与字节稳定；oracle 冻结项为暂定口径）
- [x] **P1 收口 · CLI 薄出口 + guides**：`x-basalt base` 命令（JSON 契约、error 诊断 exit 1）+ `guides/querying-bases.md`。计划：[`docs/plans/2026-07-27-bases-cli-export.md`](./docs/history/plans/2026-07-27-bases-cli-export.md)（2026-07-27 落地）
- [x] **P1 oracle · 官方差分取证（2026-07-28 完成）**：26 个 view 全部跑完，Obsidian 1.12.7，每个 view 连跑两次全部一致（无 `implementation-defined`）。**19 一致 / 7 分歧**，结论见 [runbook §4](./docs/design/bases-oracle-runbook.md)。原始观察数据由取证侧留档，不入本仓。
  - **同日上午的「⏸ 整体暂缓」决策已被推翻**。当时的三条依据里两条不成立：「官方 API 只暴露算好的结果」恰恰是充分条件（oracle 要的就是「官方算出什么行」，不需要求值引擎内部）；「仍在演进故冻结易作废」被消解（取证是脚本，升级后重跑即可）。准确表述是**绕不开 Obsidian App 进程，但绕得开人**——原判断把「需要 App」误推成「需要人逐个点」，成本估计差了一个数量级。复盘见 [runbook §0.1](./docs/design/bases-oracle-runbook.md)。
  - **取证路径**：官方 CLI 的 `eval` 读 Bases 内部对象（`controller.selectView` 切 view、`controller.view.rows` 取最终行集、`footerSummary` 取汇总）。官方那个 `base:query` 命令**吐不出结果**，不能用。三个会静默产出错误数据的坑见 [runbook §0.2](./docs/design/bases-oracle-runbook.md)。
- [x] **oracle 校正 · 第一批三条（结论明确，2026-07-28 落地）**：一条分歧一个提交，四门全绿（test **892**，基线 889）。
  - **① equality：MISSING 与 null 合并**（跟官方）——影响任何 `== null` / `!= null` 的 filter，是七条里唯一**静默改变行集且无提示**的一类。合并落在 `typedEqual`（值域唯一的相等语义），故分组分桶 / `unique()` / `contains()` 一并生效；`isType("null")` 有意不跟随。DQL 侧 `WHERE field = null` 是另一套语义，一行未动。
  - **② sort DESC 时空值排到了最前**（当 bug 修，非选择题）——本仓登记口径与官方同为「恒排最后、与方向无关」，是 engine 用 `-sortKeyCompare()` 实现 DESC 把空值组的排名差一起翻转了。新增 `sortKeyCompareDirected(a,b,direction)` 作为带方向的唯一入口。
  - **④ 空 filter 数组**（跟官方）——`and:[]`=真 / `or:[]`=假 / `not:[]`=真。原来的「P1 拒绝」不是语义主张而是「没裁判先不猜」的占位；求值侧 `every`/`some` 天然给出这三个默认值，只删掉了 planner 的拒绝分支。⚠️ `or:[]` 前后都是 0 行但成因不同（拒绝返回空 → 恒假），用例额外断言无 error 诊断。
  - **复跑对照**：`parity/bases-oracle-diff.mjs`（读冻结的官方观察记录，**不需要 Obsidian 在跑**，只需 `pnpm build`）→ 一致 24 / 分歧 2 / 共 26，**7 → 2 且无新增**。局限：只比行集不比列值，覆盖不到 ⑧⑨。
- [x] **oracle 校正 · 第二批四条出决策（2026-07-28）**：理由逐条写进 [vs-official §5](./docs/design/bases-vs-official.md)，不接受「有意差异」这种无理由的记法。⑦ 顶层行序**不跟**（本轮只测到行序、官方分组内容与组序**根本没测到**——观察记录的 `groups` 字段是坏的；且会牺牲字节稳定契约）；⑨ `+` 拼接**保留超集**（官方那里是静默的空，砍掉纯亏）；㉗ 默认数据集**不改**（差异恒发 warning 不静默；官方读数没证明附件也是行）；⑧ **跟官方**但实现待落 ↓
- [ ] **oracle 校正 · ⑧ summary `values` 两个维度（决策已出：跟官方；(b) ✅ 已落，(a) 待前置取证）**
  - [x] **(b) 计算集改为 limit 后（2026-07-29 落地，test 892 → 893）**：`engine.ts` 顶层 summaries 由 `filtered` 换 `limited`，锁定用例 `limitBefore` 翻为 `limitAfter`（sort score ASC + limit 2 → Sum=30，与旧口径 60、与「只取首行」10 三者互不相等）。**breaking**：带 `limit` 的 view，内置汇总读数会变。两项顺带收益：①顶层与组级口径统一，消掉本仓自己的不一致；②两处原本各自对同一行集求值一遍，现共用一份 `perRowValues`——省一轮求值预算并消掉「同一行错误推两条重复诊断」（`pushRowDiagnostic` 不去重）。新增用例锁定该收益。
  - **(a) 空值计入分母 —— 有硬前置，先取证再动手**：不能只改 `values` 的作用域。`values` 一旦含空值，`values.mean()` 立刻报类型错误（`list.mean()` 要求元素全为 number）；要复现官方的 `0.25`，必须**同时把通用函数 `list.mean()` 改成「非 number 不计分子、计分母」**，而官方从没给过它在混合列表上的读数。**前置：补 view 观察官方 `list(1, 2, null).mean()`**，确认机制再动。不靠猜改通用函数。
    - **⚠️ 补这个 view 时绝不能新建 `.base` 文件**——官方默认数据集把 `.base` 自身也算作行，多一个文件，26 个 view 的行数全从 12 变 13，**既有观察记录当场全作废**。必须把新 view 加进**已有的** `.base`（如 `types.base`）：文件数不变、既有行集不动，重跑还顺带当一次回归。（这也是 ⑩..㉖ 补 view 时的通用约束，见下条。）
    - **这一步决定性、不会白跑**——两个结果都能把「改不改、怎么改」钉死：
      - 官方给 `1`（= M1 成立）→ 改 `list.mean()` + `values` 作用域 + 测试，约一小时。但这是**改通用函数**：任何用户表达式里的 `.mean()` 都跟着变，且变成反直觉语义（`[1,2,null].mean()` = 1 而非 1.5）。改动量小、影响面不小。
      - 官方报错或给空 → M1 被证伪，说明官方的 `values` 根本不含空值、`0.25` 是汇总层自己取的分母——**本仓模型表达不出来**，⑧(a) 随即从「跟官方」翻成「不跟 + boundary」，**一行代码不用改，只写文档**。
  - **成本与依赖**：(b) 半小时内、独立、不需要 Obsidian；(a) 的取证要 **Obsidian 开着**（跟第一批的复跑不同——那个读冻结记录，只需 `pnpm build`）。建议顺序：先落 (b)，(a) 等下次方便开 Obsidian 再一起取证。
- [x] **oracle fixture 缺口 + 取证脚本 groups 路径（2026-07-29 全部补齐，见 [runbook §1.3](./docs/design/bases-oracle-runbook.md)）**
  - **fixture ✅**：补 **12 个 view** 覆盖 ⑩..㉖ 中的 16 条，全部在 x-basalt 侧跑通、有确定读数、无 error 诊断。17 条只用 12 个 view 是因为这批判据**全在投影列值里**，一个 view 挂一批常量表达式列就能一次读回多条（取证脚本 2026-07-28 已采 `cells`）。
  - **㉑ 判定不可取证**：`matches` 的 ReDoS 静态判据是本仓自己的安全策略，官方没有对应语义可观察 → 终局直接是 documented boundary，不需要 view。
  - **三条硬约束（已遵守）**：①只往已有 `.base` 加 view，不新建 `.base`；②**同理不新增 `.md`**——⑲⑳ 要一篇有正文出链的笔记，解法是往已有的 `CaseE.md` 正文加一行 `[[CaseB]]`，改内容不改文件数；③filter 用 `file.path` 不用 `file.name`（官方渲染不带扩展名、本仓带，会两边行集不同）。
  - **隔离原则**：已知报错或可能是自建扩展的表达式单独占 view（`mean-mixed-list` / `date-format-localized` / `ext-constructors`），免得官方求值失败连坐同伴。
  - **⑦ 的前置 ✅ 已修**：取证脚本的 `groups` 读取路径此前把 26 个 view 全采成 `key=null / rows=[]`，且是**静默**的。改为字段名自适应 + 结构探针 `groupProbe` + 跑完当场自检；另加离线自检（10 项，不需要 Obsidian）——`READ_RESULT` 是只在 Obsidian 里 eval 的源码串，正常路径一行都跑不到，这正是它能坏一整轮没人发现的原因。
  - **㉓ 的方向维度顺带确认**：`group-desc-nullpos` 实测组序 `null[4] → 2 → 1`，**空值组排最前**——即顶层 sort 空值恒最后（②已冻结）与分组 DESC 整体取反两处确实不一致，等官方读数定夺。
- [ ] **oracle 第二轮取证（唯一剩余动作：开一次 Obsidian 跑一次）**
  - 前置全部就绪：fixture 12 个新 view ✅、groups 读取路径 ✅、取证脚本全自动 ✅。view 总数 26 → 38，会连既有 26 条一起重跑（免费回归）。
  - 一次跑完可同时定夺：**⑧(a)**（`list(1,2,null).mean()` 的官方读数 —— 给 1 则改 `list.mean()` + `values` 作用域约一小时；报错或空则 ⑧(a) 翻成「不跟 + boundary」，一行代码不用改）、**⑩..⑳㉒..㉖ 共 16 条**、**⑦** 的分组内容与组序（首轮 groups 是坏的，只测到顶层行序）。
- [ ] **P2 · typed formulas/group/summary**：Property 类型、Date/Link/File/List、公式依赖图与循环、高阶列表、groupBy/summaries；以真实需求逐项开计划。
  - [x] **P2a · formulas 核心**（typed values + 算术 + 依赖图/cycle + clock，BASE-FORM-001..006/SEC-006）：[`docs/plans/2026-07-27-bases-p2a-formulas.md`](./docs/history/plans/2026-07-27-bases-p2a-formulas.md)（2026-07-27 落地）
  - [x] **P2b · types.json / list 高阶 / groupBy / summaries**（BASE-TYPE-001..003、LIST-001、GROUP-001、SUM-001/002；TYPE-004 与 GROUP-002 待 oracle）计划：[`docs/plans/2026-07-27-bases-p2b-types-list-group-summary.md`](./docs/history/plans/2026-07-27-bases-p2b-types-list-group-summary.md)（2026-07-27 落地）
- [x] **P0..P2b 收口 · code review 修复批次**：view 必填字段静默通过、Windows 盘符大小写误判越界、多根 `.base` 主键缺命名空间、`order`/`sort` 静默丢项、`maxOperations` 非查询总额、解析缓存无界。计划：[`docs/plans/2026-07-27-bases-code-review-fixes.md`](./docs/history/plans/2026-07-27-bases-code-review-fixes.md)（2026-07-27 落地）
- [x] **收口附带修复**（2026-07-27，同批次外的两笔）：①**不加引号的 frontmatter 日期静默失去日期语义**——读侧 YAML 引擎改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型），与写侧 `src/meta` 统一；②**`format:check` 门禁此前从未可通过**——`.prettierignore` 豁免 fixtures + 作用域收敛为 `src tests scripts` + 一次性格式化 13 个文件。全量 **793 测试绿**。
- [x] **P3 · all-files/context**（附件数据集 ✅ P3a；显式 `contextFile`/`this` ✅ 覆盖率片六；embedded `base` code block 与 `![[View.base#Name]]` ❌ 判不做 + 入口形态诊断）：先做独立 indexer schema 决策，证明不改变既有 DQL `.md` 数据集。schema 决策已冻结：[`docs/specs/2026-07-27-bases-p3-vault-entries-decision.md`](./docs/design/bases-vault-entries.md)（2026-07-27；实施另开计划）。**软序而非硬依赖**：真有 dogfood 需求可以先动，但要接受届时 oracle 结论可能同时推翻 P1/P2 与 P3 两层的暂定口径。
  - [x] **P3a · 附件数据集（vault_entries + all-files 模式，BASE-ALL-001/002）**：schema+indexer 六条写入路径 → base all-files 数据源 → DQL 不变证明 + CLI `--conformance`，三片全部落地。计划：[`docs/plans/2026-07-27-bases-p3-attachments.md`](./docs/history/plans/2026-07-27-bases-p3-attachments.md)（2026-07-27 用户拍板「附件数据集优先」开片；片一 schema+indexer、片二 all-files 数据源 + conformance 开关、片三 DDL 防漂移锁 + DQL 不变回归 + CLI + 基准全部落地。embedded code block 与 contextFile/this 仍另开计划）

- [x] **函数覆盖率补齐（六片全部落地，2026-07-28）**：注册表条目 **35 → 68**（63 条可执行 + 5 条白名单内显式拒绝）。①机械叶子 16 个 + 渲染类/`random` 拒绝 + `round` 归 number 组 → ②date/duration 构造 + date 方法组 → ③file/link 互转 + 行集解析器（含 `file(...)` 文法增量）→ ④`matches` + 三层 ReDoS 防护 → ⑤GROUP-002 扇出 + 组级汇总 → ⑥显式 `contextFile` 驱动 `this.*`（CTX-002/003 判不做 + 入口形态诊断）。四门全绿（test 880）。计划：[`docs/history/plans/2026-07-28-bases-functions.md`](./docs/history/plans/2026-07-28-bases-functions.md)

**暂缓**：内置 chat 打磨、DQL 函数全集、task emoji 全字段、lint CI/baseline、embedding、复杂编排器。原本的优先级基准是「不能优先于 Bases oracle」；**2026-07-29 后这条基准基本解除**——oracle 侧不需要 Obsidian 的活已全部做完，剩下的唯一动作是「开一次 Obsidian 跑第二轮取证」，它不占用其他方向的时间（等下次方便开 App 时顺手做）。除非 dogfood 出现阻断性缺陷。

**实现前停点（已通过，留档）**：原定「若 P1 场景超过三分之一依赖附件 / 动态 UI `this` / 不可稳定观测的闭源语义，则退回 `.base` lint/inspect」。实际结论：P1 全部场景在 Markdown-only 口径下可实现且可测，未触发退回；附件与 `this` 划入 P3，争议语义走 oracle 校正而非猜测补齐。


## 🧪 2026-07-28 动态 base（入参 base + chat `base_query`）——已论证，待实现

用户提出、当场论证成立的新方向。**性质变化：它把 Bases 从「读用户已有的 `.base` 资产」变成「AI 现场组装查询」，用户有没有 `.base` 文件不再是前提。**

**做什么**：`.base` 不必是磁盘上写死的文件，可作为**入参**传入（stdin / 字符串）；再把这个能力接进 chat，让 AI 自己组装 base 来查 vault。

**为什么有价值（两条，都不是「因为 index 快」或「因为不依赖索引」——那两条推不出结论，`x-basalt query` 早就是查询入参了）**：

1. **结构化输入对 AI 的可靠性高一个量级**。现在 chat 的 `query` 工具收 DQL **字符串**，AI 拼错了只能等报错重试；`.base` 是结构化的（`filters`/`order`/`sort`/`limit` 字段类型明确），可用 **JSON Schema 约束模型输出**，从「生成后校验 + 重试」变成「生成时就写不错」。与既有的 chat 韧性方向（结构化错误 + 引导换法）同源但更彻底。
2. **绕开「没人写 `.base`」这个死穴**。此前判断 Bases 的不可替代场景是「用户已有 `.base` 想复用」，而本机 vault 与 evals 场景库里 `.base` 数量均为 **0**。动态 base 让需求不再依赖用户资产。

**关键设计：按 skill 召回路由，不要把两个查询工具平铺给 AI 选**（用户拍板口径：「他召回哪个 skill，让他用哪个」）。两档实现，强度不同：

- **软路由**（便宜）：`base_query` 的 description 写明「先 `skills_recall`，按召回到的规范选工具」。缺点是工具 schema 始终在上下文里，AI 可以无视引导直接调。
- **硬路由**（真「不召回就没有」）：默认只暴露一个查询工具，召回 Bases 规范后**动态注入** `base_query`。实现更重，但才真正实现用户设想的效果。

**⚠ 前置缺口（实现前必须先处理，2026-07-28 查证）**：

- **没有 Bases 的规范 skill**。`skills-data/` 只有 `core.json5`（提到 base 命令 7 处）和 `obsidian-base-spec.json5`。按召回路由的前提是有东西可召回。
- **命名撞车，会召错**。`obsidian-base-spec` 里 **0 处**提到 Bases/`.base`——它讲的是 Obsidian Markdown 语法 + Dataview(DQL) 文法，名字里的 "base" 是「基础规范」不是「Obsidian Bases」。将来 `skills_recall "base"` 会稳定召回这份 DQL 规范。新增 Bases skill 前必须先解决命名（改名或加 triggers 区分）。

**最小验证路径**（前两步是猜想，第三步才给结论）：

1. `x-basalt base` 支持 stdin / 字符串入参（`-` 或 `--stdin`）——独立可用，命令行管道直接受益（`echo "views: …" | x-basalt base -`），不绑 chat。
2. chat 加 `base_query` 工具 + JSON Schema 严格约束；按上面选软/硬路由。
3. **拿 evals 场景库跑 A/B**：同一批任务，AI 用 `query`（DQL 字符串）vs `base_query`（结构化），比失败率 / 重试次数 / 撞顶率。**这是场景库第一次有明确的量化对比对象**（此前缺口正是「没场景库无法量化」）。

**技术细节**：入参 base 无文件路径 → 诊断的 `file` 字段给虚拟名（如 `<stdin>`）；路径越界检查（BASE-SEC-008）对入参不适用也不需要，因为根本不读文件；`.base` 内的 `file.inFolder()` 等仍作用于 vault，不受影响。改动点在 `src/base/document.ts` 的 `loadBaseDocument`——现为 `readFileSync(abs)` 取 source 后解析，把「取 source」与「解析 source」拆开即可。

## 📋 功能覆盖 gap → backlog（待 dogfood 暴露真实需求再开）

高频缺口（未做，各自待开计划/spec）：
- task emoji 多字段 + 完成状态
- 内置函数补一批（`default` / 数组高阶 / 聚合，现覆盖 ~15%）
- FROM 多源 AND/OR 取舍复核
- 详见 [`docs/research/2026-06-30-feature-gap-vs-dataview-obsidian.md`](./docs/history/research/2026-06-30-feature-gap-vs-dataview-obsidian.md)

## 💡 backlog（待 dogfood 暴露真实需求再开）

- **变更编排器 P1 余项 / P2**：背压、缓存跳过、条件分支、检查点续跑、失败告警、管道 `set` 列表值。设计见 [`change-orchestration.md`](./docs/design/change-orchestration.md)。
- **内置 pipeline 改造（统一算子模型）**：把流动单位从文件事件升级为 `Row`、算子统一单签名、调度与算子分离，让 `query`/`search`/`base`/`links`/`lint` 都能进管道。**设计已落地、代码未动**：[`pipeline-op-model.md`](./docs/design/pipeline-op-model.md)（四片切口见 §9）。
- **多平台 shell 管道**：接外部工具的 stdin/stdout 跨平台契约；**依赖上一条先落地**。设计见 [`shell-pipe-portability.md`](./docs/design/shell-pipe-portability.md)（Windows PS 5.1 中文不可逆丢失的实测证据在 §2）。取代原 backlog 条目「原生管道 stdin」。
- **更多 profile**：按需扩。
- **embedding 向量语义检索**：FTS5 全文已落地；embedding 仍 backlog（触发条件见 `docs/design/semantic-retrieval.md` §10）。
- **S3.4 kysely 收编 DQL→SQL**（可选增强，按需再定）。

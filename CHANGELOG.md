# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- **条级召回：`skills get <name> <id>...` 只取指定条目** —— `get`/`recall` 的返回单位一直是「整篇」，想要 `core` 里 meta 那一条就得吞下全篇。现在每条 rule 可带 `id`（`SkillRule.id`，可选），按 id 取即可：`skills get core meta` 约 2.6 KB，整篇是约 17 KB。条目按**传入顺序**输出；给了未知 id 报错并列出该 skill 全部可用 id，**不静默少给**（静默少给会让调用方以为已取全）。配套 `skills list <name>` 列出条目 id 与首行摘要，供挑完再取。这比拆篇更根本——大篇不必再为了「便宜」而被切碎。
- **`query --json`** —— `scan`/`run`/`base`/`lint` 都有这个开关，唯独 `query` 不接受，调用方按类推写上就撞 `unknown option` 再退回裸调。`query` 的输出本就恒为 JSON，补这个 flag 纯为接口一致，不改变任何输出。

### Changed

- **运行时说明书拆成「摘要 + 三篇正文」，`core` 21.4KB → 17.0KB** —— 此前只有「20 行触发器 skill」和「~21KB 全量 `core`」两档，中间没有一格：想改个 frontmatter 也得吞全文；而 `recall` 的返回单位是**整篇**（`skills recall meta` 输出 30KB，比 `get core` 还多 40%，因为把 `core` 与 `obsidian-base-spec` 一起吐）。更要命的是**召回的前提是知道有什么可召回**——不知道 `run --pipe` 存在的 AI 永远不会去 `recall pipeline`，只会逐个文件调 `meta set`。
  - 新增 **`summary`**（~1.8KB，英文）：三条 rule 一一对齐三篇正文，每条一屏内说清「这组能干什么」并以 `chat:` 一句标明该组在 chat 侧的三态（有同名工具 / 没有 / 明令禁止）。**只指路不重抄参数与文法**——它一旦超过 ~2KB 就是抄多了。用英文是因为读者主要是 AI，而命令名/算子名本就是英文，中英混排会为同一概念产生两个 token 形态。
  - 新增 **`pipe`**（~5KB）：`run --pipe` 从 `core` 分出（原单条 2139B，是 `core` 里最大的一条，比第二名多 70%）。参数面与三种源、算子链、写与索引刷新各成一条；`scan --pipe` / `watch --pipe` 共用同一套语义也在此说明。`core` 只留一行指路。
  - 新增 **`chat`**（~4KB）：自然语言路径从 `core` 分出——调用形态、15 个内部工具与 CLI 命令的对应关系、chat 侧**没有**（`index`/`base`）或**禁止**（`watch`，会挂死会话）的能力、`AI_GATEWAY` 配置与安全模型。CLI 直调场景这些一个字都用不上。
  - **召回按 triggers 分层**：五篇 triggers 刻意不重叠（总览词→`summary`、管道词→`pipe`、AI 词→`chat`、说明书词→`core`、语法词→`obsidian-base-spec`），于是 `recall 批量` 只吐 ~5KB 的 `pipe` 而非 `core` 全文。召回粒度靠分流实现，**未改 Fuse、未做条目级切分**。
  - **零代码改动**：`src/` 相对上一版逐字节不变。`loadDir` 本就加载目录下全部 `*.json5`，新增篇自动可用；摘要的排版靠 description 的写法适配既有渲染（首行作三级标题、清单落正文），没有为它加字段或改渲染器。
  - 修掉 `core` 中 `run` 条内重复两遍的「源三选一」段落（搬入 `pipe` 时合并）。
  - 消费侧入口 `skills-def/cli/x-basalt/SKILL.md` 指路改为「先 `skills get summary` 挑一组 → 再取那一篇」，并点明最易漏的批量场景。

### Fixed

- **chat 把索引主键当 cwd 相对路径，导致 `parse` 连续失败，`meta` 甚至可能写错同名文件** —— `query` / `search` 返回的是 vault 布局主键：单根嵌套目录下为根内相对路径，多根下为 `<根目录名>/<相对路径>`；但 chat 的 CLI 壳此前只给 query/search 注入 vault，把 parse/meta 文件参数原样交给按 cwd 读写的命令。模型拿到 `file.path` 后只能反复猜测物理目录前缀，连续失败会撞 error-storm；更危险的是 cwd 下恰有同名路径时，meta 会静默写错目标。现由持有 `ToolContext` 的 chat 壳统一经既有 `VaultLayout.toAbs` 把 parse/meta 文件参数还原为绝对路径，公开 CLI 签名与索引键格式均不变；选项位于文件参数前、多根命名空间两类回归已锁定。

- **pnpm 版本从「固定精确版」改为「最小版本约束」** —— `packageManager: pnpm@10.33.0` 是精确锁定（corepack 设计如此、不支持范围）；现删除该字段，改用 `engines.pnpm: ">=10.33.0"` 声明最小版本。本地开发时 pnpm 版本低于下限会直接报 `ERR_PNPM_UNSUPPORTED_ENGINE`，等于或高于下限的 pnpm 10/11 均可正常使用；`AGENTS.md` 与 `docs/use/install.md` 同步更新。

- **pnpm 10 不再读取 `package.json` 的 `pnpm` 字段，原生构建放行配置迁移到 `pnpm-workspace.yaml`** —— pnpm 10 对 `package.json` 中 `pnpm.onlyBuiltDependencies` 的读取已移除，每次 `pnpm` 命令都会打 WARN。现把 `onlyBuiltDependencies: [better-sqlite3]` 迁至 `pnpm-workspace.yaml`（pnpm 10 设置的唯一新位置）并从 `package.json` 删除该字段，告警消失、放行语义不变；`AGENTS.md` 与 `docs/use/` 相关说明同步更新。

- **pnpm 11 兼容：构建放行配置从 `onlyBuiltDependencies` 迁移到 `allowBuilds`** —— pnpm 11 已移除旧设置（未显式放行/拒绝的依赖构建脚本会触发 `ERR_PNPM_IGNORED_BUILDS` 并自动改写 `pnpm-workspace.yaml`），现改为 `allowBuilds: { better-sqlite3: true, esbuild: false }`：原生模块照常编译，esbuild 保持 pnpm 10 时期「跳过 postinstall」的策略。pnpm ≥10.26 与 11 均按此配置工作；`AGENTS.md` 与 `docs/use/` 相关说明同步更新。

## [0.9.0] - 2026-07-31

> chat `pipeline_run` 接入 `steps` 声明式步骤链（与 CLI 同规则）、管道教程 pipelines.md、base 算子缺投影改显式报错。

### Added

- **chat `pipeline_run` 工具接入 `steps` 声明式步骤链** —— 此前 chat 的批量写工具只暴露 `actions`（七个经典动作）+ `where`，pipelines.md 里的 `step=` 算子链（query/search/base 作源或转换、filter/limit/dedup/map、lint/links. 诊断、`{{row.x}}` 插值写回）模型根本表达不出来——能力在编排器里、CLI 也有，唯独 chat 工具面缺这个口。现 `pipeline_run` 新增 `steps?: string[]`（一元素一完整算子 spec、不切分），与 CLI 同规则：`steps` 存在时优先于 `actions`、两者至少其一（全缺在工具层即报 `invalid` 结构化错误，不让引擎静默跑空链）；返回值新增 `steps[]` 逐步行数流水（op/rowsIn/rowsOut/failed），模型据此定位「行在哪一步被滤掉」，无需重跑排查。工具描述同步点明两种写法的选择规则并指向 core 取算子语义。回归用例：steps 链落盘 + 流水回传、steps 优先于 actions、空链报 invalid（`tests/chat/tools.test.ts`）。

- **管道教程 [`docs/use/pipelines.md`](./docs/use/pipelines.md)** —— `--pipe` 算子链的完整教学：Row 心智模型与四种角色、`actions=` / `step=` 两种链写法的选择规则、逐个算子手册（含 0.8.0 新接的 query/search/base/lint/links.*/filter/limit/dedup/map）、`{{row.x}}` 插值取值优先级、`filter` 表达式语法、`RunReport` 口径（含「链首算子源自产行不计入 `total`」）、五个端到端配方。所有示例经真实 vault 冒烟验证；`docs/use/commands.md` 的 `run` 节与 `docs/use/README.md` 索引、运行时自我说明书 `skills-data/core.json5` 同步指路。

### Fixed

- **`base` 管道算子：view 未投影 `file.path` 时由「静默产出空 path 行」改为显式报错**（教程 dogfood 实测撞出）：BaseEngine 只把 view `order` 列出的键投进行，`order` 不含 `file.path` 时算子此前把行 path 映射为空串，下游写算子拿到空 path 后以 `EISDIR` 之类错误崩溃、报错完全不指向根因。现与 `query` 算子同一规则——源模式该步报「view 未投影 file.path 列，base 算子无法映射行路径」并给出补法示例（`order` 加 `file.path`），转换模式每行各记一条 failed。回归用例 Op-B8。

## [0.8.0] - 2026-07-31

> 统一算子模型片四（声明式 steps）、pipe-closure 评审修复、两处 Windows 路径判定假阳修复、管道写后自动刷索引。含 breaking（见 Changed 段）。

### Added

- **`--pipe step=<spec>` 声明式步骤列表（统一算子模型片四，D12）** —— `--pipe` 新增可重复 `step=<spec>`：一 flag 一算子、按出现顺序成链、**不做逗号切分**；配置段对应 `pipelines.<name>.steps` 字符串数组（一元素一算子 spec，只收数组）。解决统一算子模型片二/三接入的算子参数含顶层逗号（DQL、`filter status == "a,b"`、`.base#view`）时，逗号分隔面 `actions=` 把单条 spec 劈碎、后半段被当算子名报「未知操作」的缺口——能力已落地但 CLI 表达不出来。`steps` 存在时优先于 `actions`；命令行显式给出链（`step` 或 `actions` 任一形态）整体覆盖配置基底链。`actions` 的括号感知切分行为逐字不变。

### Changed

- **（源码级 API breaking，CLI/配置/报告契约不变）统一算子模型片四**：`PipelineConfig.actions` 由必填降为可选（新增 `steps?: string[]`，两者至少其一、`steps` 优先）；`parsePipeFlags` 返回形状由 `Record<string, string>` 改为 `{ kv, steps }`（承载可重复 `step`，原 Record 形态重复键互相覆盖）。**只影响源码级消费者**——本包发布面是纯 CLI（无 `main`/`exports`），命令行 `actions=`、配置段与 `RunReport` 行为逐字不变。
- **（breaking）`RunReport.changed` / `skipped` 改为「文件数」，与 `total` 同单位**。此前数的是**动作结果数**（文件 × 动作）：`actions=set,index` 跑 28 个文件会报 `total:28 / changed:56`——`changed > total` 直接说不通，调用方根本判断不出「到底改了几篇」。现同一文件被多个动作改动只计一次；旧口径的明细没丢，挪到新增的 `byAction`（动作名 → 该动作改动了几个文件）。报告另增 `changedPaths`（改动文件路径，写后刷索引与调用方复核都靠它）与 `reindexed`。受影响面：`run`/`scan --pipe`/`watch --pipe` 的 `--json` 输出与 chat 的 `pipeline_run` 返回值。现有测试断言的都是单动作场景（两种口径同值），未受影响。

### Fixed

- **两处 Windows 路径判定假阳修复（安全门/根解析）**：①`run --stdin` 的 vault 越界门（`assertPathsInVault`，pipe-closure C1）自写 `startsWith(root + sep)` 前缀比较——win32 下正斜杠路径（Git Bash 常见 `D:/vault/x.md`）与盘符小写形态（`d:\vault\…`）的**根内合法路径**被误判越界，整条 `run --stdin` 被拒；改为先 `resolve` 收拢形态（分隔符、`..` 归一）再复用「路径包含」单一真相源 `isPathInside`（win32 大小写归一），测试根形态对齐生产不变量「roots 已 resolve」，并补正斜杠/盘符小写回归用例。②`resolveVaultLayout` 根集合去重原按精确字符串——win32 下 `C:\vault` 与 `c:\vault` 同一目录被当两个根保留，随后误报「多根目录名冲突」（indexer / orchestrator / base 共用该根解析）；去重改按 `pathCaseKey` 口径（win32 忽略大小写），保留首次出现形态。
- **`search` 的匹配口径与文档不符，且命令本身在消费侧文档里根本没有**。CLI 帮助与 chat 工具描述都写「整体按字面短语匹配」——这对纯 ASCII 成立，**对含中文的查询不成立**：实现走的是 trigram 并集 **OR 宽松召回**（`src/query/index.ts` 档 1，有意设计：中文无空白分词，严格短语会大量漏召，完整子串命中者由 bm25 排最前）。后果是 `total` 被当成「确实含该短语的篇数」而误读——实测 `search "回归网"` 与 `search "回归网-不存在"` 都返回 85（「不存在」单独搜是 0，却不缩小结果）。这是**文档与实现漂移**，与此前那次 tag 口径漂移同类，对 AI 消费者尤其致命（它按 `total` 下结论）。同批补齐三处既存缺口：(1) `docs/use/commands.md` **完全没有 `search` 章节**，而 `docs/use/README.md` 却指向该锚点（死链）——现补完整章节并入目录；(2) `skills-data/core.json5` 的 rules 里**没有 `search`**，运行时自我说明书缺这一整个命令；(3) `docs/use/ai-and-skills.md` 仍写全文检索「FTS5，规划中，尚未落地」，而它早已落地——这条会直接劝退使用者。另订正最短查询长度：文档写 3，实际是 **2**（`MIN_FTS_QUERY_LEN`，P4 已放宽）。**行为一行未改**，只让说明与实现一致。
- **管道写动作落盘后不刷索引 —— 「成功回执」与「验证通道」互相矛盾**。`run` 的写动作改的是 `.md`，`query` 读的是 SQLite 索引，两者之间需要一次刷新。引擎里其实**已有**索引新鲜度纪律，但只做了一半：`runBatch` 在 `where` 过滤**之前**会先把候选落库（避免按陈旧索引选错），写完**却不刷回去**。于是实测轨迹长这样：`run --apply --pipe actions="set type=note" --pipe where=…` 报 `28 改动` → 紧接着 `query` 仍返回「28 篇缺 type」→ `scan` 显示 `modified: 28`（盘上确实改了）→ 只好再跑一次 `actions=index` → 第三次 `query` 才是 0。**管道自己报成功、而验证它的正规手段说没成功**，任何调用方（人或 AI）都只能不信、去重验，白走 `query → scan → run(index) → query` 四步；自然语言驱动时这一圈能吃掉大半个步数预算。现补上对称的另一半：非 dry-run 且确有改动时，自动把改动过的文件刷进索引（报告新增 `reindexed` = 刷新篇数，CLI 输出缀 `/ N 已刷索引`）。动作链自带 `index` 时**不重复刷**（那一步已落库）；`unlink` 事件按类型走 `removeByKey`，不会让 `update` 抛。默认开启，`--pipe refresh-index=false` 可关——关掉即回到旧行为（落盘与索引静默不一致），仅建议在「稍后必定统一 index」的批处理里用。
- **列举类回答会「按规律补齐」凑数——生成不存在的路径**。实测让 chat 列全某目录下 72 篇笔记的路径：它一次 `list` 就拿到了完整正确的 72 条，却输出了一份**分月份、格式工整、结尾写着「合计 72 条，全部列出完毕」**的清单，其中 **17 条（24%）是凭空捏造的文件名**——真实的 `…/2026/06/` 下是 `backlog-79 / faq-80 / faq-82 / 对照表`，它写成了 `backlog-72 / index-73 / 决策记录-06 / 概览-07`。捏造集中在列表尾部，形态像是照抄了前 55 条之后按命名规律「续写」到承诺的条数。**比截断更危险**：截断至少看得出没列全，这个是自信、完整、可信度极高的假清单。SYSTEM_PROMPT 补一条通用纪律（不硬编码任何答案）：列具体条目时只能从工具返回逐条转写原文，不得改写 / 按命名规律推演补齐 / 为凑条数编造；条目多先翻页取全，实在列不全就如实说「只列出前 N 条、共 M 条」——宁可承认没列全，也不给一份掺假的完整清单。同批另补一条：`pipeline_run` 返回 `changed>0` 即已写成功且索引已刷新，不必再 `query`/`scan` 复核。**验证**：同一任务修后连跑两次，均为 72/72 逐条属实、0 捏造 0 漏列（修前 17 条捏造）。
- **DQL 缺查询头（裸子句）只报文法期望列表，不指方向**。调用方常把「过滤条件」当成一整条 DQL 传（尤其管道 `where=`），写成 `FROM "inbox" WHERE type = null` 或直接 `WHERE …`；chevrotain 吐的是 `Expecting: one of these possible Token sequences: 1.[List] 2.[Table] 3.[Task] but found: 'FROM'`——这串东西不告诉人「补个 `LIST` 就行」。现首 token 即子句关键字（`FROM`/`WHERE`/`SORT`/`GROUP`/`FLATTEN`/`LIMIT`）时改抛定向错误，点名须以 `LIST`/`TABLE`/`TASK` 开头并把**补好头的原句**作为示例给出（可直接照抄）。做法与既有的 `LIKE → contains` 引导同源。**只作用于句首**：`LIST FROM "a" FROM "b"` 这类非句首文法错误仍报原始信息，不误导。

## [0.7.0] - 2026-07-29

> Bases 无头引擎全阶段落地（P0..P3a + 函数覆盖率六片 + oracle 校正）与配套质量门禁/docs 重组。含多条行为收紧与 oracle 校正 breaking（见 Changed 段）。

### Added

- **Bases 无头引擎（`src/base/`）+ `base` 命令** —— 无 GUI、无 Obsidian 运行时执行 `.base` view 查询（conformance `bases-markdown-2026-07`）：独立 Chevrotain 表达式文法（与 DQL token/AST 零共用）、递归 `and`/`or`/`not` filter、note/file 属性、白名单函数（string/list/object/file/time/number）、`order`/`sort`/`limit`、稳定 JSON 契约（`total` 为 limit 前行数、`file.path` 稳定 tie-break、字节稳定）、执行预算（文档/深度/节点/行数/集合/操作数硬上限）。P2 增量：`formulas`（依赖图拓扑 + `base/formula-cycle`）、算术与 duration 字面量、Date/Duration/Link 值、`today`/`now`（clock 注入）、list 高阶（`filter`/`map`/`reduce`/`flat`/`sort`/`unique`/`join`/`mean`）、`.obsidian/types.json` 可选只读、view `groupBy`（`groups` 增量字段）与 15 内置汇总 + 自定义 `values` 汇总。数据集默认 md-only（恒发 `base/markdown-only-dataset` warning；附件不为行，P3a 起可用 `--conformance bases-all-files-2026-07` 切换）；官方争议语义为暂定口径，待串行 oracle 冻结。
- **Bases P3a 附件数据集（all-files）** —— indexer 将非 `.md` 附件（图片 / PDF / `.base` / `.canvas` 等一切非隐藏文件）以纯 stat 元数据写入独立 `vault_entries` 表（`index` / `scan` / `watch` 同步，跨表 path 唯一，`scan --json` 报告新增附件计数字段）；`base` 新增 `--conformance <id>`：`bases-all-files-2026-07` 把附件并入数据集为行（附件行 `file.*` stat 字段可用、note 属性投影 `null`、`file.tags` / `file.links` 恒 `[]`、不发 md-only warning），缺省 `bases-markdown-2026-07` 行为不变；旧库无 `vault_entries` 表时自动降级 md-only + compat warning。**DQL 数据集不变——附件永不进 `query` 结果。**
- **Bases 函数覆盖率补齐（片一）** —— 新增 16 个叶子函数：string `replace`（字面子串全局替换，非正则）/ `repeat` / `reverse`（按 Unicode 码点）/ `slice` / `split` / `title` / `isEmpty`，number `abs` / `ceil` / `floor` / `toFixed`（返 string）/ `isEmpty`，list `reverse` / `slice`，global `max` / `min`（变长 number 参）。**number 独立成分派组**（`round` 由 `any` 组迁入，语义不变）。渲染类 `escapeHTML` / `html` / `image` / `icon` 进白名单但显式拒绝：报 `base/unsupported-feature`「无头内核不渲染」而非误导性的 `base/unknown-function`。`random()` 同样显式拒绝，但理由是**与字节稳定契约冲突**（同一输入必得同一输出是本引擎最硬的保证，不为一个叶子函数让路）——诊断消息与渲染类分开。
- **Bases 函数覆盖率补齐（片二 · date/duration 族）** —— global 构造 `date(v)`（严格 ISO 字符串 / date 幂等 / number 按 epoch 毫秒，`date(file.ctime)` 可用）与 `duration(v)`（`"1 day"` 长单位与官方短单位 `y M w d h m s`，**大小写敏感**：`M`=月、`m`=分）；新增 **date 方法分派组** `format(fmt)` / `time()` / `relative()` / `isEmpty()`。`format` 只做与语言无关的数字 token（`YYYY MM DD HH mm ss` 及不补零变体，全部按 UTC，`[方括号]` 转义字面量），月名/星期名等本地化 token **报错而非静默输出英文**；`time()` 返回当日零点起的 duration（可比较可运算）；`relative()` 固定英文、时间源恒为注入 clock。**口径变化**：`date()`/`duration()` 晚于本仓 2026-07-22 官方快照，此处显式采纳（`%` 取模仍不采纳）。
- **Bases 函数覆盖率补齐（片三 · file/link 互转）** —— global 构造 `file(path)`（在**本次查询的行集内**三级解析：完整路径 → 去扩展名忽略大小写路径 → 文件名；找不到给 `null`，不伪造空 file 值）与 `link(target, display?)`（纯值构造，不检查文件存在性）；新增 **link 方法分派组** `asFile()`；file 方法新增 `asLink(display?)` 与 `linksTo(x)`（字符串/link 入参与 `hasLink` 同一匹配，**file 入参走解析**，故 `[[Beta]]` 简写也算链到 `Projects/Beta.md`）。**含文法增量**：`file` 是关键字 token，此前 `file(...)` 直接语法错误，现由根引用规则的调用分支支持，`file.name` / 裸 `file` / `file["name"]` / `file.hasTag(...)` 行为不变。
- **Bases 函数覆盖率补齐（片四 · 正则）** —— `string.matches(pattern)`（pattern 是**字符串**，正则字面量 `/…/` 仍在文法层拒绝；子串命中语义）+ **三层 ReDoS 防护**：①静态拒绝灾难性回溯构造（无界量词套无界量词/交替，如 `(a+)+`）与反向引用；②限长（pattern 200 / 被匹配串 10000，与 DQL 侧同档）；③有界编译缓存（上限 64）。新增 rule `base/invalid-regex`——非法或不安全的正则**行级报错，不静默当作「不匹配」**（与 DQL 侧 `regexmatch` 降级为 0 的策略有意不同：那边在 SQLite 自定义函数内不便产诊断，Bases 侧硬约束是不静默忽略）。
- **Bases 函数覆盖率补齐（片五 · 分组键与组级汇总）** —— `groupBy` 不再拒绝多值键：**list 分组键扇出**（一行进入它每个元素的组，`groupBy: tags` 的自然语义；行内元素先去重，空 list 视同缺失键单独成组，不丢行），link 作为**标量**键按路径感知相等分组。扇出使 `groups` 各组行数之和可能大于 `rows.length`——顶层 `rows` 仍是平铺一份，契约已显式声明。新增 `groups[].summaries` 组级汇总（计算集 = 该组 limit 后的行，与顶层「filter 后 limit 前全量」有意不同）。
- **Bases 函数覆盖率补齐（片六 · 显式动态上下文）** —— `x-basalt base --context-file <path>` 为 `this.*` 提供**显式**上下文：`this.file.*` 取该文件的 file 字段、`this.<属性>` 取它的 frontmatter、裸 `this` 是它的整个 frontmatter，公式体内同样可用。路径写法与 `file(path)` 一致（完整路径 / 去扩展名忽略大小写 / 文件名）；不传就报 `base/dynamic-context-required`（无头执行没有「当前活动文件」，不猜），传了却找不到该文件则 error + 空结果（不静默当没给）。Markdown 内嵌 ```` ```base ```` 代码块与 `![[View.base#Name]]` 嵌入**明确不做**，但在**读文件之前**的入口形态检查处给出 `base/unsupported-feature` 诊断并附替代写法（`#锚点` → `--view`；非 `.base` → 单独存成 `.base`），不再退化成一句 YAML 解析失败。

### Changed

- **Bases oracle 第二批四条出决策（⑦⑨㉗ 落 documented boundary，⑧ 跟官方待实现）** —— 无代码改动，只是把「跟 / 不跟」和理由写死在 [vs-official §5](./docs/design/bases-vs-official.md)：**⑦ 分组时的顶层 `rows` 顺序不跟**（本轮只测到顶层行序、**没测到官方的分组内容与组序**——观察记录里的 `groups` 字段是坏的，连没有 `groupBy` 的 view 也报了组；跟等于照抄症状，且会牺牲字节稳定契约，而分组次序本就在独立的 `groups` 字段里）；**⑨ `+` 的字符串拼接保留**（官方那里是静默的空，不是语义，砍掉纯亏，与本仓「不静默」立场一致——但这是**超集不是等价**，要逐字节对齐官方就别用 `+` 拼字符串）；**㉗ 默认数据集不改**（差异恒发 `markdown-only-dataset` warning、不静默；官方读数只证明 `.base` 是行、**没证明附件也是行**，切默认等于顺带断言未取证的事；要对齐加一个 `--conformance` 即可）。**⑧ summary `values` 决定跟官方**（空值计入分母 + 按 limit 后），但实现待落——(b) 可直接改，(a) 卡在一条硬前置：要复现官方的 0.25 必须同时把通用函数 `list.mean()` 改成「非 number 不计分子、计分母」，而官方从没给过它在混合列表上的读数，先补 view 取证再动手。
- **Bases oracle 校正后复跑对照**：同一份官方观察记录，**分歧 7 → 2，无新增分歧**（24 一致 / 2 分歧 / 26 view）。剩余两条即 ⑦，已决定不跟。复跑不需要 Obsidian 在跑（对照器读冻结的观察记录），只需 `pnpm build`；⚠️ 它只比行集不比列值，覆盖不到 ⑧ 与 ⑨。
- **（breaking）Bases 空 filter 数组不再拒绝**：`and: []` = 真（全量）、`or: []` = 假（空集）、`not: []` = 真（全量）（oracle 校正 ④）—— 跟官方。原先三者一律报 `base/unsupported-feature` error + 空结果，那不是语义主张而是「官方语义未确认，先不猜」的占位；官方 1.12.7 读数稳定可重放（连跑两次一致）后占位即撤。求值侧一行未改——`evalFilter` 的 `every`/`some` 天然给出这三个默认值，校正只是删掉 planner 的拒绝分支。⚠️ `or: []` 校正前后都是 0 行，但**成因不同**（旧：拒绝返回空；新：恒假的正常空集），靠行数判断会漏看这条。
- **（breaking）Bases equality：MISSING 与 null 合并**（oracle 校正 ①，BASE-PROP-004）—— 跟官方。官方 1.12.7 实测 `X == null` 对**没有该属性**的行同样判真，本仓原先区分二者。这是七条分歧里唯一**静默改变行集且无任何提示**的一类：`status != null` 想筛「填了 status 的笔记」，旧行为会把没有 status 属性的笔记也算进来，不报错、只是数字不对。合并落在 `typedEqual` —— 值域**唯一**的相等语义，故 `groupBy` 分桶（missing 键与显式 null 键现在同组）、`list.unique()`、`contains()`、Unique 汇总一并生效；这层外推是本仓决定（官方只有一套相等，再造第二套是更大的无证据发明），理由见 [vs-official §5.1](./docs/design/bases-vs-official.md)。**有意不跟随**：`isType("null")` 仍只对显式 null 为真。区分 missing 与 null 的入口不变——`file.hasProperty(name)` 只看 key 存在性。**DQL 侧 `WHERE field = null`（测键是否存在）是另一套语义，本次一行未动。**
- **（breaking）Bases 排序：null / missing 在 `DESC` 下也排最后**（oracle 校正 ②，BASE-RESULT-002）—— 此前 engine 用 `-sortKeyCompare(a,b)` 实现 DESC，空值组的排名差被一起翻转，`direction: DESC` 时缺失属性的行跑到了结果最前。这不是「跟不跟官方」的选择题：本仓自己登记的口径就是「恒排最后、与方向无关」，官方 1.12.7 实测也是如此，**属实现漂移，当 bug 修**。现由新增的 `sortKeyCompareDirected(a, b, direction)` 施加方向——任一侧落在空值/不可比较组（null / MISSING / boolean / list / object / file）时直接给「空值在后」的定序，方向只作用于两侧都可比的情形；两侧都空则由 `file.path` ASC tie-break 兜底。**含 DESC 排序且数据有缺失值的查询，结果行序会变**。分组键组序（`groupBy.direction`）的方向维度**未取证、有意不动**，理由见 [runbook §5.1](./docs/design/bases-oracle-runbook.md)。
- **Bases 争议语义 oracle 取证完成**（2026-07-28，Obsidian 1.12.7；**仅取证，实现一行未改**）：26 个 fixture view 全部跑完、每个连跑两次结果一致，**19 一致 / 7 分歧**。①truthiness 六形态与 ③`if()` lazy 与实现一致、可转正；分歧集中在 ①equality（官方把 **MISSING 与 null 合并**）、②sort DESC 的 null 位置（**实现与本仓自己登记的口径都不符**）、④空 filter 数组（官方 `and:[]`=真/`or:[]`=假/`not:[]`=真，当前是拒绝）、⑦分组顶层行序、⑧summary `values`（官方含 null/missing 且按 limit 后，两维度都相反）、⑨`+` 不做字符串拼接（原命题「是否在拼接语境做日期推断」不成立），外加一条原不在清单里的**默认数据集差异**（官方把 `.base` 文件自身也算作行）。逐条结论见 [runbook §4](./docs/design/bases-oracle-runbook.md)，校正待办见 §5（原始观察数据由取证侧留档，不入本仓）。**同日上午「oracle 整体暂缓」的决策当天被推翻**——官方 CLI 的 `eval` 能读到 Bases 算好的行集（`controller.view.rows`），取证可脚本化；原判断把「需要 Obsidian App 进程」误推成「需要人逐个点 GUI」，成本估计差了一个数量级。`design/bases-vs-official.md` 的「坑五：不可重复」一并收窄——那是**读得太早**（`selectView` 后没等 `view.rows` 重算完），用收敛判据后重复性问题消失。
- **`.githooks/pre-push` 纳入 `format:check`**（此前只跑 typecheck / test / lint）。钩子里排除它的原注释「仓库存在既有 markdown/prose 格式基线漂移，纳入会误阻断」已随作用域收敛为 `src tests scripts`（不含 markdown）而失效，注释一并改写；行尾一致性由 `.gitattributes` 保证，该门禁不再随「文件最近有没有被工具重写过」随机红绿，可作硬门禁。**这是行尾问题能长期潜伏的直接原因**——唯一会发现它的命令此前没有任何时刻被强制执行。实测：全绿时钩子四门通过（format 段 1.6s，占 push 总时长约 4%）；故意破坏格式时 `set -e` 阻断、退出码 1。报错时跑 `pnpm run format` 自动修。
- **`docs/` 按读者重组**（原按文档类型分 `guides`/`specs`/`plans`/`research`/`testing`/`architecture`）：`use/`（怎么用，文件名去日期）、`design/`（当前有效的设计，去日期）、`history/`（归档，保留日期前缀，只进不出）、`plans/`（仅活跃计划，完成后 `git mv` 进 `history/plans/`）。**Bases 三份指南合一** —— `writing-bases.md` + `querying-bases.md` + 总纲 → 一份 `use/bases.md`（是什么 → 六步教程 → 语法速查 → 命令与输出契约 → 报错速查，一份读完就会用），原理部分独立为 `design/bases-vs-official.md`（官方 CLI 架构与五个实测坑 / 我们的流水线与六个关键决策 / 9 项待 oracle 暂定语义）。四份 README 全部重写为分流入口而非文件清单。72 份文件经 `git mv` 保留历史；内链按 git 重命名记录批量重写，docs 断链 85 → 50（剩余全部为归档内既有断链，`design/` 与 `use/` 零断链）。
- **`format` / `format:check` 作用域收敛为 `src tests scripts`**（原 `oxfmt .`），并新增 `.prettierignore` 豁免 `tests/fixtures/`（oxfmt 只认 `.gitignore` / `.prettierignore`，无 `.oxfmtignore`）。此前该门禁**从未可通过**：fixtures 里有故意写坏的 JSON（BASE-TYPE-003 回退用例），格式化器解析即报错中止整次检查。同时一次性格式化了此前从未被覆盖的 13 个代码文件（纯换行合并/拆分）。docs 的 80 个 md 暂不纳入作用域——markdown 重排与本轮无关且会淹没内容改动。

### Fixed

- **脱敏：公开仓里残留的私有评估库仓名**（6 处，全部为既存泄露，非本轮引入）。项目规则要求 AI/agent 行为评估用的私有兄弟仓「不在公开 repo 留任何痕迹」，但 `design/bases-scenarios.md` 与 `design/bases-vs-official.md` 直接写了仓名与仓内脚本路径，`history/` 下另有 4 处。已统一改为「兄弟私有仓」这类中性表述，位置只留在 gitignore 的 `AGENTS.local.md` 里。**注意：本仓已开源，这些名字在 git 历史里仍可查到**——本次修复只能防止继续扩散，抹不掉已公开的事实。`history/` 的「只进不出」纪律指的是不删归档文件，不排斥脱敏。
- **`format:check` 门禁此前不可信（随机红绿）—— 新增 `.gitattributes` 统一行尾为 LF**。仓库一直没有 `.gitattributes`，行尾完全由各人本机 `core.autocrlf` 决定：Windows 上（Git for Windows 系统级 gitconfig 默认 `autocrlf=true`）checkout 把工作区转成 CRLF，而 oxfmt / 编辑器改写文件时又写回 LF——于是 `oxfmt --check` 报不报错取决于「某个文件最近有没有被工具重写过」，与仓库内容无关（index 侧本就 100% LF，把 HEAD 原始 blob 取出单跑 `--check` 是通过的）。这道门还**单向漂移**：被改过的文件转 LF 变绿，看着像在自愈，但全新 clone 上作用域内文件会大面积红。7826506 那次「修好 format 门禁」只处理了作用域与 fixtures 豁免，没碰行尾，故未根治。现加 `* text=auto eol=lf` 让 checkout 也写 LF；`git add --renormalize .` 对 index **零改动**（内容本就干净），本次提交无任何文件内容变更。**注**：`.githooks/pre-push` 仍只跑 typecheck / test / lint、不含 `format:check`，这层缺口未在本次处理。
- **内置规范 `obsidian-base-spec` 的 tag 口径与实现漂移**（规范是 AI 构造 DQL / 判断 frontmatter 的接地材料，写错即误导）：该篇声明的标签正则是 `(^|\s)#([A-Za-z0-9_\-/]+)`，与 `src/parser` 的实际实现**两处不符**——(1) 要求前导「行首或空白」，实现用的是「`#` 前不能是 Unicode 字母/数字/下划线」的负向后顾（`标签：#moc` 实际成立、规范说不成立）；(2) 声明纯 ASCII，实现取 Unicode 字母数字（`#概念` 实际成立、规范说不成立）。**解析行为不变**，只把规范文本改成与实现逐字符一致，并补中文边界样例。同时落一条 **documented boundary**：与 Obsidian 实际行为的对照验证显示，Obsidian 会把紧跟标签的非空白 Unicode 标点计入标签本身（`再打一次 #概念。` → Obsidian 得标签 `概念。`），x-basalt 在标点处终止得 `概念`；这是**有意差异**——该边界在 Obsidian 侧无权威规格（官方文档所列允许字符与实现不符且逐版本变动），跟随会让中文标签按句读碎片化（`概念` / `概念。` / `概念，` 各成一个）并使 `FROM #概念` 前缀查询在句末标签上失效。同款边界声明已同步到 `docs/use/obsidian-syntax.md` 与开发侧 skill `biz-obsidian-spec`。该篇 `description` 另追加范围声明：只讲 Obsidian Markdown 与 DQL 文法，**不涉及 Bases（`.base`）语法**（名字里的 "base" 指「基础规范」，防召错）。**复核后补三处**：(a) 新 pattern 用了 `\p{L}` / `\p{N}`，必须带 `u` flag 才是 Unicode 属性转义——无 `u` 时不报错而被当字面字符处理、静默错配，这是换成 Unicode 类才出现的前置条件，已在条目里显式写明；(b) 「纯数字 `#123` 不算标签」由 pattern **之外**的后置判定实现（匹配结果须含至少一个 `\p{L}` 或下划线），光靠 pattern 会放行，已注明以免照抄 pattern 得到不同行为；(c) 边界说明里「官方文档自承与实现不符」及一条无出处的 issue 结论改为实测可支撑的表述（对照验证观测到 Obsidian 收下 `#概念。`，而其文档列出的字符集不含全角句号）。
- **Bases code review 修复批次**（[计划](./docs/history/plans/2026-07-27-bases-code-review-fixes.md)），四类静默失败 + 两处资源模型缺口：
  - `.base` 的 view **缺少 `type` / `name` 不再静默通过**——必填校验此前只在「键存在」时触发，缺 `type` 的 view 会被当 table 执行完（与「未知 type 不按 table 猜测」矛盾），缺 `name` 的两个 view 还能同时逃过重名判定。**（行为收紧：这类 `.base` 由静默执行改为 error + 空结果，CLI exit 1）**
  - **Windows 下 vault 根盘符大小写不同不再误判路径越界**——`d:\vault` 配 `D:\vault\...` 此前触发 `base/path-outside-vault`，合法路径被安全门假阳拒绝。判定收敛为 `utils/path.ts` 新增的共享原语 `isPathInside`（Windows 大小写不敏感），indexer 的根归属判定与编排器路径还原一并复用（此前同样会在大小写不同时漏索引）。
  - **多根 vault 下 `.base` 主键补齐 `<根目录名>/` 命名空间前缀**——此前同一个 `BaseQueryResult` 里 `base` / 诊断 `file` 与行 `file.path` 是两套键。改为统一经 `resolveVaultLayout`（indexer 写 `files.path` 用的同一函数）计算。**（多根输出契约变更；单根字节级不变）**
  - `order` / `sort` 的非法项（非字符串 / 非 map / 空 property）**不再静默丢弃**，各产 `base/invalid-schema`。
  - 新增 **`maxTotalOperations`** 查询级操作数总额（默认 5000 万，跨行累计）：此前 `maxOperations` 每次表达式求值即重置，最坏总量 `maxRows × 列数 × maxOperations` ≈ 1e11 而预算「从未耗尽」；groupBy 分桶与 summaries 迭代原本各自另开一份额度，现并入同一份总额。
  - 表达式解析缓存改为有界 LRU（512 条）——此前模块级 `Map` 无淘汰，长驻进程（chat REPL）内存随会话累计的 `.base` 数量单调增长。
- **不加引号的 frontmatter 日期不再静默失去日期语义**（真实 vault 普遍命中的静默错）：`due: 2026-08-10` 此前经 gray-matter 内置 js-yaml（YAML 1.1 `!!timestamp`）解析为 JS `Date`，落库变 `"2026-08-10T00:00:00.000Z"`（含毫秒），超出 Bases 严格 ISO 推断形态 → 退化为普通字符串 → `due < now()` 一类比较只给行级 warning + cell `null`，而查询仍以退出码 0「成功」。读侧 frontmatter 解析改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型，**与写侧 `src/meta` 统一引擎**），日期保持字符串、由值层按词法判定精度——`YYYY-MM-DD` → date、`YYYY-MM-DDTHH:mm[:ss]` → datetime，加不加引号完全等价且 date 精度不退化。

## [0.6.0] - 2026-07-22

> KB compiler P2/P3：诊断契约升格为公共契约，`lint` 命令与 `--profile` 校验体系落地。

### Added

- **`BasaltDiagnostic` 公共诊断契约** —— links 的 `BasaltIssue` 更名为 `BasaltDiagnostic` 并提升为 `src/diagnostic.ts` 跨模块公共契约（KB compiler P2），后续 lint / base 等各层诊断统一此形状。
- **`lint` 命令与 `--profile` 校验体系** —— 最小 `lint --rules links` 壳（与 `links check` 共用 `BasaltDiagnostic` 契约）；`lint --profile <builtin>` 校验内置 profile 的 required 字段（P3a）；自定义 config profile：`extends` 合并内置 profile + `metadata` / `enum-invalid` 校验（P3b），docs 元数据自举经 `lint --profile llm-wiki docs` 归零验证。

## [0.5.0] - 2026-07-15

> KB compiler P0/P1（链接检查）、召回质量四修（中文 search / skills / chat 纪律）、skills-def 薄化与目录定形。含 breaking（见 Changed 段）。

### Added

- **`links check` / `links suggest`（KB compiler P0/P1）** —— 链接定位契约（parser 侧）；白名单目标索引 + vault 文件枚举；wikilink / markdown link 目标判定（bare / qualified / 资源 / 相对 / outside / backslash / external）；`lint.ignore` 配置段与 ignore 匹配（paths / targets / rules + 极简 glob）；`checkVault` / `checkFile` 编排（解析 → 判定 → ignore → 排序）与人读 report。
- **`search` 中文相关性** —— 多词切词 AND / CJK trigram-OR 召回 / 2 字 LIKE 兜底；最短查询长度 3 → 2。
- **skills 召回中文召回率** —— 内置 skill 补中文触发词 + 查询多词切词并集匹配。
- **chat 可用性改进** —— 「未索引 / 没有 index」类问题引导 `scan`、不误当 frontmatter；零 vault 工具作答时如实标注未召回、不短路；新增 chat 程序化输出契约。
- **DQL `LIKE` 定向报错引导** —— 对标官方 Dataview 不新增 `LIKE` 算子，误用时定向提示改用 `contains`。
- **全局使用技能** `skills-def/cli/x-basalt/SKILL.md`（`pnpm run skills:install:global` 装到宿主全局），教任意 AI 会话驱动本 CLI。

### Changed

- **skills-def 入口薄化 + `cli/`/`dev/` 目录分组**：外层 `x-basalt` 入口 skill 改为薄「触发 + 指路」——用法一律 `x-basalt skills get core`，不再重抄命令表/DQL 细节，消开发文档与运行时 `core` 的二次漂移。`skills-def/` 按受众分 `cli/`（消费侧入口，装宿主全局）与 `dev/`（`biz-*` 开发侧，装本仓）；`install-skills.mjs` 改按**目录**路由（原按 `scope` frontmatter），`skills:install` / `skills:install:global` 两脚本语义不变。运行时 `core` 补 `X_BASALT_DIR` 说明。
- **（breaking）skill 运行时数据目录 `skills/` → `skills-data/`**（经 `skill-data/` 过渡），避免与 `skills` 命令前缀混淆、对齐 agent-browser；外部覆盖路径 `OBSIDIAN_SKILL_PATH` / 配置 `skillPath` / `~/.obsidian-core/skills` 不变。

## [0.4.0] - 2026-07-02

> DQL 真值/存在性与隐式字段扩展、FTS5 全文检索落地、inline fields、chat 工具面成形。

### Added

- **DQL 一元 `!` 与裸字段真值**（对标官方 Dataview `isTruthy`）；chat 侧教会助手用存在性惯用法（真相源 + 错误引导）。
- **`file.frontmatter` 隐式字段** —— 顶层键存在性判断与选列。
- **FTS5 全文检索** —— trigram 索引 + `search` 命令 / chat `search` 工具（`src/query` 档 1 为 CJK trigram-OR 宽松召回 + bm25 排序）。
- **inline fields（`key:: value`）** —— 三形态解析、索引与查询期合并（parser / indexer / query 三层贯通）。
- **chat 工具面成形** —— `read_note` + `list` 工具（读正文 / 列笔记）；工具错误结构化 + 换策略引导；撞顶区分续跑；`--trace` 落盘 JSONL（完整事件不截断、文本合并、退出打印路径）。
- **`scan` 按目录分组计数（byDir）** + 缺失 vault 根 warn-and-skip。

### Fixed

- **管道 `index` 动作假成功** —— 按主键精确删除旧键（多根下同 basename 不再互相污染）；多根 `toAbs` 未知前缀由静默放行改为报错；汇报真实 `changed` / `dryRun`。

## [0.3.0] - 2026-06-30

> 变更编排器 P0/P1 与统一 `--pipe` 命令面、CLI chat（读+写）落地、query/scan 分页。

### Added

- **变更编排器（`src/orchestrator/`）P0** —— 事件去重折叠（路径 LWW + 类型折叠）、堆积 debounce + maxWait（防饿死）、路由 match/glob + DQL 语义选择、内建动作 `index` / `normalize` / `parse`（写动作 dry-run）、串行管道执行引擎（有界并发 + 超时 + 失败策略）、scan / 手动 / watch 统一 `ChangeEvent`、防回环 + 优雅退出；配置 `pipelines` 段 + `run` / `watch --pipe` 接线。
- **编排器 P1：写动作进管道** —— `apply` / `set` / `unset` / `rename` + `if-exists` 条件；`meta apply --refresh-derived` 重算内容派生机械字段。
- **统一 `--pipe` 管道模型** —— 命令行为规范 + 配置 `use` 引用 + 内联 `--apply`；`scan --pipe` 对称补齐。
- **CLI `chat`（读 + 写）** —— provider 配置解析 + 懒加载 model（`AI_GATEWAY_*` 契约，`ai` / `@ai-sdk/*` 为 optionalDependencies）、防注入边界包裹 + 结果截断、工具面 `buildTools` + agentic 循环、写动作直接落盘（Ctrl+C 中断，无确认闸）、单发 `runOnce` + REPL、SIGINT 隔离守门。
- **`query` / `scan` 分页** —— `offset` / `size` + `total` / `counts` 元信息。

## [0.2.0] - 2026-06-28

> 0.1.0（MVP）之后第一轮硬化：DQL chevrotain 内核重写、索引健壮性（阶段3）、阶段4 选型替换（Fuse.js / yaml / cosmiconfig）、`scan`、`meta` 写侧、`skills` 命令组重构、`X_BASALT_DIR`、本地 git 门禁与打包就绪。含 breaking（见 Changed 段）。

### Added

- **`meta` 命令 —— 首个写侧能力**（只改 frontmatter、正文逐字节不动）：`get` / `set` / `unset` / `rename`；`normalize` 归一（tags/aliases/cssclasses 列表化、tags 去 `#`、去重、单数键→复数键迁移）；`profile list` / `show` 与 `apply <profile>`（内置 `pkm-note` / `llm-wiki` / `ssg-blog` 三套策略：机械补 created/modified/sha256 + `--set` 补语义 + 收尾自动归一）。YAML 往返保键序/注释、原子写、幂等、`--dry-run`、非法 YAML 拒写。
- **`scan` 命令** —— 无常驻 watcher 的按需增量重索引：diff 文件系统 vs 库、只重扫变化的（`--rehash` 按内容、`--dry-run`、`--json`）。
- **`skills` 子命令扩展**：`get <name>`（按名取整篇）、`get --all`、`path [name]`；所有读子命令支持 `--json`（默认输出人类 / AI 可读 Markdown）。
- **DQL 子集大幅扩展**：`TASK` / `GROUP BY` / `FLATTEN` / `WITHOUT ID`、多键 `SORT`、`WHERE field = null`、日期 ISO 比较、字符串谓词 `contains/icontains/startswith/endswith/regexmatch`、内置函数 `lower/upper/length/round` 与 `date(today)/date(now)`。
- **`X_BASALT_DIR` 环境变量**：自定义 `.x-basalt` 基目录（config 与 `index.db` 都落其下）。
- 本地 git 门禁：受版本控制的 `.githooks/pre-push`（push 前跑 typecheck + test + lint），`pnpm install` 经 `prepare`（`scripts/setup-hooks.mjs`）自动接线 `core.hooksPath`，零新依赖、不依赖云端 CI。
- 打包就绪：`LICENSE`（MIT）、`CHANGELOG.md`、`package.json` 的 `author` 与 `prepublishOnly` 发布门（typecheck + test + build）。

### Changed

- **（breaking）`skill` 命令组改名为 `skills`**（复数，**不保留单数别名**），对齐 agent-browser / Gemini CLI / Claude Code 等生态惯例。
- **（breaking）内置自我说明书 skill 改名 `x-basalt-usage` → `x-basalt`**（作为全局主 skill 反向召回的对象，用工具名最直观）。
- `skills` 读子命令默认输出由 JSON 改为人类 / AI 可读 Markdown，`--json` 切回结构化。
- DQL 引擎改用 chevrotain（词法 + parser），越界带位置报 `DqlSyntaxError`；旧手写 tokenizer 移除。
- skill 召回改用 Fuse.js（模糊容错 + 相关性排序）；`SkillDefinition` 增 `description` 字段。
- config 加载改用 cosmiconfig；YAML 解析 / 序列化改用 `yaml` 包（修以 `---` 开头被吞键）；CLI 输出序列化抽到 `src/format.ts`。
- 索引：大库流式 rebuild（分批事务，内存 O(批)）；inlinks/outlinks 路径感知（qualified 链接精确匹配、bare 链接按 basename 回退）。
- 解析层评估后保留自建（不引入 remark-obsidian-md）；清理 `unified` / `remark-parse` / `@flowershow/remark-wiki-link` / `zod` 等零 import 死依赖。

### Fixed

- parser：剔除围栏代码块（` ``` `/`~~~`）与行内代码（成对反引号）内的 `#tag` 与 `==高亮==`，不再把代码里的 `# 注释`、字符串误识为标签 / 高亮（修复真实 vault 上 `FROM #tag` 静默多命中）。（该 commit 实际落在 0.1.0 发布窗口内，因 0.1.0 段已冻结，回溯归入本段。）
- skills 安装：frontmatter `scope` 检测兼容 CRLF 行尾（Windows `autocrlf`）——此前 CRLF 下正则匹配失败致 `scope` 永远落到 `project`，全局安装一个都装不上、项目安装误纳 global 技能。（同上，commit 落在 0.1.0 发布窗口内，回溯归入本段。）

## [0.1.0] - 2026-06-25

### Added

- MVP：纯 Node.js CLI，零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault。
- parser：解析 Obsidian 专有语法 → `ObsidianNode[]`（wikilink/embed/tag/callout/task/highlight/blockRef）+ frontmatter。
- indexer：调 parser 写 SQLite（files/links/tags/tasks/blocks 五表），chokidar 增量监听。
- query：手写 DQL 子集 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段（inlinks/outlinks/tags/tasks）查询期 JOIN 实时计算。
- skill：JSON5 加载 + 模糊召回，内置 `obsidian-base-spec` 与 `x-basalt-usage` 兜底。
- cli：commander 五子命令 `parse / index / query / skill / watch`，支持 `--format`、`--watch`、`--on-change`，及项目 / 全局配置文件。

[Unreleased]: https://github.com/xnightsky/x-basalt/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/xnightsky/x-basalt/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/xnightsky/x-basalt/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/xnightsky/x-basalt/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/xnightsky/x-basalt/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/xnightsky/x-basalt/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/xnightsky/x-basalt/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/xnightsky/x-basalt/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xnightsky/x-basalt/releases/tag/v0.1.0

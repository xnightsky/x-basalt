# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

> 0.1.0（MVP）之后、dogfood 观察期内的累积变更，尚未发布。

### Added

- **Bases 无头引擎（`src/base/`）+ `base` 命令** —— 无 GUI、无 Obsidian 运行时执行 `.base` view 查询（conformance `bases-markdown-2026-07`）：独立 Chevrotain 表达式文法（与 DQL token/AST 零共用）、递归 `and`/`or`/`not` filter、note/file 属性、白名单函数（string/list/object/file/time/number）、`order`/`sort`/`limit`、稳定 JSON 契约（`total` 为 limit 前行数、`file.path` 稳定 tie-break、字节稳定）、执行预算（文档/深度/节点/行数/集合/操作数硬上限）。P2 增量：`formulas`（依赖图拓扑 + `base/formula-cycle`）、算术与 duration 字面量、Date/Duration/Link 值、`today`/`now`（clock 注入）、list 高阶（`filter`/`map`/`reduce`/`flat`/`sort`/`unique`/`join`/`mean`）、`.obsidian/types.json` 可选只读、view `groupBy`（`groups` 增量字段）与 15 内置汇总 + 自定义 `values` 汇总。数据集默认 md-only（恒发 `base/markdown-only-dataset` warning；附件不为行，P3a 起可用 `--conformance bases-all-files-2026-07` 切换）；官方争议语义为暂定口径，待串行 oracle 冻结。
- **Bases P3a 附件数据集（all-files）** —— indexer 将非 `.md` 附件（图片 / PDF / `.base` / `.canvas` 等一切非隐藏文件）以纯 stat 元数据写入独立 `vault_entries` 表（`index` / `scan` / `watch` 同步，跨表 path 唯一，`scan --json` 报告新增附件计数字段）；`base` 新增 `--conformance <id>`：`bases-all-files-2026-07` 把附件并入数据集为行（附件行 `file.*` stat 字段可用、note 属性投影 `null`、`file.tags` / `file.links` 恒 `[]`、不发 md-only warning），缺省 `bases-markdown-2026-07` 行为不变；旧库无 `vault_entries` 表时自动降级 md-only + compat warning。**DQL 数据集不变——附件永不进 `query` 结果。**
- **Bases 函数覆盖率补齐（片一）** —— 新增 16 个叶子函数：string `replace`（字面子串全局替换，非正则）/ `repeat` / `reverse`（按 Unicode 码点）/ `slice` / `split` / `title` / `isEmpty`，number `abs` / `ceil` / `floor` / `toFixed`（返 string）/ `isEmpty`，list `reverse` / `slice`，global `max` / `min`（变长 number 参）。**number 独立成分派组**（`round` 由 `any` 组迁入，语义不变）。渲染类 `escapeHTML` / `html` / `image` / `icon` 进白名单但显式拒绝：报 `base/unsupported-feature`「无头内核不渲染」而非误导性的 `base/unknown-function`。`random()` 同样显式拒绝，但理由是**与字节稳定契约冲突**（同一输入必得同一输出是本引擎最硬的保证，不为一个叶子函数让路）——诊断消息与渲染类分开。
- **Bases 函数覆盖率补齐（片二 · date/duration 族）** —— global 构造 `date(v)`（严格 ISO 字符串 / date 幂等 / number 按 epoch 毫秒，`date(file.ctime)` 可用）与 `duration(v)`（`"1 day"` 长单位与官方短单位 `y M w d h m s`，**大小写敏感**：`M`=月、`m`=分）；新增 **date 方法分派组** `format(fmt)` / `time()` / `relative()` / `isEmpty()`。`format` 只做与语言无关的数字 token（`YYYY MM DD HH mm ss` 及不补零变体，全部按 UTC，`[方括号]` 转义字面量），月名/星期名等本地化 token **报错而非静默输出英文**；`time()` 返回当日零点起的 duration（可比较可运算）；`relative()` 固定英文、时间源恒为注入 clock。**口径变化**：`date()`/`duration()` 晚于本仓 2026-07-22 官方快照，此处显式采纳（`%` 取模仍不采纳）。
- **Bases 函数覆盖率补齐（片三 · file/link 互转）** —— global 构造 `file(path)`（在**本次查询的行集内**三级解析：完整路径 → 去扩展名忽略大小写路径 → 文件名；找不到给 `null`，不伪造空 file 值）与 `link(target, display?)`（纯值构造，不检查文件存在性）；新增 **link 方法分派组** `asFile()`；file 方法新增 `asLink(display?)` 与 `linksTo(x)`（字符串/link 入参与 `hasLink` 同一匹配，**file 入参走解析**，故 `[[Beta]]` 简写也算链到 `Projects/Beta.md`）。**含文法增量**：`file` 是关键字 token，此前 `file(...)` 直接语法错误，现由根引用规则的调用分支支持，`file.name` / 裸 `file` / `file["name"]` / `file.hasTag(...)` 行为不变。
- **Bases 函数覆盖率补齐（片四 · 正则）** —— `string.matches(pattern)`（pattern 是**字符串**，正则字面量 `/…/` 仍在文法层拒绝；子串命中语义）+ **三层 ReDoS 防护**：①静态拒绝灾难性回溯构造（无界量词套无界量词/交替，如 `(a+)+`）与反向引用；②限长（pattern 200 / 被匹配串 10000，与 DQL 侧同档）；③有界编译缓存（上限 64）。新增 rule `base/invalid-regex`——非法或不安全的正则**行级报错，不静默当作「不匹配」**（与 DQL 侧 `regexmatch` 降级为 0 的策略有意不同：那边在 SQLite 自定义函数内不便产诊断，Bases 侧硬约束是不静默忽略）。
- **Bases 函数覆盖率补齐（片五 · 分组键与组级汇总）** —— `groupBy` 不再拒绝多值键：**list 分组键扇出**（一行进入它每个元素的组，`groupBy: tags` 的自然语义；行内元素先去重，空 list 视同缺失键单独成组，不丢行），link 作为**标量**键按路径感知相等分组。扇出使 `groups` 各组行数之和可能大于 `rows.length`——顶层 `rows` 仍是平铺一份，契约已显式声明。新增 `groups[].summaries` 组级汇总（计算集 = 该组 limit 后的行，与顶层「filter 后 limit 前全量」有意不同）。
- **Bases 函数覆盖率补齐（片六 · 显式动态上下文）** —— `x-basalt base --context-file <path>` 为 `this.*` 提供**显式**上下文：`this.file.*` 取该文件的 file 字段、`this.<属性>` 取它的 frontmatter、裸 `this` 是它的整个 frontmatter，公式体内同样可用。路径写法与 `file(path)` 一致（完整路径 / 去扩展名忽略大小写 / 文件名）；不传就报 `base/dynamic-context-required`（无头执行没有「当前活动文件」，不猜），传了却找不到该文件则 error + 空结果（不静默当没给）。Markdown 内嵌 ```` ```base ```` 代码块与 `![[View.base#Name]]` 嵌入**明确不做**，但在**读文件之前**的入口形态检查处给出 `base/unsupported-feature` 诊断并附替代写法（`#锚点` → `--view`；非 `.base` → 单独存成 `.base`），不再退化成一句 YAML 解析失败。
- **`meta` 命令 —— 首个写侧能力**（只改 frontmatter、正文逐字节不动）：`get` / `set` / `unset` / `rename`；`normalize` 归一（tags/aliases/cssclasses 列表化、tags 去 `#`、去重、单数键→复数键迁移）；`profile list` / `show` 与 `apply <profile>`（内置 `pkm-note` / `llm-wiki` / `ssg-blog` 三套策略：机械补 created/modified/sha256 + `--set` 补语义 + 收尾自动归一）。YAML 往返保键序/注释、原子写、幂等、`--dry-run`、非法 YAML 拒写。
- **`scan` 命令** —— 无常驻 watcher 的按需增量重索引：diff 文件系统 vs 库、只重扫变化的（`--rehash` 按内容、`--dry-run`、`--json`）。
- **`skills` 子命令扩展**：`get <name>`（按名取整篇）、`get --all`、`path [name]`；所有读子命令支持 `--json`（默认输出人类 / AI 可读 Markdown）。
- **DQL 子集大幅扩展**：`TASK` / `GROUP BY` / `FLATTEN` / `WITHOUT ID`、多键 `SORT`、`WHERE field = null`、日期 ISO 比较、字符串谓词 `contains/icontains/startswith/endswith/regexmatch`、内置函数 `lower/upper/length/round` 与 `date(today)/date(now)`。
- **`X_BASALT_DIR` 环境变量**：自定义 `.x-basalt` 基目录（config 与 `index.db` 都落其下）。
- **全局使用技能** `skills-def/cli/x-basalt/SKILL.md`（`scope: global`，`pnpm run skills:install:global` 装到 `~/.claude/skills/` 与 `~/.agents/skills/`），教任意 AI 会话驱动本 CLI。
- 本地 git 门禁：受版本控制的 `.githooks/pre-push`（push 前跑 typecheck + test + lint），`pnpm install` 经 `prepare`（`scripts/setup-hooks.mjs`）自动接线 `core.hooksPath`，零新依赖、不依赖云端 CI。
- 打包就绪：`LICENSE`（MIT）、`CHANGELOG.md`、`package.json` 的 `author` 与 `prepublishOnly` 发布门（typecheck + test + build）。

### Changed

- **`docs/` 按读者重组**（原按文档类型分 `guides`/`specs`/`plans`/`research`/`testing`/`architecture`）：`use/`（怎么用，文件名去日期）、`design/`（当前有效的设计，去日期）、`history/`（归档，保留日期前缀，只进不出）、`plans/`（仅活跃计划，完成后 `git mv` 进 `history/plans/`）。**Bases 三份指南合一** —— `writing-bases.md` + `querying-bases.md` + 总纲 → 一份 `use/bases.md`（是什么 → 六步教程 → 语法速查 → 命令与输出契约 → 报错速查，一份读完就会用），原理部分独立为 `design/bases-vs-official.md`（官方 CLI 架构与五个实测坑 / 我们的流水线与六个关键决策 / 9 项待 oracle 暂定语义）。四份 README 全部重写为分流入口而非文件清单。72 份文件经 `git mv` 保留历史；内链按 git 重命名记录批量重写，docs 断链 85 → 50（剩余全部为归档内既有断链，`design/` 与 `use/` 零断链）。
- **`format` / `format:check` 作用域收敛为 `src tests scripts`**（原 `oxfmt .`），并新增 `.prettierignore` 豁免 `tests/fixtures/`（oxfmt 只认 `.gitignore` / `.prettierignore`，无 `.oxfmtignore`）。此前该门禁**从未可通过**：fixtures 里有故意写坏的 JSON（BASE-TYPE-003 回退用例），格式化器解析即报错中止整次检查。同时一次性格式化了此前从未被覆盖的 13 个代码文件（纯换行合并/拆分）。docs 的 80 个 md 暂不纳入作用域——markdown 重排与本轮无关且会淹没内容改动。
- **skills-def 入口薄化 + `cli/`/`dev/` 目录分组**：外层 `x-basalt` 入口 skill 改为薄「触发 + 指路」——用法一律 `x-basalt skills get core`，不再重抄命令表/DQL 细节，消开发文档与运行时 `core` 的二次漂移。`skills-def/` 按受众分 `cli/`（消费侧入口，装宿主全局）与 `dev/`（`biz-*` 开发侧，装本仓）；`install-skills.mjs` 改按**目录**路由（原按 `scope` frontmatter），`skills:install` / `skills:install:global` 两脚本语义不变。运行时 `core` 补 `X_BASALT_DIR` 说明。
- **（breaking）`skill` 命令组改名为 `skills`**（复数，**不保留单数别名**），对齐 agent-browser / Gemini CLI / Claude Code 等生态惯例。
- **（breaking）skill 运行时数据目录 `skills/` → `skills-data/`**，避免与 `skills` 命令前缀混淆、对齐 agent-browser；外部覆盖路径 `OBSIDIAN_SKILL_PATH` / 配置 `skillPath` / `~/.obsidian-core/skills` 不变。
- **（breaking）内置自我说明书 skill 改名 `x-basalt-usage` → `x-basalt`**（作为全局主 skill 反向召回的对象，用工具名最直观）。
- `skills` 读子命令默认输出由 JSON 改为人类 / AI 可读 Markdown，`--json` 切回结构化。
- DQL 引擎改用 chevrotain（词法 + parser），越界带位置报 `DqlSyntaxError`；旧手写 tokenizer 移除。
- skill 召回改用 Fuse.js（模糊容错 + 相关性排序）；`SkillDefinition` 增 `description` 字段。
- config 加载改用 cosmiconfig；YAML 解析 / 序列化改用 `yaml` 包（修以 `---` 开头被吞键）；CLI 输出序列化抽到 `src/format.ts`。
- 索引：大库流式 rebuild（分批事务，内存 O(批)）；inlinks/outlinks 路径感知（qualified 链接精确匹配、bare 链接按 basename 回退）。
- 解析层评估后保留自建（不引入 remark-obsidian-md）；清理 `unified` / `remark-parse` / `@flowershow/remark-wiki-link` / `zod` 等零 import 死依赖。

### Fixed

- **`format:check` 门禁此前不可信（随机红绿）—— 新增 `.gitattributes` 统一行尾为 LF**。仓库一直没有 `.gitattributes`，行尾完全由各人本机 `core.autocrlf` 决定：Windows 上（Git for Windows 系统级 gitconfig 默认 `autocrlf=true`）checkout 把工作区转成 CRLF，而 oxfmt / 编辑器改写文件时又写回 LF——于是 `oxfmt --check` 报不报错取决于「某个文件最近有没有被工具重写过」，与仓库内容无关（index 侧本就 100% LF，把 HEAD 原始 blob 取出单跑 `--check` 是通过的）。这道门还**单向漂移**：被改过的文件转 LF 变绿，看着像在自愈，但全新 clone 上作用域内文件会大面积红。7826506 那次「修好 format 门禁」只处理了作用域与 fixtures 豁免，没碰行尾，故未根治。现加 `* text=auto eol=lf` 让 checkout 也写 LF；`git add --renormalize .` 对 index **零改动**（内容本就干净），本次提交无任何文件内容变更。**注**：`.githooks/pre-push` 仍只跑 typecheck / test / lint、不含 `format:check`，这层缺口未在本次处理。
- **内置规范 `obsidian-base-spec` 的 tag 口径与实现漂移**（规范是 AI 构造 DQL / 判断 frontmatter 的接地材料，写错即误导）：该篇声明的标签正则是 `(^|\s)#([A-Za-z0-9_\-/]+)`，与 `src/parser` 的实际实现**两处不符**——(1) 要求前导「行首或空白」，实现用的是「`#` 前不能是 Unicode 字母/数字/下划线」的负向后顾（`标签：#moc` 实际成立、规范说不成立）；(2) 声明纯 ASCII，实现取 Unicode 字母数字（`#概念` 实际成立、规范说不成立）。**解析行为不变**，只把规范文本改成与实现逐字符一致，并补中文边界样例。同时落一条 **documented boundary**：与 Obsidian 实际行为的对照验证显示，Obsidian 会把紧跟标签的非空白 Unicode 标点计入标签本身（`再打一次 #概念。` → Obsidian 得标签 `概念。`），x-basalt 在标点处终止得 `概念`；这是**有意差异**——该边界在 Obsidian 侧无权威规格（官方文档所列允许字符与实现不符且逐版本变动），跟随会让中文标签按句读碎片化（`概念` / `概念。` / `概念，` 各成一个）并使 `FROM #概念` 前缀查询在句末标签上失效。同款边界声明已同步到 `docs/use/obsidian-syntax.md` 与开发侧 skill `biz-obsidian-spec`。该篇 `description` 另追加范围声明：只讲 Obsidian Markdown 与 DQL 文法，**不涉及 Bases（`.base`）语法**（名字里的 "base" 指「基础规范」，防召错）。
- **Bases code review 修复批次**（[计划](./docs/history/plans/2026-07-27-bases-code-review-fixes.md)），四类静默失败 + 两处资源模型缺口：
  - `.base` 的 view **缺少 `type` / `name` 不再静默通过**——必填校验此前只在「键存在」时触发，缺 `type` 的 view 会被当 table 执行完（与「未知 type 不按 table 猜测」矛盾），缺 `name` 的两个 view 还能同时逃过重名判定。**（行为收紧：这类 `.base` 由静默执行改为 error + 空结果，CLI exit 1）**
  - **Windows 下 vault 根盘符大小写不同不再误判路径越界**——`d:\vault` 配 `D:\vault\...` 此前触发 `base/path-outside-vault`，合法路径被安全门假阳拒绝。判定收敛为 `utils/path.ts` 新增的共享原语 `isPathInside`（Windows 大小写不敏感），indexer 的根归属判定与编排器路径还原一并复用（此前同样会在大小写不同时漏索引）。
  - **多根 vault 下 `.base` 主键补齐 `<根目录名>/` 命名空间前缀**——此前同一个 `BaseQueryResult` 里 `base` / 诊断 `file` 与行 `file.path` 是两套键。改为统一经 `resolveVaultLayout`（indexer 写 `files.path` 用的同一函数）计算。**（多根输出契约变更；单根字节级不变）**
  - `order` / `sort` 的非法项（非字符串 / 非 map / 空 property）**不再静默丢弃**，各产 `base/invalid-schema`。
  - 新增 **`maxTotalOperations`** 查询级操作数总额（默认 5000 万，跨行累计）：此前 `maxOperations` 每次表达式求值即重置，最坏总量 `maxRows × 列数 × maxOperations` ≈ 1e11 而预算「从未耗尽」；groupBy 分桶与 summaries 迭代原本各自另开一份额度，现并入同一份总额。
  - 表达式解析缓存改为有界 LRU（512 条）——此前模块级 `Map` 无淘汰，长驻进程（chat REPL）内存随会话累计的 `.base` 数量单调增长。
- **不加引号的 frontmatter 日期不再静默失去日期语义**（真实 vault 普遍命中的静默错）：`due: 2026-08-10` 此前经 gray-matter 内置 js-yaml（YAML 1.1 `!!timestamp`）解析为 JS `Date`，落库变 `"2026-08-10T00:00:00.000Z"`（含毫秒），超出 Bases 严格 ISO 推断形态 → 退化为普通字符串 → `due < now()` 一类比较只给行级 warning + cell `null`，而查询仍以退出码 0「成功」。读侧 frontmatter 解析改用 `yaml` 包（YAML 1.2 core 无 timestamp 隐式类型，**与写侧 `src/meta` 统一引擎**），日期保持字符串、由值层按词法判定精度——`YYYY-MM-DD` → date、`YYYY-MM-DDTHH:mm[:ss]` → datetime，加不加引号完全等价且 date 精度不退化。
- parser：剔除围栏代码块（` ``` `/`~~~`）与行内代码（成对反引号）内的 `#tag` 与 `==高亮==`，不再把代码里的 `# 注释`、字符串误识为标签 / 高亮（修复真实 vault 上 `FROM #tag` 静默多命中）。
- skills 安装：frontmatter `scope` 检测兼容 CRLF 行尾（Windows `autocrlf`）——此前 CRLF 下正则匹配失败致 `scope` 永远落到 `project`，全局安装一个都装不上、项目安装误纳 global 技能。

## [0.1.0] - 2026-06-25

### Added

- MVP：纯 Node.js CLI，零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault。
- parser：解析 Obsidian 专有语法 → `ObsidianNode[]`（wikilink/embed/tag/callout/task/highlight/blockRef）+ frontmatter。
- indexer：调 parser 写 SQLite（files/links/tags/tasks/blocks 五表），chokidar 增量监听。
- query：手写 DQL 子集 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段（inlinks/outlinks/tags/tasks）查询期 JOIN 实时计算。
- skill：JSON5 加载 + 模糊召回，内置 `obsidian-base-spec` 与 `x-basalt-usage` 兜底。
- cli：commander 五子命令 `parse / index / query / skill / watch`，支持 `--format`、`--watch`、`--on-change`，及项目 / 全局配置文件。

[Unreleased]: https://github.com/xnightsky/x-basalt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xnightsky/x-basalt/releases/tag/v0.1.0

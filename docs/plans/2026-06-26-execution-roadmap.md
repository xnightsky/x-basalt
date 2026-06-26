# 可执行路线图：全模块收口 + 做深内核（x-basalt → 可信 1.0）

> 日期：2026-06-26 · 类型：大型执行计划（跨全部 5 个一级模块）
> 依据：生态定位 [`../research/2026-06-26-libraries-survey.md`](../research/2026-06-26-libraries-survey.md)、体检 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md)、覆盖矩阵 [`../specs/2026-06-26-coverage-matrix.md`](../specs/2026-06-26-coverage-matrix.md)、依赖决策 [`../specs/2026-06-26-deps-build-vs-buy.md`](../specs/2026-06-26-deps-build-vs-buy.md)、许可证政策 [`../guides/dependency-license-policy.md`](../guides/dependency-license-policy.md)

## 为什么这么做（一句话依据）

生态定位结论：**解析/索引是成熟或常规领域（该组装、该用现成库），唯一稀缺、有难度、能撑起代表作的是「headless DQL→SQL 引擎」**。因此本路线图把解析层改为组装、索引/skill/cli 用现成库收编，**把工程纵深押在 DQL 内核**。

## 已定决策（本路线图的前提）

| 决策 | 取值 | 影响 |
|---|---|---|
| Node 基线 | **`engines.node >=22`** | 解锁 chevrotain（DQL 文法）、`node:sqlite`；消除 better-sqlite3 12 / chokidar 5 冲突 |
| 执行范围 | **全模块一起收口** | 6 阶段覆盖 parser/indexer/query/skill/cli + 工程 |
| 解析层 | **组装**（remark 生态）+ 自建收敛 tag/task/blockRef/due_date | 停止手撸全量解析 |
| DQL 引擎 | **纯自研做深**（文法工具重写 + 补全子集 + 覆盖矩阵 + 测试） | 代表作核心 |
| 许可证 | 只用宽松证；GPL/AGPL/未声明禁用 | 见许可证政策指南 |
| **规范对标** | **严格对标官方 Obsidian/Dataview；自定义口径与官方无冲突时以官方为准** | 落到 `biz-obsidian-spec`/`biz-dql-subset` 真相源 |
| **范围外（不做）** | **DataviewJS（`dataviewjs` 代码块执行任意 JS）** | 需运行时执行任意 JS 访问 dv API，超范围且有安全问题；明确不做 |

## 全局执行约定

- **每步格式**：目标 / 动作 / 验收标准 / 证据命令 / 前置。完成把 `- [ ]` 勾成 `- [x]`。
- **TDD**：功能步骤先写测试（red）再实现（green）；验收以测试通过为准（AGENTS.md 测试规范 + superpowers TDD）。
- **证据命令**：跑给定命令并依据**实际输出**判定，不靠"应该可以"。
- **门禁口径**：每步至少跑受影响边界的 `typecheck` + 对应测试；触及公共契约/根脚本时升级到全量 `typecheck`/`build`/`test`/`lint`。
- **执行真相源**：正式开工时在根建 `TODO.md` 链接本文件；每阶段收口在文末 Evidence 追加运行记录。
- **不静默扩范围**：偏离本路线图先更新本文件再做。

---

## 阶段 0 · 基线与前置（解锁后续一切）

- [x] **S0.1 升 Node 基线到 22**
  - 动作：`package.json` 改 `"engines": { "node": ">=22" }`；`tsconfig` 的 `lib`/`target` 视需要校到对应 ES 版本；README/AGENTS 技术栈表同步。
  - 验收：`node -v` ≥ 22；`pnpm install` 成功；`engines` 与实际依赖(better-sqlite3 12 / chokidar 5)不再冲突。
  - 证据：`node -v`；`pnpm install`（exit 0）；`pnpm run typecheck`（exit 0）。
  - 前置：无。

- [x] **S0.2 测试脚本改 glob，新增测试自动纳入**
  - 动作：`package.json` 的 `test` 改为 `node --import tsx --test "tests/**/*.test.ts"`（Node 22 原生支持 glob）。
  - 验收：新建一个空 `tests/_smoke.test.ts` 能被发现并运行；删除后恢复。
  - 证据：`pnpm test` 输出包含新文件；运行后删除占位。
  - 前置：S0.1。

- [x] **S0.3 死依赖清理（按依赖决策）**
  - 动作：移除 `src/**` 零 import 的 `zod`；`unified`/`remark-parse`/`@flowershow/remark-wiki-link` 暂留（阶段 1 决定去留）。
  - 验收：`zod` 从 `package.json` 移除后 `typecheck`/`test` 全绿。
  - 证据：`pnpm run typecheck`；`pnpm test`（均 exit 0）。
  - 前置：S0.1。

- [x] **S0.4 许可证基线扫描**
  - 动作：按 [`许可证政策`](../guides/dependency-license-policy.md) 检查现有依赖；引入 `license-checker`/`pnpm licenses list` 跑一次，记录结果到依赖决策文档。
  - 验收：无 GPL/AGPL/未声明依赖；有清单为证。
  - 证据：`pnpm licenses list`（或 `npx license-checker --summary`）输出无 GPL/AGPL。
  - 前置：S0.1。

- [x] **S0.5 门禁基线快照**
  - 动作：记录当前 `typecheck`/`test`/`lint`/`build` 结果作为回归基线（写入本文件 Evidence）。
  - 验收：四项命令均有明确 exit code 记录。
  - 证据：依次跑 `pnpm run typecheck`/`pnpm test`/`pnpm run lint`/`pnpm run build`。
  - 前置：S0.1。

---

## 阶段 1 · 解析层改为组装（解决 parser 类缺陷）

> **已下钻为原子子步**，详见 [`2026-06-26-modules-steps.md`](2026-06-26-modules-steps.md) 阶段 1。下面为总览，执行以细化清单为准。

- [ ] **S1.1 复核 remark-obsidian-md 许可证与能力（卡点）**
  - 动作：查其 repo `LICENSE` 文件确认是否宽松证（manifest license 字段缺失）；跑最小 spike 解析样例，确认 wikilink/embed/callout(`+/-`)/highlight 的 AST 字段。
  - 验收：许可证为宽松证 **且** 四类节点字段满足映射需求；否则改用单点插件组合（@r4ai/remark-callout + remark-flexible-markers + wiki-link 插件）或保留自建。
  - 证据：贴出 repo LICENSE 结论；spike 脚本输出样例 AST。
  - 前置：S0.1。**许可证不过则本阶段切到备选方案。**

- [ ] **S1.2 搭 unified 管线 + 适配层（red→green）**
  - 动作：先写 `tests/parser.test.ts` 对现有 5 个 fixture 的期望节点（沿用现有断言）；再用 `unified().use(remarkParse).use(remarkObsidianMd)` + visitor 把 mdast 映射到 `ObsidianNode`。
  - 验收：现有 parser 测试全绿；wikilink/embed/callout/highlight 由库产出，**P1（wikilink 代码块掩码不一致）、P4（callout `+/-` 折叠态丢失）消除**。
  - 证据：`pnpm test tests/parser.test.ts`（全绿）。
  - 前置：S1.1。

- [ ] **S1.3 自建收敛到 tag / task / blockRef + 补 due_date（red→green）**
  - 动作：tag/task/blockRef 保留自建正则（库不覆盖）；**新增 task `due_date` 提取**（`YYYY-MM-DD`，调研 §2 要求）；统一代码块掩码口径（这三类也走 maskCode）。
  - 验收：新增 due_date 测试通过；代码块内 `#tag`/task/blockRef 不再误提取（**P2/P3 消除**）。
  - 证据：`pnpm test tests/parser.test.ts`（含新 due_date / 代码块用例，全绿）。
  - 前置：S1.2。

- [ ] **S1.4 清理解析层死依赖 + 同步契约文档**
  - 动作：移除被库取代的 `@flowershow/remark-wiki-link`；更新设计 §3.1（去掉"零 import"偏差标注，改为实际管线）、覆盖矩阵 parser 行。
  - 验收：`typecheck`/`test` 全绿；设计文档与代码一致。
  - 证据：`pnpm run typecheck`；`pnpm test tests/parser.test.ts`。
  - 前置：S1.3。

---

## 阶段 2 · DQL 内核做深（代表作核心 · 重头戏）

> **本阶段已下钻为 24 个原子子步**，详见 [`2026-06-26-dql-kernel-steps.md`](2026-06-26-dql-kernel-steps.md)（含真相源冲突卡点）。下面 7 步为总览，执行以细化清单为准。

- [x] **S2.1 文法工具选型 spike：chevrotain vs peggy（卡点）** ✅ 2026-06-27 → 选 **chevrotain**
  - 动作：各写一个最小 spike 解析 `LIST FROM #x WHERE a = 1 SORT b DESC LIMIT 5`，验证 ESM/NodeNext 接入、错误位置、TS 类型体验。
  - 验收：选定其一（推荐 **chevrotain**：纯 TS、无生成步骤、Node22 已满足、错误恢复 + IDE 友好）；记录决策到 specs。
  - 证据：两 spike 均产出一致 AST；决策 + 评估矩阵见 [`../specs/2026-06-27-dql-grammar-tool-decision.md`](../specs/2026-06-27-dql-grammar-tool-decision.md)。chevrotain 已落 `dependencies`、peggy 已移除。
  - 前置：S0.1。

- [ ] **S2.2 冻结目标 DQL 子集 + AST 契约**
  - 动作：以 obsidian-dataview 源码 `src/query/parse.ts` 为**参考**（只读、不依赖），在 specs 写出目标子集与 AST 类型：LIST/TABLE/TASK + FROM(#tag/folder/[[link]]/AND/OR/NOT) + WHERE(比较/逻辑/函数/null/日期) + SORT(多键) + LIMIT + GROUP BY + FLATTEN + WITHOUT ID + 隐式字段全集。
  - 验收：specs 有冻结的子集清单 + AST 类型；标明 CALENDAR/DataviewJS 为范围外。
  - 证据：specs 文档评审通过（自检：每条都能对到 SQL 策略）。
  - 前置：S2.1。

- [ ] **S2.3 用选定工具重写 tokenizer→parser（red→green）**
  - 动作：先把现有 `tests/query.test.ts` 11 例迁为新引擎期望（red）；用 chevrotain/peggy 实现新 parser 产出 S2.2 的 AST。
  - 验收：现有 query 测试在新 parser 上全绿；语法错误抛带位置的 `DqlSyntaxError`。
  - 证据：`pnpm test tests/query.test.ts`（全绿）。
  - 前置：S2.2。

- [ ] **S2.4 修已确认 query bug（red→green）**
  - 动作：逐个加测试再修：Q1 LIKE 通配符转义（`%`/`_` + ESCAPE）、Q2 icontains 对 tags/inlinks/outlinks 大小写、Q3 TABLE 重复 `file.name`、Q4 未知字段抛 `DqlSyntaxError`、SORT JSON 列报错、LIMIT 负数校验。
  - 验收：每个 bug 有专门测试且通过；旧测试不回归。
  - 证据：`pnpm test tests/query.test.ts`（含 6 个新回归用例，全绿）。
  - 前置：S2.3。

- [ ] **S2.5 补全子集 ①：多键 SORT + WHERE 函数/null/日期（red→green）**
  - 动作：每个特性先写测试再实现 AST→SQL：多键 SORT、`contains/icontains/startswith/endswith` 完整、null 判断、日期比较、必要的函数（如 `date(today)` 的最小集，范围在 S2.2 冻结）。
  - 验收：覆盖矩阵对应格从 ❌/⚠️ 变 ✅，每格有测试。
  - 证据：`pnpm test tests/query.test.ts`。
  - 前置：S2.4。

- [ ] **S2.6 补全子集 ②：GROUP BY / FLATTEN / WITHOUT ID（red→green）**
  - 动作：实现这三个子句的 AST→SQL（GROUP BY 聚合、FLATTEN 展开、WITHOUT ID 列控制）；TASK 查询类型（若纳入）。
  - 验收：每子句有端到端测试；覆盖矩阵更新。
  - 证据：`pnpm test tests/query.test.ts`。
  - 前置：S2.5。

- [ ] **S2.7 DQL 覆盖矩阵收口（黑盒消除）**
  - 动作：更新 [`覆盖矩阵`](../specs/2026-06-26-coverage-matrix.md) DQL 部分到实际状态；每个 ✅ 必须有测试编号佐证；明确剩余 ❌（CALENDAR/DataviewJS）。
  - 验收：矩阵无"声称支持但无测试"的格；DQL 子集覆盖率有量化结论。
  - 证据：矩阵每行链接到测试用例；`pnpm test tests/query.test.ts` 全绿。
  - 前置：S2.6。

---

## 阶段 3 · 索引层健壮性 + 现成库收编

> **已下钻为原子子步**，详见 [`2026-06-26-modules-steps.md`](2026-06-26-modules-steps.md) 阶段 3。

- [ ] **S3.1 监听健壮性（red→green）**
  - 动作：补 `watcher.on("error")`（I1）；onUnlink 加 `.catch`（I2）；加 watch 增量测试（add/change/unlink）。
  - 验收：watcher error 不崩进程；增量测试通过。
  - 证据：`pnpm test tests/indexer.test.ts`（含 watch 增量 + error 用例）。
  - 前置：S0.1。

- [ ] **S3.2 basename 反链歧义修正（red→green）**
  - 动作：加同名异目录 fixture 测试（I5）；用路径感知的链接解析（优先全路径，回退 basename）修正 inlinks JOIN。
  - 验收：`[[A/Note]]` 与 `[[B/Note]]` 不再串味；测试通过。
  - 证据：`pnpm test tests/indexer.test.ts`。
  - 前置：S3.1。

- [ ] **S3.3 大库稳健性（rebuild 流式 + 并发 I/O）**
  - 动作：rebuild 改为分批/流式写事务（I3，避免全量内存）；文件读取加并发上限。
  - 验收：用较大 fixture（或生成数千文件临时 vault）rebuild 不 OOM；行数正确。
  - 证据：脚本生成临时大 vault → `pnpm cli -- index <tmp>` 成功；行数断言。
  - 前置：S3.2。

- [ ] **S3.4 引入 kysely 收编 SQL 生成（可选但推荐）**
  - 动作：DQL→SQL 的 SQL 构造改用 kysely（参数化、类型安全），替代手拼字符串；保留 better-sqlite3 执行。
  - 验收：query 全测试不回归；SQL 仍全参数化。
  - 证据：`pnpm test tests/query.test.ts`（全绿）。
  - 前置：S2.7（DQL 稳定后再换底）。

- [ ] **S3.5 FTS5 全文检索（可选，按需）**
  - 动作：建 `fts5` 虚拟表索引内容；暴露最小检索能力（CLI 或 DQL 内）。
  - 验收：全文检索返回正确命中；不破坏现有索引。
  - 证据：`pnpm test tests/indexer.test.ts`（含 FTS 用例）。
  - 前置：S3.3。

---

## 阶段 4 · skill 召回 + CLI/config 收编

> **已下钻为原子子步**，详见 [`2026-06-26-modules-steps.md`](2026-06-26-modules-steps.md) 阶段 4。

- [ ] **S4.1 skill 召回换 Fuse.js（red→green）**
  - 动作：先写召回质量测试（同义/前缀/模糊命中）；用 Fuse.js 对 `[{name,triggers}]` 建索引替代手写匹配；保留内置兜底。
  - 验收：召回测试通过；空目录仍兜底。
  - 证据：`pnpm test tests/skill.test.ts`。
  - 前置：S0.1。

- [ ] **S4.2 YAML 用 `yaml` 包（修两个 bug，red→green）**
  - 动作：config 解析改 `yaml.parse`（修 C4 `---` 吞掉）；CLI 输出改 `yaml.stringify`（修键未转义）。
  - 验收：以 `---` 开头的配置正确解析；含特殊字符的键/值序列化正确；config 测试通过。
  - 证据：`pnpm test tests/config.test.ts`。
  - 前置：S0.1。

- [ ] **S4.3 config 加载换 cosmiconfig（向上查找 + 合并）**
  - 动作：用 cosmiconfig 替自建路径搜索；保留 flag>项目>全局>默认优先级；补全局配置链测试（L4）。
  - 验收：优先级与向上查找测试通过；删去自建 config 大半。
  - 证据：`pnpm test tests/config.test.ts`（含全局链用例）。
  - 前置：S4.2。

- [ ] **S4.4 CLI 修缺陷 + 补端到端测试（red→green）**
  - 动作：新增 `tests/cli.test.ts` 覆盖五命令主路径 + 退出码 + 优先级链（C1）；`--format` 推广到 query/skill（C2）；`--on-change` 改 `execFile` 参数化或转义（C3）；非法 format 报错退出 1（C6）；顶层 catch 用 `instanceof Error`（C7）。
  - 验收：CLI 端到端测试全绿；上述每项有用例。
  - 证据：`pnpm test tests/cli.test.ts`。
  - 前置：S4.2、S4.3。

---

## 阶段 5 · 收口与发布

- [ ] **S5.1 覆盖矩阵 + 体检全量更新**
  - 动作：覆盖矩阵所有模块更新到实际；体检报告关闭已修项、保留遗留。
  - 验收：矩阵与代码一致；无"已修"项仍标 ❌。
  - 证据：人工核对 + 全量 `pnpm test`。
  - 前置：阶段 1–4 完成。

- [ ] **S5.2 文档同步（设计/调研/usage）**
  - 动作：设计 §3 契约更新；usage 修正误导项；README 示例随新能力更新并校验。
  - 验收：usage 中每条 CLI 示例实跑通过。
  - 证据：逐条 `pnpm cli -- ...` 跑通。
  - 前置：S5.1。

- [ ] **S5.3 全量门禁 + 发布元信息**
  - 动作：全量 `typecheck`/`lint`/`build`/`test` 绿；处理 docs 的 `oxfmt` 漂移决策；校 `version`/`files`/`bin`。
  - 验收：四项全绿；`node dist/cli.js --help` 正常；`npm pack` 产物正确。
  - 证据：`pnpm run typecheck`/`pnpm run lint`/`pnpm run build`/`pnpm test`；`npm pack --dry-run`。
  - 前置：S5.2。

- [ ] **S5.4 删除 TODO.md（执行结束标记）**
  - 动作：全部勾完后删根 `TODO.md`。
  - 验收：`TODO.md` 不存在。
  - 前置：S5.3。

---

## 阶段依赖

S0 → {S1, S2, S3, S4 可并行起步}；S2（DQL）是关键路径与最大投入；S3.4 依赖 S2.7；S5 依赖全部。

## 风险与停点

- **[卡点] S1.1 许可证**：remark-obsidian-md license 未明 → 不过则解析层切单点插件组合或保留自建，**不带病引入**。
- **[卡点] S2.1 文法工具**：spike 不通过（ESM 接入/类型）则回退另一工具；两者都不行则保留并改良现有手写 tokenizer。
- **范围纪律**：DataviewJS、CALENDAR 明确不做；新增能力先改本文件再实现。
- **Node 22 门槛**：使用者环境需 Node 22+，已在 `engines` 声明；这是为解锁 chevrotain/node:sqlite 的自觉取舍。

## Evidence

> 正式开工后每阶段在此追加：运行命令、关键输出、失败复现。

### 阶段 0 · 基线与前置（2026-06-27 完成）

环境：`node -v` = v24.14.1（满足 `engines.node >=22`）；`pnpm -v` = 10.33.0。

| 子步 | 命令 | 结果 |
|---|---|---|
| S0.1 | `package.json` engines `>=18`→`>=22`；`AGENTS.md` 技术栈 Node 18+→22+；tsconfig 维持 `target ES2022 / lib ES2023`（Node22+ 适配，无需改） | ✅ |
| S0.1/S0.3 | `pnpm install` | exit 0，移除 `zod 4.4.3`；锁文件 `grep -c zod`=0 |
| S0.2 | `package.json` test → `node --import tsx --test "tests/**/*.test.ts"`；建临时 `tests/_smoke.test.ts` 验证 | glob 自动发现，测试数 52→53；删除后恢复 |
| S0.3 | 移除 `src/**` 零 import 的 `zod`（package.json + AGENTS 技术栈表） | typecheck/test 全绿 |
| S0.4 | `pnpm licenses list` | 全量宽松证：MIT 103 / ISC 7 / BSD 4 / Apache-2.0 4；**零 GPL/AGPL/MPL/未声明** |
| S0.5 | `pnpm run typecheck` / `pnpm test` / `pnpm run lint` / `pnpm run build` | 四项均 exit 0；测试 52 pass / 0 fail |

门禁基线快照（回归基准）：typecheck=0，test=52 pass/0 fail，lint=0，build=0。
保留依赖中 `unified`/`remark-parse`/`@flowershow/remark-wiki-link` 仍零 import，按 S0.3 决策留到阶段 1 决定去留。

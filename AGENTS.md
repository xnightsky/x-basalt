# AGENTS.md · x-basalt

> 纯 Node.js CLI 工具：零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault，实现 Obsidian 规范的解析、索引、Dataview 子集查询与 Skill 召回。
> 本文件是项目「全局提示词」主体；`CLAUDE.md` 仅指向本文件。

## 响应与沟通

- 始终使用简体中文回答。
- 每次回复末尾附带单独一行 `[by=x-basalt]`。
- 探索、编码、验证前，先用 1-2 句说明当前目标和下一步动作。
- 完成任务时，必须分别说明：已验证项、未验证项、剩余风险。
- 若发现边界冲突、设计冲突、阶段切口冲突或隐藏的全局一致性风险，第一时间用 `**[冲突提示]**` 单独高亮：写明冲突点、影响范围、建议停点、是否需要先更新计划/文档。不得拖到实现后或验收时集中暴露。

## 工作方式

- 先做非破坏性探索，再进入实现。
- 变更前说明目标、范围、预期影响；若方案需要扩大范围，先说明再继续。
- 优先用 `rg`（ripgrep）搜索文件与文本；优先非交互式命令。
- 不在未说明情况下做大规模重构、跨模块接口改写或批量重命名。
- 不回退不是自己产生的改动，除非用户明确要求。
- 大型任务（>90 分钟或跨 2 个及以上一级模块）开始实现前，先建/续根 `TODO.md` 并创建/更新 `docs/plans/YYYY-MM-DD-<topic>.md`。

## 项目硬约束（禁止项 · 不可协商）

这些约束定义了「x-basalt」的存在意义，违反即偏离项目：

1. **严禁** `import ... from 'obsidian'` 或引入任何 Obsidian 类型定义 / `obsidian` npm 包。
2. **严禁** 调用 `obsidian://` URI 协议。
3. **严禁** 使用 `obsidian-dataview` 包的 Evaluator / Executor；执行层完全自建（其 AST 类型可参考，执行不可依赖）。
4. **严禁** 引入 Electron / Puppeteer / Playwright 等浏览器或 GUI 自动化工具。
5. 所有文件操作只通过 `fs` / `fs.promises` / `chokidar` 完成。
6. 隐式字段（`file.inlinks` / `file.outlinks` / `file.tasks` 等）必须通过 SQLite JOIN **实时计算**，禁止假设任何外部缓存（如 `app.metadataCache`）存在。

落盘前对改动文件自查上述项；命中即视为未完成。

## 技术栈

| 用途 | 选型 |
|---|---|
| Runtime / 语言 | Node.js 22+（开发用 24.x）+ TypeScript 5.x（ESM / NodeNext） |
| CLI | commander |
| Obsidian 专有语法 / 基础解析 | **自建提取**（wikilink/embed/callout/highlight/task/blockRef），纯正则、不建完整 mdast、无第三方 wikilink 库 |
| Frontmatter | gray-matter |
| 文件监听 | chokidar |
| 索引存储 | better-sqlite3（单文件 SQLite，同步 API） |
| Skill 文件格式 | json5 |
| Skill 召回匹配 | fuse.js（模糊搜索 + 相关性排序，容拼写错） |
| 配置加载 | cosmiconfig（向上搜索 `.x-basalt/config.*`）+ yaml（YAML 解析/序列化） |
| 测试 | Node 原生 Test Runner（`node:test`）+ `assert` |
| Lint / Format | oxlint + oxfmt（oxc 工具链） |

## 目录结构

```
src/parser/   解析层：内容 → ObsidianNode[]（纯函数，不碰 fs/DB）
src/indexer/  索引层：调 parser 写 SQLite，chokidar 增量
src/query/    查询层：手写 DQL tokenizer→ast→sql-generator，编译为参数化 SQL
src/skill/    Skill 召回：json5 加载 + 模糊匹配，内置 obsidian-base-spec 兜底
src/meta/     元数据写侧：frontmatter 往返内核(yaml Document) + CRUD + 原子写（唯一写 .md 的层）
src/utils/    路径等工具
src/cli.ts    commander 入口
skills/       产品运行时 Skill 数据（SkillRecall 加载，含 obsidian-base-spec.json5）
skills-def/   开发侧业务 skill 源码（AI 召回用，见「Skills 真相源」）
tests/        Node 原生测试 + fixtures/sample-vault
docs/         research / specs / plans / guides / architecture / testing（见 docs/README.md）
```

## 常用命令

> 包管理器用 `pnpm`（`pnpm@10.33.0`）。`better-sqlite3` 的原生构建脚本已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 放行，否则 pnpm v10 默认拦截、装不上预编译二进制。质量门按改动风险选跑，详见「完成定义」。

- `pnpm install`：安装依赖（会构建 better-sqlite3）。
- `pnpm run build`：`tsc` 编译到 `dist/`。
- `pnpm run typecheck`：`tsc --noEmit`。
- `pnpm test`：Node 原生 test runner 跑 `tests/*.test.ts`。
- `pnpm run lint` / `pnpm run lint:fix`：oxlint 检查 / 自动修复（配置 `.oxlintrc.json`）。
- `pnpm run format` / `pnpm run format:check`：oxfmt 格式化 / 校验。
- `pnpm cli -- <args>`：开发态直接跑 CLI（tsx），例：`pnpm cli -- parse tests/fixtures/sample-vault/Index.md`。
- `pnpm dev`：等同 `cli`，便于联调。

> 包管理器（pnpm）与 Lint/Format（oxlint + oxfmt）均为 spec 未限定项：pnpm 按邻居约定，oxc 工具链经评估选定（未照搬邻居 y-bot 的 Biome）。TS 5.x、`node:test`、commander 等为 spec 强制项，覆盖邻居的 TS6/vitest。

## PLANS / TODO 机制

- 根 `TODO.md` 存在 = 有执行中任务；执行项全部结束即删除（以文件存在与否表示是否在执行）。
- 每个执行项链接其 `docs/plans/YYYY-MM-DD-<topic>.md`；范围扩大、阶段切换、验收口径变化时同步更新两者。
- 计划文件用 `kebab-case` + 日期命名，必备章节见 `docs/plans/` 现有样例。

## Commit 规范

- 标题遵循 Conventional Commits：`type(scope): summary`。
- `type` ∈ `feat`/`fix`/`docs`/`chore`/`refactor`/`test`/`build`/`ci`（英文）。
- `scope` 映射变更边界（英文）：`parser`/`indexer`/`query`/`skill`/`cli`/`docs`/`repo`/`test`。
- `summary` 用简短中文短句，直接描述变更。
- 示例：`feat(parser): 支持 wikilink heading 锚点解析`。
- **AI 默认不得自行 `git commit` / `git push`**；仅当用户在当前会话明确授权方可本地 commit。

## 代码与规范

- 注释默认中文，解释「为什么 / 边界 / 副作用」，禁止只复述代码，禁止用注释掩盖糟糕命名（优先重命名）。
- **Obsidian 规范来源 vs 自建实现** 必须以注释标注分界：解析 Obsidian 专有语法处用 `// === Obsidian 规范来源: <规范点> ===`，自建逻辑用 `// === 自建实现 ===`。这是本项目可追溯性的硬要求。
- 修改共享类型、schema、SQL 或脚本时，先保证代码、schema、测试、当前计划能互相验证。
- 模块边界单一职责：parser 不碰 fs/DB；indexer 不内联 DQL；query 不直接读文件，只查 DB。

## 测试规范

- 用 Node 原生 `node:test` + `assert`，测试就近放 `tests/`。
- 测试文件命名 `*.test.ts`；fixtures 放 `tests/fixtures/sample-vault/`（符合 Obsidian 规范的样例 `.md`）。
- parser/index/query 必须有端到端主路径测试。
- **复杂模块重测试（硬要求）**：DQL 内核（query）、索引隐式字段（indexer）、Obsidian 专有语法（parser）是高复杂度核心，测试必须「重」——不止主成功路径，每个**子集特性 / 文法分支 / 隐式字段**逐项独立用例，并覆盖**边界值、异常输入、错误定位、安全对抗（注入 / ReDoS）**。新增/扩展一个特性时，缺这些维度的用例视为该步未完成。每个声称「支持」的能力须有可追溯的测试编号（对齐覆盖矩阵）。
- 声称「通过」前必须实际运行并依据输出说明结果。

## Skills 真相源（skills-def）

- 开发侧自建 skill 源码**唯一维护在 `skills-def/<name>/SKILL.md`**；`.claude/skills/` 仅安装产物（由 `pnpm run skills:install` 拷贝生成，已 gitignore），不手改安装产物。
- 现有业务 skill：
  - `biz-obsidian-spec`：Obsidian Markdown 精确文法，开发/维护 parser 时召回。
  - `biz-dql-subset`：DQL 子集文法 + SQL 编译映射 + 隐式字段语义，开发 query/indexer 时召回。
  - `biz-code-comments`：中文注释 / JSDoc / 模块头 / 跨模块不变量 / 规范来源分界规范，写或审查注释时召回。
- 新增/修改 skill 后跑 `pnpm run skills:install` 重新安装。
- 注意区分：`skills-def/` 是**开发侧** AI 召回；`skills/` 是**产品运行时** SkillRecall 数据，两者不互相替代。

## Docs 维护

- 读写路由见 `docs/README.md`；改动前读直接相关文档，结论写回对应目录。
- 大改动记 ADR 或当前阶段计划；小改动至少同步直接受影响的规范/实现说明/计划，不静默覆盖原规则。
- **文档元数据自举（dogfood）**：在 `docs/` 新增或重写文档后，用 x-basalt 自己给它补 frontmatter 元数据（默认 profile `llm-wiki`），不手写——机械字段（`timestamp`/`sha256`）由工具补，语义字段（`type`/`title`/`description`/`tags`）作为消费者读 `meta profile show` 后经 `--set` 补：`x-basalt meta apply llm-wiki <doc> --set type=… --set title=… --set description=… --set tags=…`。x-basalt 的文档由 x-basalt 维护，是写侧能力的持续 dogfood。

## 脱敏

- 运行期日志脱敏 API Key / token / 邮箱 / 手机号。
- 入仓产物（`docs/`、`README.md`、注释等）禁止出现仓库根目录之外的绝对路径（Windows 盘符前缀、用户目录、POSIX 用户目录等）。引用外部代码改写为「项目名 + 相对路径」。
- 落盘前用 `rg` 自查本机路径前缀，命中即改写。

## 完成定义

- 「能运行」≠「完成」：阶段收口前完成自检、验证记录与注释补齐。
- 默认最小充分验证：优先跑受影响边界的 `typecheck`、`build` 与本次改动直接覆盖的测试；不把全量测试当默认动作。
- 只有触及跨模块公共契约、根级脚本/配置、测试基础设施或用户明确要求时，才升级到全量 lint/typecheck/build/test。
- 声称「完成 / 通过 / 可用」前，必须运行与改动风险匹配的验证命令，并依据实际输出说明结果；跳过的全量项要列出原因与剩余风险。

[by=x-basalt]

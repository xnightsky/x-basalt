# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

> 0.1.0（MVP）之后、dogfood 观察期内的累积变更，尚未发布。

### Added

- **`meta` 命令 —— 首个写侧能力**（只改 frontmatter、正文逐字节不动）：`get` / `set` / `unset` / `rename`；`normalize` 归一（tags/aliases/cssclasses 列表化、tags 去 `#`、去重、单数键→复数键迁移）；`profile list` / `show` 与 `apply <profile>`（内置 `pkm-note` / `llm-wiki` / `ssg-blog` 三套策略：机械补 created/modified/sha256 + `--set` 补语义 + 收尾自动归一）。YAML 往返保键序/注释、原子写、幂等、`--dry-run`、非法 YAML 拒写。
- **`scan` 命令** —— 无常驻 watcher 的按需增量重索引：diff 文件系统 vs 库、只重扫变化的（`--rehash` 按内容、`--dry-run`、`--json`）。
- **`skills` 子命令扩展**：`get <name>`（按名取整篇）、`get --all`、`path [name]`；所有读子命令支持 `--json`（默认输出人类 / AI 可读 Markdown）。
- **DQL 子集大幅扩展**：`TASK` / `GROUP BY` / `FLATTEN` / `WITHOUT ID`、多键 `SORT`、`WHERE field = null`、日期 ISO 比较、字符串谓词 `contains/icontains/startswith/endswith/regexmatch`、内置函数 `lower/upper/length/round` 与 `date(today)/date(now)`。
- **`X_BASALT_DIR` 环境变量**：自定义 `.x-basalt` 基目录（config 与 `index.db` 都落其下）。
- **全局使用技能** `skills-def/x-basalt/SKILL.md`（`scope: global`，`pnpm run skills:install:global` 装到 `~/.claude/skills/` 与 `~/.agents/skills/`），教任意 AI 会话驱动本 CLI。
- 本地 git 门禁：受版本控制的 `.githooks/pre-push`（push 前跑 typecheck + test + lint），`pnpm install` 经 `prepare`（`scripts/setup-hooks.mjs`）自动接线 `core.hooksPath`，零新依赖、不依赖云端 CI。
- 打包就绪：`LICENSE`（MIT）、`CHANGELOG.md`、`package.json` 的 `author` 与 `prepublishOnly` 发布门（typecheck + test + build）。

### Changed

- **（breaking）`skill` 命令组改名为 `skills`**（复数，**不保留单数别名**），对齐 agent-browser / Gemini CLI / Claude Code 等生态惯例。
- **（breaking）skill 运行时数据目录 `skills/` → `skill-data/`**，避免与 `skills` 命令前缀混淆、对齐 agent-browser；外部覆盖路径 `OBSIDIAN_SKILL_PATH` / 配置 `skillPath` / `~/.obsidian-core/skills` 不变。
- **（breaking）内置自我说明书 skill 改名 `x-basalt-usage` → `x-basalt`**（作为全局主 skill 反向召回的对象，用工具名最直观）。
- `skills` 读子命令默认输出由 JSON 改为人类 / AI 可读 Markdown，`--json` 切回结构化。
- DQL 引擎改用 chevrotain（词法 + parser），越界带位置报 `DqlSyntaxError`；旧手写 tokenizer 移除。
- skill 召回改用 Fuse.js（模糊容错 + 相关性排序）；`SkillDefinition` 增 `description` 字段。
- config 加载改用 cosmiconfig；YAML 解析 / 序列化改用 `yaml` 包（修以 `---` 开头被吞键）；CLI 输出序列化抽到 `src/format.ts`。
- 索引：大库流式 rebuild（分批事务，内存 O(批)）；inlinks/outlinks 路径感知（qualified 链接精确匹配、bare 链接按 basename 回退）。
- 解析层评估后保留自建（不引入 remark-obsidian-md）；清理 `unified` / `remark-parse` / `@flowershow/remark-wiki-link` / `zod` 等零 import 死依赖。

### Fixed

- parser：剔除围栏代码块（```` ``` ````/`~~~`）与行内代码（成对反引号）内的 `#tag` 与 `==高亮==`，不再把代码里的 `# 注释`、字符串误识为标签 / 高亮（修复真实 vault 上 `FROM #tag` 静默多命中）。
- skills 安装：frontmatter `scope` 检测兼容 CRLF 行尾（Windows `autocrlf`）——此前 CRLF 下正则匹配失败致 `scope` 永远落到 `project`，全局安装一个都装不上、项目安装误纳 global 技能。

## [0.1.0] - 2026-06-25

### Added

- MVP：纯 Node.js CLI，零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault。
- parser：解析 Obsidian 专有语法 → `ObsidianNode[]`（wikilink/embed/tag/callout/task/highlight/blockRef）+ frontmatter。
- indexer：调 parser 写 SQLite（files/links/tags/tasks/blocks 五表），chokidar 增量监听。
- query：手写 DQL 子集 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段（inlinks/outlinks/tags/tasks）查询期 JOIN 实时计算。
- skill：JSON5 加载 + 模糊召回，内置 `obsidian-base-spec` 与 `x-basalt-usage` 兜底。
- cli：commander 五子命令 `parse / index / query / skill / watch`，支持 `--format`、`--watch`、`--on-change`，及项目 / 全局配置文件。

[Unreleased]: https://example.invalid/x-basalt/compare/v0.1.0...HEAD
[0.1.0]: https://example.invalid/x-basalt/releases/tag/v0.1.0

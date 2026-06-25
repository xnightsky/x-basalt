# Changelog

本项目所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 本地 git 门禁：受版本控制的 `.githooks/pre-push`（push 前跑 typecheck + test + lint），`pnpm install` 时经 `prepare` 脚本（`scripts/setup-hooks.mjs`）自动接线 `core.hooksPath`，零新依赖、不依赖云端 CI。
- 打包就绪：`LICENSE`（MIT）、`CHANGELOG.md`、`package.json` 的 `author` 与 `prepublishOnly` 发布门（typecheck + test + build）。

### Fixed

- parser：剔除围栏代码块（```` ``` ````/`~~~`）与行内代码（成对反引号）内的 `#tag` 与 `==高亮==`，不再把代码里的 `# 注释`、字符串误识为标签/高亮（修复在真实 vault 上 `FROM #tag` 静默多命中的问题）。

## [0.1.0] - 2026-06-25

### Added

- MVP：纯 Node.js CLI，零依赖 Obsidian GUI / 运行时，直接通过文件系统操作 Vault。
- parser：解析 Obsidian 专有语法 → `ObsidianNode[]`（wikilink/embed/tag/callout/task/highlight/blockRef）+ frontmatter。
- indexer：调 parser 写 SQLite（files/links/tags/tasks/blocks 五表），chokidar 增量监听。
- query：手写 DQL 子集 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段（inlinks/outlinks/tags/tasks）查询期 JOIN 实时计算。
- skill：JSON5 加载 + 模糊召回，内置 `obsidian-base-spec` 与 `x-basalt-usage` 兜底。
- cli：commander 五子命令 `parse / index / query / skill / watch`，支持 `--format`、`--watch`、`--on-change`，及项目/全局配置文件。

[Unreleased]: https://example.invalid/x-basalt/compare/v0.1.0...HEAD
[0.1.0]: https://example.invalid/x-basalt/releases/tag/v0.1.0

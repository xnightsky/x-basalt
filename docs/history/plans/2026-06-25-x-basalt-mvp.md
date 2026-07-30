---
timestamp: 2026-06-30T00:01:23Z
sha256: 4f62deced65dbaec7a90a14a389fe5b61a454f2ef0ed39a47f14de9259da6026
type: plan
title: 计划：x-basalt MVP 分阶段实现
description: 按检查点分阶段实现 parser/indexer/query/skill/cli 五模块 MVP
tags:
  - plan
  - mvp
  - x-basalt
---
# 计划：x-basalt MVP 分阶段实现

> 日期：2026-06-25 · 类型：大型任务（跨 5 个一级模块）
> 设计：[`../specs/2026-06-25-x-basalt-design.md`](../specs/2026-06-25-x-basalt-design.md)
> 执行真相源：根 [`TODO.md`](../../TODO.md)

## 目标

按检查点分阶段实现 5 个核心模块的 MVP，每阶段产出可运行、可审查。不要求覆盖所有边界 case，但主路径必须跑通。

## 阶段切口

### 阶段 0 · 脚手架（✅ 本次初始化完成）

- agent 规则（CLAUDE.md/AGENTS.md）、根配置、docs、目录骨架、skills-def、产品内置 skill、样例 vault。
- 验收：`pnpm install && pnpm run build && pnpm run typecheck` 通过；骨架可编译。

### 阶段 1 · parser（✅ 完成）

- 实现 `frontmatter.ts`（gray-matter）→ `wikilink.ts`（wikilink/embed/锚点/别名 + 去重）→ `index.ts`（tag/callout/task/highlight/blockRef 提取）。
- 召回 `biz-obsidian-spec` 确认文法边界。
- 标注 `// === Obsidian 规范来源 ===` / `// === 自建实现 ===`。
- 验收：`tests/parser.test.ts` 对 fixtures 断言全绿；`pnpm run cli -- parse <fixture>` 输出正确 AST。
- 决策：tag 节点只含**行内**标签，frontmatter tags 经 `ParsedFile.frontmatter` 交 indexer；wikilink 去重键含 embed 标记（保留 link/embed 区分）；tag 边界由「行首或空白」细化为「`#` 前非 word 字符」（更贴近 Obsidian，已同步调研 §2.3 与 skill）。

### 阶段 2 · indexer（✅ 完成）

- `schema.ts` 建 5 表；`index.ts` 实现 `rebuild/update/remove`（事务）；`watcher.ts` chokidar 增量，跳过 `.obsidian/` 与隐藏文件。
- 验收：`tests/indexer.test.ts` 断言行数与反向链接；`pnpm run cli -- index <vault> --db ./index.db` 建库成功。

### 阶段 3 · query（✅ 完成）

- 召回 `biz-dql-subset`；手写 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段 JOIN 计算。
- 验收：`tests/query.test.ts` 端到端主路径全绿；`pnpm run cli -- query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10" --db ./index.db` 返回 JSON。

### 阶段 4 · skill + cli（✅ 完成）

- `skill/loader.ts` + `index.ts`（json5 + 模糊匹配 + 内置兜底）；`cli.ts` 用 commander 接线全部子命令 + `--format`、`--watch`、`--on-change`。
- 验收：`skills recall wikilink` / `skills list` 召回；`watch --on-change` 触发命令模板替换 `{file}`。

### 阶段 5 · 收口（✅ 完成）

- 补全 README 示例校验、注释收口、self-review；最小充分验证（typecheck/build/test）。
- 验收：全链路 parse→index→query 在样例 vault 上跑通；MVP 验收标准（设计 §7）全部满足。

## 阶段依赖

0 → 1 → 2 → 3 → 4 → 5（query 依赖 indexer 的 schema；cli 依赖前四者）。

## 风险与停点

- **[潜在冲突]** spec 限定 Node 原生 test runner，邻居 y-bot 用 vitest；本项目按 spec 走 `node:test`，若后续要并入 y-bot workspace 需统一——届时单独提示。
- better-sqlite3 在极端环境无预编译二进制时需本地编译，列为环境风险（Node 24 当前有 prebuilt）。

## Evidence

> 每阶段收口在此追加：运行命令、关键日志、输入/输出样例、失败复现。

- 阶段 0（2026-06-25 验证通过）：
  - `pnpm install` → better-sqlite3 prebuild 成功（onlyBuiltDependencies 放行）。
  - `pnpm run typecheck` exit 0；`pnpm run build` exit 0（产出 `dist/`）。
  - `pnpm test` → 8 项：pass 5 / todo 3 / fail 0（todo 为阶段 1/2/3 主体）。
  - `pnpm run lint`（oxlint）exit 0 零告警；`oxfmt` 格式化 24 文件通过。
  - `pnpm run skills:install` → 安装 biz-obsidian-spec / biz-dql-subset 到 `.claude/skills/`。
  - `node dist/cli.js --help` 正常列出五命令；未实现命令给出阶段指引。
- 阶段 1（2026-06-25 验证通过，TDD red→green）：
  - 实现 `parseFrontmatter` / `extractWikilinks` / `VaultParser.parse` 及 tag/callout/task/highlight/blockRef 提取。
  - `pnpm test` → 26 项：pass 24 / todo 2（indexer/query）/ fail 0；含对 sample-vault 五文件的端到端断言。
  - `pnpm run typecheck` exit 0；`pnpm run lint` exit 0；`pnpm run format:check` 全通过。
  - 已知近似：代码块内 `#tag`/`==..==` 暂不剔除（调研 §3.3#4）；链接按 basename 解析去重（§3.3#1）。
- 阶段 2（2026-06-25 验证通过）：
  - `schema.ts` 建 files/links/tags/tasks/blocks 五表（IF NOT EXISTS + 索引）；`index.ts` 实现 `rebuild/update/remove`（事务，先删后插）；`watcher.ts` chokidar 跳过隐藏/`.obsidian`，仅 `.md`。
  - 列扩展（已注释说明）：`files.name_key`/`files.folder`、`links.target_key`、`blocks.line_number`，支撑 basename 解析与查询期 JOIN。
  - 为诚实填充 `tasks.line_number`/`blocks.content`，给 parser 的 `task`/`blockRef` 节点加 `line`（位置信息归 parser；现有 parser 测试不受影响）。
  - `tests/indexer.test.ts` 3 例：files 5 / links 17 / tags 17 / tasks 9 / blocks 4；inlinks JOIN（指向 Alpha 的源文件 = 4）；remove→update 幂等。
- 阶段 3（2026-06-25 验证通过）：
  - 手写 `tokenizer → parseQuery(ast) → generateSql`，全参数化绑定；`DataviewEngine` 只读打开库并注册 `REGEXP` 自定义函数。
  - 隐式字段经相关子查询 JOIN（tags/inlinks/outlinks/tasks），inlinks/outlinks 用 `DISTINCT`；frontmatter 标量经 `json_extract` 且字段名白名单校验防注入。
  - `tests/query.test.ts` 11 例：README 示例（→ Alpha）、TABLE+FROM"folder"、FROM [[link]] 反链、contains(file.tags) 前缀、聚合数组、inlinks 去重、regexmatch、AND/OR/NOT、非子集字段报错、DqlSyntaxError。
- 阶段 4（2026-06-25 验证通过）：
  - `skill/loader.ts`（JSON5 + 目录解析 env>~/.obsidian-core>内置 + 兜底）、`skill/index.ts`（name/triggers 双向子串模糊召回）；`tests/skill.test.ts` 5 例（含空目录兜底）。
  - `cli.ts` commander 接线五子命令 + `--format json|yaml`（YAML 极简块序列化，Date→ISO）、`--watch`、`--on-change {file}`。
  - CLI 冒烟（tsx + dist 双跑）：parse(json/yaml)、index、query(LIST/TABLE/inlinks)、skills list/recall、watch（初始 rebuild + add/change 增量 + on-change 触发 + `FROM #fresh` 命中新笔记）。
  - 附带：按用户要求从邻居 y-bot 抄入 `biz-code-comments` skill 并本地化（真相源指向本仓库 `AGENTS.md`、示例改本项目域、补「规范来源/自建实现」分界），同步 `skills-def/README.md`、`AGENTS.md` 清单并 `skills:install`。
- 阶段 5（2026-06-25 收口验证通过）：
  - 全量门：`pnpm run typecheck` exit 0；`pnpm run build` exit 0（dist 产出，`node dist/cli.js` 五命令可用、dist→`skills-data/` 兜底解析正常）；`pnpm test` → 41 项全绿（todo 0）；`pnpm run lint` 0 告警；改动的源码/测试文件 `oxfmt --check` 全通过。
  - **[已知风险]** 仓库级 `oxfmt --check .` 在 docs/markdown/json 等**未被本次改动触及**的文件上仍报格式不符（如 `README.md`、`docs/*`、`skills-def/INSTALL.md`、`.oxlintrc.json`），为既有基线漂移（oxfmt 默认会重排中文 prose）。本次只格式化自身改动文件，未对用户手写文档做大规模重排；是否全仓 `pnpm format` 留待单独决策。

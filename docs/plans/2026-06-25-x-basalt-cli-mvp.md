# 计划：x-basalt-cli MVP 分阶段实现

> 日期：2026-06-25 · 类型：大型任务（跨 5 个一级模块）
> 设计：[`../specs/2026-06-25-x-basalt-cli-design.md`](../specs/2026-06-25-x-basalt-cli-design.md)
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

### 阶段 2 · indexer
- `schema.ts` 建 5 表；`index.ts` 实现 `rebuild/update/remove`（事务）；`watcher.ts` chokidar 增量，跳过 `.obsidian/` 与隐藏文件。
- 验收：`tests/indexer.test.ts` 断言行数与反向链接；`pnpm run cli -- index <vault> --db ./index.db` 建库成功。

### 阶段 3 · query
- 召回 `biz-dql-subset`；手写 `tokenizer → ast → sql-generator`，编译为参数化 SQL；隐式字段 JOIN 计算。
- 验收：`tests/query.test.ts` 端到端主路径全绿；`pnpm run cli -- query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10" --db ./index.db` 返回 JSON。

### 阶段 4 · skill + cli
- `skill/loader.ts` + `index.ts`（json5 + 模糊匹配 + 内置兜底）；`cli.ts` 用 commander 接线全部子命令 + `--format`、`--watch`、`--on-change`。
- 验收：`skill recall wikilink` / `skill list` 召回；`watch --on-change` 触发命令模板替换 `{file}`。

### 阶段 5 · 收口
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

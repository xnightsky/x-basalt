---
timestamp: 2026-06-30T00:01:23Z
sha256: 826548a69b9a425f9a6cb93f3720376d492d785155cf34a9bc4f724b8971c66d
type: spec
title: 设计：x-basalt
description: x-basalt 总体设计：模块划分、边界约束与 MVP 验收标准
tags:
  - spec
  - design
  - x-basalt
---
# 设计：x-basalt

> 日期：2026-06-25 · 状态：已确认架构，分阶段实现中
> 事实依据见 [`../research/2026-06-25-obsidian-spec-and-deps.md`](../research/2026-06-25-obsidian-spec-and-deps.md)；执行计划见 [`../plans/2026-06-25-x-basalt-mvp.md`](../plans/2026-06-25-x-basalt-mvp.md)。

## 1. 目标与硬约束

纯 Node.js CLI，零依赖 Obsidian GUI / 运行时，直接通过文件系统 API 操作 Vault，实现解析、索引、Dataview 子集查询、Skill 召回。硬约束（禁止项）以 `AGENTS.md`「项目硬约束」为准，核心：不引入 `obsidian` 包 / 不调 `obsidian://` / 不用 dataview Evaluator / 不用浏览器自动化 / 仅 fs+chokidar / 隐式字段一律 SQLite JOIN 实时计算。

## 2. 关键决策

| 项             | 决策                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 包名 / CLI bin | `x-basalt`                                                                                                             |
| 模块格式       | ESM（`"type": "module"`，NodeNext，相对 import 带 `.js`）                                                              |
| 包管理         | pnpm（`pnpm@10.33.0`；spec 未限定 PM，按邻居 y-bot 约定。better-sqlite3 经 `pnpm.onlyBuiltDependencies` 放行原生构建） |
| 测试           | Node 原生 `node:test` + `assert`（spec 限定）                                                                          |
| TypeScript     | 5.x（spec 限定，未跟随邻居 y-bot 的 TS6）                                                                              |
| Lint/Format    | oxlint + oxfmt（oxc 工具链；spec 未限定，经评估选定，未照搬邻居 Biome）                                                |
| 交付           | 分阶段带检查点（见计划）                                                                                               |
| 项目根         | 直接在 `x-basalt/` 根，不嵌套 `obsidian-core/`                                                                         |

**选型判据**：spec「严格限定」清单覆盖的项（TS 5.x、`node:test`、commander、unified/remark、gray-matter、chokidar、better-sqlite3、zod、json5）**以 spec 为准、覆盖邻居**（故未跟 y-bot 的 TS6/vitest）；spec 未覆盖的项中，包管理器**按邻居 y-bot 约定**选 pnpm；Lint/Format **经评估选 oxc 工具链（oxlint + oxfmt）**，未照搬邻居的 Biome（理由：纯 Rust 工具链、单生态、快，且为本项目刻意选型而非沿用）。

## 3. 模块划分与接口契约

### 3.1 parser（`src/parser/`）

纯函数，输入文件内容 → 输出 `{ frontmatter, nodes }`。不碰 fs / DB。

```typescript
type ObsidianNode =
  | {
      type: "wikilink";
      target: string;
      alias?: string;
      heading?: string;
      blockId?: string;
      embed: boolean;
    }
  | { type: "tag"; value: string }
  | { type: "callout"; calloutType: string; title: string; foldable: boolean; content: string }
  | { type: "task"; status: string; text: string }
  | { type: "blockRef"; id: string }
  | { type: "highlight"; content: string };

interface ParsedFile {
  frontmatter: Record<string, unknown>;
  nodes: ObsidianNode[];
}

class VaultParser {
  parse(content: string): ParsedFile;
}
```

文件：`types.ts`（类型）、`frontmatter.ts`（gray-matter 封装）、`wikilink.ts`（wikilink/embed 提取）、`index.ts`（编排 + 其余节点提取）。Obsidian 专有语法全部自建提取，`remark-parse` 仅用于拿基础 AST 辅助定位。

> **[2026-06-26 偏差标注]** 实现与本契约存在分叉：(1) `remark-parse` 实际**零 import**，解析全为手写字符串（见 [`2026-06-26-deps-build-vs-buy.md`](2026-06-26-deps-build-vs-buy.md)）；(2) `types.ts` 的 `task`/`blockRef` 节点额外带 `line` 字段（本契约未列，实现注释已解释）；(3) 调研要求的 task `due_date` 未在节点中实现。逐项见 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md) 与 [`2026-06-26-coverage-matrix.md`](2026-06-26-coverage-matrix.md)。

### 3.2 indexer（`src/indexer/`）

`VaultIndexer` 调 parser 写 SQLite，chokidar 增量。

```typescript
class VaultIndexer {
  constructor(opts: { vaultPath: string; dbPath: string });
  rebuild(): Promise<void>; // 全量扫描 .md
  update(filePath: string): Promise<void>;
  remove(filePath: string): void;
  watch(): void; // chokidar add/change/unlink
  close(): void;
}
```

跳过 `.obsidian/` 与隐藏文件。文件：`schema.ts`（建表）、`watcher.ts`（chokidar 封装）、`index.ts`（编排）。

#### SQLite Schema

`files / links / tags / tasks / blocks` 五表（字段见 spec 原文 / `schema.ts`）。`inlinks/outlinks` 无物化视图，由 `links` 表查询期 JOIN 计算。

### 3.3 query（`src/query/`）

`DataviewEngine`：手写 `tokenizer → ast → sql-generator`，编译 DQL 子集为**参数化 SQL**，交 better-sqlite3 执行。不依赖 obsidian-dataview 执行层。

```typescript
interface QueryResult {
  type: "LIST" | "TABLE";
  columns: string[];
  rows: Record<string, unknown>[];
}
class DataviewEngine {
  constructor(dbPath: string);
  query(dql: string): QueryResult;
}
```

DQL 子集与隐式字段见调研 §3。文件：`tokenizer.ts` / `ast.ts` / `sql-generator.ts` / `index.ts`。

### 3.4 skill（`src/skill/`）

`SkillRecall`：json5 加载 + 对 `triggers`/`name` 模糊匹配，内置 `obsidian-base-spec` 兜底。

```typescript
class SkillRecall {
  constructor(opts?: { skillPath?: string }); // env OBSIDIAN_SKILL_PATH > ~/.obsidian-core/skills > 内置 skills-data/
  list(): SkillMeta[];
  recall(keyword: string): SkillDefinition[];
}
```

文件：`loader.ts`（json5 + 目录解析）、`index.ts`（匹配）。

### 3.5 cli（`src/cli.ts`）

commander 五子命令：`parse / index / query / skills / watch`，签名见 README。
选项默认值可由项目/全局配置文件提供（`src/config.ts`）。项目配置默认放隐藏目录 `.x-basalt/config.{yaml,yml,json5,json}`（回退扁平 `.x-basalt.{...}`），cwd 向上查找；全局回退 `~/.x-basalt/config.{...}`。默认 YAML（复用 gray-matter 引擎解析，不新增依赖）；键 `db/vault/skillPath/format/onChange`。索引默认落 `.x-basalt/index.db`（indexer 自动建父目录）。优先级：命令行 flag > 项目配置 > 全局配置 > 内置默认。`.x-basalt/` 整体不入 git（仅保留 `config.example.yaml` 模板）。详见 `docs/guides/usage.md` §12。

## 4. 数据流

```
.md 文件 ──VaultParser──▶ ParsedFile ──VaultIndexer──▶ SQLite(files/links/tags/tasks/blocks)
                                                              │
DQL 字符串 ──DataviewEngine(tokenizer→ast→sql)──▶ 参数化 SQL ─┘──▶ QueryResult(JSON)
skill 关键字 ──SkillRecall──▶ SkillDefinition(JSON)
```

## 5. 错误处理

- parser：非法 frontmatter / 语法不报错，尽量降级提取，记 `nodes` 缺失而非抛出。
- indexer：单文件解析失败跳过并 warn，不中断全量；DB 操作用事务，失败回滚。
- query：DQL 语法错误抛带位置的 `DqlSyntaxError`；未知字段返回明确错误。
- skill：目录不存在 / json5 解析失败时降级到内置 spec 并 warn。

## 6. 测试策略

- `tests/parser.test.ts`：对 fixtures 断言各类节点提取与去重。
- `tests/indexer.test.ts`：rebuild 后断言 files/links/tags/tasks 行数与反向链接。
- `tests/query.test.ts`：端到端 `LIST/TABLE + FROM + WHERE + SORT + LIMIT` 主路径。
- fixtures：`tests/fixtures/sample-vault/` 3-5 个符合规范的 `.md`。

## 7. 验收标准（MVP）

- `pnpm run build` / `pnpm run typecheck` 通过；`pnpm test` 全绿。
- `parse` 输出含 wikilink/tag/callout/task 的 AST JSON。
- `index` 建库；`query` 跑通 `LIST FROM #tag WHERE ... SORT ... LIMIT ...`。
- `skills recall wikilink` / `skills list` 召回内置规范。
- README 含安装/索引/查询/skill 示例。

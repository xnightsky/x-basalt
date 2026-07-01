# 计划：收口场景库坐实的确定性产品缺口

> 2026-07-02 · scan byDir 分组计数 · 缺失 vault 根 warn · DQL `file.frontmatter` 存在性
> 关联：私有场景库 `../x-basalt-evals`（不入本仓，位置见 `AGENTS.local.md`）

## 背景

dogfood 期私有场景库用真实失败坐实了一批产品缺口，但至今未出过 baseline（只跑过 dry）。其中三个是**确定性**的——不依赖 AI 行为、可用 CLI + 单测直接验证，且承接刚落地的 DQL 真值/存在性工作（提交 5cc56f8、2735725）。本轮把这三个缺口在产品侧修掉并回归，让场景库「找失败 → 修产品 → 重测」闭环第一次走通确定性半环。

三个缺口：

| # | 来源场景 | 现状缺陷 | 目标 |
|---|---|---|---|
| 1 | `scale/doc-migration-count` facet2 | 能数未索引总量，数不了每子目录（大列表灌爆 context → 撞顶） | `scan` 产出按目录标量计数 `byDir` |
| 2 | `scale/doc-migration-count` 前提 | 多根含不存在目录时整条 index/scan 崩 ENOENT（**非**场景所述"静默接受"，见下冲突订正） | 跳过缺失根 + warn + 其余照常 |
| 3 | `messy/no-index-count` gap#3 | DQL 查不了「完全无 frontmatter」；`WHERE file.frontmatter = null` 报"不支持的查询字段" | `file.frontmatter` 成为合法隐式字段，表达「有/无任意键」 |

### [冲突提示]（已吸收）

场景库前提写「缺失根静默接受」，实测不成立：`src/indexer/index.ts:202` `collectAllMarkdown` → `collectMarkdownFiles` 的 `readdir`（`index.ts:126`）对不存在目录抛 ENOENT，导致 index/scan **全量失败**（all-or-nothing + 晦涩报错），而非"假装已索引"。#2 按 warn-and-skip 实现，并订正场景库该场景的前提描述。

## 工作项

### 项 1 · scan byDir

- `ScanReport`（`src/indexer/index.ts:26-42`）新增 `byDir: Record<string, {added,modified,deleted}>`（标量计数，不含文件名列表）。
- 在 `scan()`（`index.ts:396-409`）投影时用 `path.posix.dirname` 对 added/modified/deleted 聚合；根级文件归 `"."`；抽纯函数 `groupByDir` 便于单测。
- CLI 新增 `--by-dir`（`cli.ts:288-348`）；`--json` 自动带 byDir；人读模式追加明细行。
- chat scan 工具 description 点明用 byDir，不逐文件列举。
- 测试：`tests/scan.test.ts`、`tests/cli.test.ts`。

### 项 2 · 缺失 vault 根 warn-and-skip

- `collectAllMarkdown`（`index.ts:200-204`）过滤不存在/非目录根，逐个 `console.warn('⚠ 跳过不存在的 vault 根：...')`；全缺则 throw 清晰错误。
- 不改 `resolveVaultLayout`（保持纯函数）。`index`/`scan`/`run`/`watch` 经此汇聚点全覆盖；`query` 不受影响。
- 测试：`tests/vault-multidir.test.ts` 新增缺失根用例。

### 项 3 · DQL file.frontmatter 存在性

- `sql-generator.ts` 加 `FM_KEY_COUNT` 常量（`json_each(f.frontmatter)` 计数）。
- `fieldToSql` 加 `case "file.frontmatter"`（选列返回对象）；`truthySql`/`isnull` 特判走 key-count（不能走通用列真值，`'{}'` 是非空字符串会误判）。
- 语义：`WHERE file.frontmatter` = 有键；`!file.frontmatter` / `= null` = 无键；`TABLE file.frontmatter` = 返回对象。
- 已知限制：无法区分「无 `---`」与「空 `---\n---`」（索引层都存 `'{}'`）。
- 测试：`tests/query-parser.test.ts`、`tests/sql-generator.test.ts`、`tests/query.test.ts`。

## 收尾

- DQL 真相源文档补 `file.frontmatter`：`docs/specs/2026-07-01-dql-truthiness-existence-design.md`、`docs/specs/2026-06-27-dql-subset-frozen.md`、`docs/specs/2026-06-26-coverage-matrix.md`、`skills-def/biz-dql-subset/SKILL.md`（跑 `pnpm run skills:install`）。
- scan 文档补 `--by-dir`。
- 私有场景库（`../x-basalt-evals`）订正两处场景描述（不入本仓，仅记于此供追溯）。

## 验证

1. `pnpm run typecheck && pnpm run build`
2. `pnpm test`（scan / cli / query / query-parser / sql-generator / vault-multidir）
3. 手验三项 CLI 行为（见根 TODO.md 执行项链接）
4. 场景库 dry runner 仍绿

## 范围外

- chat 端「无 FS 迁移能力应老实拒」（AI 行为，需 baseline）
- 「无 `---` vs 空 `---\n---`」区分（需扩 schema）
- scan `--pipe` 编排路径的 byDir
- AI 端到端 baseline（另一条线）

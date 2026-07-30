---
type: plan
title: Bases P3 计划（附件数据集 vault_entries）
description: 独立 vault_entries 表 + indexer 附件扫描/watch/diff + Bases all-files 数据源模式（BASE-ALL-001/002），DQL .md-only 数据集零变化证明
tags:
  - plan
  - bases
  - indexer
  - x-basalt
timestamp: 2026-07-27T04:48:16Z
sha256: bb4925bbd0fffdbb9f5d488c584f526dc06d6e6cc0775b4a8002a35ec8d6959f
---
# 计划：Bases P3 · 附件数据集（vault_entries + all-files 模式）

> 2026-07-27 · 来源：根 `TODO.md` P3 项第一片（用户拍板「附件数据集优先」；embedded base code block 与 contextFile/this 另开计划）。
> 决策真相源（已冻结）：[`../specs/2026-07-27-bases-p3-vault-entries-decision.md`](../../design/bases-vault-entries.md)；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../../design/bases-scenarios.md) §6 BASE-ALL-001/002。
> 已知风险承接：P1 oracle 未跑，9 项暂定口径压着；本片接受「oracle 结论届时可能同时推翻 P1/P2 与本片口径」（TODO.md 原文软序声明）。
> 分三片顺序推进：片一 schema+indexer → 片二 base all-files 模式 → 片三 证明清单+CLI+收口。片二依赖片一的表与写入路径。

## 目标与范围

- **片一 · schema + indexer**：`vault_entries` 表（决策 §3 DDL 原样）进 `SCHEMA_SQL`；扫描器收附件（**扩展名白名单 = 除 `.md` 外全部文件**，隐藏项过滤不变）；rebuild / computeDiff / scanIter / update / remove / watch 六条写入路径全部覆盖附件；多根命名空间复用 `VaultLayout.toKey`。
- **片二 · Bases all-files 数据源**：`readBaseRows` 增加 all-files 模式（内存合并 `files` ∪ `vault_entries`，全局 `path ASC`）；附件行 note fields 全 MISSING（`note = {}` 经既有 MISSING 传播）、file fields 可用、`file.tags`/`file.links` 恒 `[]`；conformance 开关（默认仍 `bases-markdown-2026-07`，新增 `bases-all-files-2026-07`）。
- **片三 · 证明清单 + CLI + 收口**：执行决策 §3 的「DQL 不变」四条证明；`x-basalt base --conformance <id>` 薄透传；BASE-ALL-001/002 测试；附件体量基准（只记录不承诺）。

## 非目标

- embedded `base` code block、显式 `contextFile`/`this`（BASE-CTX-001..004，另开计划）。
- 附件内容解析（EXIF/PDF 文本）、thumbnails、附件全文索引（决策 §3「不做」原样）。
- `file.backlinks` 字段（语法文档标【P2 评估】；本片满足线 = 链接命中关系可查询，见下）。
- 索引范围配置化（隐藏项/扩展名规则仍硬编码，不引入新配置键）。
- 不动 `files` 表 DDL、不动 DQL 任何 SQL、不动既有 `ScanReport` 字段语义（附件计数为增量字段）。

## 关键取舍（实现前拍板）

### 片一 · schema + indexer

1. DDL：决策 §3 的 `vault_entries`（id/path UNIQUE/name/extension 不含点/folder/size/mtime/ctime）+ `idx_vault_entries_folder` 追加进 `SCHEMA_SQL`；`IF NOT EXISTS` 幂等，旧库打开即补建，无需迁移机制（与既有七表同策略）。
2. 扫描：`collectMarkdownFiles` 升级为同时返回附件清单（单根函数保持签名兼容或新增兄弟函数，以最小 diff 为准）；附件判定 = 非隐藏 && 非目录 && 扩展名非 `.md`（大小写不敏感）。`collectAllMarkdown` 对应升级，多根去重逻辑不变。
3. 附件 payload：纯 `stat`（不读内容、不解析）；`name`/`extension`/`folder` 命名口径与 `files` 表完全一致（name = 去扩展名 basename，extension = 不含点小写）。rebuild 清空清单与 `deleteByPath` 删除清单同步加 `vault_entries`（两处都是硬编码表清单：index.ts  rebuild 事务与 deleteByPath）。
4. 增量：`computeDiff` 扩展为同时 diff 附件（FS 附件集 vs `SELECT path, mtime, size FROM vault_entries`，mtime 同既有 floor 口径）；`scanIter` 对附件 added/modified 走 stat upsert、deleted 走按 path 删除；报告增量附件计数字段，既有字段不动。
5. `update(abs)`/`remove(abs)` 按扩展名分派：`.md` 走既有路径，其余 upsert/删除 `vault_entries`；`remove` 双表都删（幂等，防扩展名判断与库内现状不一致）。
6. watcher：`isMarkdown` 门改为分派——`.md` 事件走既有 onAdd/onChange/onUnlink，非 `.md` 文件事件走新增可选回调（缺省空操作，向后兼容）；`VaultIndexer.watch` 接线到 update/remove。隐藏过滤（`isHidden`）不变。

### 片二 · Bases all-files 数据源

7. `readBaseRows(db, limits, onIssue)` 增 options 参（`dataset: "markdown" | "all-files"`，默认 `markdown` 保持现签名兼容）。all-files：增读 `vault_entries`（不读 content 大列的同款轻 SELECT），附件行 `note = {}`、`file.properties = wrapValue({})`、`tags/links = []`，file 字段映射与笔记行同一套代码路径（name/basename/path/folder/ext/size/ctime/mtime）；合并后全局 `path ASC` 排序，maxRows 预算对合并集截断。
8. 旧库无 `vault_entries` 表（BaseEngine 只读打开）：all-files 模式降级 = md-only + compat warning 诊断（不崩）；markdown 模式零感知（不查新表）。
9. conformance：engine 增 query option `conformance?: "bases-markdown-2026-07" | "bases-all-files-2026-07"`（缺省 markdown），未知值 → `base/invalid-schema` error；`pushMarkdownOnly` 警告仅 markdown 模式发；`BaseQueryResult.conformance` 如实回传所选值。
10. BASE-ALL-002 满足线（决策 §3）：附件行出链恒 `[]`、未知格式不伪造内容链接；附件作为**链接 target** 的命中关系可查询 = 笔记行 `file.links` 含附件原始 target 文本（现状即如此，补回归测试锁定）；embed `![[img.png]]` 已在 `links` 表（is_embed=1 计入口径不变）。

### 片三 · 证明清单 + CLI + 收口

11. 「DQL 不变」四条证明（决策 §3，全部落成测试）：① `sqlite_master` 锁定 `files` 表 DDL 逐字节快照（此前无此测试，新增）；② DQL 全部既有测试零改动通过；③ 回归用例：vault 含附件时 DQL 查询行数 = 纯 .md 行数；④ indexer 写入分派测试：附件只进 `vault_entries`、`.md` 只进 `files`，删除/改名（unlink+add）经 diff 同步。
12. 跨表 path 唯一性不变量测试：同一物理文件只进一张表（扩展名分派保证，决策 §4）。
13. CLI：`x-basalt base` 增 `--conformance <id>` 薄透传（缺省不传 = markdown，契约不变）。
14. 基准（决策 §4「只记录不承诺」）：sample-vault + bases fixtures 重建耗时/库体积记录进本计划验证结论。
15. 既有 BASE-DATA-002（附件不为行）在默认 md-only 模式下必须保持绿色。

## 风险

- **oracle 软序风险**（承接 TODO）：truthiness/null 排序/类型比较等暂定口径若被 oracle 推翻，附件行走同路径需同步校正——本片测试对暂定口径处注释标注「待 oracle」。
- 附件体量：大 vault 数万附件对 rebuild 时间与库体积的影响无实测；本片只记录基准，不做性能承诺（决策 §4）。
- watcher 分派改动触碰既有事件路径——既有 watch 测试（add/unlink 行数断言）必须零改动通过。
- `vault_entries` 与 `files` 的 folder/ext 口径若不一致会导致 Bases 行字段分叉——强制同一映射函数产出两类行。

## 停点

- 需要改 `files` 表 DDL 或 DQL SQL 才能过 → 停下回报（违反硬边界）。
- 附件与笔记同名导致的 wikilink 解析键歧义（决策 §3 明示不在 schema 层预判）若阻塞 BASE-ALL-002 → 降级为「链接命中可查询」已满足 + 标注 oracle 对照项，不擅自扩。
- all-files 合并后 sort/filter 路径出现 attachment 行特有崩溃且无法保守处理 → 停下回报。

## 验证口径（完成定义）

- BASE-ALL-001、BASE-ALL-002 每号独立测试通过（注释标编号）；片一 indexer 六条路径各有独立用例（含边界：隐藏附件跳过、无扩展名文件、大小写扩展名、多根命名空间、改名=unlink+add）。
- 证明清单 11①③④、12 全部落成测试并通过；DQL 既有测试零改动。
- `pnpm run typecheck`、`pnpm test` 全绿；触碰代码文件 `oxfmt --check` + `oxlint` 0 告警。
- 实现状态追踪文档 §4 对应行翻牌；TODO.md 更新；本计划附验证结论；改动文档按 dogfood 补元数据（`x-basalt meta apply llm-wiki … --refresh-derived`）。

## 验证结论

**片二（2026-07-27 落地）**：Bases all-files 数据源 + conformance 开关。

- `source.ts`：`readBaseRows` 增第 4 参 `ReadBaseRowsOptions`（`dataset`，缺省 markdown，现签名兼容）；
  all-files = `files` ∪ `vault_entries` 内存合并、全局 `path ASC`，maxRows 对合并集计数（口径注释标注与
  md-only 单侧不同）；附件行 `note = {}`（MISSING 传播全缺失、投影塌缩 null）、`file.tags/links` 恒 `[]`；
  file 字段映射抽取共用函数 `fileValueFrom`（笔记/附件同一口径，防分叉）；`hasVaultEntriesTable`
  （sqlite_master）为降级判定唯一实现，markdown 模式对新表零感知。
- `engine.ts`：`BaseQueryOptions.conformance`（缺省 `bases-markdown-2026-07`）；未知 id →
  `base/invalid-schema`（error，复用配置形状口径）+ 空结果；all-files 遇旧库降级 = md-only +
  `base/unsupported-feature` compat warning（reason `all_files_degraded_no_vault_entries`），
  `BaseQueryResult.conformance` 回传**实际生效**口径；`pushMarkdownOnly` 仅 markdown 模式发。
- 测试 `tests/base-all-files.test.ts` 11 用例全绿：BASE-ALL-001 ×2（附件为行/file 字段逐字段/行数
  = files + vault_entries/合并序 path ASC）、BASE-ALL-002（附件行出链恒 [] + embed 命中可查询）、
  conformance ×3（缺省 markdown / 显式 all-files 无 md-only warning / 未知 id error）、降级 ×2
  （all-files 降级不崩 + markdown 零感知）、note 属性 filter（MISSING 不崩）、file.size 混排、
  maxRows 合并集截断。
- 验证：`pnpm run typecheck` 通过；`pnpm test` 全量 **814 pass / 0 fail**（基线 803 + 新增 11，
  BASE-DATA-001/002 等既有断言零改动）；触碰文件 `oxlint` 0 告警、`oxfmt --check` 通过。
**片三（2026-07-27 落地）**：「DQL 不变」证明 + CLI `--conformance` + 基准收口。

- 证明清单（决策 §3）全部落成：
  - ① `tests/vault-entries-dql-proof.test.ts` 新增 3 用例——`sqlite_master` 逐字节快照锁覆盖
    白名单 8 表（files/links/tags/tasks/blocks/inline_fields/store_config + vault_entries），
    任何 DDL 漂移（含注释/对齐）即红；③ 同文件回归：bases/p1/vault（7 篇 .md + 16 附件在场）
    rebuild 后 `TABLE file.path` 行数 == files 表 .md 行数（7）且全为 `.md` 结尾，
    `file.inlinks` JOIN 查询（Beta ← Alpha.md）与 `TASK` 查询行为不变；
  - ② DQL 全部既有测试零改动通过——`git status` 确认 tests/ 下仅 base-cli.test.ts 增量（+53 行）
    与新增文件，query-\*/sql-generator/inlinks/fts 等 DQL 相关测试文件零改动；
  - ④ 写入分派 + 跨表 path 唯一性由片一 `tests/indexer-attachments.test.ts` 覆盖（不重复）。
  - 全仓自查：`rg 'vault_entries' src/query/` 零命中——DQL SQL 不含新表。
- CLI：`x-basalt base` 增 `--conformance <id>` 薄透传（src/cli.ts；缺省不传 = markdown，
  JSON 契约不变；CLI 不做白名单校验，未知 id 由引擎诊断）。`tests/base-cli.test.ts` 补 3 用例：
  显式 all-files → total 23（7 + 16）且含附件行 cover.png、不发 md-only warning；
  缺省 → total 7 无附件行；未知 id → exit 1 + `base/invalid-schema` error + rows 空。
- 基准（决策 §4「只记录不承诺」，本机 Windows / Node 24 单次 rebuild 实测）：
  - `tests/fixtures/sample-vault`（files=5，vault_entries=0）：rebuild ≈ 21.4 ms，库 152.0 KiB；
  - `tests/fixtures/bases/p1/vault`（files=7，vault_entries=16）：rebuild ≈ 7.2 ms，库 148.0 KiB。
  - 小 fixture 量级下附件扫描开销不可分辨；数万附件大 vault 未实测，不做性能承诺。
- 验证：`pnpm run typecheck` 通过；`pnpm test` 全量 **820 pass / 0 fail**（基线 814 + 新增 6）；
  触碰代码文件（src/cli.ts、tests/base-cli.test.ts、tests/vault-entries-dql-proof.test.ts）
  `oxlint` 0 告警、`oxfmt --check` 通过。
- 文档翻牌：实现状态追踪 §5 BASE-ALL-001/002 → ✅（BASE-ALL-002 标注暂定口径待 oracle）；
  TODO.md P3a 勾销。P3 余项（embedded code block、contextFile/this，BASE-CTX-001..004）另开计划。


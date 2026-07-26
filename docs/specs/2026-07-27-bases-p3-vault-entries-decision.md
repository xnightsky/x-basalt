---
type: spec
title: 决策：Bases P3 all-files 附件索引 schema（vault_entries）
description: 独立 vault_entries 表存附件条目、Bases all-files 查询期合并、DQL .md-only 数据集不变的证明清单；只决策不实施
tags:
  - spec
  - bases
  - decision
  - indexer
  - x-basalt
timestamp: 2026-07-26T20:11:45Z
sha256: dbbaea638ce90143ef9de4616405038bc055c50ed2c8ebe2116426413efd831c
---
# 决策：Bases P3 all-files 的附件索引 schema（vault_entries）

> 2026-07-27 · 状态：决策冻结（**只决策、不实施**；实施另开计划）。
> 前置契约：[`2026-07-22-bases-headless-engine-design.md`](2026-07-22-bases-headless-engine-design.md) §13 P3 第 1 条「独立设计 `vault_entries`/附件索引，证明 DQL 不变」；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../testing/2026-07-22-bases-scenario-matrix.md) §6（BASE-ALL-001/002）。

## 1. 问题

Bases all-files 要求附件（图片/PDF/Canvas/`.base` 等）作为查询行（file fields 可用、note fields 缺失）。当前 `files` 表是 **.md-only** 数据集，同时服务 DQL 与 Bases md-only conformance。硬边界（设计 §2.7）：现有 DQL 结果集继续只含 `.md`，all-files **不得通过改变旧 `files` 语义偷渡**。

## 2. 选项

| 选项 | 做法 | 评价 |
| ---- | ---- | ---- |
| A · 独立表 `vault_entries`（**采纳**） | 新表存附件条目；Bases all-files 数据源 = `files` ∪ `vault_entries` 查询期合并 | DQL 零感知（不读新表），「DQL 不变」可机械证明；附件 schema 可独立演进 |
| B · `files` 加 `kind` 列 | 附件入 `files` 以 kind 区分 | 改变既有表语义与唯一键假设；DQL 所有 `FROM files` 查询计划被动摇——违反硬边界，拒绝 |
| C · 附件直接入 `files` | 不区分 | 同 B 且更糟，拒绝 |

## 3. 决策（A 的落地形状）

```sql
CREATE TABLE IF NOT EXISTS vault_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  path      TEXT NOT NULL UNIQUE,   -- 与 files.path 同一命名空间（多根 <根目录名>/<相对>）
  name      TEXT NOT NULL,          -- 文件名（无扩展名）
  extension TEXT NOT NULL,          -- 不含点
  folder    TEXT NOT NULL,
  size      INTEGER NOT NULL,
  mtime     INTEGER NOT NULL,
  ctime     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_entries_folder ON vault_entries(folder);
```

- **无 content/frontmatter/name_key/path_key**：附件不解析内容、不参与 wikilink 解析键（bare 链接回退仍只命中笔记——同名附件与笔记的歧义属 BASE-ALL-002 的 oracle 对照项，不在 schema 层预判）。
- **DQL 不变的证明**（实施计划的验收清单）：① `files` 表 DDL 逐字节不变（schema.ts diff）；② DQL 全部既有测试无改动通过；③ DQL 查询 SQL 不含 `vault_entries`（代码审查 + 一条「files 行数不受附件影响」回归用例）；④ 索引器对附件只写 `vault_entries`，删除/改名经既有 diff 机制同步。
- **Bases 数据源扩展**：`source.ts` 增加 all-files 模式（按 conformance 版本开关，默认仍 md-only）：行 = `files`（note fields 有）∪ `vault_entries`（note fields 全 MISSING，BASE-ALL-001）；`file.tags`/`file.links` 对附件行为空列表。UNION 查询或双表内存合并（P1 无下推先例，先内存合并，性能证据出现再议）。
- **附件 links/backlinks**（BASE-ALL-002）：`links` 表已含指向附件的行（embed `![[img.png]]`、普通链接）。all-files 阶段：附件行的 `file.links`（出链）恒空；附件的 backlink（被谁引用）经既有路径感知 JOIN 可得，但 `file.backlinks` 字段本身在语法文档标【P2 评估】——先以「链接命中关系可查询」为满足线，字段形态另评。
- **indexer 扩展面**：扫描器增加附件收集（扩展名白名单 = 除 `.md` 外全部，或显式清单——实施时定）；watcher add/unlink/change 同步 `vault_entries`；重建/增量路径共用 VaultLayout 命名空间。
- **不做**：附件内容解析（EXIF/PDF 文本）、附件 thumbnails、附件全文索引。

## 4. 风险与开放问题

- 附件体量（大 vault 数万附件）对索引体积与重建时间的影响——实施计划需带基准（沿用「只记录不承诺」口径）。
- `vault_entries` 与 `files` 的 path 唯一性跨表成立（同一物理文件只进一张表，由扩展名分派保证）——实施时加一条不变量断言测试。
- Canvas/`.base` 本身是 JSON/YAML 文本：本期一律按附件（不解析），未来若要「.base 作为行且可读其 views」属另一决策。
- 官方对附件 note fields 的确切缺失形态（null vs missing）并入既有 oracle runbook（BASE-PROP-006 已在矩阵，P1 标「P1 不产生该类行」）。

## 5. 后续

- 实施计划（另开）：schema + indexer 扩展 → `source.ts` all-files 模式 → BASE-ALL-001/002 测试 → 证明清单（§3）执行。
- 本决策若被实施期证据推翻（如合并查询性能不可接受），回写本文「状态」并记录推翻理由。

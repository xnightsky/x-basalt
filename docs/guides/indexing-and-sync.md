---
timestamp: 2026-06-30T03:21:44Z
sha256: 77884e9a406aa1c13b24f0c52d7877e7f8f927dcb9f873761c2ed49de0dc7304
type: guide
title: 索引与同步 · x-basalt
description: index/scan/watch 三种索引模式的行为、取舍与数据模型
tags:
  - guide
  - indexer
  - scan
  - x-basalt
---
# 索引与同步 · x-basalt

> 深入讲解三种索引维护方式（`index` / `scan` / `watch`）、增量检测细节、全量重建的原子性保证、SQLite 五表数据模型，以及路径感知链接解析。
>
> 返回：[使用指南](usage.md)
> 相关章节：[命令参考](commands.md) · [DQL 查询语法](querying-dql.md) · [配置文件](configuration.md) · [故障排查](troubleshooting.md)

---

## 1. 三种索引维护方式

| 方式     | 命令             | 适用场景                                    | 维护机制                                      |
| -------- | ---------------- | ------------------------------------------- | --------------------------------------------- |
| 全量重建 | `x-basalt index` | 首次建库；需要彻底重置索引                  | 清空五表，流式分批重写，单事务原子            |
| 按需增量 | `x-basalt scan`  | 无常驻进程；人/AI 周期触发                  | diff FS vs 库快照，只重扫新增/改动/删除的文件 |
| 实时监听 | `x-basalt watch` | 有常驻进程；编辑 Vault 的同时需索引实时跟上 | chokidar 事件流，单文件增量更新               |

**选哪个？**

- 第一次用，或想从头来 → `index`
- 无常驻进程，被 AI / 脚本定期调用 → **`scan`**（无常驻时首选；本章重点）
- 长期开着终端，实时索引 → `watch`

---

## 2. `scan`：按需增量重索引

### 2.1 命令接口

```
x-basalt scan [vault...] [--db <path>] [--rehash] [--dry-run] [--json]
```

| 选项          | 默认                 | 说明                                                       |
| ------------- | -------------------- | ---------------------------------------------------------- |
| `[vault]`     | 配置 `vault`         | Vault 根目录；省略时取配置文件 `vault`，二者皆无则报错     |
| `--db <path>` | `.x-basalt/index.db` | SQLite 索引文件（父目录自动创建）                          |
| `--rehash`    | 关                   | 按内容对比检测变更（慢但稳）；缺省用 mtime+size 快判       |
| `--dry-run`   | 关                   | 只报告差异，**绝不写库**（预览用）                         |
| `--json`      | 关                   | 结构化输出 `{added,modified,deleted,unchanged}`（AI 消费） |

默认（非 `--json`）输出示例：

```
✓ scan ./my-vault：+3 新增 ~1 改动 -0 删除（142 未变跳过）
```

dry-run 时结尾附注 `（dry-run 未写入）`。

### 2.2 变更检测：mtime+size 快判 vs `--rehash` 内容对比

scan 的核心是把「文件系统当前态」与「库内快照（`files` 表的 `mtime`/`size`/`content`）」做 diff，只重扫有变化的文件。

#### 默认模式：mtime+size 快判

- mtime 取 **floored-ms**（截断到毫秒，绕开纳秒抖动）；size 取字节数；
- 两者均与库内相同 → 视为**未变**，**连读盘都跳过**（性能最大化）；
- 任一不同 → 视为改动，重新解析入库。

#### 已知局限（诚实标注，对标 git "racy git" / rsync 默认）

| 场景                                    | 现象                                     |
| --------------------------------------- | ---------------------------------------- |
| 同一秒内修改且 size 恰好不变            | mtime 精度不够，可能漏判为未变（假阴性） |
| `cp -p` / `rsync -a` 复制，保留旧 mtime | 内容变但 mtime 未跳，漏判                |

反方向误报（`touch` 改 mtime 但内容不变）只会**多扫一次**，结果正确无害。

#### `--rehash`：内容对比兜底

`--rehash` 读取文件当前内容，与库内存储的 `files.content` 逐字节比对。绕开上述漏判窗口——对标 git 对 "racy" 情况的内容哈希回退和 rsync `--checksum`。代价是每个待判文件都需读盘，适合精度优先、或刚完成 `cp -p` / `rsync -a` 同步的场景。

```bash
# 预览差异，不写库
x-basalt scan ./my-vault --dry-run

# 内容对比，精度优先
x-basalt scan ./my-vault --rehash

# AI 周期触发，拿结构化报告
x-basalt scan ./my-vault --json

# 内容精确 + 结构化报告
x-basalt scan ./my-vault --rehash --json
```

### 2.3 差异报告字段

`--json` 输出（同库级 API `VaultIndexer.scan()` 的返回类型 `ScanReport`）：

```json
{
  "added":     ["新增文件相对 Vault 的 POSIX 路径", ...],
  "modified":  ["改动文件路径", ...],
  "deleted":   ["删除文件路径", ...],
  "unchanged": 142
}
```

- `added` / `modified` / `deleted`：`string[]`，已按字母序排序；
- `unchanged`：`number`，未变文件**计数**（不列名，性能优先）。

### 2.4 分批处理与断点续扫

CLI 的 `scan` 命令走便捷封装 `VaultIndexer.scan()`，底层是 async 生成器 `scanIter()`。

| 机制                 | 说明                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **分批落库**         | 变更文件按批（默认 100 个/批）并发读盘+解析，每批在独立事务内落库后 yield 进度                                                 |
| **内存 O(批)**       | 每批落库后即可回收，内存不随变更总数线性膨胀，大库不 OOM                                                                       |
| **进度 `remaining`** | 每批 yield 的 `ScanProgress` 含 `remaining`（剩余待处理数），调用方可据此决定是否续跑                                          |
| **天然断点续扫**     | 调用方 `break` 后，已写批持久化；未写文件保持库内旧 `mtime`/`size`，下次 `scan` 的 diff 仍判为改动，自然续上——**无需游标状态** |

库级 API 示意（可选断点续）：

```typescript
const indexer = new VaultIndexer({ vaultPath, dbPath });
for await (const progress of indexer.scanIter({ batchSize: 50 })) {
  console.log(
    `已处理 +${progress.added.length} ~${progress.modified.length}，剩余: ${progress.remaining}`,
  );
  if (shouldStop()) break; // 中途退出，下次 scan 自动续上
}
indexer.close();
```

---

## 3. `index`：全量重建

```
x-basalt index [vault...] [--db <path>] [--watch]
```

| 行为           | 说明                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **流式分批**   | 100 个/批并发读盘+解析，内存 O(批)，不随库规模膨胀                                                 |
| **原子事务**   | 手动 `BEGIN` → 清空五表 → 分批写入 → `COMMIT`；任意批写入异常立即 `ROLLBACK`，保证「无半成品索引」 |
| **单文件容错** | 单文件读取/解析失败 → 跳过 + `warn`，其余照常入库，不中断全量重建                                  |
| **`--watch`**  | 全量重建完成后继续进入监听模式（等价 `watch` 但先强制全量刷新）                                    |

首次建库、或想彻底重置时用 `index`。之后用 `scan` 或 `watch` 维护增量。

---

## 4. `watch`：实时监听

```
x-basalt watch [vault...] [--db <path>] [--on-change <cmd>]
```

启动时先全量 `rebuild()`，随后进入 chokidar 监听循环（前台运行，`Ctrl+C` 退出）。

| 机制             | 说明                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| **忽略隐藏路径** | 任意路径段以 `.` 开头均忽略，含 `.obsidian/`、`.git/`、`.DS_Store` 等               |
| **只处理 `.md`** | 非 Markdown 文件的变更事件被过滤，不触发索引回调                                    |
| **写稳定窗口**   | `awaitWriteFinish: { stabilityThreshold: 100ms }`，等编辑器写完再触发，避免半写状态 |
| **先索引后回调** | `add`/`change` 先增量更新索引**再**触发 `--on-change`，保证回调看到的索引已是最新   |
| **单文件容错**   | 单文件索引失败或监听器错误降级为 `warn`，不崩进程（幂等监听）                       |

```bash
x-basalt watch ./my-vault --db ./my-vault.db --on-change "node run-query.js {file}"
```

---

## 5. SQLite 数据模型

索引是**单文件 SQLite**，默认路径 `.x-basalt/index.db`。五张表，路径一律以 **POSIX 正斜杠**（`/`）存储，Windows 反斜杠在写入前由 `toPosix()` 转换（跨平台可移植）。

> **硬约束**：隐式字段（`file.inlinks` / `file.outlinks` / `file.tags` / `file.tasks`）**不建物化视图**，查询期路径感知 JOIN 实时计算。

### 5.1 `files` — 每文件一行

| 列            | 类型        | 说明                                                                                          |
| ------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `path`        | TEXT UNIQUE | 文件主键（POSIX，含扩展名）。**单根** vault = 相对该根，如 `projects/alpha.md`；**多根** vault = `<根目录名>/<相对该根>`，如 `docs/alpha.md`（各根目录名作命名空间，互不撞键）          |
| `name`        | TEXT        | 文件名无扩展名，如 `alpha`                                                                    |
| `name_key`    | TEXT        | `name` 的小写形式；bare 链接 `[[Note]]` 的 basename 大小写不敏感解析键                        |
| `path_key`    | TEXT        | 全路径去扩展名小写，如 `projects/alpha`；qualified 链接精确解析键（S3.2，消除同名异目录串味） |
| `extension`   | TEXT        | 扩展名不含点，如 `md`                                                                         |
| `folder`      | TEXT        | 父目录 POSIX（根为空串），支撑 `file.folder` 与 `FROM "folder"` 前缀匹配                      |
| `size`        | INTEGER     | 字节数                                                                                        |
| `mtime`       | INTEGER     | 修改时间 epoch 毫秒（floored-ms）                                                             |
| `ctime`       | INTEGER     | 创建时间 epoch 毫秒（birthtime 为 0 时回退 ctime）                                            |
| `content`     | TEXT        | 原始文件内容（`--rehash` 内容对比时读取）                                                     |
| `frontmatter` | TEXT        | frontmatter 的 JSON 字符串，查询期 `json_extract(f.frontmatter, '$.field')` 取标量            |

### 5.2 `links` — 每条 wikilink 一行

| 列                | 类型         | 说明                                                                                                       |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `source`          | TEXT         | 源文件 `path`（POSIX）                                                                                     |
| `target`          | TEXT         | 原始 target 文本，展示用，如 `Projects/Alpha`                                                              |
| `target_key`      | TEXT         | `linkKey(target)` = 小写无扩展名 basename；bare 链接的 inlinks 回退连接键                                  |
| `target_path_key` | TEXT \| NULL | target 含 `/` 时的 `pathKey(target)`（如 `projects/alpha`），否则 `NULL`；qualified 链接精确连接键（S3.2） |
| `alias`           | TEXT \| NULL | `[[Note\|Alias]]` 中的别名                                                                                 |
| `heading`         | TEXT \| NULL | `[[Note#Heading]]` 中的标题锚点                                                                            |
| `block_id`        | TEXT \| NULL | `[[Note#^block-id]]` 中的块 id                                                                             |
| `is_embed`        | INTEGER      | `1` = `![[...]]` 嵌入，`0` = 普通链接；嵌入同样计入 outlinks                                               |

### 5.3 `tags` — 每个标签一行

| 列               | 类型    | 说明                                                        |
| ---------------- | ------- | ----------------------------------------------------------- |
| `file_path`      | TEXT    | 所属文件 `path`                                             |
| `tag`            | TEXT    | 不带 `#` 的标签文本；嵌套保留全名，如 `area/work`           |
| `in_frontmatter` | INTEGER | `1` = 来自 frontmatter `tags`/`tag` 字段，`0` = 行内 `#tag` |

### 5.4 `tasks` — 每个 task 一行

| 列            | 类型         | 说明                                                                     |
| ------------- | ------------ | ------------------------------------------------------------------------ |
| `file_path`   | TEXT         | 所属文件 `path`                                                          |
| `line_number` | INTEGER      | 1-based 正文行号（不含 frontmatter 头部）                                |
| `status`      | TEXT         | 方括号内单字符：`' '`（未完成）、`x`（完成）、`-`（取消）、`?`（待定）等 |
| `text`        | TEXT         | 去掉 `- [x] ` 前缀后的任务文本                                           |
| `due_date`    | TEXT \| NULL | 从 text 中提取的第一个 `YYYY-MM-DD`，无则 `NULL`                         |

### 5.5 `blocks` — 每个块锚点一行

| 列            | 类型    | 说明                                         |
| ------------- | ------- | -------------------------------------------- |
| `file_path`   | TEXT    | 所属文件 `path`                              |
| `block_id`    | TEXT    | 块 id（行尾 `^block-id` 的 `block-id` 部分） |
| `content`     | TEXT    | 块锚点所在正文行，已剥离行尾 `^id` 并 trim   |
| `line_number` | INTEGER | 1-based 正文行号                             |

`(file_path, block_id)` 有 `UNIQUE` 约束，写入用 `INSERT OR REPLACE` 保证幂等。

---

## 6. 路径感知链接解析

### 6.1 两种匹配模式

wikilink target 中是否含 `/` 决定匹配方式（两者均在查询期实时 JOIN，不预物化）：

| 链接类型                | 示例                 | 连接键                                                                | 语义                                                    |
| ----------------------- | -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **qualified**（含目录） | `[[Projects/Alpha]]` | `links.target_path_key = files.path_key`                              | 精确路径匹配；`projects/alpha` 不会命中 `archive/alpha` |
| **bare**（仅文件名）    | `[[Alpha]]`          | `links.target_path_key IS NULL AND links.target_key = files.name_key` | basename 大小写不敏感回退；同名多文件时全列（MVP 近似） |

### 6.2 写入规则

`target_path_key` 仅当 target 含 `/` 时写入，否则存 `NULL`：

```typescript
// src/indexer/index.ts
targetPathKey: node.target.includes("/") ? pathKey(node.target) : null;
```

`pathKey(t)` = 去扩展名 + toPosix + 全小写（如 `Projects/Alpha` → `projects/alpha`）。
`linkKey(t)` = basename 去扩展名小写（如 `Projects/Alpha` → `alpha`）。

### 6.3 inlinks / outlinks 实际 JOIN 逻辑

`file.inlinks` 使用的路径感知条件（源自 `src/query/sql-generator.ts`）：

```sql
-- INLINK_MATCH（路径感知，S3.2）
(l.target_path_key = f.path_key
 OR (l.target_path_key IS NULL AND l.target_key = f.name_key))
```

- 若 `target_path_key` 不为 NULL → 走 **qualified 精确匹配**（`path_key` 对 `path_key`）；
- 若 `target_path_key IS NULL` → 走 **bare 回退**（`target_key` 对 `name_key`，basename 大小写不敏感）。

```sql
-- file.inlinks（结果列）
SELECT json_group_array(DISTINCT l.source) FROM links l
WHERE (l.target_path_key = f.path_key
       OR (l.target_path_key IS NULL AND l.target_key = f.name_key))

-- file.outlinks（结果列）
SELECT json_group_array(DISTINCT l.target) FROM links l
WHERE l.source = f.path
```

`FROM [[Note]]`（DQL 反链 FROM）走同一路径感知逻辑：找「有出边指向 Note 的文件」，即 Note 的 inlinks 集合。详见 [querying-dql.md](querying-dql.md)。

---

## 7. 典型使用模式

```bash
# 首次建库
x-basalt index ./my-vault

# AI 定期调：增量扫描，拿结构化报告
x-basalt scan ./my-vault --json

# 高精度增量扫（例如外部同步工具保留 mtime 后）
x-basalt scan ./my-vault --rehash

# 先预览再实施
x-basalt scan ./my-vault --dry-run --json
x-basalt scan ./my-vault

# 有常驻终端时：全量重建后实时监听
x-basalt watch ./my-vault --on-change "echo {file} 已更新"
```

---

> 返回 [使用指南](usage.md) · 上一章：[安装](installation.md) · 下一章：[DQL 查询语法](querying-dql.md)

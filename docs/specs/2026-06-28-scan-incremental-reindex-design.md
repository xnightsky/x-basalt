# `scan`：按需增量重索引设计

> 日期：2026-06-28 · 类型：设计/spec（dogfood 观察期需求）
> 关联：[`TODO.md`](../../TODO.md)「dogfood 观察期」、索引层 [`src/indexer/index.ts`](../../src/indexer/index.ts)
> 标尺：[`biz-dql-subset`](../../skills-def/biz-dql-subset/SKILL.md)（schema / 隐式字段）

## 背景与动机

dogfood 暴露的真实场景：**没有常驻进程**去 `watch` 文件夹，而是被人/AI **定期触发**，丢来一个**任意目录**，要求自己搞清「哪些文件变了」并**只重扫变化的**（新增/修改/删除），跳过没动的——而非每次全量 `rebuild`。难点：没有事件流，变更需由「文件系统当前态 vs 上次索引态」**自行 diff** 得出。该场景比 `watch` 更重要。

## 决策

新增 **`scan` 子命令** + `VaultIndexer`：对比文件系统与库内快照，只处理变化文件。变更检测**默认 mtime+size**，`--rehash` 改走内容对比。**不改 schema**（mtime/size/content 均已存）。

**分批 / 迭代器（避免一次处理太多爆内存，同 S3.3 流式 rebuild 思路）**：
- `scanIter(opts)` 是 **async 生成器**，把变更文件**按批**(re)build+落库，每批 yield 一次进度（含 `remaining`）。调用方可 `break` 只处理一部分就停——**未写入的文件下次 scan 仍被检出，天然断点续扫**（无需游标状态）。
- `scan(opts)` 是便捷封装：**drain `scanIter` 全跑**，返回累计 `ScanReport`。CLI 与简单调用走这个。

> **先例校准**：此设计与业界一致——rsync 默认 mtime+size、`--checksum` 走哈希；git index 用 stat 缓存做快判、遇 "racy" 回退内容哈希。已知局限同 git「racy git」（见下「变更检测」）。

## 命令接口

```
x-basalt scan [vault] [--db <path>] [--rehash] [--dry-run] [--json]
```
- `vault` / `--db`：同 `index`（可回退 config.vault / config.db；默认库 `.x-basalt/index.db`）。
- `--rehash`：内容对比检测（慢但稳），默认 mtime+size。
- `--dry-run`：只算差异、**不写库**，输出报告（供 AI/人触发前预览）。
- `--json`：输出结构化报告（`{added,modified,deleted,unchanged}`，AI 用）；缺省为人读的一行摘要。
  - 避免与 parse/query 的 `--format json|yaml`（输出体序列化）语义撞车，故 scan 单用 `--json` 布尔旗标。

## 核心算法

**① `computeDiff(rehash)` —— 算差异（便宜，先不写）**
1. **扫 FS**：`collectMarkdownFiles(vault)` 取当前所有 `.md`；每个 `stat` 出 `{ relPath, mtime(floored-ms), size }`。
2. **读库快照**：`SELECT path, mtime, size FROM files` → `Map<relPath,{mtime,size}>`。
3. 分类：
   - **新增** = 在 FS 不在库；**删除** = 在库不在 FS；
   - **改动**：两边都有且 —— 默认 `mtime ≠` 或 `size ≠`（floored-ms，同机同文件，等价 git stat 快判）；`--rehash` 读当前内容与库内 `files.content` 比，不等即改动；
   - **未变** = 其余 → 默认路径**连读都不读**（性能收益；`--rehash` 为检测会读）。

**② `scanIter(opts)` —— 按批落库的 async 生成器**
- 先 `computeDiff`；`--dry-run` 则只 yield 一次完整计划、不写、返回。
- 删除一次性清（便宜）。新增+改动组成工作列表，按 `batchSize`（默认 = `REBUILD_BATCH`）切批：每批并发 `buildPayload` → 一个 `db.transaction` 内 `deleteByPath`(改动先删)+`insertPayload`(先删后插，幂等) → **yield 累计进度** `{ added, modified, deleted, unchanged, remaining }`。
- 单文件 `buildPayload` 失败 → 跳过 + warn，不中断（同 rebuild）。
- **断点续扫**：调用方中途 `break`，已写批落库、未写文件保持库内旧 stat，下次 scan 的 `computeDiff` 仍把它们判为改动 → 自然续上，无游标。

**③ `scan(opts): Promise<ScanReport>` —— drain `scanIter` 全跑**，返回最终累计 `{ added, modified, deleted, unchanged }`。CLI `scan` 走它。

## 变更检测：默认路径的已知局限（诚实标注）

默认 mtime+size 有**固有假阴性窗口**（同 git "racy git" / rsync 默认）：
- 文件**同一秒内被改且 size 恰好不变** → mtime 可能未跳，漏判；
- **复制/还原保留旧 mtime**（`cp -p`/`rsync -a`）→ 内容变但 mtime 没变，漏判。

remedy = **`--rehash`**（内容对比，稳态兜底）。反方向（`touch` 改了 mtime 但内容没变）只会**多扫一次**，结果正确、无害。

实现规避的坑：只比「同一文件上次存的 stat vs 现在的 stat」（同机，非跨机器）；mtime 按 **floored-ms** 存与比，躲开纳秒精度抖动。`scan()` 的 JSDoc / `--rehash` 帮助文案须明写此局限。

## 复用与边界

- **复用**：`collectMarkdownFiles` / `buildPayload` / `insertPayload` / `deleteByPath`。
- **新增**：`scan()` 方法 + `diffScan()` 纯函数 + CLI `scan` 命令分支。
- **边界**：空库/新目录 → 全算新增（等价全量首次索引）；单文件 `buildPayload` 失败 → 跳过 + warn，不中断（同 `rebuild`）；`--dry-run` 绝不写库。

## 测试（按重测试纪律）

- **未变幂等**：建库后立即 `scan` → 0 改动；连扫两次第二次仍 0。
- **新增 / 改动 / 删除**：各造一个，验报告计数与库内行数。
- **改动检测**：改文件内容 + touch mtime → 默认路径检出。
- **`--rehash`**：改内容（保持 size/mtime 不便造，改为验 `--rehash` 能检出一个内容改动，且不依赖 mtime）。
- **`--dry-run`**：报告正确但库**未变**（行数不动）。
- **未变不重读**：未变文件不触发 `buildPayload`（以"内容含错误的脏文件不被报错"间接验，或注入计数）。

## 先例来源

- rsync 默认 mtime+size、`--checksum` 走哈希。
- git index：stat 缓存快判 + "racy git" 内容哈希回退（[racy-git 文档](https://git-scm.com/docs/racy-git/2.0.5)）。
- mtime 局限：[apenwarr, mtime comparison considered harmful](https://apenwarr.ca/log/20181113)。

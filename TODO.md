# TODO · x-basalt 全模块收口 + 做深内核

> 执行真相源（存在 = 有执行中任务）。本文件链接主路线图，逐阶段勾选。
> 主计划：[`docs/plans/2026-06-26-execution-roadmap.md`](docs/plans/2026-06-26-execution-roadmap.md)
> 阶段 2 细化：[`docs/plans/2026-06-26-dql-kernel-steps.md`](docs/plans/2026-06-26-dql-kernel-steps.md)
> 阶段 1/3/4 细化：[`docs/plans/2026-06-26-modules-steps.md`](docs/plans/2026-06-26-modules-steps.md)

## 阶段 0 · 基线与前置（✅ 完成 2026-06-27）

- [x] S0.1 升 Node 基线到 22（package.json engines `>=22` + AGENTS 技术栈表；pnpm install exit 0）
- [x] S0.2 测试脚本改 glob `tests/**/*.test.ts`（_smoke 验证 52→53，已删占位）
- [x] S0.3 死依赖清理：移除 `zod`（package.json + AGENTS + 锁文件 grep=0；typecheck/test 全绿）
- [x] S0.4 许可证基线扫描（全宽松证 MIT/ISC/BSD/Apache，零 GPL/AGPL）
- [x] S0.5 门禁基线快照（typecheck=0 / test=52pass / lint=0 / build=0，记入路线图 Evidence）

## 阶段 1 · 解析层改为组装　（下一步可起，**卡点 S1.1**：remark-obsidian-md license + 能力 spike）
## 阶段 2 · DQL 内核做深（关键路径 · 进行中）
**Part A 选型与契约 ✅ 全部完成（2026-06-27）：**
- [x] S2.1 文法工具选型 → **chevrotain@12.0.0**（已落 dependencies；peggy 已移除）。决策：`docs/specs/2026-06-27-dql-grammar-tool-decision.md`
- [x] S2.2a 冻结扩展子集 → `docs/specs/2026-06-27-dql-subset-frozen.md`（TASK+GROUP BY+FLATTEN 全纳入；函数集=日期+字符串+数值）
- [x] S2.2b 同步真相源（biz-dql-subset SKILL + research §3.1/§3.2 + skills:install；现有测试无冲突）
- [x] S2.2c 扩展 AST 类型（ast.ts：TASK/多键sort/groupBy/flatten/withoutId；typecheck+52测试绿）

**Part B 用 chevrotain 重写 tokenizer→parser ✅ 全部完成（2026-06-27）：**
- [x] S2.3 tokenizer 全 token 覆盖（`tokens.ts` lexer + 19 词法用例；Tag 自定义 matcher 解 unicode）
- [x] S2.4–S2.7 parser（`parser.ts` chevrotain）：头(LIST/TABLE/TASK)/FROM/WHERE 优先级/多键SORT/LIMIT + GROUP BY/FLATTEN/WITHOUT ID 结构，16 parser 用例
- [x] S2.8 端到端切换 `DataviewEngine`→`parseDql`；删旧手写 `tokenizer.ts`/`ast.parseQuery`，`DqlSyntaxError` 移 `errors.ts`；全量 86 测试/typecheck/lint/build 全绿

**Part C 修已确认 query bug ✅ 全部完成（2026-06-27）：**
- [x] S2.9 LIKE 通配符转义 + 附带修 S2.8 字符串转义解码回归
- [x] S2.10 icontains 大小写（file.tags LOWER）· S2.11 TABLE 列去重 · S2.12 未知字段 DqlSyntaxError · S2.13 SORT JSON 列报错 + LIMIT 负数校验
- 新建 `tests/sql-generator.test.ts`（SQL 生成纯函数单测）；全量 100 测试 / typecheck / lint 全绿

**Part D 补全子集（每子句一步）：**
- [x] S2.14 多键 SORT · S2.15 WHERE null · S2.16 日期比较（ISO 字典序）
- [x] S2.18 GROUP BY（分组键+rows聚合）· S2.19 FLATTEN（json_each 展开）· S2.20 WITHOUT ID · S2.21 TASK（tasks JOIN files 任务行）—— 均含端到端验证
- [x] **S2.17 内置函数集** ✅（lower/upper/length/round + date today/now；parser 区分谓词/scalar 函数）

**Part E 安全与收口 ✅ 完成（2026-06-27）：**
- [x] S2.22 隐式字段全集核对 · S2.23 注入/ReDoS 安全（`regexp.ts` safeRegexpMatch + 端到端注入用例）· S2.24 覆盖矩阵 §B 重写到实际

> ## ✅ 阶段 2 · DQL 内核做深 全部完成（S2.1–S2.24）
> chevrotain 重写词法+语法、扩展子集全实现（LIST/TABLE/TASK + 完整 WHERE + 多键SORT + GROUP BY/FLATTEN/WITHOUT ID + 内置函数集）、5 bug 修复、注入/ReDoS 防护、覆盖矩阵收口。
> **132 测试 / typecheck / lint / build 全绿。** DQL 子集覆盖 ~95%。

## 下一步（按路线图剩余阶段）
- [ ] **阶段 1** 解析层改为组装（卡点 S1.1：remark-obsidian-md license + 能力 spike）
- [ ] **阶段 3** 索引层健壮性
  - [x] S3.1 监听健壮性（watcher error/onUnlink catch/ready 信号 + watch 增量测试）✅ 2026-06-27
  - [x] **S3.2 basename 反链歧义** ✅ 2026-06-28（跨 indexer/query，路径感知）
    - 真相源先行：`biz-dql-subset` + research §3.3#1 由「basename 近似」改为「路径感知」。
    - schema 加 `files.path_key` + `links.target_path_key`（bare 链接为 NULL）；indexer 落库时计算。
    - query inlinks/outlinks/`FROM [[..]]` 路径感知：qualified（含 `/`）按 `path_key` 精确、bare 按 `name_key` 回退。
    - 新增 `tests/inlinks-pathaware.test.ts`（同名异目录不串味，4 例）；`generateSql` 补路径感知 `@behavior`。
  - [x] **S3.3 大库流式 rebuild** ✅ 2026-06-28（手动 BEGIN/COMMIT 分批读写，内存 O(批) 防 OOM；并发上限=批大小）
    - rebuild 不再一次性把全部 payload 留内存；批内并发读盘、批间串行；整体失败 ROLLBACK 保原子。
    - 新增 `tests/rebuild-streaming.test.ts`（250 文件跨批，行数/反链精确 + 重复 rebuild 不累加，3 例）。
  - [ ] **S3.4 kysely(可选) → S3.5 FTS5(可选)**（阶段 3 剩余可选项）
- [ ] **阶段 4** skill 召回 Fuse.js + CLI/config 收编（yaml/cosmiconfig）
- [ ] **阶段 5** 收口与发布

> 当前全量 **140 测试 / typecheck / lint / build 全绿**。
> 阶段依赖：S0 → {S1, S2, S3, S4 可并行起步}；S2(DQL) 是关键路径与最大投入。
> 阶段 1–5 子步以 `docs/plans/` 细化清单为准；本文件只记录阶段级进度与当前停点。

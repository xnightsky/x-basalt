# TODO · x-basalt

> 执行真相源（存在 = 有在做/待做的任务）。**完成的阶段进度不在此堆积**，见路线图与各决策文档，最终以 git log 为准。
> 主计划：[`docs/plans/2026-06-26-execution-roadmap.md`](docs/plans/2026-06-26-execution-roadmap.md)
> 阶段细化：[`dql-kernel-steps.md`](docs/plans/2026-06-26-dql-kernel-steps.md)（阶段2）、[`modules-steps.md`](docs/plans/2026-06-26-modules-steps.md)（阶段1/3/4）

## ▶ 当前：dogfood 观察期（2026-06-28 起）

核心模块（解析 / 索引 / 查询 / 召回 / CLI）已做深做透；阶段 1 经对标决定保留自建（[决策](docs/specs/2026-06-28-parser-buy-vs-build-decision.md)）。**方案：先不发布，全局安装实际用一段时间，据真实反馈再迭代。**

- 已 `npm link` 全局安装：`x-basalt` 命令全局可用（live 链向仓库 `dist/`；**改源码后需 `pnpm build` 重新编译才生效**，跑的是 dist 不是 src）。
- **暂不发布**（阶段 5 推迟到观察期后；发布前清死依赖 unified/remark-parse/@flowershow）。
- 阶段 3 可选增强 S3.4(kysely) / S3.5(FTS5)：**暂缓**，按观察暴露的真实需求再定做不做、做哪个。

### 观察记录（实际使用中发现的问题 → 下一轮迭代输入）

- **[已迭代] 元数据写侧（meta 命令）· Phase 1 + 2**：x-basalt 此前纯读侧，缺「元数据头改造」。新增首个**写侧**命令组。
  - **Phase 1（CRUD）**：`meta get/set/unset/rename`。`src/meta/`（document 往返内核用 yaml Document API 保键序/注释/正文逐字节保真；operations 顶层扁平键 CRUD；index 原子写 + 幂等 + 非法 YAML 拒写 + dry-run）。deep-research 定型：用 yaml 不用 gray-matter 写回、不依赖 .obsidian/types.json、auto 保守推断避 Norway 陷阱。
  - **Phase 2（normalize 归一）**：`meta normalize`（`src/meta/normalize.ts`）。默认 ON：tags/aliases/cssclasses 列表化（tags/cssclasses 标量按空白/逗号拆、aliases 不拆）、tags 去 `#`、去重、单数键 tag/alias/cssclass→复数键迁移（合并/原位改名）；opt-in `--sort-keys`。坑：未加引号 `- #x`/`tag: a #b` 的 `#` 被 YAML 当注释，解析期即丢/变 null（归一丢弃 null 项）。
  - 计划 [`docs/plans/2026-06-28-meta-frontmatter-write.md`](docs/plans/2026-06-28-meta-frontmatter-write.md) + [`docs/plans/2026-06-28-meta-normalize.md`](docs/plans/2026-06-28-meta-normalize.md)；冻结 [`docs/specs/2026-06-28-meta-subset-frozen.md`](docs/specs/2026-06-28-meta-subset-frozen.md)。
  - **后续阶段**（各自再开计划）：derive（派生）、lint（schema 校验）、migrate（vault 级批量）、type 强制/日期统一（调研判风险高，暂不做）。

- **[已迭代] 无常驻 watcher 的按需重扫**：真实流程是人/AI 定期触发、丢来任意目录，需自行 diff 出新增/改动/删除、只重扫变化的。已新增 `scan` 命令 + `VaultIndexer.scanIter()`（迭代器内核，按批落库、可中途 break 断点续扫）+ `scan()` 便捷全跑；默认 mtime+size、`--rehash` 内容兜底、`--dry-run`/`--json`。设计 [`docs/specs/2026-06-28-scan-incremental-reindex-design.md`](docs/specs/2026-06-28-scan-incremental-reindex-design.md)。
- **[已迭代] `X_BASALT_DIR` 环境变量**：指定 `.x-basalt` 基目录（config 与 index.db 都落其下），可把状态搬到任意位置。优先级 flag > env > 就近发现 > 默认。
- **[已迭代] `x-basalt` 全局使用技能**：新增 `skills-def/x-basalt/SKILL.md`（教 AI 用 CLI，`scope: global`）+ `pnpm skills:install:global` 装到 `~/.claude/skills/`（biz-* 开发技能不进全局）。与 `skills/x-basalt-usage.json5`（CLI 自助数据）互补、各服务不同消费者。

---

> **已完成**：阶段 0（基线）/ 2（DQL 内核做深）/ 3 核心（S3.1–3.3 监听健壮·路径感知·流式 rebuild）/ 4（Fuse.js + yaml + cosmiconfig + CLI 端到端）+ 阶段 1 关闭（保留自建）+ 观察期迭代（scan / X_BASALT_DIR / 全局 skill / **meta 写侧 Phase 1 CRUD + Phase 2 normalize**）。**243 测试 / typecheck / build 全绿。** 逐项进度见路线图与 `docs/specs/` 决策文档。

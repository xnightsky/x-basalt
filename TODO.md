# TODO · x-basalt

> backlog / roadmap（存在 = 有待做项）。**已完成的不堆这**——见 git log、`docs/plans/`、`docs/specs/`。

## ▶ 当前：dogfood 观察期（2026-06-28 起）

核心读侧（解析/索引/查询/召回/CLI）+ 写侧（meta：CRUD / normalize / profile-apply，3 套 profile）均已落地。**先不发布，全局安装实际用一段时间，据真实反馈再迭代。**

- 已 `npm link` 全局：`x-basalt` 全局可用（live → 仓库 `dist/`；**改源码需 `pnpm build` 重编才生效**）。
- 暂不发布（阶段 5 推迟到观察期后）。

## 💡 backlog（待 dogfood 暴露真实需求再开，各自写计划/spec）

- **migrate（vault 级批量改造）**：批量重命名 / 改值 / 合并拆分属性。≈ `query/index` 找出含某属性的文件（无头独有优势，MetaEdit 等需 Obsidian 运行时）+ 逐文件 meta + 批量 dry-run/进度/失败汇总。**发散度最低、最该先做**。
- **lint（schema 校验）**：按用户 schema 校验属性存在性/类型/取值，报告或修（"修"复用 normalize/set）。需先定 frontmatter schema 格式（JSON Schema 或自创轻量 DSL，对标 `remark-lint-frontmatter-schema`）——长期 API 承诺最重，**最后做**。
- **watch pipeline（常驻维护管线）**：把 `watch` 从「索引 + 跑裸 shell（`--on-change`）」升级为**声明式的、由内建动作组成的管线**——常驻进程监听变更，按 `文件变更 → 一串 defined 动作` 自动维护 Vault。
  - 形态设想：`watch | apply profile pkm-note`、`watch | normalize`、`watch | scan && apply ...`；动作是 x-basalt 自己的强类型动词（index/scan/meta apply/normalize，未来 lint/migrate），**不是**任意 shell（区别于现有 `--on-change`，后者保留作逃生口）。
  - **「足够 defined」是核心要求**：每个动作的输入/输出/失败语义/幂等性/触发条件（add/change/unlink、路径/标签过滤）要先定清；管线可声明在配置（如 `.x-basalt/config` 的 `pipeline:` 段）而非命令行硬拼，便于常驻复用与审计。
  - 复用现有：watcher 增量回调（`indexer/index.ts` 的 `watch(onEvent)`）作为管线源；动作复用 meta/index 的 `applyProfile`/`normalizeDoc` 等。
  - 风险/待定：写动作（apply/normalize）会改 `.md`，常驻自动改文件需谨慎——默认 dry-run/需显式开启写、失败汇总而非中断、避免与编辑器保存竞争（已有 awaitWriteFinish 兜底）。与 migrate（一次性批改）互补：migrate 是手动批量，watch-pipeline 是常驻增量。
- **更多 profile**：按需扩（加 profile = 加数据；现有 `pkm-note` / `llm-wiki` / `ssg-blog`）。
- **不做**：type 强制 / 日期格式统一（调研判风险高、格式不确定）。
- **可选增强**（按需再定）：S3.4 kysely 收编 DQL→SQL；S3.5 FTS5 全文检索。

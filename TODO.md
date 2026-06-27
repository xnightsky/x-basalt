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

- _（待填）_

---

> **已完成**：阶段 0（基线）/ 2（DQL 内核做深）/ 3 核心（S3.1–3.3 监听健壮·路径感知·流式 rebuild）/ 4（Fuse.js + yaml + cosmiconfig + CLI 端到端）+ 阶段 1 关闭（保留自建）。**163 测试 / typecheck / lint / build 全绿。** 逐项进度见路线图与 `docs/specs/` 决策文档。

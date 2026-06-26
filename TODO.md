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
- [x] S2.1 文法工具选型 spike → 选 **chevrotain@12.0.0**（已落 dependencies，待 S2.3 接入；peggy 已移除）。决策：`docs/specs/2026-06-27-dql-grammar-tool-decision.md`
- [ ] **S2.2a（卡点·决策）冻结"扩展后的目标子集"裁决表**——逐项裁决纳入/不纳入/后续；改真相源前需对齐
- [ ] S2.2b 同步真相源（biz-dql-subset SKILL + research §3 + 调整 query 测试断言），再动代码
## 阶段 3 · 索引层健壮性 + 现成库收编　（未开始，S3.4 依赖 S2.7）
## 阶段 4 · skill 召回 + CLI/config 收编　（未开始）
## 阶段 5 · 收口与发布　（未开始）

> 阶段依赖：S0 → {S1, S2, S3, S4 可并行起步}；S2(DQL) 是关键路径与最大投入。
> 阶段 1–5 子步以 `docs/plans/` 细化清单为准；本文件只记录阶段级进度与当前停点。

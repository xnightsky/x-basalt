# 计划：文档落地——依赖决策 + 现状体检 + 规范覆盖矩阵

> 日期：2026-06-26 · 类型：大型任务（跨多份文档，**不改源码**）
> 执行真相源：根 [`TODO.md`](../../TODO.md)
> 触发：复盘发现「调研选定的库未落地、官方/规范未完全对齐、缺集中真相源 → 项目像黑盒」。

## 目标

把这次复盘的事实**固化为文档**，消除黑盒，为后续「做深内核」提供依据。只落文档，不动任何 `src/`。

产出三份新文档 + 两处既有文档偏差标注：

1. `docs/specs/2026-06-26-deps-build-vs-buy.md` —— 依赖与「自建 vs 用库」决策记录（ADR 性质）。
2. `docs/testing/2026-06-26-audit.md` —— 现状体检报告（分模块发现，带行号/严重度/证据/复核状态）。
3. `docs/specs/2026-06-26-coverage-matrix.md` —— Obsidian 语法 / DQL 子集覆盖矩阵（黑盒消除真相源）。
4. 偏差标注：设计 `2026-06-25-x-basalt-design.md` §3.1、调研 `2026-06-25-obsidian-spec-and-deps.md` §1 依赖段（只加标注 + 链接，不重写）。

## 阶段切口

### 阶段 A · 事实核实（✅ 完成 2026-06-26）
- npm registry 实测：包存在性 / 版本 / 自述能力；机制性事实（Dataview 执行层绑 Obsidian）。
- 核实不到的一律标「待核实」，不写成事实。

### 阶段 B · 三份新文档（进行中）
- 依赖决策 → 体检报告 → 覆盖矩阵。
- 审计发现按「复核状态」分级：✅本会话读码复核 / ⚠️审计提出待复现 / ✗已下调或推翻。

### 阶段 C · 既有文档标注 + 路由收口
- 设计 §3.1 与调研 §1 加偏差标注并互链。
- 更新 `docs/README.md` 当前活跃文档清单。
- 删除根 `TODO.md`。

## 边界与不做项

- **不改任何源码**（修 bug、删死依赖、补测试均不在本任务）；这些只在文档里登记为待办。
- 不重写既有设计/调研正文，避免抹掉历史决策；只追加标注。

## 验收

- 三份新文档可与代码互相验证（行号、证据可回溯）。
- 任何写成「事实」的第三方库声明都有 npm 实测出处或标「待核实」。
- `docs/README.md` 能路由到三份新文档。

## 风险与停点

- **[已知风险]** 审计中标 ⚠️ 的条目（onUnlink/rebuild 内存与竞态/ctime/ReDoS/HTML 注释）本会话未逐行复核，文档中明确标注，避免再造「写成事实的黑盒」。
- 决策文档的「该买该建」给出选项与建议，最终选型留待用户拍板，不在本任务擅自实施。

## Evidence

> 收口在此追加：核实命令、关键结论。

- 阶段 A（2026-06-26）：
  - npm registry `/latest` 实测：`@flowershow/remark-wiki-link@4.0.0`、`@portaljs/remark-wiki-link@1.2.0`、`remark-obsidian-md@1.1.0`（keywords: wiki-links/callouts/alerts）、`@oomkapwn/enquire-mcp@3.10.1`（自述「AI 长期记忆 MCP」）均存在。
  - 门禁实测：`typecheck` exit 0；`pnpm test` 52 pass / 0 fail；`oxlint` 0 告警；`oxfmt --check .` 在 18 个 docs/json 文件红（既有中文 prose 漂移，无 `.ts`）。
  - 死依赖实测：`unified` / `remark-parse` / `@flowershow/remark-wiki-link` / `zod` 在 `src/**` 的 import 次数 = 0。

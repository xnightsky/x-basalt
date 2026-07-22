---
timestamp: 2026-06-30T00:01:23Z
sha256: 0703536ac1dc69da9a0ed25c032c8c0d48b74ea7f3ea5bd7b7f085000d6fea49
type: plan
title: 阶段 1/3/4 下钻：解析组装 · 索引 · skill/CLI · 原子子步
description: parser/indexer/skill+CLI 模块的原子实现子步
tags:
  - plan
  - modules
  - x-basalt
---
# 阶段 1/3/4 下钻：解析组装 · 索引 · skill/CLI · 原子子步

> 最后同步：2026-07-22（checklist 更新到代码实际状态）
> 日期：2026-06-26 · 父计划：[`2026-06-26-execution-roadmap.md`](2026-06-26-execution-roadmap.md) 阶段 1/3/4
> 真相源：parser→`skills-def/biz-obsidian-spec/SKILL.md`；DQL→另见 [`2026-06-26-dql-kernel-steps.md`](2026-06-26-dql-kernel-steps.md)
> 依据：体检 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md)（编号 P*/I*/C*/L*）、库普查 [`../research/2026-06-26-libraries-survey.md`](../research/2026-06-26-libraries-survey.md)

## 子步格式

每步：目标 / 动作 / 验收标准 / 证据命令 / 前置。功能步 **TDD：先写测试(red)→实现(green)**。证据命令以实际输出判定。

---

## 阶段 1 · 解析层改为组装

> 真相源 8 类语法（frontmatter/wikilink/embed/tag/callout/task/highlight/blockRef）+ 边界清单为验收基准。库覆盖 wikilink/embed/callout/highlight，自建收敛 tag/task/blockRef。

- [x] **M1.1 复核 remark-obsidian-md 许可证 + 能力 spike（卡点）** ✅ 2026-06-28
  - **决策结论：保留自建**（详见 [`../specs/2026-06-28-parser-buy-vs-build-decision.md`](../specs/2026-06-28-parser-buy-vs-build-decision.md)）
  - 证据：spec 决策文档。前置：阶段 0。

- [ ] **M1.2–M1.9（取消）**
  - 本阶段原计划将 parser 改为 unified + remark-obsidian-md 管线。
  - M1.1 spike 结论为**保留自建**，此方案未实施。
  - parser 实际演进：保留自建 → 后续 KB compiler P0 扩了 markdownLink/imageLink 节点和代码块掩码。

---

## 阶段 3 · 索引层健壮性 + 现成库收编

- [x] **M3.1 监听健壮性（I1/I2，red→green）** ✅ 2026-06-28
  - 代码：watcher.on("error") 已实现（`src/indexer/watcher.ts:73`）。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：阶段 0。

- [x] **M3.2 basename 反链歧义修正（I5，red→green）** ✅ 2026-06-28
  - 代码：链接解析路径感知，inlinks JOIN 已修。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.1。

- [x] **M3.3 大库稳健性（I3）** ✅ 2026-06-28
  - 代码：rebuild 分批/流式写事务，`COMMIT` 包裹（`src/indexer/index.ts:143,375-403`）。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.2。

- [x] **M3.4 ctime 跨平台口径（I6）** ✅ 2026-06-26
  - 代码：`birthtimeMs` 回退 `ctimeMs`（`src/indexer/index.ts:784-785`）。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.1。

- [ ] **M3.5 schema 完整性（I8）**
  - 状态：**未实现。** 当前靠应用层保证一致性，未开 `PRAGMA foreign_keys`。
  - 决策记录：此 issue 已在 `docs/research/` 覆盖矩阵中登记，低优先级。

- [ ] **M3.6 引入 kysely 收编 SQL（依赖 DQL 完成）**
  - 状态：**未实现。** 父计划 `execution-roadmap` 标记为「暂缓」（S3.4：kysely「已评估，暂不需要」）。
  - 前置：DQL S2.24。

- [x] **M3.7 FTS5 全文检索（可选）** ✅ 2026-07-02
  - 代码：`src/indexer/schema.ts` 建 `fts5` 虚拟表；`tests/fts.test.ts` 测试通过。
  - CLI：`x-basalt search <query>` 命令可用。
  - 证据：`pnpm test tests/fts.test.ts`。前置：M3.3。

---

## 阶段 4 · skill 召回 + CLI/config 收编

- [x] **M4.1 skill 召回换 Fuse.js（red→green）** ✅ 2026-06-28
  - 动作：补召回质量测试（拼写容错/前缀/相关性排序/垃圾串不放水）；Fuse.js 对 `name`(权重2)+`triggers`(权重1) 建索引替朴素子串，`ignoreLocation` + 阈值 0.4；构造期建一次索引；loader 兜底不变。
  - 验收：拼写近似（wikilnk/callot/frontmater）模糊命中；垃圾串仍空；空目录兜底、现有 skill 测试不回归。
  - 证据：`tests/skill.test.ts`（11 例，新增 4）；全量 144 测试 / typecheck / lint / build 全绿。前置：阶段 0。

- [x] **M4.2 YAML 用 `yaml` 包（C4/C5，red→green）** ✅ 2026-06-28
  - 动作：config 解析改 `yaml.parse`（修 `---` 吞掉 C4）；输出格式化抽到 `src/format.ts` 用 `yaml.stringify`（修键未转义 C5），删 cli.ts 手写 toYaml/yamlScalar/isContainer。gray-matter 仅 parser 仍用，保留依赖。
  - 验收：以 `---` 开头的 config 不丢键；含 `:`/空格/`#` 的键值往返一致；CLI parse --format yaml 冒烟 OK。
  - 证据：`tests/config.test.ts`（+2 C4）、`tests/format.test.ts`（+4 C5/往返）；全量 150 测试全绿。前置：阶段 0。

- [x] **M4.3 config 换 cosmiconfig（L4，red→green）** ✅ 2026-06-28
  - 动作：用 cosmiconfig（`searchStrategy:'project'` + 自定义 searchPlaces/loaders）替自建上溯搜索（删 firstExisting/configAtLevel/findProjectConfig/readConfigFile/parseByExt）；保留项目>全局合并 + 键白名单 + 解析失败降级；loadConfig 加可注入 globalHome 参数便于测全局链。
  - 验收：上溯查找、同目录多格式优先、隐藏目录优先、全局回退+项目覆盖、畸形降级用例全通过。
  - 证据：`tests/config.test.ts`（+2 全局链，共 11 例）；全量 152 测试全绿。前置：M4.2。

- [x] **M4.4 新建 CLI 端到端测试（C1，red→green）** ✅ 2026-06-28
  - 动作：新建 `tests/cli.test.ts`（subprocess 跑 `node --import <tsx绝对URL> src/cli.ts`，避子进程 cwd 找不到 tsx）覆盖 parse/index/query/skills/watch 主路径 + 退出码（非法 DQL/缺 vault/无命中→1）+ flag↔config 优先级链（config format 生效、flag 覆盖、config 提供 vault+db 无参跑通）。watch 用 spawn+killTree 跨平台收尾。
  - 验收：端到端 11 例全绿。
  - 证据：`tests/cli.test.ts`；全量 163 测试 / typecheck / lint / build 全绿。前置：M4.2、M4.3。

- [ ] **M4.5 `--format` 推广 + 非法值处理（C2/C6）**
  - 当前状态：**部分实现。** `--format` 已接 parse/scan/links/lint，但 **query/skills 未接**（恒输出 JSON/人读）。
  - 剩余工作：接到 query/skills；非法值退出码 1。

- [ ] **M4.6 on-change 防注入（C3）**
  - 当前状态：**未实现。** `--on-change` 用 `onChange.replaceAll("{file}", file)` + shell `exec()`，未做参数化注入防护。
  - 剩余工作：改 `execFile` 参数化或 shell 转义。

- [ ] **M4.7 错误处理 + 脱敏收尾（C7/C8）**
  - 当前状态：**部分实现。** 顶层 catch 用 `(err as Error).message`，非 Error throw 时 message 为 undefined。
  - 剩余工作：`err instanceof Error ? err.message : String(err)`；脱敏决策记录。

---

## 与父计划衔接

- 本清单替代父路线图阶段 1/3/4 的概览步（更细）；父路线图对应阶段顶部链到本文件。
- M3.6（kysely）依赖 DQL [`2026-06-26-dql-kernel-steps.md`](2026-06-26-dql-kernel-steps.md) S2.24。
- M1.4 涉及 `ObsidianNode` 契约改动（foldable→fold 三态），动前确认 indexer/query 消费方一并改。

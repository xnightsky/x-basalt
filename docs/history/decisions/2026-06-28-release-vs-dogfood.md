---
type: decision
title: 先 dogfood 还是先开源（发布时机评估）
description: 评估 x-basalt 先继续 dogfood 还是先开源，给出时间盒推荐与开源前 checklist
tags:
  - spec
  - release
  - dogfood
  - x-basalt
timestamp: 2026-06-29T23:59:10Z
sha256: e4f6b6618b303169cf8df7118593d1529662c6aeba6a9c63b1ebcae96b8f17b0
---

# 决策评估：先继续 dogfood 还是先开源

> 日期：2026-06-28　类型：决策/ADR（发布时机）
> 触发：用户问「先用一阵还是先开源」。本文给诚实评估 + 明确推荐 + 开源前 checklist。
> 关联：现状见 [`TODO.md`](../../TODO.md)「dogfood 观察期」；许可证/开源前检查政策已落地（commit 97fe800）。

## 结论先行（TL;DR）

**推荐：有时间盒、有退出标准的「先用一阵」（≈2–4 周），重点压测刚完成的写侧（meta），同时把开源前 checklist 备齐；满足退出标准即开源——而不是开放式「再用用看」，也不是「今天就发」。**

一句话理由：核心读侧 + 打包 + 文档已接近就绪，但**写侧（meta/profile/apply）只有几天大、连公开 README 都还没收录**，且工具边界仍在沉淀（3 个 backlog 方向未定）。作为代表作，带着「写侧没被真实用过、也没对外讲清」的状态发布，会低估这件作品。

## 决定性维度（哪条更重要，结论可能不同）

这个决策真正取决于你此刻的首要目标：

- **若首要目标 = 作品可见性 / 简历曝光**：天平偏向**尽早开源**。读侧本身已是可展示的、独特的（无头操作 Obsidian——MetaEdit/Dataview 这些都需要 Obsidian 运行时，做不到 CLI 无头）。私有仓库一天，作品就隐形一天。
- **若首要目标 = 我依赖它、要把它做对**：天平偏向**先 dogfood 写侧再开源**。一旦开源，API 预期被外部用户钉死；你会想在别人依赖之前，先用自己的真实使用把粗糙边角磨掉。

我的默认推荐（下文）取后者权重略高——因为「代表作」既是给别人看，也得自己用得顺；且写侧太新。但若你心里其实是「先要曝光」，那就走「尽早开源」分支，把下面的 checklist 压缩到必做项后即发。

## 两方案利弊矩阵

| 维度       | 先继续 dogfood                                   | 先开源                                                         |
| ---------- | ------------------------------------------------ | -------------------------------------------------------------- |
| API 稳定性 | ✅ 写侧能在真实使用中定型，避免发布后改 API 失信 | ⚠️ 写侧几天大，过早冻结预期，后续改动代价高                    |
| 反馈来源   | ⚠️ 单人 dogfood 有盲区，覆盖面窄                 | ✅ 更早拿到多样真实用户反馈（正是 backlog 在等的「真实需求」） |
| 作品可见性 | ❌ 一直隐形，无 star/曝光                        | ✅ 可被发现，代表作的简历价值兑现                              |
| 维护负担   | ✅ 精力全投产品，无 issue/PR 支持面              | ⚠️ 单人维护要扛 issue/PR/社区沟通                              |
| 完成度观感 | ✅ 能以「我每天在用」的姿态发布，第一印象更稳    | ⚠️ 可见「在动荡中」，易招过早的功能争论                        |
| 法务/规范  | —                                                | ✅ MIT + 开源前检查政策已就绪，地基已打好                      |
| 机会成本   | ⚠️「再用用看」无退出标准易无限拖延               | ✅ 避免完美主义拖延                                            |

## 现状盘点（开源就绪度，基于仓库实查）

**已就绪**：

- 核心读侧 + 写侧均落地，**272 测试绿**；`prepublishOnly` 质量门（typecheck + test + build）已配。
- `README.md`（价值主张/命令表/安装/快速上手/指南链接）、`LICENSE`（MIT）、`CHANGELOG.md` 齐全。
- `package.json`：`bin` / `files` 白名单 / `description` / `engines>=22` / `packageManager` 均配好，非 private。
- 文档体系完整：guides（分章教程）、specs、research、plans，本轮新增 **architecture 总览**。
- 许可证声明 + 开源前检查政策已落地（97fe800）；脱敏政策（禁本机绝对路径）在 `AGENTS.md`。

**开源前的真实缺口**：

1. **README 命令表缺 `meta`**——刚完成的写侧（get/set/unset/rename/normalize/profile/apply）公开门面里看不到，是最该先补的文档债。
2. **无 CI**（仓库无 `.github/workflows/`）——公开仓库普遍期望 push/PR 自动跑测试，否则「272 绿」对外不可见、不可信。
3. **`package.json` 无 `repository` 字段**，且尚无公开 GitHub 远端。
4. 写侧**真实使用里程不足**——profile/apply 的人机协作（x-basalt 只告知、消费者补语义）这套交互，需要自己真用几轮验证顺手度与边界。

## 推荐执行：时间盒 dogfood + 并行备料

**阶段 A（现在起 ≈2–4 周）：写侧 dogfood**

- 拿自己的真实 Vault，每天用 `meta set/normalize/apply`（三套 profile）维护元数据，记录卡点/想改的 API/缺的能力。
- 退出标准（满足即进入开源）：
  - [ ] 每个 meta 子命令在真实库里各跑过几十次，无想改的签名/行为。
  - [ ] `apply` 的「仍缺字段→消费者补」闭环走通过至少一遍完整笔记。
  - [ ] backlog 三方向至少明确「首发是否包含」——建议**首发只含已完成能力，migrate/lint/watch-pipeline 留作 roadmap**，不阻塞发布。

**阶段 B（与 A 并行，几小时工作量）：开源前 checklist 备齐**

- [ ] README 命令表补 `meta` 行 + 写侧快速上手示例（apply 一个 profile 的完整片段）。
- [ ] 加最小 CI：`.github/workflows/ci.yml`，在 push/PR 跑 `pnpm install && pnpm run typecheck && pnpm test`（Node 22/24 矩阵，放行 better-sqlite3 构建）。
- [ ] `package.json` 补 `repository` / `homepage` / `bugs` 字段，加 `keywords`（obsidian/dataview/markdown/cli…）。
- [ ] 全仓 `rg` 自查：无仓库根外本机绝对路径、无密钥/邮箱/token（脱敏政策）。
- [ ] 决定首发 npm 包名与 `0.1.0` 是否直接公开发布，还是先公开仓库、npm 稍后。
- [ ] （可选）`CONTRIBUTING.md` + issue 模板；README 加一句「单人维护、按兴趣推进」设预期。

**阶段 C：开源**

- 满足 A 退出标准 + B 全勾 → 公开仓库（+ 可选 npm publish）。届时能以「我每天在用、核心有测试有 CI、架构文档齐全」的姿态发布。

## 主要风险

- **拖延风险**：「先用一阵」最大的敌人是没有退出标准——故本方案强制时间盒 + 勾选式退出，到期即评审是否开源，不无限顺延。
- **写侧改 API 风险**：这正是先 dogfood 要消化的；阶段 A 结束时若仍想大改 meta API，说明还不该发，正常推迟一轮。
- **CI 与原生模块**：better-sqlite3 在 CI 需放行预编译/构建（`pnpm.onlyBuiltDependencies` 已配），加 CI 时验证一次跨平台构建。

## 备注

若你的首要目标其实是「尽早曝光代表作」，可走精简路径：只做阶段 B 的前两项（README 补 meta + 最小 CI）即公开仓库，把写侧打磨放到开源后用 `0.x` 语义版本承接——代价是接受 `0.x` 期 API 可能 break，并在 README 写明。

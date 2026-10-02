---
type: plan
title: chat 写后节流与显式验收修复
description: 修正 chat 写后节流与显式复核和再次执行的提示冲突，记录真实 CLI 回归、六次模型对照及证据边界。
tags:
  - plan
  - chat
  - verification
status: completed
timestamp: 2026-10-02T07:25:55Z
sha256: a4b550833743a61544a564afc0dbcac21cd85b0d1eb56a44ec2586d3971cc57a
---
# chat 写后节流与显式验收修复

## Goal / Spec

领取根 TODO 第一项：默认写成功后不追加无意义的交叉验证；用户明确要求复核、再次执行或幂等验证时，执行对应工具并依据真实回执回答。第二次 `run` 必须真实调用，不能用 `query=0` 替代。

## Constraints / Non-goals

- 用户已确认最小提示修复及最多 6 次模型对照、每次最多 12 步；只操作临时合成库，不碰真实 vault。
- 不修改 CLI / 编排器 / schema，不增加规划器、自动重跑器或依赖；不混修外层答案范围与 trace 调用标识。
- 系统提示与运行时 chat 说明书同批校正；区别已落盘、dry-run、部分失败与索引刷新回执。
- `src/chat/index.ts` 已超过 500 行，本次只改既有提示职责，不扩建入口或顺手重构；拆分债另行处理。
- 实施阶段未获 commit / push 授权；用户随后明确授权按下述单个原子提交计划本地提交并正常推送，不强制推送。

## Tasks / Interfaces

- [x] 核对冲突来源、登记领取，固定默认写 / 显式复核 / 显式第二次 run 的合成输入。
- [x] 建立提示契约 RED，新增真实 CLI / 文件 / SQLite 回归；脚本模型仅验证接线，不代表模型遵循。
- [x] 最小修改系统提示与 chat 说明书，保留默认节流和写安全开关。
- [x] 同一模型、任务、预算进行旧 / 新提示各三题对照；保存完整原始消息与 trace，审计调用、结果和最终答案。
- [x] 同步设计、教学、README、CHANGELOG、core 指路和 TODO；质量门与文档元数据自举。

## Verify / Review Focus

- 默认写：读取确认目标、实际 `--apply` 写入，无无请求的额外 query/scan/run。
- 显式复核：写后真实读取，结果与文件 / 索引一致；复核不是重复写入授权。
- 显式幂等：两次同范围同动作的实际 `run --apply` 及独立回执，第二次 changed=0，文件字节不再变化；query 空集不是第二次执行。
- 未执行 / 工具失败 / dry-run / 部分失败不能声明已完成；run 回执按 dryRun、failed、changed、reindexed 解读。
- 提示文本测试只锁定契约；确定性工具测试只证明接线与执行；小样本模型对照不证明所有模型可靠性或历史失败因果。

## Decisions / Progress

- 已确认系统提示的「不要再 query/scan 复核」与运行时 chat limits 条目均未留显式验收例外；工具执行层没有写后复核禁令。
- 最小修复同时限定通用交叉验证纪律及 scan/index 的显式索引复核入口，避免只修写后句却留下另一条无条件禁令。没有新增自动复核、自动补 --apply 或自动重复写入。
- TDD：`node --import tsx --test tests/chat/prompt-discipline.test.ts` 首轮 9 项中 4 个新契约失败、5 个既有护栏通过；修后与新接线回归合计 14/14。文本测试只锁定提示契约，不证明模型行为。
- 接线回归 `tests/chat/write-verification.test.ts`：CHAT-WV-I001 / I002 分别验证第二次 run 的空候选与相同候选、独立工具回执及字节稳定；I003 验证写后 query 与 SQLite；I004 验证含 index 动作的 dry-run 可 changed>0 但不写 Markdown；I005 验证第二次工具错误不能冒充成功零改动。它们在修改提示前已经能通过，证明执行层原本允许验收，并非内核 bug 的 RED。
- 初写接线测试误将 unchanged 等同 skipped、纯 set 的 dry-run 期望 changed>0，实跑及源码核对后订正；这些是测试预期错误，不计产品失败。索引动作的 changed 也不等同 Markdown 落盘，提示因此不能只看 changed>0。
- 质量门：`pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 已实际通过；`node --import tsx --test tests/chat/*.test.ts tests/skill.test.ts` 124/124。最终数据排版调整后 skill 36/36；改动源码 / 测试定向 oxfmt、diff --check、三篇 docs 正文哈希与相对链接、实际 `skills get chat write-verification` 渲染及新增内容脱敏核对均通过。文档机械元数据由已构建 CLI 自举 / 刷新。

### 模型对照：执行义务与输出范围分开计

- 时间：2026-10-02；基线提交 `6999c56`。模型为环境配置 ID `deepseek-flash`，不推断网关实际版本。最多 6 个外层 loop，均自然收尾，没有追加收费重跑；每个 loop 最多 12 步、240 秒。
- 路径：同一 `createModel` / `runLoop` / `buildTools`，真实 CLI 子进程与三篇合成文件。旧提示先冻结，旧技能目录快照与新技能取源分开。为避免规范截断影响对照，两侧均固定 safety maxChars=30000；**这不是产品默认 8000 字符的 live 验证**。未实跑 runOnce / REPL；recalled 等展示字段不是本次验收指标。
- 语料：`inbox/a.md` 为 status=draft、正文 `# A`；`inbox/b.md` 为 tags=[pending]、正文 `# B`；`outside.md` 为 status=draft、正文 `# Outside`，三篇初始均无 type。每题单独重建新库，不复用上一题终态。
- 三个固定用户输入（两侧完全相同）：
  1. 「先读取确认目标，把 inbox 下 type 缺失的所有笔记设成 note，实际落盘。最终只报改动篇数。」
  2. 「先读取确认目标，把 inbox 下 type 缺失的所有笔记设成 note，实际落盘。写完后用 query 复核 inbox 下还有多少篇缺失 type，最终报改动篇数和复核剩余篇数。」
  3. 「先读取确认目标，把 inbox 下 type 缺失的所有笔记设成 note，实际落盘。然后再执行一次同样的批量命令验证幂等，报告两次各改动多少篇。第二次要真实执行，不要以查询空集代替。」

| 执行义务 | 旧提示 | 新提示 | 过程证据 |
| --- | --- | --- | --- |
| 默认写后停止 | 通过，5 步 | 通过，4 步 | 读确认 → 一次 run --apply，写后没有额外 CLI |
| 显式写后复核 | 通过，5 步 | 通过，5 步 | 读确认 → run --apply → query，独立查询结果 total=0 |
| 真实第二次 run | 通过，5 步 | 通过，5 步 | 同一 argv 的两次 run --apply，两份回执分别 changed=2 / 0，无失败 |

原始证据留在本地忽略目录 `.tmp/chat-write-verification/`：`run.ts` 为固定探针，`old-prompt.txt` / `old-skills/` 为基线；六个 `<old|new>-<default|verify|rerun>/` 分别保存 `trace.jsonl`、`messages.json`、`summary.json` 和实际文件 / SQLite。`audit.ts` / `audit.json` 按原始 SDK 消息的 **toolCallId** 关联输入与结果，保存消息哈希及最终答案，不用 trace 的同名最近调用猜归属。

- 新提示 rerun 的两个独立调用 ID：`call_00_wnmrSTDQ95sWVg0HEyjJ2329`、`call_00_9EiIdWy7CfknKR0KG5bz6686`；原始消息 SHA-256 为 `e97164d629b9617418602c6ca6de23ec32d7d85e9cdad2d8e4e683dd435d9a69`。相同 argv、独立回执与结果原文均已核对。
- 6/6 原始消息审计通过：每个工具调用有唯一 ID 对应成功结果、写前有读取、两篇目标的文件与 SQLite 同值、正文保留、范围外文件不变，最终答案中的本项计数与回执一致。live 的逐次文件字节快照没有保存；第二次 run 的字节稳定另由确定性 I001 / I002 验证。
- **结论边界**：旧／新执行义务都是 3/3，没有复现旧失败，也没有成功率提升证据。只确认提示优先级冲突已消除、本次样本符合本项执行义务，不证明历史遗漏由旧提示造成。
- **范围风险**：显式复核等样本的最终答案仍附加用户未要求的命中路径，旧提示样本还出现工具前过程文案；这些不算全部输出纪律通过。本轮不处理外部 AI 转述或通用输出范围，相关根 TODO 保持未完成。

- 收口仅将根 TODO 首项标记为本切口已完成并保留可见；其它三项未修／待核对事项与八项长期关注均保持未完成。实施收口时尚未 commit / push，未追加模型费用试验。

### 本地提交与推送授权

- 用户确认单个原子提交并授权推送：`fix(cli): 修正 chat 写后节流与显式验收冲突`。
- 精确提交系统提示、两篇 runtime skill、两份测试、README / CHANGELOG / TODO 与三篇 docs，共 11 个文件；本地 `.tmp/` 模型证据不入仓。
- 提交前已重跑相关测试 124/124，lint / typecheck / build / 改动源码及测试的定向格式检查与 diff --check 通过；原始日志留 `.tmp/chat-write-verification/precommit-tests.log`。文档正文哈希、链接和暂存内容在落盘后再核对，不追加收费模型试验，不扩大到其它 TODO。
- 当前分支 main，目标 origin/main；仅正常快进推送，远端分歧时停止，不 force、不擅自合并。

### 未验证与剩余风险

- 未做其它模型／宿主、产品默认 safety 截断配置、真实大型 Vault、随机多轮和故障场景的 live 对照；确定性错误回归不等于模型遇错会如实说明。
- 没有独立代理评审；本轮自审限于提示优先级、开关与证据、技能分工和消费说明，不增通用验收器。
- 未改内核公共契约或根脚本，故不默认重跑全项目测试；chat、真实 CLI 写／索引接线及 skill 已全覆盖相关回归。全量 lint、typecheck、build 已跑，但无全项目 test 承诺。
- 模型仍可能漏执行或虚报；trace 本身仍缺关联标识，审计通过 SDK 原始消息规避，不等于修复根 TODO 第三项。

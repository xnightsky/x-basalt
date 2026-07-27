---
type: research
title: chat 对标 agent-browser — 能力差距诊断与改进方向
description: dogfood 实测 chat 三痛点（操作失败率高/轮询撞顶停/缺场景库）的代码级根因，对标 vercel-labs/agent-browser 的差距与补齐优先级
tags:
  - research
  - chat
  - agent-browser
  - gap-analysis
timestamp: 2026-06-30T15:34:23Z
sha256: 7bb0adf511305eae6203c9324951b33a2cca816c94922bc5d39f11d2944027cf
---

# chat 对标 agent-browser — 能力差距诊断与改进方向

> 日期：2026-06-30。状态：调研落地，待据此开改进计划。
> 触发：dogfood 观察期实测 `x-basalt chat` 暴露三痛点 —— ①操作失败概率高 ②轮询到上限就停 ③需要项目外的素材/场景库。
> 方法：直读 `src/chat/*` 源码 + 用 deepwiki 扒对标库 `vercel-labs/agent-browser`（chat 设计的原始对标，见 `docs/specs/2026-06-28-cli-chat-design.md`）。
> 配套：功能覆盖侧（对标 Dataview/Obsidian 的解析/查询 gap）由另一篇 deep-research 调研单独落地，本篇只管 chat。

## 1. x-basalt chat 现状基线

| 维度 | 现状 | 证据 |
|---|---|---|
| 工具集（读） | `query` / `parse` / `scan` / `meta_get` / `skills_recall` / `skills_get` | `src/chat/tools.ts` |
| 工具集（写） | `meta_set/unset/rename/normalize/apply` / `pipeline_run`，直接落盘无确认闸 | `src/chat/tools.ts:183+` |
| 循环 | `streamText` + `stopWhen: stepCountIs(maxSteps)`，默认 **maxSteps=12** | `src/chat/loop.ts:52`、`src/cli.ts:670` |
| 中断 | Ctrl+C → AbortController，撤了逐动作确认闸 | `src/chat/index.ts:133` |
| grounding | 会话级一次性：system prompt 强指令让模型自取 `skills_get core`（对标 agent-browser stub，非每轮往返） | `src/chat/index.ts:23`、`docs/specs/2026-06-30-chat-skill-grounding-design.md` |
| 防注入 | `<<VAULT_DATA nonce>>` 边界包裹 + 8000 字符截断 | `src/chat/safety.ts` |

## 2. 三个差距（对标 agent-browser）

### 2.1 可靠性：工具调用无重试 → 「操作失败概率高」

**agent-browser 的做法**：`send_command` 对**瞬时错误**（`EAGAIN`/`EWOULDBLOCK`、EOF、连接重置、broken pipe）做重试，`MAX_RETRIES=5`、退避 `RETRY_DELAY_MS=200ms` 递增；非瞬时错误（连接拒绝、daemon 不可达）立即失败并走 `ensure_daemon` 重生。叠加 **JSON schema 入参校验** + **结构化清晰错误消息**（`ParseError`：UnknownCommand/MissingArguments/InvalidValue），让模型据错误自纠。

**x-basalt 现状**：每个工具 `execute` 直接调底层原语（new DataviewEngine / editMeta / Orchestrator…），**无任何重试、无错误分类**。失败直接抛成 `tool-error` 回灌模型（`loop.ts:68`）。后果：
- 可恢复的瞬时失败（DB 锁、文件占用、并发写）没兜住，直接判失败；
- 失败的工具调用**照样消耗一步**，模型重试又吃步数 → 加速撞顶（见 2.2）；
- 错误消息是底层异常 message，未结构化，模型自纠成功率低。

> 注：x-basalt 是纯文件/SQLite 同步操作，无 daemon，不需要 agent-browser 那套 IPC 重试；但 **SQLite 写锁（WAL 下并发）、文件被占用、DQL 偶发** 等是真实瞬时失败面，值得一层「分类 + 有限重试 + 结构化错误」。

### 2.2 步数预算：maxSteps=12 撞顶静默停 → 「轮询到上限就停」

**问题**不在 12 这个数字本身，而在三件事叠加：
1. **grounding 吃预算**：会话第一步强制 `skills_get core`，复杂 DQL 还要再取 `obsidian-base-spec` → 1-2 步没干正事。
2. **失败重试吃预算**：2.1 的无重试导致模型在循环里自行重试，每次再吃一步。
3. **撞顶静默停**：`stopWhen(stepCountIs(12))` 到顶直接结束，**没有「未完成、是否继续」提示，REPL 下也不能续跑**（`loop.ts:52`、`index.ts:92` finish 只打「· 完成」）。用户感知就是「话说一半突然停」。

**改进方向**：
- 撞顶时显式区分「自然完成」vs「步数耗尽」，后者打提示并（REPL 下）支持 `继续/continue` 接着跑；
- 把 grounding 步、失败重试步从「有效步预算」里摘开，或提高默认步数 / 做成可配；
- 治本仍是 2.1（少失败 = 少吃步）+ 2.3（强工具 = 少绕路）。

### 2.3 工具面：缺「读正文 / 全文搜 / 列笔记」→ 答不了内容类请求

**agent-browser 工具面**（core profile）：`snapshot`（读整页可访问性树）、`get text|html|value`（读元素内容）、`eval <js>`（任意 JS 搜索/抽取）、`skills list`（发现技能）、`tab list` / `profiles`（列对象）。即——**读全、读内容、搜、列** 都有专门工具。

**x-basalt 缺口**：

| chat 高频需求 | agent-browser 对应 | x-basalt 现状 |
|---|---|---|
| 读整篇笔记正文 | `get text` / `snapshot` | ❌ 只有 `parse`（→AST 非原文）、`meta_get`（只 frontmatter） |
| 按正文全文搜索 | `eval` + 自处理 | ❌ FTS5 未做，`query` 只查结构化字段 |
| 列出/发现有哪些笔记 | `snapshot -i` / `tab list` | ❌ 无 `list`/`glob`，只能靠 DQL（还得先懂 DQL） |

后果：「帮我看/总结这篇」「哪篇提到了 X」「vault 里有哪些笔记」三类日常请求直接做不了。其中 `read_note`(读正文) 和 `list`(列笔记) 是**低成本可立即补**的工具；全文搜索需 FTS5（中等成本，backlog 已有评估 `docs/specs/2026-06-28-semantic-retrieval-integration.md`）。

## 3. 场景库（素材库）— 对标 agent-browser evals

你要的「兄弟目录维护素材场景库」，agent-browser 有现成对标 —— `evals/` 目录：

- **结构**：`evals/cases/*.ts` 各导出一组 `EvalCase`；`evals/run.ts` 汇总成 `ALL_CASES`；判分逻辑 `evals/lib/judge.ts`，报告 `evals/lib/reporter.ts`。
- **EvalCase 字段**：`id` / `name` / `category` / `prompt`（用户任务）/ `context`（注入上下文）/ `expectedPatterns`（正则，全须命中）/ `forbiddenPatterns`（正则，须不命中）/ `rubric`（可选 LLM judge 评分准则）。
- **category**：`skill-loading`（是否先取 skill）/ `skill-selection`（选对专项 skill）/ `command-usage`（生成正确命令）/ `context-footprint`（上下文字节/token 量，确定性 JSON 报告）。
- **判分**：pattern 断言（expected 全中 + forbidden 全不中）+ 可选 `--judge`（LLM 打 1-5 分 + 理由）。

**为什么正好解你的三痛点**：有了场景库，「操作失败率」「撞顶率」从主观体感变成**可量化、可回归**的指标 —— 改了重试/步数/工具后，跑一遍场景库就知道有没有变好。

**待定（本篇不决，留给后续 brainstorm/spec）**：
1. 放哪 —— 兄弟新目录（如 `../x-basalt-evals`）还是并入已有 `../x-kb` / `../x-promptkit`；
2. 格式 —— 照搬 TS `EvalCase`，还是用 YAML（与项目内已装的 `recall-queue.schema.yaml` / recall-author/eval 体系对齐）；
3. 与项目内 `.recall` 评估体系的关系（复用还是另起）；
4. 场景从哪来 —— 沉淀真实 dogfood 转录。

## 4. 补齐优先级建议

| 优先级 | 项 | 解决的痛点 | 成本 | 证据/去向 |
|---|---|---|---|---|
| **P0** | 工具调用「错误分类 + 有限重试 + 结构化错误」 | 操作失败率高 | 低-中 | 对标 send_command MAX_RETRIES |
| **P0** | 撞顶区分「完成/步数耗尽」+ REPL 可续 + 步数预算调整 | 轮询撞顶停 | 低 | `loop.ts:52`、`index.ts:92` |
| **P1** | 新增 `read_note`（读正文）+ `list`（列笔记）工具 | 答不了内容/发现类 | 低 | `tools.ts` 加两个 tool |
| **P1** | 场景库落地（对标 evals，先小批真实场景） | 量化①②、回归 | 中 | 见 §3，需先 brainstorm 选址/格式 |
| **P2** | 全文搜索（FTS5）工具 | 按正文找 | 中 | `docs/specs/2026-06-28-semantic-retrieval-integration.md` |

**取舍说明**：P0 两项是「止血」——直接降失败率、止住半途而废，改动小、收益直接。P1 的场景库是「体检仪」——让后续改进可量化，但选址/格式需先和你对齐（§3 待定项），不宜闷头建。

## 5. 未决项 / 风险

- agent-browser 的 5 步上限取自其 **docs-chat API 路由**，非 chat 命令的 vault 操作循环，不能直接拿来当「x-basalt 该用几步」的标尺；x-basalt 步数应由自己的场景库实测定。
- 「写工具无确认闸」是已记的设计取舍（靠 Ctrl+C + 原子写 + 流式可观测），dogfood 未列为痛点，本篇不改。
- 场景库选址涉及跨仓库约定，需用户拍板，故列 §3 待定。

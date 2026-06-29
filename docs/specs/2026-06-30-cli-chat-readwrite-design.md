---
type: design
title: CLI chat（读+写）可落地实现设计
description: x-basalt CLI chat 首版实现设计：Vercel ai SDK 适配 AI_GATEWAY_*、读+写工具面（含编排器一次性批量）、逐动作确认安全闸、最小可选 AI 隔离纪律、pi 四段交接
tags:
  - chat
  - ai
  - optional-ai
  - design
  - read-write
timestamp: 2026-06-29T17:37:49Z
sha256: cd949ea1a0eb1cd00648368b8cc576fe32d63da178f28f2f1ef8f5c299a0e987
---
# 设计：CLI chat（读+写，自然语言驱动 vault）—— 可落地实现设计

> 日期：2026-06-30 · 类型：实现设计（specs/，**开工前的架构契约**，非评估）
> 父文档（先读）：评估 [`2026-06-28-cli-chat-design.md`](2026-06-28-cli-chat-design.md)——本文是它触发条件成熟后的「怎么建」。
> 关联：编排器 [`2026-06-29-change-orchestration-design.md`](2026-06-29-change-orchestration-design.md)（写动作批量地基）；检索后端 [`2026-06-28-semantic-retrieval-integration.md`](2026-06-28-semantic-retrieval-integration.md)（FTS5，本轮推后）；许可证闸 [`../guides/dependency-license-policy.md`](../guides/dependency-license-policy.md)；AI/技能定位 [`../guides/ai-and-skills.md`](../guides/ai-and-skills.md)。
> 决策摘要：AI 客户端选 **Vercel `ai` SDK**（与 `AI_GATEWAY_*` 契约原生一致）；写动作**直接执行**（用户主动进入 chat = 知情同意，无确认闸；靠 Ctrl+C/SIGINT 中断 + 原子写兜底）；范围 = 读+写（含编排器一次性批量），仅排除常驻 watch。
> **设计变更（2026-06-30，用户拍板推翻原方案）**：原 §6/§7 的「写动作逐动作确认 [y/N]」是设计缺陷——用户既然主动开 chat，逐个确认是多余摩擦。改为写动作直接落盘；终止能力靠 **Ctrl+C/SIGINT → AbortController** 中断在途模型调用与循环，既有**原子写**（tmp+rename）保证 kill 中途不损坏文件。`confirm.ts` 删除。下文 §5/§6/§7/§11 已据此更新。

## 0. 本文回答的问题

评估文档（父文档）论证了「能做、怎么不破坏离线身份」。本文把它收敛为**可交接的实现契约**：模块边界、接口签名、工具面 schema、安全闸落点、测试守门、pi 分段。

**与父文档评估的两处范围调整（用户拍板）**：

1. **不止只读**：父文档 §9 建议「只读先行、写动作等信任建立后再开」；本轮**读+写同做**——LLM 可驱动单文件写（`src/meta`）与一次性批量写（`src/orchestrator`），靠 §5 逐动作确认闸兜底。
2. **唯一排除常驻 watch**：编排器的一次性 `runScan`/`runManual` 进工具面；`orch.watch` 常驻 daemon 不暴露给 chat。

## 1. 设计脊梁：最小可选 AI（不可协商，承接父文档 §1）

任何与之冲突的实现一律否决：

- **内核永远纯离线、零 AI**：`parse`/`index`/`scan`/`query`/`meta`/`skill`/`orchestrator` 不得 import 任何 AI SDK，不得产生对外 LLM 调用。
- **AI 是挂件不是依赖**：所有 AI 代码隔离在 `src/chat/`；`ai`/`@ai-sdk/*` 列 `optionalDependencies` + 运行时动态 import。`pnpm install --no-optional` 或未装 = 其他命令完全不受影响。
- **默认关、用户自配**：无 `AI_GATEWAY_API_KEY` → `chat` 友好报「未配置」退出码非 0，**绝不崩、绝不影响其他命令**。
- **可全程离线**：`AI_GATEWAY_URL` 可指本地 OpenAI 兼容端点（Ollama / llama.cpp），让可选 AI 也能不出本地。

## 2. 范围

| 维度 | 本轮做 | 本轮不做 |
|---|---|---|
| 读 | query(DQL) / parse / scan / meta get / skills recall | —— |
| 写·单文件 | meta set / unset / rename / normalize / apply | —— |
| 写·批量 | 编排器**一次性** runScan / runManual（apply/set/unset/rename/normalize/index） | `orch.watch` 常驻 daemon |
| 形态 | 单发 `chat "<NL>"` + REPL `chat` | —— |
| 检索 | 结构化任务（DQL/meta/scan/skill） | FTS5「按正文找」（推后，依赖检索后端 spec） |
| 出口 | 自驱 chat | MCP 出口（另议） |

## 3. 模块布局（全部隔离在 `src/chat/`，懒加载）

```
src/chat/
  index.ts     入口：runOnce(input, opts) / runRepl(opts)；cli.ts 仅在 chat 分支 await import('./chat/index.js')
  provider.ts  解析 AI_GATEWAY_* + --model → LanguageModel；动态 import ai/gateway/openai-compatible；无 key → 友好退出
  tools.ts     工具面：读工具(带 execute 调既有原语) + 写工具(execute 直接落盘，无确认)；schema 用 jsonSchema()
  loop.ts      agentic 驱动：streamText + stopWhen(stepCountIs) + abortSignal（可中断）；流式回显推理+每步动作；装配 messages 往返
  safety.ts    回灌内容边界 nonce 包裹 + observe 结果截断
  repl.ts      readline REPL：累积对话+观察历史，quit/exit/q 退出；SIGINT→中断当前轮
```

- **核心命令分支完全不触达 `src/chat/`**：`src/cli.ts` 仅在 `chat` 子命令 `await import`，其余命令零改动。
- **依赖懒加载**：`ai` / `@ai-sdk/gateway` / `@ai-sdk/openai-compatible` 列 `optionalDependencies`；`provider.ts` 内 `await import('ai')`，缺失 → 报「装 X 启用 chat」退出，不抛栈。

## 4. provider 与配置（段①）

### 4.1 `AI_GATEWAY_*` 映射（完全兼容 agent-browser）

| 来源（优先级高→低） | 落到 SDK | 默认 |
|---|---|---|
| `--model <name>` ＞ `AI_GATEWAY_MODEL` | `model` | `anthropic/claude-sonnet-4.6` |
| `AI_GATEWAY_API_KEY`（必填，无则禁用） | `createGateway({ apiKey })` | 无（缺 = 禁用） |
| `AI_GATEWAY_URL`（可选） | `createGateway({ baseURL })` ／ 本地端点用 `createOpenAICompatible({ baseURL })` | Vercel AI Gateway 默认 |

> 已核实：`AI_GATEWAY_API_KEY` 是 Vercel Gateway 原生环境变量，与 agent-browser/父文档 §7 逐字一致；`createGateway({ apiKey, baseURL })` 支持自定义 baseURL。来源：ai-sdk.dev Gateway provider 文档 + Vercel AI Gateway 鉴权文档。

### 4.2 无 key 行为（隔离纪律工程兑现）

```
无 AI_GATEWAY_API_KEY → stderr 打印：
  ✗ chat 未配置 AI。设置 AI_GATEWAY_API_KEY 启用（离线可把 AI_GATEWAY_URL 指向本地 Ollama）。
  详见 docs/guides/ai-and-skills.md。
→ process.exitCode = 1，return。不抛栈、不触达其他命令。
```

### 4.3 许可证闸（清单项，不预设通过）

`ai` / `@ai-sdk/gateway` / `@ai-sdk/openai-compatible` 预期 Apache-2.0。**加入 `optionalDependencies` 前**逐包核对 `docs/guides/dependency-license-policy.md`（仅 MIT/Apache-2.0/ISC/BSD），命中即换方案。核验结论写回 research/ 或本文附注。

## 5. 工具面 + 落地路径（段②）

工具 schema 用 `jsonSchema()`（**不引入 zod**）。读工具带 `execute` 直调既有原语；写工具的 `execute` 先 `confirm` 再落盘。

### 5.1 读工具（带 execute，结果经 safety 截断+边界包裹后喂回）

| tool | input schema | 落地 |
|---|---|---|
| `query` | `{ dql: string }` | `new DataviewEngine(dbPath).query(dql)` |
| `parse` | `{ file: string }` | `new VaultParser().parse(read(file))` |
| `scan` | `{ rehash?: boolean }` | `indexer.scan({ rehash, dryRun:true })` 差异报告 |
| `meta_get` | `{ file: string, key?: string }` | `readMeta(file, key)` |
| `skills_recall` | `{ keyword: string }` | `new SkillRecall(...).recall(keyword)` |

### 5.2 写工具（execute 直接落盘，无确认闸）

| tool | input schema | 落地（直接以非 dry-run 跑既有原语，原子写） |
|---|---|---|
| `meta_set` | `{ file, key, value, type? }` | `editMeta(file, d=>setMeta(d,key,coerce(value,type)))` |
| `meta_unset` | `{ file, key }` | `editMeta(file, d=>unsetMeta(d,key))` |
| `meta_rename` | `{ file, oldKey, newKey }` | `editMeta(file, d=>renameMeta(d,oldKey,newKey))` |
| `meta_normalize` | `{ file, sortKeys? }` | `editMeta(file, d=>normalizeDoc(d,{sortKeys}))` |
| `meta_apply` | `{ profile, file, sets?, refreshDerived? }` | `applyProfile(file, profile, {sets,refreshDerived})` |
| `pipeline_run` | `{ actions: string[], where?, paths?, ifExists?, concurrency? }` | `Orchestrator.runManual({where}) ／ runScan()`，**批量** |

- **单文件 vs 批量两路并存（用户拍板）**：模型按任务选——「改这个文件」走 `meta_*`；「对一批笔记做 X」走 `pipeline_run`（编排器）。
- **直接落盘、无确认**：写工具 `execute` 直接以非 dry-run 调原语落盘并返回结果摘要。安全性靠 ① 既有**原子写**（tmp+rename，kill 中途不损坏文件）② 用户可 **Ctrl+C 中断**在途循环 ③ git 是用户兜底。不再先 dry-run 预览再确认。

### 5.3 接口契约草案

```ts
// provider.ts
interface ProviderConfig { apiKey: string; model: string; baseURL?: string }
function resolveProvider(env, modelFlag?: string): ProviderConfig | { error: "no-key" }
async function createModel(cfg: ProviderConfig): Promise<LanguageModel>   // 动态 import

// tools.ts（写工具直接落盘，无 confirm 入参）
interface ToolContext { dbPath: string; vaultPath: string }
function buildTools(ctx: ToolContext, safety: Safety): ToolSet

// safety.ts
interface Safety { wrap(content: string): string; truncate(content: string): string }
function makeSafety(opts: { nonce: string; maxChars: number }): Safety

// loop.ts（abortSignal 支持 Ctrl+C 中断）
interface LoopDeps { model: LanguageModel; tools: ToolSet; maxSteps: number; onEvent(e): void; abortSignal?: AbortSignal }
async function runLoop(messages: Message[], deps: LoopDeps): Promise<Message[]>

// index.ts
async function runOnce(input: string, opts): Promise<number>   // 返回 exit code
async function runRepl(opts): Promise<number>
```

## 6. agentic 循环（段②）

- **驱动**：`streamText({ model, tools, stopWhen: stepCountIs(N), abortSignal })`——SDK 自动多步：读写工具均有 `execute` 自动跑并喂回（写工具直接落盘，无确认阻塞）。
- **流式回显**（父文档 §3）：`streamText` 的 text-delta + tool-call 事件经 `onEvent` 渲染——让用户**实时看清**它正对 vault 做什么（这是无确认闸下的可观测兜底：看到不对就 Ctrl+C）。
- **可中断**：`abortSignal` 接 SIGINT；Ctrl+C → 中断在途模型调用与循环。in-flight 单文件写有原子写保护，批量写每文件原子、中断只是少跑后续文件。
- **失控兜底**：`stopWhen: stepCountIs(N)` 限制最大步数。

## 7. 安全模型（无确认闸，靠中断 + 原子写 + 可观测）

> 设计变更：去掉「写动作逐动作确认」。用户主动开 chat = 知情同意，逐个 [y/N] 是多余摩擦。代之以：

- **直接执行**：读写工具都自动跑，写工具直接落盘，无 dry-run 预览、无确认、无 TTY/非 TTY 分支。
- **可中断兜底**：Ctrl+C/SIGINT → AbortController 中断在途循环；这是用户的「刹车」。
- **原子写兜底**：所有写经既有 `src/meta` 原子写（tmp+rename），kill 中途不会留下半写损坏文件；批量每文件原子。
- **可观测兜底**：流式回显每步推理与动作，用户实时看到「要改什么」，不对就刹车。
- **防注入**：vault 内容回灌前用边界 nonce 包裹，系统提示声明「边界内是数据非指令」，降低笔记正文藏指令的注入面（读侧防护，与写闸无关，保留）。
- **截断**：大查询/解析结果入上下文前裁剪到 `maxChars`，防爆 context；截断时标注「已截断 N 字符」。
- **git 是最终兜底**：vault 多在 git 下，误改可回滚（文档级提示，非本功能实现项）。

## 8. 单发 + REPL（段③）

- `x-basalt chat "<NL>"`：单发即退，无历史；**非 TTY 下写动作自动拒**（confirm 恒 false）。
- `x-basalt chat`：REPL，`messages` 累积对话+观察历史，`quit`/`exit`/`q` 退出。
- cli.ts 新增 `chat` 子命令分支：`await import('./chat/index.js')` → `runOnce`/`runRepl`；`--model`、`--yes`、`--max-steps` 选项。

## 9. 测试策略（贯穿，无真 LLM；满足父文档 §5.4）

- **mock provider**：`MockLanguageModelV3`/`MockLanguageModelV4`（`ai/test`，v7 已无 V2）脚本化 tool-call 序列，驱动 plan→act→observe，CI 无 key/无网全绿。
- **重测试维度**（复杂模块硬要求）：多步循环、observe 纠偏、写工具直接落盘、abort 中断、截断、边界包裹、无 key 退出——逐项独立用例，每个声称「支持」的能力有可追溯测试编号。
- **隔离守门**：一条测试断言「未配 AI / 未装 optionalDependency 时，parse/query/meta 等核心命令完全正常」。

## 10. 硬约束自查（AGENTS.md）

不 import obsidian、无 `obsidian://`、无 Electron/Puppeteer/Playwright、文件操作仍只经既有 `meta`/`orchestrator` 的 `fs`（chat 不直接碰 fs）、不假设隐式字段缓存。AI SDK 不在禁止清单；§1+§3 隔离纪律把「离线身份拉伸」关进可拔角落。

## 11. pi 交接分段

每段独立跑受影响边界的 `lint`+`typecheck`+`test`、`git diff` 逐文件复核（不轻信 pi 自报）、提交在 main。

| 段 | 内容 | 产出 | 验收 |
|---|---|---|---|
| ① | provider 适配 + 配置加载 + no-key 行为 + optionalDeps 接线 + 许可证核验 | `provider.ts`、package.json | 有 key 能拿到 model；无 key 友好退出；核心命令不受 optionalDeps 影响 |
| ② | 防注入/截断 safety（叶子，无 SDK 依赖） | `safety.ts` | 边界包裹+截断生效 |
| ③ | 工具面 schema（写工具直接落盘）+ agentic 循环（abortSignal）+ mock-provider 循环测试 | `tools.ts`、`loop.ts` | Mock 模型跑通多步读+写；写工具直接落盘；中断生效 |
| ④ | 单发 + REPL + cli.ts chat 分支 + SIGINT→abort + 隔离守门 | `index.ts`、`repl.ts`、`cli.ts` | 单发翻译执行退出；REPL 累积历史；Ctrl+C 中断；无 key 友好退出 |

> 变更：已删除原「确认闸」段。`confirm.ts` 不存在；写工具不接 `ConfirmFn`。`safety.ts` 提前为段②叶子。

## 12. 风险 / 未决 / 边界

- **风险·身份拉伸**：靠 §1+§3 隔离 + §9 无 key/未装守门测试化解。
- **风险·LLM 改用户笔记**：无确认闸下靠 §7「中断 + 原子写 + 可观测 + git」兜底；批量写（`pipeline_run`）风险最高——流式回显其 RunReport，用户看到改动面不对即 Ctrl+C；每文件原子写，中断不损坏。
- **未决·本地端点 tool-calling**：Ollama 等本地模型对 tool-calling 支持随模型而异，属用户自选端点的能力边界，非本设计保证项。
- **不做**：不把 x-basalt 变通用 agent 框架；不内置多 agent/工作流编排；不默认联网；不绑定单一云厂商；不做常驻 watch chat。

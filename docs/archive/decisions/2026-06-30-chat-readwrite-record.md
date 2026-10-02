---
type: record
title: CLI chat 初版范围、工具与交接记录
description: 从 docs/design/chat-readwrite.md 摘出的历史章节与旧导言，保留当时证据、版本及纠偏；当前契约和未完成义务仍由来源文档维护。
tags:
  - archive
  - history
  - x-basalt
timestamp: 2026-10-02T11:25:55Z
sha256: 5a8e598d740c17769b965eed4fc0744f2748ea8ea1c1fc01352fb16fb883e955
---
# CLI chat 初版范围、工具与交接记录

> 归档于 2026-10-02；来源：[docs/design/chat-readwrite.md](../../design/chat-readwrite.md) 的下列原章节。仅保留当时过程、提案或观察，不代表当前实现；有效契约与后续义务以来源文档及根 TODO 为准。

保留来源章节的原读数、旧选择与纠偏经过；章节中的“当前”“待实施”均按原阶段基线阅读，不作为归档后的新授权。

## 2. 范围

| 维度      | 本轮做                                                                         | 本轮不做                                    |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------- |
| 读        | query(DQL) / parse / scan / meta get / skills recall                           | ——                                          |
| 写·单文件 | meta set / unset / rename / normalize / apply                                  | ——                                          |
| 写·批量   | 编排器**一次性** runScan / runManual（apply/set/unset/rename/normalize/index） | `orch.watch` 常驻 daemon                    |
| 形态      | 单发 `chat "<NL>"` + REPL `chat`                                               | ——                                          |
| 检索      | 结构化任务（DQL/meta/scan/skill）                                              | FTS5「按正文找」（推后，依赖检索后端 spec） |
| 出口      | 自驱 chat                                                                      | MCP 出口（另议）                            |

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

## 5. 工具面 + 落地路径（段②）

以下工具表是迁移前的设计记录，不再作为当前 schema。当前 `buildTools()` 只装配 `cli` / `skills_recall` / `skills_get`，vault 操作经 CLI 分发；没有 `confirm`。依据：[`src/chat/tools.ts`](../../../src/chat/tools.ts)、[`src/chat/cli-tool.ts`](../../../src/chat/cli-tool.ts)。

### 5.1 读工具（带 execute，结果经 safety 截断+边界包裹后喂回）

| tool            | input schema                     | 落地                                             |
| --------------- | -------------------------------- | ------------------------------------------------ |
| `query`         | `{ dql: string }`                | `new DataviewEngine(dbPath).query(dql)`          |
| `parse`         | `{ file: string }`               | `new VaultParser().parse(read(file))`            |
| `scan`          | `{ rehash?: boolean }`           | `indexer.scan({ rehash, dryRun:true })` 差异报告 |
| `meta_get`      | `{ file: string, key?: string }` | `readMeta(file, key)`                            |
| `skills_recall` | `{ keyword: string }`            | `new SkillRecall(...).recall(keyword)`           |

### 5.2 写工具（execute 直接落盘，无确认闸）

| tool             | input schema                                                     | 落地（直接以非 dry-run 跑既有原语，原子写）              |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `meta_set`       | `{ file, key, value, type? }`                                    | `editMeta(file, d=>setMeta(d,key,coerce(value,type)))`   |
| `meta_unset`     | `{ file, key }`                                                  | `editMeta(file, d=>unsetMeta(d,key))`                    |
| `meta_rename`    | `{ file, oldKey, newKey }`                                       | `editMeta(file, d=>renameMeta(d,oldKey,newKey))`         |
| `meta_normalize` | `{ file, sortKeys? }`                                            | `editMeta(file, d=>normalizeDoc(d,{sortKeys}))`          |
| `meta_apply`     | `{ profile, file, sets?, refreshDerived? }`                      | `applyProfile(file, profile, {sets,refreshDerived})`     |
| `pipeline_run`   | `{ actions?: string[], steps?: string[], where?, paths?, ifExists?, concurrency? }` | `Orchestrator.runManual({where}) ／ runScan()`，**批量** |

- **单文件 vs 批量两路并存（用户拍板）**：模型按任务选——「改这个文件」走 `meta_*`；「对一批笔记做 X」走 `pipeline_run`（编排器）。
- **`pipeline_run` 链两种写法（2026-07-30 对齐 CLI）**：`steps`（一元素一完整算子 spec、不切分，支持 query/search/base/filter/lint 等算子与 `{{row.x}}` 插值）存在时优先于 `actions`（七个经典动作），两者至少其一——全缺在工具层即报 invalid，不静默跑空链；返回值带 `steps[]` 逐步行数流水（行在哪一步被滤掉一眼定位）。
- **直接落盘、无确认**：写工具 `execute` 直接以非 dry-run 调原语落盘并返回结果摘要。当前临时文件 + rename 避免直接半写目标；Ctrl+C 中断模型/循环，不回滚已完成写入，也不保证即时停止已启动的 CLI 子进程；git/备份须由用户实际建立，产品不自动提供。依据：[`src/meta/index.ts`](../../../src/meta/index.ts)、[`src/chat/loop.ts`](../../../src/chat/loop.ts)、[`src/chat/cli-tool.ts`](../../../src/chat/cli-tool.ts)。不再先 dry-run 预览再确认。

### 5.3 接口契约草案

```ts
// provider.ts
interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}
function resolveProvider(env, modelFlag?: string): ProviderConfig | { error: "no-key" };
async function createModel(cfg: ProviderConfig): Promise<LanguageModel>; // 动态 import

// tools.ts（写工具直接落盘，无 confirm 入参）
interface ToolContext {
  dbPath: string;
  vaultPath: string;
}
function buildTools(ctx: ToolContext, safety: Safety): ToolSet;

// safety.ts
interface Safety {
  wrap(content: string): string;
  truncate(content: string): string;
}
function makeSafety(opts: { nonce: string; maxChars: number }): Safety;

// loop.ts（abortSignal 支持 Ctrl+C 中断）
interface LoopDeps {
  model: LanguageModel;
  tools: ToolSet;
  maxSteps: number;
  onEvent(e): void;
  abortSignal?: AbortSignal;
}
async function runLoop(messages: Message[], deps: LoopDeps): Promise<Message[]>;

// index.ts
async function runOnce(input: string, opts): Promise<number>; // 返回 exit code
async function runRepl(opts): Promise<number>;
```

## 11. pi 交接分段

每段独立跑受影响边界的 `lint`+`typecheck`+`test`、`git diff` 逐文件复核（不轻信 pi 自报）、提交在 main。

| 段  | 内容                                                                                 | 产出                            | 验收                                                                 |
| --- | ------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------- |
| ①   | provider 适配 + 配置加载 + no-key 行为 + optionalDeps 接线 + 许可证核验              | `provider.ts`、package.json     | 有 key 能拿到 model；无 key 友好退出；核心命令不受 optionalDeps 影响 |
| ②   | 防注入/截断 safety（叶子，无 SDK 依赖）                                              | `safety.ts`                     | 边界包裹+截断生效                                                    |
| ③   | 工具面 schema（写工具直接落盘）+ agentic 循环（abortSignal）+ mock-provider 循环测试 | `tools.ts`、`loop.ts`           | Mock 模型跑通多步读+写；写工具直接落盘；中断生效                     |
| ④   | 单发 + REPL + cli.ts chat 分支 + SIGINT→abort + 隔离守门                             | `index.ts`、`repl.ts`、`cli.ts` | 单发翻译执行退出；REPL 累积历史；Ctrl+C 中断；无 key 友好退出        |

> 变更：已删除原「确认闸」段。`confirm.ts` 不存在；写工具不接 `ConfirmFn`。`safety.ts` 提前为段②叶子。

## 整理前导言（历史上下文）

# 设计：CLI chat（读+写，自然语言驱动 vault）—— 可落地实现设计

> 初版设计：2026-06-30；当前工具面已由[单 CLI 工具设计](../../design/chat-tool-surface.md)及 [`src/chat/tools.ts`](../../../src/chat/tools.ts) 取代。下文初版工具表/交接段保留设计背景，不作为当前工具清单。2026-09-30 复核写安全边界。
> 父文档（先读）：评估 [`2026-06-28-cli-chat-design.md`](2026-06-28-cli-chat-design.md)——本文是它触发条件成熟后的「怎么建」。
> 关联：编排器 [`2026-06-29-change-orchestration-design.md`](../../design/change-orchestration.md)（写动作批量地基）；检索后端 [`2026-06-28-semantic-retrieval-integration.md`](../../design/semantic-retrieval.md)（FTS5，本轮推后）；许可证闸 [`../guides/dependency-license-policy.md`](../../design/dependency-license-policy.md)；AI/技能定位 [`../guides/ai-and-skills.md`](../../use/ai-and-skills.md)。
> 决策摘要：AI 客户端选 **Vercel `ai` SDK**（与 `AI_GATEWAY_*` 契约原生一致）；写动作**直接执行**（用户主动进入 chat = 知情同意，无确认闸；以 Ctrl+C/SIGINT 中断模型/循环、以原子替换避免直接半写目标；不保证撤销已启动或完成的写入）；范围 = 读+写（含编排器一次性批量），仅排除常驻 watch。
> **设计变更（2026-06-30，用户拍板推翻原方案）**：原 §6/§7 的「写动作逐动作确认 [y/N]」是设计缺陷——用户既然主动开 chat，逐个确认是多余摩擦。改为写动作直接落盘；终止能力靠 **Ctrl+C/SIGINT → AbortController** 中断在途模型调用与循环，既有临时文件 + rename 避免直接半写目标，但不保证并发防覆盖、断电持久性或中断回滚（[`src/meta/index.ts`](../../../src/meta/index.ts)）。`confirm.ts` 删除。下文 §5/§6/§7/§11 已据此更新。

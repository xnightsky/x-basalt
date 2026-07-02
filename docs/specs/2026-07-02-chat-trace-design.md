---
type: design
title: chat --trace 落盘机制设计：给 LoopEvent 流加一个零干扰的 JSONL sink
description: 设计 x-basalt chat 的 --trace 选项，将类型化 LoopEvent 流完整写入 JSONL，用于事后排障；不改动 stdout 渲染，不引入新依赖，失败不影响主流程。
tags:
  - design
  - chat
  - trace
  - cli
  - x-basalt
timestamp: 2026-07-02T07:40:56Z
sha256: e9b36585bc6c4da7ee37af8a6c5e3d6f7a19f942ed75e64faee0a262076c88a1
---
# chat `--trace` 落盘机制设计：给 `LoopEvent` 流加一个零干扰的 JSONL sink

> 日期：2026-07-02 · 类型：实现设计（已冻结，按本 spec 落码）
> 状态：**已冻结**
> 关联：[`2026-06-28-cli-chat-design.md`](2026-06-28-cli-chat-design.md)（chat 总体设计）、[`2026-06-30-cli-chat-readwrite-design.md`](2026-06-30-cli-chat-readwrite-design.md)（chat 读写模式）

## 1. 动机

chat 排障目前只能依赖 stdout 渲染输出。渲染层为了可读性，对工具入参与结果做了单行截断（`oneLine` / `PREVIEW_MAX` 约 200 字符），导致长输入、长输出、多行 vault 内容在终端里被截断，信息损耗大。在一次真实排障（`pipeline_run` 假成功事件）中，团队只能靠外部 `tee` 手工留痕，既不可靠也无法复现。

因此 chat 需要一个**可维护的 `--trace` 机制**：把对话循环内部的完整事件流落盘到 JSONL，事后可逐行回放、可 diff、可与模型侧日志交叉验证。

## 2. 现状调研

- `src` 全仓目前**无任何 trace / telemetry 实现**；`docs` 也无相关设计存档。
- 对标 `vercel-labs/agent-browser` 的 `chat` 只有 `-v` / `-q` / `--json` 等冗余度开关，**无落盘 trace**；其 `trace start/stop` 属于 Chrome DevTools 域，与 CLI 事件流 trace 完全不同，不可照搬。
- 结论：**需自建**。

## 3. 方案

### 3.1 架构插入点：`runLoop` 的 `LoopEvent` 流

`src/chat/loop.ts` 的 `runLoop` 已经把 `streamText` 的多步收敛为**类型化 `LoopEvent` 流**：

- `text`：模型生成的文本块
- `tool-call`：模型调用工具
- `tool-result`：工具执行结果
- `tool-error`：工具执行失败
- `finish`：单轮/整轮结束，含 `stopReason`

`renderEvent` 只是该事件流的消费者之一。`--trace` 即为事件流增加**第二个 sink（tee）**，与渲染**并联、互不干扰、零新依赖**。

```text
runLoop(...) ──► LoopEvent 流 ──► renderEvent ──► stdout
                        │
                        └──────► traceSink ─────► .jsonl
```

### 3.2 CLI 形态

```bash
# 单发模式：一次对话一个 trace 文件
x-basalt chat "列出本周新建笔记" --trace /tmp/my-trace.jsonl
x-basalt chat "列出本周新建笔记" --trace          # 使用默认路径

# REPL 模式：整会话共用一个文件，逐 turn 追加
x-basalt chat --trace
```

- `--trace [file]`：`file` 为可选值。
- 不带值时，默认落到 `X_BASALT_DIR` 基目录下的 `chat-traces/<ISO时间戳>.jsonl`。
- `X_BASALT_DIR` 的解析与 `index.db` 同源（见既有路径解析逻辑），天然落在 `.gitignore` 区。
- `chat-traces/` 目录不存在时**自动创建**。

### 3.3 失败策略

trace 写入失败时：

1. 仅 `console.warn` 一次，说明错误原因与停用后的影响；
2. 自动**停用 trace**（后续事件不再尝试写入）；
3. **绝不抛出、绝不影响对话主流程**。

这是由 chat 的"可选增强"定位决定的：trace 是排障辅助，不能成为对话可用性的单点故障。

## 4. JSONL 行 schema

trace 文件为 **JSON Lines（`.jsonl`）**，每行一个 JSON 对象，便于 `tail -f` / `jq` / `cat` 回放。

### 4.1 首行：session 元信息

文件第一行是 session 级元数据：

```json
{
  "kind": "session",
  "ts": "2026-07-02T14:32:01.234Z",
  "model": "anthropic/claude-sonnet-4.6",
  "maxSteps": 32,
  "db": "/home/user/.local/share/x-basalt/index.db",
  "vault": "/home/user/vault",
  "cliVersion": "0.7.0"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | `"session"` | 固定值，便于解析器识别 |
| `ts` | ISO 8601 | trace 文件创建时间 |
| `model` | string | 本次 chat 使用的模型 slug |
| `maxSteps` | number | `streamText` 的 `maxSteps` 上限 |
| `db` | string | 当前使用的 SQLite 索引路径 |
| `vault` | string | 当前 vault 根路径 |
| `cliVersion` | string | x-basalt CLI 版本 |

### 4.2 后续每行：事件

每事件一行：

```json
{
  "ts": "2026-07-02T14:32:02.123Z",
  "turn": 1,
  "step": 2,
  "type": "tool-result",
  "toolName": "query",
  "input": { "dql": "TABLE file.name WHERE ..." },
  "output": "VAULT_DATA\n...\nVAULT_DATA",
  "error": null,
  "stopReason": null,
  "usage": null
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | ISO 8601 | 事件发生时间 |
| `turn` | number | REPL 轮次；单发模式固定为 `1` |
| `step` | number | 当前 turn 内的模型/工具步序号 |
| `type` | string | `text` / `tool-call` / `tool-result` / `tool-error` / `finish` |
| `toolName` | string \| null | `tool-call` / `tool-result` / `tool-error` 时填写工具名 |
| `input` | JSON object | 工具调用的完整入参，**完整 JSON、不截断** |
| `output` | string / JSON | 工具结果，**完整保留**；涉及 vault 内容时保留 `VAULT_DATA` 边界原文 |
| `error` | object \| null | `tool-error` 时填错误对象；其余为 `null` |
| `stopReason` | string \| null | `finish` 行必填，如 `"stop"` / `"max-steps"` / `"tool-calls"` / `"content-filter"`；其余为 `null` |
| `usage` | object \| null | `finish` 行若可得 token 用量，则填 `{ promptTokens, completionTokens, totalTokens }`；否则 `null` |

### 4.3 序列化约定

- 所有对象字段按固定键序写出（可借助 `JSON.stringify` 与常量键顺序），便于 `jq` 与文本 diff。
- 不启用美化（单行、无多余空格），保持 JSONL 规范。
- `input` / `output` 不做任何截断或脱敏；API key 本来就不进入事件流。
- 时间戳统一用 UTC + `Z`，毫秒精度。

## 5. 边界

### 5.1 非目标

- **不做 OTEL / OpenTelemetry**：本项目是本地 CLI，不需要分布式 trace 语义。
- **不做 `experimental_telemetry` 上报**：AI SDK 的 telemetry 接口用于向网关/平台回传，与本地落盘目标不同；远期若需可另开设计，但不在本 spec 范围。
- **不做网络外发**：trace 只写本地文件。
- **不做内容脱敏**：事件流里不出现 API key；vault 内容按用户可见原文保留，便于排障。

### 5.2 与现有开关的关系

| 开关 | 作用 |
|---|---|
| `-v` / `-q` / `--json` | 控制 stdout 渲染冗余度；保持现状，不受 `--trace` 影响 |
| `--trace` | 只控制是否落盘 JSONL；**不改动 stdout 任何行为** |

两者可独立、可同时使用：`--trace` 开启时 stdout 该怎么渲染还怎么渲染。

### 5.3 REPL vs 单发

| 模式 | trace 文件行为 |
|---|---|
| 单发 | 一次对话产生一个独立 `.jsonl` 文件 |
| REPL | 整会话共用同一个 `.jsonl` 文件，每轮 turn 结束后追加新行 |

`turn` 字段在 REPL 模式下递增，方便事后按轮次切片。

## 6. 测试要点

按 AGENTS「复杂模块重测试」精神，trace 虽不是核心解析/查询链路，但涉及文件 I/O 与主流程容错，需覆盖：

| # | 测试项 | 覆盖目标 |
|---|---|---|
| T1 | 单发模式 `--trace` 与 `--trace <path>` | 默认路径解析、指定路径落盘、文件内容首行 `kind=session` |
| T2 | REPL 模式多 turn 追加 | 同一文件、多行事件、`turn` 递增、`step` 每轮重置 |
| T3 | 完整字段不截断 | 长 `input` / 长 `output` / 多行 vault 内容在 JSONL 中完整保留 |
| T4 | `finish` 行字段 | `stopReason` 与 `usage` 正确携带；无用量时 `usage=null` |
| T5 | 写入失败容错 | 模拟目录不可写 / 磁盘满，确认仅 warn 一次并停用 trace，主流程继续 |
| T6 | 与 stdout 渲染解耦 | 开启 `--trace` 后，`-q` / `--json` 输出不变 |
| T7 | JSON 可解析性 | 每行均为合法 JSON，`jq -c` 可通；首行 `kind=session` 识别 |
| T8 | 路径安全 | 默认路径落在 `X_BASALT_DIR` 下，不污染 vault；目录自动创建 |

## 7. 结论

chat `--trace` 是一个**小切口、高排障价值**的增强：在现有 `LoopEvent` 流上并联一个 JSONL sink，不改动渲染、不引入新依赖、失败不影响主流程。实现按本 spec 的 schema 与边界落码；测试矩阵覆盖单发/REPL、字段完整、失败容错、与 stdout 解耦。

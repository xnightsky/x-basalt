---
type: plan
status: done
title: 动态 base 第一步：stdin / 字符串入参
description: 让 .base 不必是磁盘文件——x-basalt base 支持从 stdin（- 或 --stdin）读入查询定义，为 chat base_query 工具铺路
tags:
  - plan
  - bases
  - cli
  - stdin
timestamp: 2026-08-06T23:59:45Z
sha256: 538e988dd3a66cb02419461fbd9b1ffbd6c1d94729dd7494fc6d7cfe988abc0b
---
# 动态 base 第一步：stdin / 字符串入参

> **For agentic workers:** 用 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。
> 日期：2026-08-03 · 主题：`x-basalt base` 支持 stdin 入参（`-` / `--stdin`），`loadBaseDocument` 拆「取 source」与「解析 source」
> 真相源（论证）：[`TODO.md`](../../../TODO.md)「🧪 2026-07-28 动态 base」段
> 触发：用户拍板「直接开动态 base 第一步（写计划 + TDD 落地）」

**Goal:** `.base` 不必是磁盘上写死的文件，可作为**入参**传入（stdin / 字符串）。本计划只落「第一步：stdin 入参」——`x-basalt base -` / `--stdin` 从管道读入 `.base` 定义并执行，独立可用（命令行管道直接受益：`echo "views: …" | x-basalt base -`），**不绑 chat**。chat 侧 `base_query` 工具与软/硬路由、skill 前置缺口，属后续计划。

**为什么现在做（两条，都不是「因为 index 快」）：**
1. 结构化输入对 AI 的可靠性高一个量级——`.base` 是结构化的（`filters`/`order`/`sort`/`limit` 字段类型明确），JSON Schema 约束模型输出比 DQL 字符串可靠；
2. 绕开「没人写 `.base`」死穴——本机 vault 与 evals 场景库里 `.base` 数量均为 0。

**最小验证路径（本计划只做第 1 步）：**
1. ✅ `x-basalt base` 支持 stdin / 字符串入参（`-` 或 `--stdin`）——本计划；
2. chat 加 `base_query` 工具 + JSON Schema 严格约束——后续计划；
3. evals 场景库 A/B 对比——后续计划。

**Architecture:** 改动点在 `src/base/document.ts` 的 `loadBaseDocument`——现为 `readFileSync(abs)` 取 source 后解析，把「取 source」与「解析 source」拆开即可。engine 层 `BaseQueryOptions` 增 `source?` 字段走纯解析入口；CLI 薄出口只装配。

**Tech Stack:** Node 22+ / TS ESM(NodeNext) / commander / node:test。

## Global Constraints（每个 task 隐含遵守）

- 不 `import 'obsidian'`、不调 `obsidian://`；文件操作仅经 `fs`/`chokidar`。
- 业务逻辑不留在 `src/cli.ts`：CLI 只收集参数与选源，解析/校验归 base 引擎。
- 中文注释解释「为什么/边界/副作用」；`@behavior` 固化行为契约。
- 路径越界检查（BASE-SEC-008）对入参不适用也不需要，因为根本不读文件。
- 入参 base 无文件路径 → 诊断的 `file` 字段给虚拟名 `<stdin>`。

---

## 范围切分

| 部件                                                             | 本计划 | 说明                                        |
| ---------------------------------------------------------------- | ------ | ------------------------------------------- |
| `document.ts` 拆 `parseBaseSource`（纯解析，不碰 fs）              | **DB-1** | 文件模式路径越界/stat/readFileSync 保留     |
| `engine.ts` `BaseQueryOptions.source?` + 虚拟名 `<stdin>`          | **DB-2** | source 模式跳过 checkEntryForm 与越界检查   |
| `cli.ts` base 命令 `-` / `--stdin` + stdin 读取                    | **DB-3** | 复用 assertPipedStdin 模式（TTY 报错不挂起） |
| 文档/契约同步（guides/commands.md、core.json5、TODO）              | **DB-4** | 收口                                      |
| chat `base_query` 工具 + 软/硬路由 + skill 前置缺口                 | roadmap  | 见 TODO「🧪 2026-07-28 动态 base」段        |

---

## 文件与职责

```
src/base/document.ts   拆分：loadBaseDocument（文件模式，越界+stat+readFileSync）
                       + parseBaseSource(source, { file, limits })（纯解析，file 为虚拟名或 rel）
                       ——复用全部 YAML/schema/filter/表达式校验与诊断逻辑，不重复。
src/base/engine.ts     BaseQueryOptions 增 source?: string；query() 中 source 模式：
                       跳过 checkEntryForm 与 loadBaseDocument，直接 parseBaseSource(source, { file: "<stdin>" })；
                       输出 base 字段 = "<stdin>"。
src/base/index.ts      导出 parseBaseSource 与 ParseBaseSourceOptions 类型。
src/base/stdin.ts      新增：readStdinText(stream) 读流到 EOF 成字符串（注入流，可测）。
src/cli.ts             base 命令：<file> 变可选 + --stdin flag；file === "-" 或 --stdin → stdin 路径。
```

---

## 原子子步（TDD）

### DB-1：document.ts 拆分 parseBaseSource

- [x] **DB-1a `parseBaseSource` 纯解析（red→green）**
  - 文件：`src/base/document.ts` + `tests/base-document.test.ts`。
  - 把 `loadBaseDocument` 中「防线 3 起」（YAML 解析 → schema/filter/表达式校验）整体移入新函数 `parseBaseSource(source, { file, limits })`；`loadBaseDocument` 保留防线 1/2 与 readFileSync 后转调。
  - 行为等价：同 source 经 parseBaseSource 与经 loadBaseDocument 产出的 views/diagnostics 完全一致（仅 file 字段不同：rel vs 传入名）。
  - 覆盖：合法文档、非法 YAML、views 缺失、同名 view、未知顶层 key、filter 结构、表达式浅扫描——与既有用例对拍。（kimi 评审 Low 补齐：views 缺失/同名/未知 key/filter 四类已加 parseBaseSource 名下显式对拍）
- [x] **DB-1b 虚拟文件名（red→green）**
  - `parseBaseSource(source, { file: "<stdin>" })`：全部诊断的 `file` 字段 = `<stdin>`。
  - 新增用例：虚拟名穿透到 error/warning 诊断与 doc.path。
- [x] **DB-1c 越界/stat 豁免（red→green）**
  - `parseBaseSource` 不查 vaultRoots、不做 stat、不 readFileSync——纯字符串入参，天然无越界语义。
  - 新增用例：即使传看似越界的 file 名（`<stdin>`）也不触发 path-outside-vault（该 rule 只在 loadBaseDocument 文件模式出现）。
  - 注意：文档大小预算（maxDocumentBytes）的 stat 预判是文件模式防线；source 模式不 stat（入参已在内存），但 YAML alias 预算与 maxExpressionNodes 等解析期预算照常生效。
- [x] **DB-1d commit**（feat(base): 拆分 parseBaseSource 纯解析入口 → `12e336d`）

### DB-2：engine 支持 source 入参

- [x] **DB-2a `BaseQueryOptions.source?`（red→green）**
  - 文件：`src/base/engine.ts` + `src/base/index.ts` + `tests/base-engine.test.ts`。
  - `BaseQueryOptions` 增 `source?: string`；query() 中 `source !== undefined` 时：
    - 跳过 `checkEntryForm`（入口形态检查只对文件路径有意义）；
    - 文档层改调 `parseBaseSource(source, { file: "<stdin>", limits })`；
    - 结果 `base` 字段 = `<stdin>`。
  - 覆盖：source 模式与文件模式对同一内容产出等价 rows/columns/total（fixture 复用 `tests/fixtures/bases/p1/vault/views/default.base` 内容）；source 模式带 error 诊断（非法 YAML）→ 空结果 + exit 1 语义不变。
  - **kimi 评审 High 修复（`10d182a`）**：basePath/source 必须「恰其一」——双缺省会让 checkEntryForm(undefined) 抛 TypeError（违反 query() 不 throw 契约）、双给时 source 静默胜出（非法参数静默降级），两者均返回 error 诊断空结果。
- [x] **DB-2b commit**（feat(base): BaseQueryOptions 支持 source 字符串入参 → `d02d942`）

### DB-3：CLI base 命令 stdin

- [x] **DB-3a `readStdinText`（red→green）**
  - 文件：`src/base/stdin.ts` + `tests/base-stdin.test.ts`。
  - 读流到 EOF 成字符串；注入 `Readable.from` 分片测试；Buffer 分片 utf8 解码；空输入返回空串。
- [x] **DB-3b CLI `-` / `--stdin`（red→green）**
  - 文件：`src/cli.ts` + `tests/base-cli.test.ts`。
  - `<file>` 参数变可选；新增 `--stdin` flag；`file === "-"` 或 `--stdin` → 读 stdin（file 与 `--stdin` 同给时以 `--stdin` 为准）：
    - TTY 无管道输入 → 报错不挂起（复用 orchestrator 的 assertPipedStdin；该函数 isTTY 分支已有单测）。
    - stdin 内容 → `engine.query({ source, ... })`，`--vault`/`--view`/`--db`/`--format`/`--conformance`/`--context-file` 照常生效。
  - e2e：`echo "views: …" | pnpm cli -- base - --vault …` 与 `--stdin` 等价于文件模式输出；空 stdin → views 缺失 error（exit 1）。
- [x] **DB-3c commit**（feat(cli): base 命令支持 stdin 入参 → `c29eccd`）

### DB-4：文档与契约同步

- [x] **DB-4a** `docs/use/commands.md`（计划原写 docs/guides/，实际位于 docs/use/）：参数表补 `--stdin`、`<file>` 可选说明与 `-` 示例。
- [x] **DB-4b** `skills-data/core.json5`：base 命令签名/选项同步（该篇为 CLI 自我说明书）。
- [x] **DB-4c** TODO.md：动态 base 段第一步勾除、标注第二步（chat base_query + skill 前置）为待开计划。
- [x] **DB-4d** 文档元数据自举（`x-basalt meta apply llm-wiki <doc> --refresh-derived`）；commit 随 docs 提交收口。

**kimi 评审 Low 收口（2026-08-03）**：
- types.json 读取诊断的 `file` 指向其自身路径（`.obsidian/types.json`），非 `<stdin>`——有意行为（file 字段反映「哪个文件产生诊断」），验收口径修订为「文档层诊断 file=<stdin>，外部文件自身诊断除外」。
- DB-1a 对拍覆盖面已补齐（四类结构校验显式对拍）。
- engine.ts 接口头注释已更新（不再声称「签名与契约一字不差」）。

**kimi(k3) 复核结论（2026-08-03，两轮）**：
- 第一轮（DB-1/DB-2 后）：High 1 个（basePath/source 双缺省 TypeError）→ 已修 `10d182a`；Low 4 个 → 已收口。
- 第二轮（DB-3/DB-4 后）：无 High/Medium；CLI↔commands.md↔core.json5 三者一致、全量 1142 绿、端到端 stdin 与文件模式等价实测通过；Low 2 个（assertPipedStdin 示例误导 → 已修 `e9ee3a6`；core.json5 types.json 例外表述 → 已修）；Nit 记录（--context-file 文档缺口为既有问题，非本次引入）。

---

## 验收

- `pnpm run typecheck` / `pnpm run lint` / `pnpm test` 全绿（本次触及 base 公共契约 `BaseQueryOptions` 与 CLI 命令签名，按 AGENTS「完成定义」升级到全量）。
- `echo "views: …" | pnpm cli -- base - --vault <vault> --db <db>` 与文件模式输出等价（同内容同 result，base 字段 = `<stdin>` 除外）。
- `pnpm cli -- base --stdin --vault <vault> --db <db>`（管道输入）等价；TTY 无管道 → 报错不挂起。
- 文档层诊断（error/warning）的 `file` 字段在 stdin 模式 = `<stdin>`（types.json 读取诊断除外——其 `file` 指向自身路径 `.obsidian/types.json`，口径修订见上「kimi 评审 Low 收口」）。
- 路径越界检查（BASE-SEC-008）在 stdin 模式不触发（根本不读文件）；文件模式行为不变（回归既有用例）。
- 无残留「后续」注释指向已实现的能力；`loadBaseDocument` 与 `parseBaseSource` 职责注释分界清晰。

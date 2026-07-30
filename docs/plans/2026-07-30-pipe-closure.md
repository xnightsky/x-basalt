---
type: plan
title: 变更编排管道收尾计划（pipe closure）
description: 补齐 --pipe 参数面（内联 debounce/on-error/on-busy、非法值与未知 key 报错、括号感知切分）、set 列表值与原生管道 stdin 源，使命令行与配置段一一对应
tags:
  - plan
  - orchestrator
  - pipeline
  - cli
timestamp: 2026-07-30T16:04:39Z
sha256: 0f0bd127af4ae750fac4e02ef129725b6b2921052d6abd1fcdd20be1bffa7711
---
# 变更编排管道收尾计划（pipe closure）

> **For agentic workers:** 用 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。
> 日期：2026-07-30 · 主题：把 `--pipe` 参数面与源接入收口到 spec §8 的冻结口径
> 真相源（设计）：[`../specs/2026-06-29-change-orchestration-design.md`](../specs/2026-06-29-change-orchestration-design.md) §8
> 前序：[`2026-06-29-change-orchestration.md`](2026-06-29-change-orchestration.md)（P0 全部完成）
> 触发：用户 goal「pipe 做到没收尾，请做完」。

**Goal:** `--pipe` 是 spec §8 冻结的「管道 = 一组参数」唯一命令面。P0 落地时漏了三类东西：**参数不全**（`debounce` 只能走配置、`onBusy` 被静默丢弃）、**参数无校验**（`on`/`concurrency` 裸转型、未知 key 静默忽略）、**源接入缺口**（§8.3 原生管道 stdin 未接、`set` 列表值未支持）。本计划补齐这三类，使「命令行 ⟷ 配置段一一对应」这条契约真正成立。

**Architecture:** 参数解析/校验从 `src/cli.ts` 下沉到 `src/orchestrator/params.ts`，成为命令行与配置段**共用的唯一入口**（消除两侧各写一套、一侧静默丢参数的根因）；stdin 作为独立「源」接入，不进 `--pipe`（§8.3 正交性）。

**Tech Stack:** Node 22+ / TS ESM(NodeNext) / commander / node:test。

## Global Constraints（每个 task 隐含遵守）

- 不 `import 'obsidian'`、不调 `obsidian://`；文件操作仅经 `fs`/`chokidar`。
- 业务逻辑不留在 `src/cli.ts`：CLI 只收集参数与选源，解析/校验归 orchestrator。
- **参数一一对应是不变量**：新增字段必须同时补命令行 key、配置段 key 与两侧校验，缺一侧即视为未完成。
- 非法参数**声明期报错**，不静默忽略、不静默降级（拼错的过滤条件比报错危险）。
- 中文注释解释「为什么/边界/副作用」；`@behavior` 固化行为契约。

---

## 冲突裁决（实现前定的口径）

| 冲突                                                                                    | 裁决                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| spec §8.1 表说 `paths` 是 glob 过滤；§8.2 与 guide 说 `--pipe where/paths` 都能「切源」 | 以 **§8.1 + §8.3** 为准：`paths` 只做路由过滤，显式文件列表源归 stdin（§8.3 正交设计）。改 §8.2 与 guide 措辞 |
| `onBusy` 的 `restart`/`ignore` 语义（spec §211，「最关键算子」）                         | **不在本计划实现**（需给 `runPipeline` 串 AbortSignal，属执行引擎状态机）。改为显式报「尚未实现」，停止静默降级为 queue；仍留在 TODO |

---

## 范围切分

| 部件                                                                    | 本计划    | 说明                       |
| ----------------------------------------------------------------------- | --------- | -------------------------- |
| 参数解析/校验下沉 + 括号感知切分 + 未知 key 报错                        | **PC-1**  | 消除两侧各写一套           |
| `--pipe debounce=` / `on-error=` / `on-busy=` 内联（补全一一对应）       | **PC-2**  | 复用 PC-1 校验器           |
| 管道 `set` 列表值（`set tags=[a, b]`）                                  | **PC-3**  | 依赖 PC-1 的括号感知切分   |
| 原生管道 stdin（§8.3）                                                  | **PC-4**  | 独立源，不碰 `--pipe`      |
| 文档/契约同步（spec §8、guide、TODO）                                   | **PC-5**  | 收口                       |
| `onBusy` restart/ignore、背压、缓存跳过、条件分支、检查点续跑、失败告警 | roadmap   | 见 spec §12，各自再开计划  |

---

## 文件与职责

```
src/orchestrator/params.ts   新增：PIPE_KEYS + parsePipeFlags + resolvePipelineParams +
                             字段级校验（toEventTypes/toConcurrency/toDebounce/toEnum）+
                             splitTopLevel（括号感知逗号切分）。纯解析，无 fs/DB。
src/orchestrator/actions.ts  set 动作支持 [a, b] 列表值；值在声明期即 coerce（失败立即报错）。
src/orchestrator/sources.ts  新增 parsePathList（纯函数）+ readPathList（注入流，可测）+
                             assertPipedStdin（非管道输入报错不挂起）。
src/config.ts                parsePipelines 复用 params.ts 校验器（配置段非法值不再裸转型）。
src/cli.ts                   resolvePipeline 变薄壳；run 新增 --stdin 选源。
```

---

## 原子子步（TDD）

### PC-1：参数解析下沉 + 校验

- [x] **PC-1a `splitTopLevel` 括号感知切分（red→green）**
  - 文件：`src/orchestrator/params.ts` + `tests/orchestrator-params.test.ts`。
  - 覆盖：顶层逗号切分、`[a,b]` / `{md,txt}` / `(x,y)` 内逗号不切、未闭合括号整串成一 token、空段丢弃。
- [x] **PC-1b 字段级校验器（red→green）**
  - `on` 非 add/change/unlink 报错；`concurrency` 非正整数报错；`debounce` 接受 `"300,3000"` 与 `{wait,maxWait}`、非法报错；`if-exists`/`on-error`/`on-busy` 枚举校验。
  - 错误信息带来源（`--pipe on` vs `pipelines.<name>.on`），便于定位是命令行还是配置段。
- [x] **PC-1c `resolvePipelineParams` + 未知 key 报错（red→green）**
  - `use` 加载基底 → 其余 k=v 覆盖；未知 key 报错并列已知 key；`--apply` 覆盖 `dryRun`。
- [x] **PC-1d cli.ts / config.ts 接线**：`resolvePipeline` 薄壳化、`parsePipelines` 复用校验器；原 CLI/config 测试全绿。
- [x] **PC-1e commit**（已授权；与 PC-2/PC-3/PC-4 交织同批文件，按 feat/fix/docs 三提交收口 → `aa60b66`）

### PC-2：补全一一对应

- [x] **PC-2a `--pipe debounce/on-error/on-busy` 内联（red→green）**
  - 端到端：`--pipe use=<name> --pipe debounce=50,500` 覆盖基底；`on-busy=restart` 报「尚未实现」。
- [x] **PC-2b commit**（随 PC-1e 同提交 `aa60b66`，按 feat/fix/docs 三提交收口）

### PC-3：管道 `set` 列表值

- [x] **PC-3a `set key=[a, b]`（red→green）**
  - `actions.ts` parseAction：值为 `[...]` → 列表；标量仍禁空格；key 禁空格；声明期 coerce。
  - 端到端：`--pipe actions="set tags=[a, b]" --apply` 写出 YAML 列表。
- [x] **PC-3b commit**（随 PC-1e 同提交 `aa60b66`，按 feat/fix/docs 三提交收口）

### PC-4：原生管道 stdin（§8.3）

- [x] **PC-4a `parsePathList` + `readStdinPaths`（red→green）**
  - 按行 trim、跳空行与 `#` 注释；不猜 JSON；注入 `Readable` 测试。
- [x] **PC-4b `run --stdin` 接线（red→green）**
  - 端到端：`printf 'A.md\n# c\n\nB.md' | x-basalt run --stdin --pipe actions=index`；TTY 无管道输入报错不挂起；与 `where=` 同给时 where 退化为语义过滤。
- [x] **PC-4c commit**（随 PC-1e 同提交 `aa60b66`，按 feat/fix/docs 三提交收口）

### PC-5：文档与契约同步

- [x] **PC-5a** spec §8.1 表补 `debounce`/`on-error`/`on-busy` 行；§8.2 纠正 `paths` 切源措辞；§8.3 标记已实现。
- [x] **PC-5b** `docs/guides/commands.md`：参数表补三行、`set` 限制改为支持列表、`run --stdin` 章节与示例、纠正 `paths=` 切源说法。
- [x] **PC-5c** TODO.md 勾除「原生管道 stdin」「管道 set 列表值」，`onBusy` 余项留下并写明卡点。
- [x] **PC-5d** 文档元数据自举（`x-basalt meta apply llm-wiki`）；commit 随 docs 提交收口。

### PC-6：评审修复

> 触发：code review 实测复现 C1/I1，对照源码核实五项全部属实。TDD 逐项 red→green。

- [x] **C1 stdin 路径穿越（Critical）**：`run --stdin` 喂 `../x.md` / 根外绝对路径可经 `toAbs` 逃根、被 `--apply` 写动作改写 vault 外文件。
  修复：源层新增 `assertPathsInVault`（`src/orchestrator/sources.ts`，纯路径演算不碰 fs），resolve 后必须落在某根内，越界声明期报错并列出非法行；
  `Orchestrator.assertStdinPaths` 接线（roots 与动作层 toAbs 同源），`run --stdin` 调用（`src/cli.ts`）。
  「不存在的相对路径」不算非法（§8.3 口径不变）。测试：sources 单测对抗用例 + CLI e2e（越界 exit 1、vault 外文件不被改写）。
- [x] **I1 stdin + where= 时不存在路径裸崩**：`runBatch` 预索引循环 `indexer.update` 无降级，ENOENT → 整个 run reject。
  修复：预索引单文件失败降级（warn 指出路径 + 从 routed 剔除），与 indexer 批内「单文件失败降级跳过」一致（`src/orchestrator/engine.ts`）。
  测试：engine 单测（warn 含 ghost.md、整批不崩）+ CLI e2e（stdin 含 ghost + where → exit 0）。
- [x] **I2 配置校验错被 warn+整体丢弃吞掉**：区分两类错误——YAML/JSON5 **语法解析失败**维持 warn + 降级 {}；
  **校验失败**（`pipelines` 字段非法，如 `on: [modifed]`）抛 `ConfigValidationError` 直接终止（`src/config.ts`；CLI 启动处捕获报带来源的错误并 exit 1）。
  测试：loadConfig 集成用例固化两类行为。
- [x] **M1 set 未闭合 `[` 静默落标量**：`set k=[a,b` / `set k=a,b]` 方括号不成对时声明期报错（`src/orchestrator/actions.ts` parseSetValue）。
- [x] **M2 弱断言补强**：`set tags=[pkm, note ,]` 用例落盘验证列表值本身（元素 trim、丢空尾项）。

- [x] **PC-6 commit**（已授权；按 feat/fix/docs 三提交收口 → fix `9a6790d`）

> **PC-6 追加（2026-07-30 片四期间发现）**：C1 的 `assertPathsInVault` 自写 `startsWith(root + sep)` 前缀比较，win32 下正斜杠（Git Bash 形态）与盘符小写的**根内合法路径**被误判越界——安全门假阳，`run --stdin` 整条被拒；且对抗用例因「全都抛」而假性通过，两个正向用例在 Windows 确定性红。修复：先 `resolve` 收拢形态再复用 `isPathInside` 单一真相源；测试根形态对齐生产不变量「roots 已 resolve」，补正斜杠/盘符小写回归用例。教训：路径包含判定禁止绕过 `utils/path.ts` 自写 `startsWith`。

文档同步（同批）：spec §8.3 补「stdin 路径须在 vault 内」契约句与 I1 口径；guide `run --stdin` 章节补路径约束。

---

## 验收

- `pnpm run typecheck` / `pnpm run lint` / `pnpm test` 全绿（本次触及公共契约 `PipelineConfig` 与配置解析，按 AGENTS「完成定义」升级到全量）。
- 命令行 key 与配置段 key **逐项对得上**（`use` 除外，它是引用入口；`dryRun` 由 `--apply` 承载）。
- 非法参数一律声明期报错并带来源；无静默忽略、无静默降级。
- spec §8 / guide / 实现三者互相验证，无残留「后续」注释指向已实现的能力。

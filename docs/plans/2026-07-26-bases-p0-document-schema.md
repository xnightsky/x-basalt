---
type: plan
title: Bases 无头引擎 P0 计划（document/schema/diagnostic）
description: 落地 src/base/ 文档层：.base YAML + schema + filter 结构校验 + 表达式浅扫描 + source span 诊断，完成 BASE-DOC-001..009 与 SEC-007/008
tags:
  - plan
  - bases
  - obsidian
  - headless
  - x-basalt
timestamp: 2026-07-26T12:17:57Z
sha256: 8641e5f5be92d65dea618eb255efde8f6a7c9ad9f1c8b438f40ec06649708a8c
---
# 计划：Bases 无头引擎 P0 · document / schema / diagnostic

> 2026-07-26 · 来源：根 `TODO.md`「Obsidian Bases 无头执行引擎」P0 项。
> 设计真相源：[`../specs/2026-07-22-bases-headless-engine-design.md`](../specs/2026-07-22-bases-headless-engine-design.md)（已冻结）；验收编号：[`../testing/2026-07-22-bases-scenario-matrix.md`](../testing/2026-07-22-bases-scenario-matrix.md) §3。
> 前置验收（设计 §15）：①Markdown-only 口径已由用户确认（2026-07-26 会话）；②fixture 空壳随本计划落地；③`BASE-PROP-004`/`BASE-RESULT-002` 官方 oracle 属 P1 语义冻结，不阻塞 P0；④本计划即执行计划并同步 TODO；⑤**API 先于 CLI**——P0 不加任何 CLI 命令。

## 目标与范围

落地 `src/base/` 一级模块的**文档层**：读取并校验 `.base` 文件（YAML + schema + filter 结构 + source span），产出稳定诊断，完成场景 `BASE-DOC-001..009`，并覆盖文档层可达的安全项 `BASE-SEC-007`（YAML alias bomb）/ `BASE-SEC-008`（路径越出 vault）。

P0 交付物（纯 API，无 CLI、无 SQLite、无 evaluator）：

- `src/base/types.ts`：`BaseDocument` / `BaseView` / `BaseFilter` / `SourceSpan` 类型（诊断 `file/line/column` 对齐 `src/diagnostic.ts` 契约：完整文件 1-based 行号、UTF-16 code unit 列）。
- `src/base/errors.ts`：`base/*` 诊断构造辅助（rule id 常量、severity 口径）。
- `src/base/expressions.ts`：**表达式浅扫描**（见「关键取舍」）。
- `src/base/document.ts`：`loadBaseDocument()` 主入口（读文件 → 预算 → YAML → schema → view/filter 校验 → 诊断聚合）。
- `src/base/index.ts`：公共出口。
- `tests/fixtures/bases/` fixture 空壳（minimal + 各非法文档 + security）。
- `tests/base-document.test.ts`：`BASE-DOC-001..009` 逐项独立用例 + `BASE-SEC-007/008`。

## 非目标（防止范围蔓延）

- **不**实现表达式完整文法（Chevrotain parser / AST / evaluator）——P1。
- **不**碰 SQLite / 索引层 / `src/query/`；不查询任何笔记行。
- **不**加 CLI 命令（薄出口另行立项）。
- **不**做 `formulas` / `summaries` / `groupBy` 的执行，仅按设计 §5 给 `base/unsupported-feature`。
- **不**为官方争议语义（missing/null 合并、null 排序等）下结论——P1 oracle 冻结。

## 关键取舍（实现前拍板）

1. **`BASE-DOC-008` 用「浅扫描」而非完整 parser**：P0 不建 Chevrotain 文法。`expressions.ts` 手写一个最小 tokenizer（空白 / 单双引号字符串 / 数字 / 标识符 / 括号与运算符符号），只做两件事：
   - 收集 `标识符(` 形态的函数调用名与其 UTF-16 offset，对照设计 §9 白名单**名字集合**（`if/list/number/isTruthy/isType/toString/contains/containsAll/containsAny/startsWith/endsWith/lower/trim/isEmpty/keys/values/hasTag/inFolder/hasLink/hasProperty`）；未知名（含旧版 snake_case 如 `contains_all`）→ `base/unknown-function`（error，位置 = YAML scalar 起点 + 表达式内 offset）。
   - tokenizer 自身失败（如未闭合字符串）→ `base/expression-syntax`（error，带 offset）。
   - 字符串字面量内的 `foo(` 不误报（tokenizer 跳过字符串内容）。括号配平、运算符文法等留给 P1 parser。
2. **诊断严重级口径**：终止性问题（invalid-yaml / view-required / duplicate-view-name / view-not-found / invalid-schema / unknown-function / expression-syntax / 预算耗尽 / 路径越界）= `error`；未知顶层 key = `warning`（保留原值）；`cards/list/map` 等已知但未支持 view type 与 `formulas`/`summaries`/`groupBy` = `base/unsupported-feature`（error，因选中即不可执行）；未知/插件 view type = `base/unsupported-view-type`（error）。
3. **filter 结构校验**：字符串 = 表达式 filter；对象仅允许 `and`/`or`/`not` 单键、值为 filter 数组；空数组按设计 §6 暂定 `and:[]→true / or:[]→false / not:[]→true`（注释标注「待 oracle」，P0 只记录结构、不求值）；嵌套深度超 `maxFilterDepth` 以**迭代 + 显式深度计数**拒绝（`base/execution-budget`，error），杜绝栈溢出。
4. **预算默认值**（设计 §12 的文档层子集，实现时以 fixture 校准并写注释）：`maxDocumentBytes = 1 MiB`、`maxYamlAliases = 100`（对齐 `yaml` 包 `maxAliasCount` 默认）、`maxFilterDepth = 32`、`maxExpressionNodes`（浅扫描阶段 = token 数上限）= 1000。
5. **路径安全**：`basePath` resolve 后必须落在某个 `vaultRoots` 内（先 resolve 再判定，读取前拒绝，含 `..` 越界与绝对路径绕出）；vault 相对路径统一 POSIX。
6. **YAML 解析**：用既有依赖 `yaml`（`parseDocument`，安全默认 schema，`maxAliasCount` 显式设限），经 `LineCounter` + 节点 `range` 换算 line/column；非法 YAML 终止执行并给完整文件位置。
7. **view 选择**：`selectView(doc, name?)`——未指定取 `views[0]`；指定不存在 → `base/view-not-found`（error，`suggestions` 列可用 view 名）；选中带 error 级诊断的 view（如 unsupported type）→ 由调用方（P1 engine）拒绝执行，P0 只在文档校验阶段产出诊断。
8. **schema 校验细节**：`views` 缺失/空数组 → `base/view-required`；view `name` 非空字符串、重名 → `base/duplicate-view-name`；`limit` 必须非负整数（负数/非数 → `base/invalid-schema`，与 `BASE-RESULT-003` 负数拒绝对齐）；`order`/`sort` 的 property-ref 形态（`note.x` / `file.x` / 裸属性）只做结构记录，合法性 P1 再验；已知结构内的未知 key 按是否影响结果分 warning/error（设计 §5）。

## 验证口径（完成定义）

- `tests/base-document.test.ts`：`BASE-DOC-001..009` 每号独立用例可追溯（注释标号），另加 `BASE-SEC-007`（alias 超限）/ `BASE-SEC-008`（`../` 越界与绝对路径）用例；断言诊断 rule / severity / line / column / suggestions。
- `pnpm run typecheck`、`pnpm test` 全绿；触碰文件 `oxfmt --check` + `oxlint` 通过。
- 落盘前自查 AGENTS.md 硬约束（无 `obsidian` import、只经 `fs` 读、不写任何 vault 文件、无 `eval`/`new Function`）。
- 注释规范：Obsidian Bases 行为对齐处标 `// === Obsidian 规范来源: <规范点> ===`，自建处标 `// === 自建实现 ===`（召回 `biz-code-comments`）。

## 风险与停点

- `yaml` 包节点 `range` 对块级/流式 scalar 的 offset 语义需在实现时以 fixture 实测确认；若无法稳定换算 expression 位置，退化为「表达式整体位置 = scalar 起点」并如实记录，不伪造精确列。
- 白名单名字集合与设计 §9 保持单一真相源；P1 函数注册表落地后浅扫描复用同一名单，避免两处漂移。
- 若发现设计 §5/§6 与矩阵 §3 冲突 → 先停、更新设计文档，再实现。

## 验证结论（2026-07-26）

- `BASE-DOC-001..009` 全部落地并有独立用例（`tests/base-document.test.ts`，注释标编号），另加 `BASE-SEC-007`（alias bomb）/ `BASE-SEC-008`（`..` 越界 + 绝对路径绕出）与一条 filter children 顺序回归用例。
- `pnpm run typecheck` 通过；`pnpm test` 626 pass / 0 fail；触碰文件 `oxfmt --check` + `oxlint` 均 0 告警。
- 审查修复：coder 初版 `validateFilter` 正序入 LIFO 栈导致 `and/or/not` children 反序，已改倒序入栈并加回归用例（`tests/fixtures/bases/minimal/views/ordered.base`）。
- 实现期补充（已同步回设计 §11）：新增 rule `base/path-outside-vault`（§11 原列表未覆盖 BASE-SEC-008）；`yaml` 包 `maxAliasCount` 仅 `toJS` 阶段生效，alias 超限诊断如实定位 1:1；view 内未知 key P0 一律 warning（精确分界属 P1）；文件不可读归入 `base/invalid-yaml` + `reason: "unreadable"`。
- 未验证项：多行折叠 scalar 内表达式的列号语义（注释已声明为原文本位置）；官方争议语义（空 filter 数组、missing/null）按设计留待 P1 oracle。
- 剩余风险：白名单名字集合（`BASE_FUNCTION_NAMES`）与设计 §9 需保持同步，P1 函数注册表落地时必须复用同一名单。

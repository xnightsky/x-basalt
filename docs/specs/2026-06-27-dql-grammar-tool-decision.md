---
timestamp: 2026-06-30T00:01:23Z
sha256: 8f094827587c2781a2daebd0c6cf44580956f7a83831eaa298af0493ca6c45a3
type: spec
title: DQL 文法工具选型决策：chevrotain
description: DQL parser 选用 chevrotain 的 spike 结论与决策
tags:
  - spec
  - dql
  - chevrotain
  - x-basalt
---
# DQL 文法工具选型决策：chevrotain（S2.1 spike 结论）

> 日期：2026-06-27 · 类型：选型决策（ADR 性质）
> 父计划：[`../plans/2026-06-26-dql-kernel-steps.md`](../plans/2026-06-26-dql-kernel-steps.md) S2.1
> 依据：[`2026-06-26-deps-build-vs-buy.md`](2026-06-26-deps-build-vs-buy.md) B 项（DQL 纯自研做深）、生态定位调研

## 决策

**选定 `chevrotain@12.0.0` 作为 DQL 文法（tokenizer + parser）实现工具，落为运行时依赖（`dependencies`）。** 落选 `peggy`，已移除。

## spike 方法

各写一个最小 spike（`spike/chevrotain-spike.ts` / `spike/peggy-spike.ts`，评估后删除），解析同一样例：

```
LIST FROM #x WHERE a = 1 AND contains(file.tags,"y") SORT b DESC LIMIT 5
```

并各测一个非法输入 `LIST WHERE a = 1 SORT LIMIT 5`（SORT 缺字段名）验证错误定位。两者均产出**完全一致**的目标 AST（贴近 `src/query/ast.ts` 的 `DqlQuery`）。

## 实证评估矩阵

| 维度              | chevrotain 12.0.0                                                                                        | peggy 5.1.0                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ESM/NodeNext 接入 | ✅ `import { createToken, Lexer, EmbeddedActionsParser }` 直接可用                                       | ✅ `import peggy` 默认导入可用                                                                                               |
| 解析样例 → AST    | ✅ 正确（修两处后）                                                                                      | ✅ 正确（一次通过）                                                                                                          |
| **TS 类型体验**   | ✅ **纯 TS**；AST 经 `RULE` 回调返回类型端到端 typed，`parse()` 直接产 typed `Dql`                       | ⚠️ 文法是**字符串 DSL**（无 TS 检查 / IDE 支持）；生成的 `parse(input): any`（实测 `peg.d.ts:1113`），AST 全靠手动 `as` 断言 |
| 错误定位          | ✅ offset+line+期望 token；LL 不回溯，位置贴近真实错误点（样例报 **offset 22**：SORT 后期望 Identifier） | ✅ offset+line+col+**期望集更丰富**；但 PEG 回溯使位置漂移（把 `LIMIT` 当字段名 → 报到下游 **offset 28** 的 `5`）            |
| 错误恢复          | ✅ 内建多错误收集（`parser.errors[]` 数组）                                                              | ⚠️ 首个错误即抛                                                                                                              |
| 构建步骤          | ✅ 无（运行时 self-analysis）                                                                            | ✅ 无（运行时 `peggy.generate`），生产可预编译为 .js                                                                         |

## 选 chevrotain 的理由（按权重）

1. **端到端类型安全**：内核要"做深、当代表作"，AST 是 query 层公共契约。chevrotain 让 `tokenize→parse` 产出 typed AST，IDE/重构/`tsc` 全程护航；peggy 文法是字符串、`parse()` 返回 `any`，类型断裂会顺着 sql-generator 一路蔓延。**这是决定性因素。**
2. **错误定位贴近真实错误点**：LL(k) 不回溯，语法错误位置稳定、可解释；PEG 回溯会把错误漂移到下游 token（spike 已复现：同一错误 chevrotain 报 offset 22、peggy 报 offset 28），对用户报错体验更差。
3. **多错误恢复**：chevrotain 内建 `parser.errors[]`，未来可一次给出多处语法错误；peggy 首错即抛。
4. **纯 TS、无生成步骤、Node 22 已满足**：与既定技术栈（TS 5.x / ESM / NodeNext）同构，无需引入 .peggy 文件 + 生成产物的双轨维护。

## 已知代价（可接受，已记录规避）

- **数字后缀约束**（`NUMERICAL_SUFFIXES`）：同一规则内重复 `CONSUME`/`SUBRULE`/`OR` 须带数字后缀（`CONSUME1`…）。机械但 **fail-fast**：在 parser 构造期（`performSelfAnalysis`）即报错并指向 FAQ，不会潜伏到运行期。
- **unicode property escape**：lexer 对 `/#[\p{L}\p{N}…]+/u` 的首字符优化失配（spike 临时退化为 ASCII 标签体）。实现期 Tag/标签体改用 **自定义匹配函数** 或 `Lexer` 关闭首字符优化（`ensureOptimizations: false`）即可恢复 Obsidian 规范的 unicode 标签支持——见 `biz-obsidian-spec` 标签体文法。

## 后续衔接

- chevrotain 已落 `dependencies`（DQL 解析是运行时功能，非 devDep）；**当前零 import**，待 **S2.3** 用它重写 `src/query/tokenizer.ts` + `ast.ts` 的 parser 后真正接入。
- peggy 已移除（`pnpm remove peggy`）。
- 工具选定不改变 DQL 子集边界；子集扩展仍走 **S2.2a/S2.2b**（先改 `biz-dql-subset` 真相源 + research §3，再动代码）。

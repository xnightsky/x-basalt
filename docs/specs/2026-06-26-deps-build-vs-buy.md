---
timestamp: 2026-06-30T00:01:23Z
sha256: ade12994513d6512e670f8cd37313d061186df20cf74f56197fd79f8ac021599
type: spec
title: 决策：依赖与「自建 vs 用库」边界
description: 各模块第三方依赖与自建边界的 ADR 决策
tags:
  - spec
  - deps
  - adr
  - x-basalt
---
# 决策：依赖与「自建 vs 用库」边界（x-basalt）

> 日期：2026-06-26 · 状态：决策记录（ADR 性质），待用户拍板选型
> 事实依据：npm registry 实测（2026-06-26）；既有调研 [`../research/2026-06-25-obsidian-spec-and-deps.md`](../research/2026-06-25-obsidian-spec-and-deps.md)
> 关联：体检 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md)、覆盖矩阵 [`2026-06-26-coverage-matrix.md`](2026-06-26-coverage-matrix.md)

## 0. 这份文档要回答的问题

> 「我调研时业界有很多现成组件，本该组装；为什么实现成了纯裸开发？是不是违规了？」

结论先行：

1. **没有违反项目硬约束**——自建 Obsidian 专有语法解析是 `AGENTS.md` 技术栈表**明文要求**的，不是擅自。
2. **但「零依赖 Obsidian 运行时」被执行成了「全部手撸字符串」**，这是把一个对的约束理解过度了。
3. 而且**连调研自己选定的 AST 工具链都没落地**（4 个声明依赖零 import），这是实现与设计脱节。

下面逐条给证据与边界。

## 1. 硬约束到底禁了什么、没禁什么

`AGENTS.md`「项目硬约束」逐条对照：

| 约束 | 禁止的                                                  | **没有禁止的**                              |
| ---- | ------------------------------------------------------- | ------------------------------------------- |
| 1    | `import ... from 'obsidian'` / obsidian npm 包 / 其类型 | 任何**纯 remark 生态**插件（不引 obsidian） |
| 2    | `obsidian://` URI 协议                                  | ——                                          |
| 3    | `obsidian-dataview` 的 **Evaluator / Executor**         | 参考其 AST 类型；**自建执行层**             |
| 4    | Electron / Puppeteer / Playwright                       | ——                                          |
| 5    | 文件操作只用 `fs` / `chokidar`                          | ——                                          |
| 6    | 隐式字段假设外部缓存                                    | SQLite JOIN 实时计算                        |

**关键：硬约束从未禁止 `remark-obsidian-md`、`@flowershow/remark-wiki-link`、`unified`、`gray-matter` 这类纯 npm 库。** 而技术栈表又写明「Obsidian 专有语法 = **自建提取**，`@flowershow/remark-wiki-link` 仅作语法参考」。所以：

- 自建 wikilink/tag/callout 解析 = **遵守约定**，不算违规。
- 真正的偏差在第 4 节。

## 2. 核心区分：「零依赖运行时」≠「全部自建」

这是整件事的认知症结：

> **「零依赖 Obsidian 运行时」（项目灵魂，保留）≠「连纯 npm 的 remark 插件都不用、全部手撸」（过度执行）。**

二者可分离：完全可以用 `remark-obsidian-md` + `gray-matter` 做**解析层**（一行 obsidian 代码不碰），同时**自建索引层和 DQL 执行层**。当前实现把它们捆死了，导致在解析这种「业界已解决」的问题上重复造轮子，且造出了 bug（见体检报告）。

## 3. 三层 build-vs-buy 决策表

把项目拆成三层，分别判断「该买（组装现成）还是该建（自研）」：

| 层                                                         | 有无现成纯 npm 方案              | 建议                      | 理由                                                              |
| ---------------------------------------------------------- | -------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| **解析层**<br>wikilink/embed/callout/highlight/frontmatter | ✅ 有（见 §4 矩阵）              | **可买/组装**             | 纯 remark 插件不碰 Obsidian；自建 = 重复造轮 + 现有实现有边界 bug |
| **索引层**<br>Vault 扫描 / 反向链接倒排 / SQLite           | ❌ 无「Vault 级索引」现成包      | **必须建**                | 没有现成方案；这是合理的自研                                      |
| **DQL 执行层**<br>DQL → 求值                               | ⚠️ 官方绑 Obsidian；社区只有子集 | **必须建 / 基于子集做深** | 官方 Evaluator 依赖运行时；**这是项目真正的技术价值所在**         |

**推论**：内核（索引 + DQL 执行）的自研是对的、有价值的，应当**做深**；解析层的自研是**可省的重复劳动**，可换成熟插件，把精力让给内核。这与「做深内核、冲代表作」的方向一致。

## 4. 依赖可用性矩阵（npm registry 实测 2026-06-26）

✅ = 本次 `registry.npmjs.org/<pkg>/latest` 实测确认；⚠️ = 存在但能力声明待核实。

| 包                             | 版本   | 自述能力                                                                                                                     | 依赖 Obsidian 运行时？ | 状态                                                              |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `@flowershow/remark-wiki-link` | 4.0.0  | 解析/渲染 wiki 链接（尤 Obsidian 风格）                                                                                      | 否                     | ✅ 存在                                                           |
| `@portaljs/remark-wiki-link`   | 1.2.0  | 解析/渲染 wiki 链接（尤 Obsidian 风格）                                                                                      | 否                     | ✅ 存在                                                           |
| `remark-obsidian-md`           | 1.1.0  | wiki links + **callouts** + **highlights**（keywords: wiki-links/callouts/alerts；repo: adrianoaraujods/remark-obsidian-md） | 否                     | ✅ 存在；embed/tag/task 覆盖 ⚠️待核实                             |
| `gray-matter`                  | 4.0.3  | frontmatter（YAML）                                                                                                          | 否                     | ✅ 已在用                                                         |
| `obsidian-dataview`            | npm 包 | 发布 DQL 的 TS 类型 + `getAPI()`；**执行依赖 `app.metadataCache`（运行中的 Obsidian）**                                      | **是（执行层）**       | ✅ 机制确认：无法 headless 求值                                   |
| `@oomkapwn/enquire-mcp`        | 3.10.1 | 自述「给 AI agent 持久长期记忆、后端是本地 Obsidian vault」的 MCP server                                                     | 否                     | ⚠️ 存在已确认；**DQL 子集查询能力待核实**（自述非 Dataview 引擎） |

### 待核实清单（不得当事实写入实现依据）

- `obsidian-dataview` 在 0.5.50 具体把 `EXPRESSION`/`QUERY` parser 暴露到 npm 的方式与版本。
- `remark-obsidian-md` 是否覆盖 embed / tag / task（实测仅确认 wikilink/callout/highlight/alerts）。
- `@oomkapwn/enquire-mcp` 是否真有 `obsidian_dataview_query` 工具及其支持的 DQL 子集。

## 5. 当前实现的偏差（实测）

1. **4 个声明依赖零 import**：`unified`、`remark-parse`、`@flowershow/remark-wiki-link`、`zod` 在 `src/**` import 次数 = 0（2026-06-26 实测）。
   - 设计 §3.1 说「`remark-parse` 仅用于拿基础 AST 辅助定位」——未落地，解析全是逐行 `split` + 正则。
   - 调研 §1 把 `unified/remark-parse` 列入是为「强制 ESM」的论证，但运行时并未使用。
   - 影响：依赖树虚胖、给「我们用了成熟方案」的错觉、`zod` 声称的 schema 校验实为裸 `Error` + 手写判断。
2. **`due_date` 半接线**：`schema.ts:63` 有列、`sql-generator.ts:78` 引用 `k.due_date`，但 `types.ts:19` 的 task 节点无该字段、parser 不提取 → 实际**恒为 NULL**（调研 §2 line 58 明确要求从文本提取 `YYYY-MM-DD`）。

## 6. 待拍板的选型（本文档只登记，不擅自实施）

> 方向已定为「做深内核、冲代表作」。以下为支撑该方向的具体选型岔路，留待确认后单独立计划执行：

- **A. 解析层：换成熟插件 vs 继续自建。**
  - 建议：解析层引入 `remark-obsidian-md`（callout/highlight/wikilink）+ 保留 `gray-matter`，把自建解析收敛到插件未覆盖处（tag/task/blockRef/embed 细节）。把省下的精力投入内核。
  - 代价：需重写 parser 适配层 + 回归测试；需先核实 §4「待核实」项。
- **B. DQL 执行层：基于社区子集起步 vs 纯自研做深。**
  - 建议：纯自研做深（当前已有 tokenizer→ast→sql 骨架），把它从 70% 子集补成「完整可信子集 + 覆盖矩阵」，作为代表作技术亮点；社区实现仅作对照。
- **C. 死依赖处理：** 从 `package.json` 移除 `unified`/`remark-parse`/`@flowershow/remark-wiki-link`/`zod`，或在选 A 后让它们真正被用上。
  - **[2026-06-27 进展 · 路线图 S0.3]** `zod` 已移除（package.json + AGENTS 技术栈表）；typecheck/test 全绿。`unified`/`remark-parse`/`@flowershow/remark-wiki-link` 暂留，待阶段 1 解析层选型（A 项）决定去留。
  - **[2026-06-27 · 路线图 S0.4 许可证基线]** `pnpm licenses list` 全量为宽松证：MIT 103 / ISC 7 / BSD 4 / Apache-2.0 4，**零 GPL/AGPL/MPL/未声明**，符合 `guides/dependency-license-policy.md`。

## 7. 一句话总结

不是违规，是「把『不依赖 Obsidian 运行时』错读成『什么都自己撸』，还没撸到位」。解析层本该组装、内核本该自研做深——当前恰好做反了一半。

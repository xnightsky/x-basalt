---
timestamp: 2026-06-30T00:01:23Z
sha256: 5c0cee07c9872bd5f5d3ae3fca3d21033daf9a2c0f5ed4ebeae220d08e0a8c63
type: spec
title: 解析层 buy-vs-build 决策：保留自建
description: parser 保留自建、不替换 remark-obsidian-md 的 spike 结论
tags:
  - spec
  - parser
  - adr
  - x-basalt
---
# 解析层 buy-vs-build 决策：保留自建，不替换为 remark-obsidian-md（S1.1 spike 结论）

> 日期：2026-06-28 · 类型：选型决策（ADR 性质）
> 父计划：[`../plans/2026-06-26-execution-roadmap.md`](../plans/2026-06-26-execution-roadmap.md) 阶段 1 / S1.1
> 依据：[`2026-06-26-deps-build-vs-buy.md`](2026-06-26-deps-build-vs-buy.md) A 项、[`../research/2026-06-26-libraries-survey.md`](../research/2026-06-26-libraries-survey.md) §1
> 标尺：[`biz-obsidian-spec`](../../skills-def/biz-obsidian-spec/SKILL.md)（Obsidian 官方语法行为）

## 决策

**保留自建解析层（`src/parser/**`），不替换为 `remark-obsidian-md`。** 阶段 1「解析层改为组装」据此**关闭\*\*——经实测对标，自建解析在 x-basalt 的 headless 元数据提取场景下能力更全、更正确，且契合硬约束，换库无收益反受损。

## 背景

S1.1 原为「卡点」：先确认 `remark-obsidian-md` 的 license 与能力，再决定是否把自建解析换成「remark 插件组装」。用户口径明确：**先头对头对标自建 vs 该库，达到甚至更好就不替换。**

## license（不再是阻塞项）

- `remark-obsidian-md@1.1.0` = **MIT**（`npm view` 实测，repo 亦确认）。调研期「manifest license 字段缺失」的顾虑解除——**license 不卡**，决策纯看能力。
- 对照：`remark-obsidian@12.x` = **GPL-3.0**，MIT 项目不可引入（传染），本就排除。

## spike 方法

临时装 `remark-obsidian-md`（devDep，评估后移除），同一段含全部专有语法 + 刁钻边界的 Obsidian 文本，分别喂自建 `VaultParser` 与该库的 unified 管线，对比输出（脚本 `_spike_compare.ts`，跑完即删）。样例含：带 heading/blockId/alias 的 wikilink、资源/笔记 embed、可折叠 callout、嵌套 Unicode 标签、`#123`/`word#notag`/`Concepts#heading` 等非标签干扰、自定义状态 task、blockRef 定义、**代码块/行内代码内的 `#`/`==`**。

## 实测结论

### 自建 `VaultParser`：11 个节点，全对

- wikilink ×4：`target` 与 `heading`(#小节)/`blockId`(#^block-1)/`embed`(资源 image.png 与笔记 Embedded Note) **全部分清**。
- tag：仅 `nested/标签`（Unicode 嵌套）入选；`#123`(纯数字)、`word#notag`(word 前缀)、`Concepts#heading`(锚点) **全部正确排除**。
- callout：type=warning、`-`→foldable=true、content 聚合两行。
- task ×3：状态 `x`/`?`/` ` 各自保留 + 1-based 行号。
- highlight、blockRef 定义各 1。
- **代码区掩码生效**：围栏块内 `#围栏代码里的也不算`、行内 `#代码里的不算标签`、`==这也不是高亮==` **全部未误识**。

### `remark-obsidian-md`：headless 直接崩溃

- 给定字符串输入即抛 `TypeError: path must be string... undefined`，栈在 `processFrontmatter` 的 `readFileSync(file.path)`——**它按磁盘路径读文件**处理。
- 即便提供 `root`/`publicFolder` 仍崩：它需要**真实 vault 目录 + contentMap**（全库文件映射）把链接解析成 **URL/slug**，并把 callout/frontmatter 渲染成**带折叠图标的 HTML 组件**（Options 全是 `slugify`/`calloutCollapseIcon`，还导出 `./styles/*.css`）。

## 能力对照

| 维度                                | 自建 `VaultParser`                               | `remark-obsidian-md`                         |
| ----------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| wikilink/embed                      | ✅ 结构化 target/alias/heading/blockId/embed     | ⚠️ 渲染成 `<a>`/HTML，需 contentMap 解析 URL |
| callout                             | ✅ type/title/foldable/content                   | ⚠️ 渲染成带图标 HTML 组件                    |
| highlight                           | ✅ `{content}`                                   | ⚠️ 渲染成 `<mark>`                           |
| frontmatter                         | ✅ gray-matter 取数据                            | ⚠️ 渲染成 HTML 组件（按文件路径读盘）        |
| **tag（行内/嵌套/排除规则）**       | ✅                                               | ❌ 完全不做                                  |
| **task（自定义状态 + due + 行号）** | ✅                                               | ❌ 完全不做                                  |
| **blockRef 定义**                   | ✅                                               | ❌ 完全不做                                  |
| **代码块/行内代码内不误识**         | ✅ 等长掩码                                      | ❌ 不涉及（非元数据提取目标）                |
| 运行模型                            | ✅ 纯函数 `string → ObsidianNode[]`，无 fs/vault | ❌ 需磁盘 vault + 渲染管线                   |

## 理由

1. **目标错位**：该库是「笔记 → 网页 HTML」的**建站/渲染**插件；x-basalt 要的是「笔记 → 结构化元数据」的 **headless 提取**。即便重叠的四类语法，其输出也是渲染态 HTML，需反向拆解才能还原结构化字段，得不偿失。
2. **覆盖更窄**：tag/task/blockRef（x-basalt 索引/查询的核心字段）该库**完全不做**，仍须自建——换库后反而是「半自建 + 适配一个反向的渲染库」。
3. **正确性更弱**：自建独有的代码区掩码、blockId/heading 区分、自定义 task 状态、Unicode 标签排除规则，库均不覆盖。
4. **违背硬约束**：该库需读磁盘 vault + 渲染，违反「解析层纯函数、零 Obsidian 运行时、不碰 fs」（`AGENTS.md` 硬约束）。

## 影响

- 阶段 1「解析层改为组装」**关闭**；其子步 S1.2（组装 remark 插件）取消。
- 「死依赖」`unified`/`remark-parse`/`@flowershow/remark-wiki-link`：既然不走 remark 组装路线，应在后续收口（阶段 5）评估**移除**（与 S0.3 清理 `zod` 同理）。本次先记录，不动。
- task `due` 提取（旧记 S1.3）早已在 indexer 实现（`DUE_DATE_RE`），无遗留。
- 结论同步至真相源：`docs/specs/2026-06-26-deps-build-vs-buy.md`、`research/2026-06-26-libraries-survey.md` 的「解析层建议组装」口径改为「自建已胜出，保留」。

---
type: plan
title: KB compiler P0 parser 链接定位契约计划
description: 规划 KB compiler P0 的 parser 链接定位契约：wikilink/embed 补完整文件位置与 raw，新增 Markdown link/image link 节点，并约束代码区屏蔽与验证范围。
tags:
  - plan
  - kb-compiler
  - parser
  - links
  - lint
  - x-basalt
timestamp: 2026-07-09T05:51:47Z
sha256: 9be9a6bd245e15dfcfbccddc08838e607a96d6b057fa1d9aadbe76f10123ccab
---

# 计划：KB compiler P0 parser 链接定位契约

> 2026-07-09 · 承接 [`../specs/2026-07-09-kb-compiler-lint-links-design.md`](../specs/2026-07-09-kb-compiler-lint-links-design.md) P0。
> 状态：已完成（2026-07-09）。验证：`node --import tsx --test tests/parser.test.ts tests/indexer.test.ts tests/query.test.ts`、`pnpm run typecheck`、`pnpm run build`、触碰 TS/测试文件定向 `oxfmt --check` 均通过。

## 目标

让 parser 稳定产出可诊断的链接位置节点：wikilink / embed 补 `line` / `column` / `raw`，新增 Markdown inline link / image link 节点，并保证代码块与行内代码中的链接不产出节点。

## 非目标

- 不新增 `links check` / `links suggest` CLI。
- 不定义长期稳定的 `BasaltIssue` JSON。
- 不检查目标是否存在，不做路径建议，不写文件。
- 不实现完整 CommonMark reference link / nested parentheses。
- 不改 indexer 的 `links` 表语义；若 parser 为诊断保留多次出现，indexer 仍可在写库边界维持原去重策略。

## 分阶段切口

### P0.1 · 计划与契约冻结

- 新建本计划并更新根 `TODO.md` 指针。
- 保持设计真相源为 `docs/specs/2026-07-09-kb-compiler-lint-links-design.md`。
- 文档新增后用 `x-basalt meta apply llm-wiki` 补 frontmatter 元数据。

### P0.2 · 测试先行：wikilink 定位

- `tests/parser.test.ts` 新增失败用例：
  - `VaultParser.parse` 中 `[[Note|别名]]` 产出 `line` / `column` / `raw`。
  - `![[assets/diagram.png]]` 的 `raw` 包含 `!`，`embed=true`。
  - 同一坏链多次出现时 parser 保留多次出现，供后续 links check 精确诊断。
  - frontmatter 后的链接行号采用完整文件行号，不是正文行号。
  - 围栏代码块与行内代码中的 wikilink 不产出节点。
- 先运行 `pnpm test tests/parser.test.ts`，确认新用例按预期失败。

### P0.3 · 实现 wikilink 定位契约

- `src/parser/types.ts`：扩展 `wikilink` 节点字段 `line` / `column` / `raw`，注释明确它们是完整文件行号与 UTF-16 code unit 列。
- `src/parser/wikilink.ts`：让 `extractWikilinks` 接收完整内容或行号偏移上下文，计算位置并保留每次出现。
- `src/parser/index.ts`：在 `parseFrontmatter` 后用完整文件行号偏移调用 wikilink 提取；对链接类语法使用代码掩码结果，避免代码区域误提取。
- 如 indexer 测试暴露去重假设，去重只移动到 indexer 写库边界，不让 parser 丢诊断源。

### P0.4 · 测试先行：Markdown link / image link

- `tests/parser.test.ts` 新增失败用例：
  - `[text](../a.md)` 产出 `markdownLink`，包含 `text` / `target` / `image=false` / `line` / `column` / `raw`。
  - `![alt](../asset.png)` 产出 `image=true`。
  - `[text](../a.md "title")` 产出 `title`，`target` 不含 title。
  - 外部 URL / mailto / anchor-only link 仍产出节点，留给 P1 判断是否跳过。
  - 行内代码与围栏代码块中的 Markdown link / image link 不产出节点。
- 运行 `pnpm test tests/parser.test.ts`，确认新用例按预期失败。

### P0.5 · 实现 Markdown link / image link 提取

- `src/parser/types.ts`：新增 `markdownLink` 节点变体。
- `src/parser/index.ts` 或新 `src/parser/markdown-link.ts`：实现保守 inline link 提取，仅覆盖 P0 范围。
- 位置字段沿用 wikilink 契约：完整文件 1-based `line`，1-based UTF-16 `column`，`raw` 为原始匹配文本。
- 代码区屏蔽复用等长 `maskCode` 结果，保证列位回指原文。

### P0.6 · 文档与验证收口

- `docs/specs/2026-07-09-kb-compiler-lint-links-design.md` 如需同步实现约束，只做 P0 事实性小改。
- `TODO.md` 更新 P0 状态。
- 运行：
  - `pnpm test tests/parser.test.ts`
  - `pnpm run typecheck`
  - 必要时 `pnpm run build`
- 自查禁止项：不引入 Obsidian 包、GUI 自动化、`obsidian://`，parser 仍为纯函数。

## 验收标准

- `wikilink` / embed 节点包含 `line` / `column` / `raw`，且行号是完整文件行号。
- parser 不再为 links 诊断去重 wikilink；同一链接多次出现可分别定位。
- 新增 `markdownLink` 节点覆盖 inline Markdown link 与 image link P0 子集。
- 代码块与行内代码中的 wikilink / Markdown link / image link 不产出节点。
- parser 测试与 typecheck 通过；若 indexer 受 parser 去重调整影响，相关 indexer 测试也通过。

## 风险

- parser 去重语义调整可能影响 indexer 现有 outlinks 行数；若发生，去重应在 indexer 写 `links` 表前完成，保持查询行为不漂移。
- Markdown inline link 首版是保守子集，嵌套括号、reference link 与复杂转义暂不支持；P1 links check 必须把未支持形态作为后续扩展，而不是猜测。
- `column` 采用 UTF-16 code unit，不是 grapheme；这是为了和 JavaScript 字符串索引直接换算，后续 CI annotation 需要沿用同一口径。

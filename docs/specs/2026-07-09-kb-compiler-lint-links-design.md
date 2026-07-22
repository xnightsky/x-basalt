---
type: design
title: KB compiler / lint / links 设计规格
description: 冻结 x-basalt Markdown 知识库编译器路线：parser 链接定位契约、links check/suggest、BasaltDiagnostic、profile/schema、CI 与 rewrite/fix 分层边界
tags:
  - design
  - kb-compiler
  - lint
  - links
  - parser
  - x-basalt
timestamp: 2026-07-22T03:55:45Z
sha256: 4ae55484c3162fa4b17008b4d7ba807b9e45f5b6222244e97a28d9cec920b13c
---

# KB compiler / lint / links 设计规格

> 日期：2026-07-09 · 类型：parser 定位契约 + links/lint/profile 分层设计
> 状态：P0 parser 定位契约 + P1 links check/suggest 已落地；P2 统一诊断契约（`BasaltDiagnostic`）+ lint 壳进行中（见 [`../plans/2026-07-22-kb-compiler-p2-diagnostic-contract.md`](../plans/2026-07-22-kb-compiler-p2-diagnostic-contract.md)）。关联调研：[`../research/2026-07-09-markdown-kb-compiler-lint-links-research.md`](../research/2026-07-09-markdown-kb-compiler-lint-links-research.md)。

## 1. 结论

x-basalt 下一阶段不直接实现大而全的 `lint --profile --fix`，而是按下面链路分层落地：

```text
parser 带位置结构化节点
  -> BasaltDiagnostic 统一诊断模型
  -> links check / suggest
  -> lint 壳与 metadata/profile 规则
  -> CI / baseline
  -> rewrite / fix
```

核心判断：**先让 parser 稳定回答“源文件第几行第几列是什么链接”，再让检查器回答“这是不是问题、如何建议修复”。** 位置契约进入 parser 公共类型，不在 links 命令里临时重算；诊断契约（`BasaltDiagnostic`）进入诊断层，不和 AST 节点混用。

## 2. 背景与现状

P0 实现前，parser 已支持 Obsidian 专有语法与 Dataview inline fields，但链接定位能力不完整：

- `wikilink` 节点已有 `target` / `alias` / `heading` / `blockId` / `embed`，但没有 `line` / `column` / `raw`。
- `task`、`blockRef`、`inlineField` 已带行号；其中 `inlineField.line` 是 1-based 正文行号。
- 普通 Markdown link / image link 当前没有结构化节点。
- indexer 已将 wikilink/embed 写入 `links` 表，但 `links` 表服务查询，不适合直接承载 lint 的源位置诊断。

因此，第一步不是写 `links check`，而是冻结 parser 位置契约。否则后续会出现两个问题：坏链只能报数量不能定位；rewrite/fix 需要重新解析原文，容易与 parser 语义分叉。P0 已按此切口完成，后续 P1 直接消费 parser 节点，不在 links 命令里重新解析 Markdown。

## 3. 范围与非范围

### 3.1 P0 范围：parser 定位契约

P0 只扩展解析产物，不新增 CLI 检查命令：

- `wikilink` / embed 节点补 `line`、`column`、`raw`、`target`。
- 新增 Markdown link / image link 节点，覆盖 `[text](target)` 与 `![alt](target)`。
- 位置采用完整文件行号，而不是剥离 frontmatter 后的正文行号。
- `column` 为 1-based UTF-16 code unit 列，与 JavaScript 字符串索引换算简单；先不承诺 grapheme column。
- 代码块与行内代码中的链接不产出链接节点。

### 3.2 P1 范围：links check / suggest

P1 在 P0 位置契约上建立本地链接诊断：

- 检查 Markdown 相对链接、Markdown 图片、Obsidian wikilink、Obsidian embed。
- 首版只检查 vault 内本地目标，不检查外部 HTTP 可达性。
- 对 basename 唯一命中给建议；多命中只排序展示，不自动修。
- 支持 ignore 配置，避免历史附件、生成目录、外部 PDF 等长期噪声。

### 3.3 P2 范围：统一 BasaltDiagnostic + lint 壳

P2 把 links 诊断提升为通用诊断框架：

- 定义 `BasaltDiagnostic` JSON 契约。
- `links check` 与 `lint --rules links` 共享同一诊断产物。
- 人读输出与 JSON 输出都按 `file` / `line` / `column` 稳定排序。
- exit code：error 非 0；warning 是否阻断留给 CI 阶段配置。

### 3.4 P3-P5 延后范围

- P3 `profile/schema`：在 `.x-basalt/config.*` 声明文档元数据约束，首版轻量 DSL，不承诺完整 JSON Schema。
- P4 CI / baseline：等诊断 JSON 稳定后再加 `--ci`、`--format github`、`--baseline`。
- P5 rewrite/fix：默认 dry-run；只有 `--apply` 落盘；不自动猜业务语义。

### 3.5 明确不做

- 不引入 Obsidian 运行时、`obsidian` npm 包、`obsidian://`、Electron、Puppeteer 或 Playwright。
- 不在首版检查外部 HTTP URL 可达性。
- 不在首版支持完整 CommonMark reference link 全量变体。
- 不把某个业务 profile 写死进 x-basalt 内核。
- 不让 `lint --fix` 自动判断语义状态，例如把 `unknown` 改成 `deprecated`。

## 4. Parser 链接节点契约

### 4.1 共同位置字段

所有链接类节点共享以下位置字段：

```ts
interface SourceSpan {
  line: number; // 1-based 完整文件行号，包含 frontmatter 行
  column: number; // 1-based UTF-16 code unit 列
  raw: string; // 原始匹配文本，例如 "[[Note|别名]]" 或 "[text](../a.md)"
}
```

采用完整文件行号的理由：编辑器、CI annotation、GitHub workflow command 都按完整文件定位。现有 task/blockRef/inlineField 的正文行号保持不变，避免破坏已落库语义；链接节点是新契约，直接用完整文件行号。

### 4.2 Wikilink / embed

现有节点扩展为：

```ts
type WikilinkNode = {
  type: "wikilink";
  target: string;
  alias?: string;
  heading?: string;
  blockId?: string;
  embed: boolean;
  line: number;
  column: number;
  raw: string;
};
```

解析语义沿用 `biz-obsidian-spec`：

- 支持 `[[Note]]`、`[[Note|Alias]]`、`[[Folder/Note]]`、`[[Note#Heading]]`、`[[Note#^block-id]]`。
- `![[...]]` 作为 `embed: true`；资源 vs 笔记仍由 indexer / path 工具判断，parser 不区分。
- `target` 不含 `#heading` / `#^blockId` / `|alias`。
- `raw` 包含前缀 `!`，例如 `![[asset.png]]`。

去重规则需要调整：现有 wikilink 会按 target+anchor+embed 去重。P0 后，parser 作为诊断源必须保留每一次出现，否则 links check 无法报告同一坏链的多个位置。索引层若仍需去重，应在 indexer 写 `links` 表时按原规则去重，不能让 parser 丢诊断信息。

### 4.3 Markdown link / image link

新增节点：

```ts
type MarkdownLinkNode = {
  type: "markdownLink";
  text: string;
  target: string;
  title?: string;
  image: boolean;
  line: number;
  column: number;
  raw: string;
};
```

首版只覆盖 inline link：

```markdown
[text](../a.md)
![alt](../asset.png)
[text](../a.md "title")
```

边界：

- `image: true` 表示 `![alt](...)`。
- `target` 保留括号内目标文本的路径部分，不含 title。
- 外部 URL、mailto、anchor-only link 仍产出节点，交给 links check 判断是否跳过。
- Reference link 如 `[text][id]`、`[id]: target` 暂不产出节点，列入后续 CommonMark 扩展。
- 嵌套括号、转义括号首版采用保守解析；解析失败时不产出节点，不猜测。

### 4.4 代码区域屏蔽

链接提取必须复用或推广现有 `maskCode` 思路：

- fenced code block 内不产出链接节点。
- 行内代码内不产出链接节点。
- 掩码必须等长保留换行与列位置，确保 `line` / `column` 可回指原文。

## 5. Links 目标解析

### 5.1 Markdown 相对链接

Markdown link 按当前文件所在目录解析相对路径：

- `./a.md`、`../a.md` 指向 vault 内文件。
- 省略扩展名时首版可尝试 `.md`，但必须在 issue `reason` 中保留原始 target。
- 图片目标允许常见附件扩展名，是否是资源由路径存在性决定。
- 反斜杠路径 `..\a.md` 报 `backslash_path`，可建议替换为 `/`。
- 解析后逃出 vault 根目录报 `outside_vault`。

### 5.2 Wikilink / embed

wikilink 按 Obsidian 语义查找：

- `[[Note]]` 优先按 basename 匹配 `.md`。
- `[[Folder/Note]]` 按 vault 相对路径匹配，可补 `.md`。
- `[[asset.png]]` / `![[asset.png]]` 允许匹配附件文件。
- `#Heading` 和 `#^blockId` 的精确校验后置；首版只要求文件目标存在，锚点校验列 P1.5/P2。
- basename 多命中报 `ambiguous_target`，不自动修。

### 5.3 Suggest 排序

建议算法保持可解释：

```text
取 target basename
  -> 在 vault 内找同名或同 stem 文件
  -> 唯一命中：给出相对当前文件的建议
  -> 多命中：按同目录、同上级目录、README/index、路径短优先排序
```

suggest 只产出候选，不写文件；rewrite/fix 阶段才允许把建议变更落盘。

## 6. BasaltDiagnostic 契约

诊断（`BasaltDiagnostic`）是诊断结果，不是 AST 节点。

```ts
type BasaltDiagnosticSeverity = "error" | "warning" | "info";

interface BasaltDiagnostic {
  file: string; // vault 相对路径
  line: number; // 1-based 完整文件行号
  column: number; // 1-based UTF-16 code unit 列
  rule: string; // 例如 "links/no-missing-target"
  severity: BasaltDiagnosticSeverity;
  message: string;
  target?: string; // 原始链接目标
  reason?: string; // 机器可读原因，例如 "not_found"
  suggestions?: string[];
  fixable: boolean;
}
```

首批 links reasons：

- `not_found`
- `outside_vault`
- `backslash_path`
- `ambiguous_target`
- `tmp_path`
- `unsupported_reference_link`
- `external_skipped`

JSON 字段一旦进入 CI 就是长期 API。P1 曾把该接口放在 `src/links/` 内部模块（名为 `BasaltIssue`）；P2 提升为**公共稳定契约**并冻结为 `lint --format json` 的稳定输出，`links check` 与 `lint --rules links` 共用。

> **P2 命名决策（2026-07-22）**：`BasaltIssue` → **`BasaltDiagnostic`**（`BasaltIssueSeverity` → `BasaltDiagnosticSeverity`）。理由：① 与本仓工具链（oxc/oxlint 的 `OxcDiagnostic`）及 LSP / TypeScript 的 `Diagnostic` 对齐——本契约字段形状（`file`/`line`/`column`/`severity`/`rule`/`message`）即 LSP `Diagnostic`；② 规避与 GitHub Issue 撞词（P4 规划 `--format github` annotation，撞词面真实）。规则 id（如 `links/no-broken-link`）、severity 取值、字段名均不变，仅换承载名词；`reason` 冻结为 `string`（机器可读原因，links 侧仍产 `not_found` 等字面量，为 P3 metadata 规则的 reason 留出共用空间）。公共契约真相源落 `src/diagnostic.ts`（中立叶子，对齐 `src/config.ts`/`src/format.ts`），`src/links/types.ts` re-export 保后向兼容。

## 7. Ignore 配置语义

ignore 必须在 links check 首版就存在，否则真实 vault 会被历史附件和生成目录淹没。

建议配置：

```yaml
lint:
  ignore:
    paths:
      - ".tmp/**"
      - "dist/**"
    targets:
      - "http://*"
      - "https://*"
      - "mailto:*"
    rules:
      links/no-missing-target:
        - "legacy/**"
```

语义：

- `paths` 忽略被检查文件。
- `targets` 忽略目标字符串。
- `rules.<rule>` 只对特定 rule 忽略指定文件或目标模式。
- ignore 命中后不产出 issue；调试模式可后续加 `--show-ignored`，首版不承诺。

## 8. Profile/schema v1

profile/schema 是 metadata lint 的配置，不替代现有 `meta profile` 写侧模板。

```yaml
profiles:
  llm-wiki:
    include: "docs/**/*.md"
    required: ["type", "title", "description", "tags"]
    enums:
      type: ["index", "guide", "design", "spec", "decision", "research", "plan"]
    tagRules:
      require: ["x-basalt"]
      byType:
        design: ["design"]
        research: ["research"]
    domain:
      fromPath:
        docs/specs: spec
        docs/research: research
    ignore:
      - "docs/archive/**"
```

首版只承诺轻量 DSL：

- `include`
- `required`
- `enums`
- `tagRules.require`
- `tagRules.byType`
- `domain.fromPath`
- `ignore`

不承诺完整 JSON Schema，不做类型系统强制，不做日期格式统一。需要更强 schema 时再单独调研扩展。

## 9. 命令面草案

P1：

```bash
x-basalt links check --vault <vault> --format json
x-basalt links suggest --vault <vault> <file>
```

P2：

```bash
x-basalt lint --vault <vault> --rules links --format json
x-basalt lint --vault <vault> --rules links,metadata
```

P3：

```bash
x-basalt lint --vault <vault> --profile llm-wiki
```

P4：

```bash
x-basalt lint --vault <vault> --profile llm-wiki --ci --format github
x-basalt lint --vault <vault> --profile llm-wiki --baseline .x-basalt/lint-baseline.json
```

P5：

```bash
x-basalt links rewrite --from old.md --to new.md --apply
x-basalt lint --rules links --fix --apply
```

写动作边界沿用项目现有纪律：默认 dry-run，`--apply` 才落盘；Markdown 文件写入必须复用 `src/meta/` 或同等原子写边界，不能散落 `fs.writeFile`。

## 10. 测试计划

### 10.1 Parser P0

必须覆盖：

- wikilink line/column/raw：首行、frontmatter 后、行中多个链接。
- embed line/column/raw：`![[asset.png]]`。
- Markdown link / image link：相对路径、title、外部 URL。
- 代码块与行内代码负例。
- 同一坏链多次出现必须保留多节点。
- 超长行 ReDoS 对抗。

### 10.2 Links P1

必须覆盖：

- Markdown link 存在 / 缺失 / escape vault。
- Wikilink basename 命中 / 多命中 / 不存在。
- Embed 资源存在 / 不存在。
- `backslash_path` 建议。
- ignore paths / targets / rule-specific ignore。
- JSON issue 稳定排序。

### 10.3 Lint/Profile P2-P3

必须覆盖：

- `links check` 与 `lint --rules links` 产出同构诊断（`BasaltDiagnostic`）。
- required 缺字段。
- enum 非法值。
- tagRules 缺 tag。
- profile include/ignore 命中边界。

## 11. 阶段切口

1. **P0 parser 定位契约**：改类型、提取器、parser 测试；不改 CLI。✅ 已落地：wikilink/embed 带完整文件 `line`/`column`/`raw`，新增 `markdownLink` 节点，代码区链接不产出，indexer 维持 links 表去重。
2. **P1 links check/suggest**：新增 links 模块与 CLI；输出内部 issue JSON。✅ 已落地（`src/links/` 内存 per-run 白名单集合；`[vault...]` 位置参数对齐 index/scan；`lint.ignore` 配置；锚点 / `tmp_path` 后置——见 [`../plans/2026-07-09-kb-compiler-links-check.md`](../plans/2026-07-09-kb-compiler-links-check.md)）。
3. **P2 统一诊断契约 + lint 壳**：把 `BasaltIssue` 更名为 `BasaltDiagnostic` 并冻结为公共稳定契约（落 `src/diagnostic.ts`），让 `links check` 与 `lint --rules links` 共用同一诊断模型（不再 links 私有）。
4. **P3 profile/schema**：接 `.x-basalt/config.*` 的轻量 DSL。
5. **P4 CI/baseline**：GitHub annotation 与 baseline。
6. **P5 rewrite/fix**：有限机械修复，默认 dry-run。

## 12. 真相源同步

P0 实现同步项：

- `docs/plans/2026-07-09-kb-compiler-parser-position.md`：实现切口与验收。✅
- `docs/specs/2026-06-26-coverage-matrix.md`：新增 links/parser 定位覆盖项。✅
- `skills-def/biz-obsidian-spec/SKILL.md`：补链接位置契约与 Markdown link 节点。✅
- `skills-data/obsidian-base-spec.json5` 或相关运行时 skill：按需补 parser 能力说明。✅
- `docs/guides/commands.md`：parse 输出说明已补链接定位；links check CLI 等 P1 存在后再补命令说明。

## 13. 开放问题

- Markdown link title 解析是否需要完整支持转义引号；P0 可先保守解析。
- Heading slug 精确校验是否进入 P1，还是 P1.5；建议后置，因为 Obsidian heading slug 兼容细节较多。
- `column` 是否长期承诺 UTF-16 code unit；建议先显式承诺，未来如需 grapheme column 再加新字段，不改变旧字段。

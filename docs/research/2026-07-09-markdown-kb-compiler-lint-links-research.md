---
type: research
title: Markdown knowledge base compiler：lint / links / profile 深度调研
description: 调研 Markdown lint、links check、frontmatter schema、CI 诊断等生态后，为 x-basalt 提出的 KB compiler 分层路线与优先级建议
tags:
  - research
  - kb-compiler
  - lint
  - links
  - profile
  - ci
timestamp: 2026-07-09T05:13:42Z
sha256: 3e045c6f4fed647539b65ae4700d5d726ab07c01c9a632280b94b47399f752d5
---
# Markdown knowledge base compiler：lint / links / profile 深度调研

> 日期：2026-07-09
> 状态：调研结论，供后续 spec / plan 取舍使用

## 结论

x-basalt 下一阶段不应直接从“大而全 `lint` 子命令”开做，而应先补齐一条更稳的能力链：

```text
Markdown/Obsidian 源文档
  -> 带位置的结构化节点
  -> 统一诊断 Issue
  -> links check / suggest
  -> metadata lint
  -> profile/schema
  -> CI / baseline / rewrite
```

一句话：先让 x-basalt 看得清“文档里第几行第几列是什么”，再谈“规则是否违反、能不能给建议、是否允许自动改”。

这条路线把 x-basalt 从“Obsidian vault 查询器”推进为“Markdown knowledge base compiler”：兼容 Obsidian 语法，输出结构化索引，并用项目 profile 检查工程文档约束，但默认不替人做语义判断。

## 外部生态调研

### Markdown lint：规则引擎而不是临时脚本

`markdownlint` 把 Markdown 检查定义为静态分析规则：输入 Markdown，输出规则违规。它还支持可自动修复规则通过 `fixInfo` 描述修复信息，再由统一的 apply fixes 逻辑执行。

调研依据：

- markdownlint：Node.js Markdown style checker，规则库用于维护标准和一致性；自动修复规则带 `fixInfo`。<https://github.com/DavidAnson/markdownlint>
- GitHub Docs content linter：基于 markdownlint 框架，叠加自定义规则，检查 Markdown 内容并在可行时自动修复。<https://docs.github.com/en/contributing/collaborating-on-github-docs/using-the-content-linter>
- GitLab Docs：`docs-lint` 使用 markdownlint 捕获文档风格偏差。<https://docs.gitlab.com/development/documentation/testing/markdownlint/>

对 x-basalt 的启发：

- `lint` 应是规则执行框架，不是一组散落脚本。
- 每条规则应产出统一 Issue，而不是直接打印自由文本。
- `--fix` 不能先行；必须等 Issue 模型和修复边界稳定后再加。

### AST / position：可修复性的前提

remark/unified 生态把 Markdown 当作结构化 AST 处理；unist 规范把节点位置抽象为 `position.start/end`，包含 line/column。vfile 则把 lint message 附着到文件和位置上。

调研依据：

- remark：Markdown processor，插件检查和变换 Markdown 结构化树。<https://remark.js.org/>
- unist：通用语法树规范，Position 表示节点在源文件中的位置。<https://github.com/syntax-tree/unist>
- unified syntax tree guide：解析出的语法树可携带 `position` 字段。<https://unifiedjs.com/learn/guide/syntax-trees-typescript/>
- vfile：虚拟文件格式，支持给文件中特定位置附着 lint messages / errors。<https://unifiedjs.com/explore/package/vfile/>
- vfile-message：message 有 `place`、`ruleId`、`source` 等字段。<https://github.com/vfile/vfile-message>

对 x-basalt 的启发：

- “坏链数量”不够，必须报出 `file + line + column + raw + target`。
- 当前 parser 已给 `task` / `blockRef` / `inlineField` 行号，但 `wikilink` 没有 line/column，Markdown 普通链接也未建模；这应排在 `lint` 前。
- 位置契约应进入 parser 公共类型，而不是只在某个 links 命令里临时计算。

### Links check：文档站生成器已经把坏链当构建问题

Docusaurus、MkDocs 等文档站工具都把 broken links 作为构建期诊断。Docusaurus 默认对 broken links 抛错；MkDocs 提供 validation 配置，并支持 strict 模式让 warning 在持续测试中升级为错误。

调研依据：

- Docusaurus `onBrokenLinks`：检测 broken link，默认 throw，避免发布坏链。<https://docusaurus.io/docs/api/docusaurus-config#onBrokenLinks>
- Docusaurus Markdown links：区分 URL path 和 file path，相对文件路径按当前文件目录解析。<https://docusaurus.io/docs/markdown-features/links>
- MkDocs validation：对 nav/link 的 not_found、anchors、absolute_links 等配置 `warn/info/ignore`，`warn` 可在 `mkdocs build --strict` 中变成错误。<https://www.mkdocs.org/user-guide/configuration/#validation>
- markdown-link-check：支持通过 `ignorePatterns` 跳过特定链接。<https://github.com/tcort/markdown-link-check>

对 x-basalt 的启发：

- `links check` 应先覆盖本地 vault 内链，不急着做外部 HTTP 检查。
- 输出需要定位和 reason：`not_found`、`outside_vault`、`tmp_path`、`backslash_path`、`ambiguous_target`。
- ignore 不是附加项，而是工程文档必需项：历史附件、外部 PDF、废弃目录、生成目录都可能需要豁免。

### Obsidian links：x-basalt 的差异化价值

Obsidian 官方文档说明内部链接可指向 notes、attachments、其他文件；默认生成 Wikilink，也可关闭 Wikilinks 改用 Markdown links。Obsidian 还会在重命名文件时自动更新内部链接。

调研依据：

- Obsidian Internal links：支持链接到 notes、attachments、其他文件；可自动更新内部链接；默认 Wikilink，可改用 Markdown links。<https://obsidian.md/help/links>

对 x-basalt 的启发：

- 普通 Markdown 检查器不理解 `[[Note]]` / `![[asset.png]]` / `[[Note#Heading]]` / `[[Note#^block]]`。
- x-basalt 的核心价值不是替代 markdownlint，而是把 Obsidian link 语义和工程文档约束放进同一个本地 CLI。
- rewrite 能力可以参考 Obsidian 的“重命名自动更新链接”，但 x-basalt 必须保持 CLI 可审计：默认 dry-run，只有 `--apply` 才落盘。

### Frontmatter schema：项目文档需要强约束

Astro Content Collections 用 Zod schema 约束 collection 的 frontmatter / entry data；如果文件违反 schema，会给出错误。`remark-lint-frontmatter-schema` 则把 Markdown frontmatter YAML 对齐到 JSON Schema 校验。

调研依据：

- Astro Content Collections：schema 通过 Zod 约束 frontmatter 或 entry data，让数据可预测，并生成 TypeScript 类型。<https://docs.astro.build/en/guides/content-collections/#defining-the-collection-schema>
- remark-lint-frontmatter-schema：用 JSON Schema 校验 Markdown frontmatter。<https://github.com/JulianCataldo/remark-lint-frontmatter-schema>
- GitHub Docs YAML frontmatter：frontmatter 用来定义版本、元数据、文章布局等。<https://docs.github.com/en/contributing/writing-for-github-docs/using-yaml-frontmatter>

对 x-basalt 的启发：

- `meta profile` 和 `lint profile/schema` 必须分层：前者是写侧模板和字段说明，后者是机器校验约束。
- `cmdb-doc` 这类项目规则应放配置，不应写死进 x-basalt 内核。
- schema 第一版应是轻量 DSL，而不是直接承诺完整 JSON Schema 支持；后续如确有需求再考虑兼容 JSON Schema。

### CI 输出：稳定格式比漂亮文本重要

GitHub Actions workflow commands 支持把 error/warning 关联到具体文件和行，SARIF 则是静态分析结果交换格式。

调研依据：

- GitHub Actions workflow commands：`::error file=...,line=...::message` 可生成文件/行级 annotation。<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands>
- SARIF 2.1.0：静态分析结果交换格式标准。<https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html>

对 x-basalt 的启发：

- `--format github` 可以是早期 CI 友好输出。
- `--format sarif` 可以列入后置 backlog，不必第一期承诺。
- JSON 输出字段一旦进入 CI 就是长期 API，必须先冻结 Issue 模型。

## 概念分层

### 1. 带位置的结构化节点

这是 parser 产物，不是 lint 产物。

示例：

```json
{
  "type": "wikilink",
  "raw": "[[Index|首页]]",
  "target": "Index",
  "alias": "首页",
  "line": 18,
  "column": 12
}
```

它回答：“文档里有什么，在哪里？”

### 2. Issue

Issue 是诊断结果，不等于 AST 节点。

示例：

```json
{
  "file": "docs/a.md",
  "line": 18,
  "column": 12,
  "rule": "links/no-missing-target",
  "severity": "error",
  "message": "链接目标不存在：../x.md",
  "target": "../x.md",
  "reason": "not_found",
  "suggestions": ["../../x.md"],
  "fixable": false
}
```

它回答：“哪里违反了什么规则，严重程度如何，能否建议修复？”

### 3. links check

links check 是一组规则，专门检查链接目标。

第一版应覆盖：

- Markdown 相对链接：`[text](../a.md)`
- Markdown 图片：`![alt](../a.png)`
- Obsidian wikilink：`[[Note]]`
- Obsidian embed：`![[asset.png]]`
- 反斜杠路径提示：`..\a.md`
- `.tmp/` 和未托管临时文件链接

第一版不建议覆盖：

- 外部 HTTP URL 可达性
- 复杂 heading slug 兼容
- 所有 Markdown reference link 变体

### 4. links suggest

links suggest 是 links check 的辅助器，不是写入器。

算法先保持简单：

```text
取 target basename
  -> 在 vault 内找同名文件
  -> 唯一命中则给相对路径建议
  -> 多命中按同 domain、同目录近邻、README/index 排序
```

它回答：“如果这个链接错了，最可能应该指向哪里？”

### 5. profile/schema

profile/schema 是“这类文档应该长什么样”的配置。

示例：

```yaml
profiles:
  cmdb-doc:
    include: "docs/**/*.md"
    required:
      - title
      - type
      - status
      - doc_domain
      - tags
    enums:
      status: [unknown, active, deprecated, draft]
      type: [doc, design, api, index, history, prototype, rfc]
    tagRules:
      require: ["cmdb-doc"]
      byStatus:
        deprecated: ["deprecated"]
        draft: ["draft"]
    domain:
      fromPath:
        architecture: root
```

它回答：“这篇文档的 frontmatter 是否符合项目约束？”

### 6. rewrite/fix

rewrite/fix 是写文件，不是检查。

边界：

- `lint` 默认只报告。
- `links rewrite` 默认 dry-run。
- 只有 `--apply` 才落盘。
- 不自动猜业务语义，例如不把 `unknown` 自动改成 `deprecated`。
- frontmatter 写入仍应复用 `src/meta/` 的写侧内核。

## 对 x-basalt 的路线建议

### P0：parser 定位契约

目标：让 Obsidian/Markdown 链接节点具备 `line`、`column`、`raw`。

范围：

- 扩展 `ObsidianNode` 的 wikilink 节点位置字段。
- 新增 Markdown link / image link 节点，或以独立 `MarkdownLinkNode` 输出。
- 明确行号是否相对正文还是完整文件；建议 links 用完整文件行号，便于编辑器和 CI 对齐。

验收：

- `parse` 输出的链接节点可定位到源文件原文。
- 代码块 / 行内代码内链接不会误报。

### P1：links check / suggest

目标：给出本地链接的可定位诊断和相对路径建议。

范围：

- 检查 vault 内相对 Markdown link。
- 检查 wikilink / embed 目标是否存在。
- 支持 ignore 配置。
- 输出 JSON issue。

验收：

- 能定位坏链文件、行、列。
- basename 唯一命中时能给出建议。
- 多命中时不自动修，只排序给建议。

### P2：统一 Issue 模型与 `lint` 壳

目标：把 links 和 metadata 检查统一成一个诊断框架。

范围：

- 定义稳定 `BasaltIssue`。
- `x-basalt lint --rules links,metadata --format json`。
- 人读输出按 file/line 排序。
- error 时 exit code 非 0；warning 是否失败由后续 CI 配置决定。

验收：

- `links check` 与 `lint --rules links` 共享同一 issue 模型。
- JSON 输出可被测试快照锁住。

### P3：仓库级 profile/schema

目标：让项目在 `.x-basalt/config.*` 声明文档约束。

范围：

- `profiles.<name>.include`
- `required`
- `enums`
- `tagRules.require`
- `tagRules.byStatus`
- `domain.fromPath`
- `ignore`

验收：

- `x-basalt lint --profile cmdb-doc` 能检查 docs 类文档。
- 规则不写死 CMDB / x-basalt 专有字段。

### P4：CI / baseline / github format

目标：进入持续集成，但不一次性阻断历史债。

范围：

- `--ci`
- `--format github`
- `--baseline <file>`
- severity 配置

验收：

- GitHub Actions 能按文件/行展示 annotation。
- baseline 里的历史 issue 不阻断新 issue。

### P5：rewrite / fix

目标：把明确安全的修复变成可确认写动作。

范围：

- `links rewrite --from old.md --to new.md --apply`
- `lint --fix` 仅处理机械修复：反斜杠转 `/`、唯一建议路径替换、tags 标量转数组等。
- 语义字段不自动改。

验收：

- dry-run 输出 diff 或 planned changes。
- `--apply` 复用原子写入边界。

## 不建议做的事

- 不把 `cmdb-doc` 写死成内置唯一 profile。
- 不在第一版支持完整 JSON Schema。
- 不默认检查外部 HTTP URL 可达性。
- 不自动判断文档语义状态。
- 不把 rewrite 混在 check 默认流程里。
- 不引入 Obsidian 运行时、GUI / 浏览器自动化栈或 Obsidian URI 协议。

## 推荐新增设计文档

后续进入实现前，建议新增 spec：

```text
docs/specs/2026-07-09-kb-compiler-lint-links-design.md
```

该 spec 至少冻结：

- parser link node 定位字段
- `BasaltIssue` JSON schema
- links target resolution 规则
- ignore 配置语义
- profile/schema DSL v1
- `--fix` / `--apply` 写入边界

## 建议优先级

| 优先级 | 能力 | 原因 |
| --- | --- | --- |
| P0 | AST 定位 | 没有位置就没有可修复诊断 |
| P1 | links check / suggest | dogfood 收益最高，且最体现 Obsidian 差异化 |
| P2 | Issue 模型 + lint 壳 | 为 metadata、CI、chat 共用诊断语言 |
| P3 | profile/schema | 解决 docs 工程约束，但 API 承诺较重 |
| P4 | CI / baseline | 等 JSON 稳定后再承诺 |
| P5 | rewrite/fix | 最容易误改文件，必须最后做 |

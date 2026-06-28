# 元数据策略（profile）调研：derive 功能设计依据

> 日期：2026-06-28 · 来源：deep-research run `wf_d56251ed-15e`（5 角度 fan-out + 对抗式核验，23 源 / 113 声明 / 25 核验 / 18 confirmed）
> 用途：为 meta 写侧 Phase 3「derive = 元数据策略/profile 幂等补缺」选首批内置 profile 与字段定型。
> 关联：[`../plans/2026-06-28-meta-frontmatter-write.md`](../plans/2026-06-28-meta-frontmatter-write.md)、[`../specs/2026-06-28-meta-subset-frozen.md`](../specs/2026-06-28-meta-subset-frozen.md)。

## 头号结论

1. **业界不存在跨体系的「必填字段共识」**。最具约束力的 Google **OKF v0.1** 也只把 `type` 列为唯一必填；Karpathy 原始「LLM Wiki」gist **不规定任何 frontmatter 字段**（明文「intentionally abstract … everything optional and modular」）——社区流传的 `type/title/description/...` 字段集是社区叠加，非作者规定。
   - → **不能拿 Karpathy gist 当 profile 蓝本；应以 OKF v0.1 为 LLM 风格 profile 的权威来源。**
2. 这反而给 x-basalt 留足空间：自定义几套 profile、把「必填」理解为**「本 profile 的语义锚点 + apply 补缺/校验依据」**，而非某引擎强校验。
3. **幂等补缺模型现成可借**：Jekyll `_config.yml` defaults「已有值不覆盖、缺的补」正是我们要的；x-basalt 已有 YAML 往返保真 + 原子写，落地只差「profile 声明 + 按声明驱动补缺」。

## 自动补 vs 人工（核验过）

| 可自动推导 | 规则 / 坑 |
|---|---|
| `title` | 文件名去扩展名、分隔符→空格、首字母大写（OKF 明文允许从文件名派生）。**坑**：CJK/多语言文件名分词与大小写无通用规则，需显式策略 |
| `created` | `fs.stat().birthtime`。**坑**：部分 Linux 文件系统 birthtime 不可靠 → 回退 `mtime` |
| `modified`/`updatedDate`/`timestamp` | `fs.stat().mtime` |
| `slug` | 文件名去扩展名、保连字符 |
| `sha256` | 仅对**正文**（闭合 `---` 之后）hash，用于 drift 检测（社区实践，无 spec 级权威，medium 置信）|
| `wordcount`/`reading_time` | 正文字数 |
| `aliases` | 可把文件名作初始项 |
| `backlinks`/`outlinks` | x-basalt 索引已能算（但写回会与索引重复，谨慎）|
| **必须人工** | `description`（agent 判相关性的入口，需语义理解）、`author`、`category`/`type`、`status`、`resource` |

## 体系冲突（profile 必须显式标注，不可调和）

- **日期格式**：ISO 8601 字符串（`YYYY-MM-DD` / RFC3339）vs **Dendron 的毫秒 Unix 数值**（如 `1639425310320`）。→ **derive 写日期一律用 ISO 字符串，绝不写数值时间戳**（否则 Obsidian/SSG 解析不了）。
- **标题字段名**：多数体系 `title` vs **schema.org `headline`**。
- **日期语义**：多数 SSG 单一 `date` 入口 vs schema.org 三字段 `datePublished/dateModified/dateCreated`。
- **不要硬编码 Obsidian 日期格式**：「Obsidian Date 固定 ISO 8601」声明被 **0-3 驳回**（实际更宽松/有版本差异）→ 日期格式应由 profile 配置。

## 建议首批内置 3 套 profile

### A. `llm-wiki`（基于 OKF v0.1）— LLM/agent 导向（你的头号需求）

| 字段 | 角色 | 类型 | 自动补 |
|---|---|---|---|
| `type` | **必填（唯一）** | string | 人工 / 按文件夹规则 |
| `title` | 推荐 | string | ✅ 文件名 |
| `description` | 推荐（agent 相关性入口）| string 单句 | ❌ 人工 |
| `resource` | 推荐 | url | ❌ 人工 |
| `tags` | 推荐 | list | 半自动 |
| `timestamp` | 推荐 | datetime(ISO 串) | ✅ fs mtime |
| `sha256`（扩展）| 可选 | string | ✅ 正文 hash（drift）|

> OKF 仍是 **Draft（2026-05）**，profile 文件需**版本锁定**、随 spec 演进。

### B. `ssg-blog`（基于 Astro content collections）— 发布博客导向

| 字段 | 角色 | 类型 | 自动补 |
|---|---|---|---|
| `title` | 必填（锚点）| string | ✅ 文件名（初值）|
| `pubDate` | 必填 | date(ISO) | ✅ birthtime（回退 mtime）|
| `description` | 必填 | string | ❌ 人工 |
| `updatedDate` | 可选 | date(ISO) | ✅ mtime |
| `draft` | 可选 | bool | 默认 `false` |
| `tags` | 可选 | list | — |
| `slug` | 可选 | string | ✅ 文件名 |

### C. `pkm-note`（基于 Obsidian 官方 + 社区惯例）— 笔记导向

| 字段 | 角色 | 类型 | 自动补 |
|---|---|---|---|
| `tags` | 核心 | list | — |
| `aliases` | 核心 | list | ✅ 文件名（初值）|
| `cssclasses` | 可选 | list | — |
| `created` | 可选 | datetime(ISO 串) | ✅ birthtime |
| `modified` | 可选 | datetime(ISO 串) | ✅ mtime |
| `status` | 可选 | enum | ❌ 人工 |

> Obsidian 官方核心 property 仅 `tags/aliases/cssclasses`（List）；`description/publish/permalink/image/cover` 属 Obsidian Publish 扩展，非核心。Dendron 已停维（2023），仅作格式反例（Unix 时间戳）参考。

## apply（幂等补缺）落地模型

`meta apply <profile> <file>`：读现有 fm → 遍历 profile 字段：**已有 → 跳过；缺 + 可推导 → 推导填入；缺 + 需人工 → 占位/报告**（决策见下）→ 原子写回 → 报告「补了 X，仍缺人工项 Y」。复用 Phase 1/2 全部安全机制（往返保真、原子写、非法 YAML 拒写、dry-run、幂等）。profile 定义为数据（json5/yaml）：有序字段列表 `{key, role, type, default, derive: <source>|none}`。

## 待定决策（转设计前需拍板）

1. **缺的人工字段**：apply 时是**插入空占位**（`description:` 空值，让用户看到要填啥）还是**只报告不插**（保持 fm 干净）？
2. **多 profile 字段冲突**：同一文档既 llm-wiki 又 pkm（`timestamp` vs `created/modified`）——MVP 先**单 profile 隔离**（一次套一套），跨 profile 别名映射后置？
3. **首批做几套**：3 套全做，还是先做 `llm-wiki` 一套（你的头号需求）验证模型再扩？
4. **sha256/backlinks 是否纳入**：drift 检测有用但无 spec 权威；backlinks 写回与索引重复——是否进首版？

## 开放问题（记录）

- OKF Draft 正式发布后字段集/conformance 可能变 → profile 版本演进策略。
- title 从文件名派生的中文/多语言规则未定。
- 跨 profile 命名空间 vs 别名映射的长期取向。

## 来源（精选）

- [Karpathy LLM Wiki (gist)](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)（primary）
- [Google Open Knowledge Format SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)（primary）
- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)、[Hugo front matter](https://gohugo.io/content-management/front-matter/)、[Jekyll front matter defaults](https://jekyllrb.com/docs/configuration/front-matter-defaults/)（primary）
- [Dublin Core DCMI Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)、[schema.org/Article](https://schema.org/Article)、[Pandoc](https://pandoc.org/MANUAL.html)（primary）
- [Obsidian Properties](https://help.obsidian.md/properties)、[Dendron frontmatter](https://wiki.dendron.so/)（primary，Dendron 仅历史参考）

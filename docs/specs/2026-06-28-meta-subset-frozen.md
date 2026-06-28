# meta 子集冻结 · frontmatter 写侧（Phase 1 + 2 + 3）

> 日期：2026-06-28 · 状态：冻结（Phase 1 CRUD + Phase 2 normalize + Phase 3 profile/apply）
> 实现：`src/meta/`（document 往返内核 / operations CRUD / normalize 归一 / profiles+derive+apply 策略 / index 编排+原子写）；CLI `meta` 组。
> 计划：[`../plans/2026-06-28-meta-frontmatter-write.md`](../plans/2026-06-28-meta-frontmatter-write.md)（P1）、[`../plans/2026-06-28-meta-normalize.md`](../plans/2026-06-28-meta-normalize.md)（P2）、[`../plans/2026-06-28-meta-derive-profiles.md`](../plans/2026-06-28-meta-derive-profiles.md)（P3，调研 [`../research/2026-06-28-metadata-profiles-research.md`](../research/2026-06-28-metadata-profiles-research.md)）。
> 测试真相源：`tests/meta-document.test.ts` / `meta-ops.test.ts` / `meta.test.ts` / `meta-adversarial.test.ts` / `meta-normalize.test.ts` / `meta-derive.test.ts` / `meta-apply.test.ts` / `cli.test.ts`(meta 段)。

本文件冻结 x-basalt **写侧**第一期支持的 frontmatter 操作子集——「声称支持」即以本文 + 对应测试为准。

## 命令面

```
meta get   <file> [key] [--format json|yaml]
meta set   <file> <key> <value> [--type string|number|boolean|null|list|auto] [--dry-run]
meta unset <file> <key> [--dry-run]
meta rename <file> <oldKey> <newKey> [--dry-run]
meta normalize <file> [--sort-keys] [--dry-run]              # Phase 2
meta profile list                                            # Phase 3
meta profile show <name> [--format json|yaml]               # Phase 3
meta apply <profile> <file> [--set key=value]... [--dry-run] # Phase 3
```

## 语义（冻结）

| 操作 | 语义 | 缺省/异常 |
|---|---|---|
| `get` | 无 key → 整个 frontmatter 对象；有 key → 该键值 | 缺失键 → 输出 `null`（exit 0）|
| `set` | 键存在 → **原位更新**（保留位置）；不存在 → 追加末尾 | 值经 `--type` 定型 |
| `unset` | 删除键 | 键不存在 → no-op（exit 0，报「无变化」）|
| `rename` | 改键名，**保留位置与值节点（含值上注释）** | 源缺失 → ✗ 报错；目标已存在 → ✗ 报错（不覆盖）|

`--type`（默认 `auto`）：`auto` 仅识别 `true`/`false`→bool、`null`→null、严格 `^-?\d+(\.\d+)?$`→number，**其余按字符串**（刻意不识别 `yes/no/on/off`，规避 YAML 1.1 Norway 陷阱）；`string` 强制字符串；`number`/`boolean` 非法值 ✗ 报错；`list` 按逗号分隔去空白为数组。

### normalize 语义（冻结 · Phase 2）

默认 ON（"让 frontmatter 对 Obsidian 合法有效"的安全归一）：

| 规则 | 语义 |
|---|---|
| 列表属性归一 | `tags`/`aliases`/`cssclasses` → 列表。`tags`/`cssclasses` 标量串按 `/[\s,]+/` 拆；`aliases` 标量当单别名**不拆**；非串标量→单元素；`null` 跳过 |
| 去 `#` | 仅 `tags` 项去前缀 `#`（`#` 起注释会让 frontmatter 标签无效）|
| 去重 | 列表项保序去重；数组中的 `null` 项（如未加引号 `- #x` 被 YAML 弃为 null）丢弃 |
| 单数键迁移 | `tag`→`tags`/`alias`→`aliases`/`cssclass`→`cssclasses`：都在→合并并集删单数；仅单数→原位改名保位置 |

opt-in：`--sort-keys` 顶层键字母序排序（可能动空行，默认 OFF）。normalize 同样幂等、只动 frontmatter、非法 YAML 拒写。

### profile / apply 语义（冻结 · Phase 3）

**模型**：profile = 模板（字段 + 角色/类型/含义）+ 规范文本。x-basalt 只「告知」（`meta profile show`），补不补 / 补什么由消费者（AI/人）决定，**x-basalt 不调 LLM**。

内置 profile（`listProfiles` 顺序即推荐序）：

| profile | 来源 | 机械字段（derive）| 语义字段（消费者）|
|---|---|---|---|
| `pkm-note`（第一推荐）| Obsidian Properties + 社区惯例 | `created`(birthtime,回退mtime) / `modified`(mtime) | tags(rec) / aliases / cssclasses / status |
| `llm-wiki` | Google OKF v0.1（Draft 2026-05）| `timestamp`(mtime) / `sha256`(正文hash) | type(required) / title / description / resource / tags |
| `ssg-blog` | Astro/Hugo/Jekyll 等 SSG | `pubDate`(birthtime) / `updatedDate`(mtime) | title(required) / description(required) / draft / tags / slug |

`meta apply <profile> <file>` 两层语义：

- **机械预填 = 补缺**：仅当机械字段缺失时按 fs 信息填（日期写 **ISO 字符串**，绝不数值时间戳；birthtime 不可靠回退 mtime；sha256 仅算正文）；已有不动。
- **`--set key=value`（可重复）= 显式权威覆盖**：始终写入——覆盖文件已有值与机械预填；值按 profile 声明字段类型转（list 拆逗号、number/bool 保守 auto；profile 外的额外 key 用 auto）。apply 内 `--set` 先写、机械层只补 `--set` 没给的缺。
- 报告 `{ filled, overridden, present, missing(required/recommended/optional) }`；没补的字段不出现（保持干净）。幂等、只动 frontmatter、非法 YAML 拒写、未知 profile 报错列可用名。

## 往返保真规则（冻结）

- **正文逐字节保真**：只动顶部 `---…---` 块；正文（含其中的 `---`、代码块、EOL）原样保留。
- 只认**文件首行起**的 `---`，且需有单独成行的 `---` 闭合；无闭合视为「无 frontmatter」。
- **EOL** 探测（含 `\r\n`→CRLF）用于 frontmatter 块；**BOM** 原样保留在最前。
- 用 `yaml`(eemeli) Document API 序列化：保留键顺序；**注释尽力保留**（不保证——`yaml` trailing-comment 已知 bug、排序类操作可能改空白）；需引号的值（如 `[[X]]`）自动加引号产出合法 YAML；关闭折行（`lineWidth:0`）。
- 无 frontmatter 文件 `set` → 顶部新建 `---…---`，原文整体作正文。
- **幂等**：同一改动连跑两次，第二次「无变化」、字节稳定。
- **原子写**：同目录临时文件 + rename；无字节变化不写盘。
- **非法 YAML 防护**：frontmatter 解析有错时，写操作**拒绝执行并 ✗ 报错**、文件不变。

## 非目标（不做，留后续阶段）

- 嵌套键路径（`a.b`）、inline Dataview 字段（`key:: v`）。
- 批量 / 跨 vault 操作。
- normalize 的高风险/不确定项：**类型强制**、**日期格式统一**（调研：格式不确定）、删空键、空行规整。
- 派生 derive、schema 校验 lint、迁移 migrate。
- 读取 `.obsidian/types.json` / 复现 Obsidian 类型语义（调研：types.json 不全、靠猜测，不可依赖）。

> 维护：命令签名 / `--type` / 往返规则变化时，同步本文、`docs/guides/commands.md`、`usage.md`、自我说明书 skill（`skill-data/x-basalt.json5`）与上述测试，确保互相验证。

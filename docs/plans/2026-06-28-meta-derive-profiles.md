# 元数据写侧 Phase 3：profile（元数据策略）——x-basalt 只「告知」，消费者补

> 日期：2026-06-28 · 主题：维护几套元数据策略（profile = 模板 + 规范）；提供「读规范」的能力，由消费者（AI/人）决定补什么
> 前置：Phase 1（CRUD + 往返内核 + 原子写）、Phase 2（normalize）。
> 调研真相源：[`../research/2026-06-28-metadata-profiles-research.md`](../research/2026-06-28-metadata-profiles-research.md)。

## 核心模型（用户拍板，重写自旧版机械-derive 方案）

**x-basalt 的职责是「告知（tell）」，不是「智能补」。**

- 一套策略 = **模板（一组参数：哪些字段、角色、类型、含义）+ 规范（spec 文本：这套约定是什么、每个字段意思、哪些必填/推荐、可额外补什么）**。
- x-basalt **提供「读这套规范」的能力**（`meta profile show`），把模板+规范亮给消费者。**之后补不补、补什么，是 AI 还是人，x-basalt 一概不管，也不调用任何 LLM**（守零运行时依赖、fs-only）。
- **机械层（确定性、x-basalt 顺手预填）**：只补"无需判断"的字段——`timestamp`(fs mtime)、`sha256`(正文 hash)。
- **智能层（消费者做，x-basalt 不介入）**：`type/title/description/tags/resource` 这些"需要理解文档"的，由消费者读规范后用 `meta set` 自行补；**额外字段**（规范允许的、消费者觉得有必要的）也由消费者加。
- **保持干净**：没补的字段**不出现**（不插空占位）；事后想要哪个，`meta set` 手动加。
- **两种消费场景**：裸调用（人读规范、按判断补）；AI 调用（AI 读文档+规范，顺手把语义字段和额外字段一起补）。x-basalt 对两者一视同仁，只负责告知。

## 内置 profile（3 套全落地）：`pkm-note`（第一推荐）/ `llm-wiki` / `ssg-blog`

x-basalt 本就是 Obsidian 工具，**`pkm-note`（Obsidian）为第一推荐/默认首位**；`llm-wiki`（OKF）、`ssg-blog`（Astro/SSG）为另两套。开发成本极低（加 profile = 加数据 + 几行测试），故 3 套一并落地。

**`pkm-note`（基于 Obsidian 官方 Properties + 社区惯例）**

| 字段 | 角色 | 类型 | 谁补 |
|---|---|---|---|
| `tags` | recommended | list | 消费者 |
| `aliases` | optional | list | 消费者 |
| `cssclasses` | optional | list | 消费者 |
| `created` | recommended | datetime(ISO) | **机械**：fs birthtime（不可靠回退 mtime）|
| `modified` | recommended | datetime(ISO) | **机械**：fs mtime |
| `status` | optional | string | 消费者 |

**`llm-wiki`（基于 Google OKF v0.1, Draft 2026-05）**：`type`(required, 消费者) / `title`/`description`/`resource`/`tags`(recommended, 消费者) / `timestamp`(recommended, **机械** mtime) / `sha256`(optional, **机械** 正文 hash)。

**`ssg-blog`（基于 Astro/Hugo/Jekyll 等 SSG）**：`title`/`description`(required, 消费者) / `pubDate`(required, **机械** birthtime) / `updatedDate`(optional, **机械** mtime) / `draft`/`tags`/`slug`(optional, 消费者)。

> 规范文本（spec）写清每个字段语义 + "允许额外补 X" + 来源版本锁定，供 `meta profile show <name>` 输出给消费者读。

## 实现（纯/IO 分层，复用 Phase 1/2）

```
src/meta/profiles.ts   纯数据：Profile/ProfileField 类型 + 内置 PROFILES（pkm-note 首位 + llm-wiki，含 spec 文本）+ getProfile / listProfiles
src/meta/derive.ts     纯函数：deriveValue(source, ctx) —— birthtime / mtime / sha256-body 三个机械 source（birthtime 不可靠回退 mtime）
src/meta/apply.ts       纯函数：diffProfile(doc, profile) → {present[], missing:{required,recommended,optional}}；
                        prefillTrivial(doc, profile, ctx) → filled[]（仅补缺失机械字段）；
                        applySets(doc, profile, sets) → {filled[], overridden[]}（消费者 key=value，按 profile 字段类型转，显式权威覆盖：缺则补、已有则覆盖）；
                        coerceForProfile(profile, key, raw)（按 profile 声明类型转值，extra key 用 auto）
src/meta/index.ts       applyProfile(file, name, {sets, dryRun})：读文件+fs.stat+split → applySets(显式覆盖) + 机械预填(补缺) → serialize → 原子写 → 返回 {filled, overridden, present, missing}
                        listProfiles()/showProfile(name) 透传 profiles
```

- derive 纯净：`ctx = { birthtime, mtime, body }` 由 index.ts 读 fs 后传入。
- 复用 Phase 1：split/serialize/原子写/非法 YAML 拒写/dry-run/无 frontmatter 新建。
- 幂等：仅填**缺失**的机械字段；已有不动；`timestamp` 第二次因已存在跳过（不因写文件改了 mtime 而漂移）；sha256 对正文稳定。

## CLI

```
x-basalt meta profile list                  # 列出可用 profile
x-basalt meta profile show <name>           # 输出该 profile 的规范+模板（“告知”，给 AI/人读）
x-basalt meta apply <profile> <file> [--set key=value]... [--dry-run]
```

- **`--set key=value`（可重复，即「kwargs」口子）**：消费者（AI 读规范+文档后 / 人按判断）在 apply 时**顺手把语义字段和额外字段一起补进去**，免去逐条 `meta set`。值**按 profile 声明的字段类型自动转**（如 `tags` 是 list → 按逗号拆；number/bool 同 `meta set` 的保守 auto）；profile 里没有的 key（额外字段）按 `auto` 转。
- **两层语义**：
  - **机械预填（created/modified/sha256）= 补缺**：只在字段缺失时填、已有不动（不 clobber）。
  - **`--set` = 显式权威覆盖**：始终写入——**覆盖文件里已有的值、也覆盖机械预填**（apply 内 `--set` 先写、机械层只补 `--set` 没给的缺）。例：`meta apply llm-wiki note.md --set title=abc` 即把 title 覆盖为 abc。
- 幂等：同输入再跑结果一致（机械跳过已有、`--set` 写同值无净变化）。报告区分 filled(新补) / overridden(--set 覆盖了已有) / 仍缺(按 required/recommended/optional)。
- `meta apply` 输出（人读 + 可 --format json）：补入 / 覆盖 / 仍缺分组 + "可额外补"提示 + 指向 `meta profile show` 读完整规范。
- 未知 profile → `✗` 报错并列可用名；非法 `--set`（无 `=`）→ 报错。

## 原子子步（TDD：先 red 后 green）

- [x] **MW3.1 profiles + derive（red→green）**
  - 动作：`profiles.ts`（类型 + llm-wiki 数据 + spec 文本 + getProfile/listProfiles）、`derive.ts`（mtime/sha256-body）；`tests/meta-derive.test.ts`。
  - 验收：mtime→ISO 去毫秒、sha256 对正文 hex；getProfile 未知名报错；listProfiles 含 llm-wiki；profile 字段角色/derive 标注正确。
  - 证据：`pnpm test tests/meta-derive.test.ts`。前置：Phase 1/2。

- [x] **MW3.2 diff + prefill + applySets（red→green）**
  - 动作：`apply.ts` diffProfile（present/missing 分组）+ prefillTrivial（仅补缺失机械字段）+ coerceForProfile（按 profile 类型转值）+ applySets（消费者 kwargs，top-up）；`tests/meta-apply.test.ts`。
  - 验收：present/missing 分组正确；prefill 只补 timestamp/sha256 且已有跳过、不碰语义字段；coerceForProfile 按字段类型（list 拆、number/bool auto、extra key auto）；applySets top-up（已有跳过并记 skipped）、补缺记 filled；二次幂等。
  - 证据：`pnpm test tests/meta-apply.test.ts`。前置：MW3.1。

- [x] **MW3.3 编排 + CLI + 端到端（red→green）**
  - 动作：`index.ts` applyProfile/listProfiles/showProfile；CLI `meta profile list/show` + `meta apply`；扩 `tests/meta.test.ts` + `tests/cli.test.ts`。
  - 验收：apply 真预填落盘、幂等字节稳定、dry-run 不落盘、无 frontmatter 新建、非法 YAML 拒写、未知 profile 退出 1；profile show 输出规范；report 含 missing 分组。
  - 证据：`pnpm test tests/meta.test.ts tests/cli.test.ts`。前置：MW3.2。

- [x] **MW3.4 收口：质量门 + 文档/spec/skill 同步**
  - 动作：typecheck/build/相关测试；commands.md/usage.md 加 profile/apply；meta-subset spec 加该段；自助 skill 同步「让 AI 知道：apply 后读 missing、按 profile show 的规范补语义字段」。
  - 验收：全绿；签名/语义 代码↔文档↔spec↔skill 一致。
  - 证据：`pnpm run typecheck && pnpm test`。前置：MW3.1–MW3.3。

## 风险

- OKF Draft 可能变 → spec 文本标注版本来源，后续更新。
- 机械层刻意只做 timestamp/sha256；title 等不机械派生（交给智能层，质量更好）——符合"太多需要智能层"。
- 规范文本是本期"告知能力"的核心价值，须写到 AI 读了就能正确补全的程度。

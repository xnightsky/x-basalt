---
timestamp: 2026-06-30T00:01:23Z
sha256: b6ed8f861dde474b3fdfc6150a77054ac3ad9d23d04bc88f7a35b04ecf698f1a
type: plan
title: 元数据写侧 Phase 2：normalize（frontmatter 归一）
description: frontmatter normalize 归一规则的实现计划
tags:
  - plan
  - meta
  - normalize
  - x-basalt
---
# 元数据写侧 Phase 2：normalize（frontmatter 归一）

> 日期：2026-06-28 · 主题：在 meta 写侧地基上加「归一/标准化」——`meta normalize`
> 前置：Phase 1（[`2026-06-28-meta-frontmatter-write.md`](2026-06-28-meta-frontmatter-write.md)，往返内核 + CRUD + 原子写已就绪）
> 调研真相源：deep-research run `wf_fb274cf7-cfd`（见 Phase 1 计划「调研结论」）。

## 目标

把"裸/乱"的 frontmatter 归一成对 Obsidian **合法有效**的形态。建立在 Phase 1 的安全往返内核之上（正文逐字节保真、原子写、幂等、非法 YAML 拒写全部复用）。

## 设计决策（保守默认 + opt-in，用户已授权 AI 定）

**默认 ON**（都是"让它对 Obsidian 有效"的安全归一，有明确正确答案）：

1. **保留列表属性归一**：`tags` / `aliases` / `cssclasses` 统一为列表形态。按键分流的拆分规则（关键边界）：
   - `tags`、`cssclasses`：标量字符串按 `/[\s,]+/`（空白或逗号）拆成多项——标签/类名不含空格。
   - `aliases`：标量字符串**当作单个别名，不拆**——别名可含空格（拆了会错）。
   - 非字符串标量（number/bool）→ 单元素列表。null → 跳过（不动）。
   - 已是列表 → 逐项 trim、按下条去 `#`、去重。
2. **去 `#` 前缀**（仅 `tags` 项）：`- #x` → `- x`（YAML `#` 起注释，带 # 的 frontmatter 标签无效）。
3. **去重**：列表项保留首次出现顺序去重。
4. **单数键迁移**：`tag→tags` / `alias→aliases` / `cssclass→cssclasses`（Obsidian 1.9 已移除单数键）。
   - 两者都在 → **合并并集**到复数键（复数原值在前），删单数。
   - 只有单数 → **原位改名**保位置，再按上面归一其值。

**Opt-in（默认 OFF）**：

- `--sort-keys`：顶层键按字母序排序。调研：排序可能副作用动空行，故不默认、并在输出提示。

**明确不做**（风险/不确定，留后续或永不做）：类型强制（无 types.json 不可靠）、日期格式统一（调研：格式不确定）、删空键、空行规整。

## 实现

```
src/meta/normalize.ts   纯函数 normalizeDoc(doc, opts) → {changes: string[]}
                        在 yaml Document 上原位归一；返回应用了哪些变更（供报告）。
```

- 复用 Phase 1：CLI `meta normalize` 经 `editMeta(file, d => { report = normalizeDoc(d, opts) }, {dryRun})` 落盘。
- 列表归一用 `doc.set(key, normalizedArray)`（存在键原位更新保位置）；单数原位改名复用「改 Pair.key 节点」手法。
- **幂等**：第二次跑 normalize 无变更（单数键已迁走、列表已是干净形态）。
- 报告：CLI 打印 changes（人读）；无变更打印「· 已是规范形态」；`--dry-run` 打印将写入内容 + changes。

## CLI

```
x-basalt meta normalize <file> [--sort-keys] [--dry-run]
```

## 原子子步（TDD：先 red 后 green）

- [x] **MW2.1 列表属性归一 + 去 #/去重（red→green）**
  - 动作：`normalize.ts` 的 reserved-list 归一（含 per-key 拆分规则）；`tests/meta-normalize.test.ts`。
  - 验收：tags 标量(空白/逗号)拆+去#+去重；aliases 标量不拆（保留含空格别名）；cssclasses 拆；number 标量→单元素；已是列表逐项清洗；幂等。
  - 证据：`pnpm test tests/meta-normalize.test.ts`。前置：Phase 1。

- [x] **MW2.2 单数键迁移（red→green）**
  - 动作：tag/alias/cssclass → 复数；只有单数→原位改名保位置；两者都在→合并并集删单数。
  - 验收：三组键各自迁移；位置保留；合并去重；与列表归一叠加后幂等。
  - 证据：同上测试文件。前置：MW2.1。

- [x] **MW2.3 --sort-keys（opt-in）+ 报告 + 端到端（red→green）**
  - 动作：sortKeys 选项；normalizeDoc 返回 changes；CLI `meta normalize` 接线 + dry-run + 报告；扩 `tests/cli.test.ts`。
  - 验收：默认不排序；--sort-keys 排序且幂等；报告列出变更；dry-run 不落盘；非法 YAML 拒写复用。
  - 证据：`pnpm test tests/cli.test.ts`。前置：MW2.2。

- [x] **MW2.4 收口：质量门 + 文档/spec/skill 同步**
  - 动作：typecheck/build/相关测试；commands.md/usage.md 加 normalize；更新 meta-subset spec；自助 skill 同步。
  - 验收：全绿；签名/语义代码↔文档↔spec↔skill 一致。
  - 证据：`pnpm run typecheck && pnpm test`。前置：MW2.1–MW2.3。

## 风险

- 单数键迁移是有主张的默认（但 Obsidian 官方已弃单数，迁移=修正）；合并并集可能改变用户原本想分开的语义——以报告明示「合并了 X→Y」。
- aliases 不拆是刻意保守（避免拆碎含空格别名）；若用户确有逗号分隔的多别名，本期不自动拆（留作 opt-in 后续）。

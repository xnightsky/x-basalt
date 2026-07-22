---
type: plan
title: meta 模块实现全记录（Phase 1–3）
description: meta 命令 frontmatter 写侧从读写改造→normalize 归一→profile 元数据策略的三阶段汇总
status: completed
tags:
  - plan
  - meta
  - normalize
  - profile
  - x-basalt
---

# meta 模块实现全记录（Phase 1–3）

> 合并自：Phase 1 `2026-06-28-meta-frontmatter-write`、Phase 2 `2026-06-28-meta-normalize`、Phase 3 `2026-06-28-meta-derive-profiles`
> 冻结规范：`docs/specs/2026-06-28-meta-subset-frozen.md`
> 全部阶段于 2026-06-28 完成落地。

---

## 整体架构

```
src/meta/index.ts        → CRUD + applyProfile / inspectProfile（写侧唯一入口）
src/meta/apply.ts        → diffProfile / prefillTrivial / applySets
src/meta/normalize.ts    → 键名归一、排序
src/meta/profiles.ts     → 内置 profile 定义
src/cli.ts               → meta 子命令组
```

写侧约束：`src/meta/` 是**唯一写 `.md` 的层**，编排器/chat 必须经此写入。

---

## Phase 1 · frontmatter 读写改造（2026-06-28）

### 做了什么

- CLI `meta get/set/unset/rename` 命令
- 内核 `src/meta/index.ts`：
  - `editMeta(file, ops)` — 读 → YAML parse → apply ops → YAML stringify → 原子写
  - `getMeta(file, keys?)` — 读 frontmatter 为对象
- YAML 序列化用 `yaml` 包（gray-matter 仅 parser 仍用）
- 原子写：写临时文件 → rename 覆盖（防崩溃损坏）
- dry-run：`meta set/rename --dry-run` 不落盘
- `--format` 对 get 生效

### 设计决策

| 决策 | 选择 | 原因 |
|---|---|---|
| YAML 库 | `yaml` 包 | 比手写 toYaml 安全（处理冒号/空格/`#` 转义）|
| 日期推断 | 保守 | 不与 Obsidian 100% 一致（无 types.json）|
| trailing-comment | 不保证 | `yaml` 包已知 bug，文档注明"尽力" |

### 对抗

- 路径穿越 → 白名单校验
- 超大 / 深嵌套 anchor 别名炸弹 → YAML parse 有上限
- 恶意值 → 序列化兜住

---

## Phase 2 · normalize 归一（2026-06-28）

### 做了什么

- CLI `meta normalize`
- 单数键迁移：`tag`→`tags`、`alias`→`aliases`、`cssclass`→`cssclasses`
  - 只有单数→原位改名保位置
  - 两者都在→合并并集删单数
- `--sort-keys` opt-in：默认不排序，指定后排序且幂等
- `normalizeDoc` 返回 changes 列表
- dry-run 出报告列出变更

### 设计决策

| 决策 | 选择 |
|---|---|
| 单数键迁移 | 默认执行（Obsidian 官方已弃单数）|
| aliases 合并 | 并集去重，不拆逗号分隔（保守）|
| 排序 | opt-in（默认不排，不强制改变用户习惯）|

### 幂等性保证

两次 `meta normalize` 结果一致（单数键已迁不再迁、已排序不再变）。

---

## Phase 3 · profile 元数据策略（2026-06-28）

### 做了什么

- 三种内置 profile：`pkm-note` / `llm-wiki` / `ssg-blog`
- `src/meta/apply.ts`：
  - `diffProfile(content, name)` → present/missing 分组
  - `prefillTrivial` — 仅补缺失机械字段（`timestamp` / `sha256`），不碰语义字段
  - `applySets` — consumer kwargs top-up，已有跳过并记 `skipped`
- CLI `meta profile list/show` + `meta apply <profile> [files...]`
  - `--refresh-derived` 重算内容派生机械字段
  - dry-run 不落盘
  - 无 frontmatter → 新建
  - 非法 YAML → 拒写

### profile 定义规范

```yaml
# 告知式规范：告诉 AI 该补什么，不是强制校验
profiles:
  pkm-note:
    required: [title, created, tags, status]
  llm-wiki:
    required: [type, title, description, tags]
  ssg-blog:
    required: [title, date, tags]
```

`llm-wiki` 的 sha256/timestamp 由 `prefillTrivial` **机械填充**；title/description/tags 等语义字段暴露为 `missing` 让 AI 补齐。

### 设计决策

| 决策 | 选择 |
|---|---|
| 告知 vs 强制 | 告知式（规范描述期望，不强制）|
| 机械字段 | 只做 timestamp/sha256（可程序派生）|
| title 等 | 不给机械值（"太多需要 AI"——质量更好）|
| OKF Draft | 标注版本来源，后续变化时追溯 |

---

## 测试覆盖

| 模块 | 测试文件 |
|---|---|
| CRUD | `tests/meta.test.ts` |
| normalize | `tests/meta-normalize.test.ts` |
| apply/diff | `tests/meta-apply.test.ts` |
| derive | `tests/meta-derive.test.ts` |
| CLI 端到端 | `tests/cli.test.ts` |

---

## 已知限制

| 限制 | 说明 |
|---|---|
| trailing-comment 保真 | `yaml` known bug，不保证 |
| 日期/类型语义 | 不与 Obsidian 100% 一致（无 types.json），set 保守推断 |
| aliases 不拆 | 含逗号的别名不自动拆分（留 opt-in 后续） |
| Phase 1 不是"标准化完成" | normalize 才是标准化主体 |

---

## 原始文件

本合并文档替代以下 3 份独立 plan（已归档到 `docs/plans/archived/`）：
- `2026-06-28-meta-frontmatter-write.md`（Phase 1）
- `2026-06-28-meta-normalize.md`（Phase 2）
- `2026-06-28-meta-derive-profiles.md`（Phase 3）

冻结规范仍在 `docs/specs/2026-06-28-meta-subset-frozen.md`。

# QUICKSTART · 从这里开始开发

> 项目初始化（阶段 0）已完成并验证通过。本文件告诉你：怎么让 AI 加载好全局规则，然后用一句话开始开发。

## 现状

- ✅ 脚手架、agent 规则（`AGENTS.md`）、调研/设计/计划文档、`src/` 可编译骨架、样例 vault、开发侧 skill 全部就位。
- ✅ `pnpm install` / `typecheck` / `build` / `test`(5 pass·3 todo) / `lint` / `skills:install` 全绿。
- ⏳ `src/` 各模块为桩（throw NotImplemented），主体待按计划分阶段实现。

## 三步开始开发

### 1）重启 Claude Code 会话
让它加载项目「全局提示词」`CLAUDE.md → AGENTS.md`，以及刚装到 `.claude/skills/` 的两个业务 skill（`biz-obsidian-spec` / `biz-dql-subset`）。

> 依赖已装好，无需再 `pnpm install`。若换机器，先 `pnpm install`（会构建 better-sqlite3）。

### 2）给 AI 一句话开始
重启后，直接说：

```
开始执行 docs/plans/2026-06-25-x-basalt-cli-mvp.md 阶段 1（parser），先召回 biz-obsidian-spec。
```

AI 会按计划实现 parser，并用样例 vault 跑 `tests/parser.test.ts`。后续阶段同理（2 indexer → 3 query → 4 skill+cli → 5 收口）。

### 3）（可选）先提交基线
当前为干净待提交状态（git 已 init，未 commit）：

```bash
git add -A && git commit -m "chore(repo): 初始化脚手架与阶段 0 骨架"
```

## 常用命令

```bash
pnpm run build        # tsc → dist/
pnpm run typecheck    # tsc --noEmit
pnpm test             # node:test
pnpm run lint         # oxlint
pnpm run format       # oxfmt（写入）
pnpm cli -- parse tests/fixtures/sample-vault/Index.md   # 开发态跑 CLI（当前桩会提示未实现）
pnpm run skills:install   # 重装 skills-def/ 到 .claude/skills/
```

## 目录速览

```
AGENTS.md            项目全局规则（CLAUDE.md 指向它）
docs/                research / specs / plans（真相源路由见 docs/README.md）
TODO.md              执行真相源（链接当前计划）
src/                 parser / indexer / query / skill / utils / cli（骨架）
skills/              产品运行时 SkillRecall 数据（obsidian-base-spec.json5）
skills-def/          开发侧业务 skill 源码（安装到 .claude/skills/，见 skills-def/INSTALL.md）
tests/               node:test + fixtures/sample-vault
```

## 下一步

阶段计划与验收：[`docs/plans/2026-06-25-x-basalt-cli-mvp.md`](docs/plans/2026-06-25-x-basalt-cli-mvp.md)

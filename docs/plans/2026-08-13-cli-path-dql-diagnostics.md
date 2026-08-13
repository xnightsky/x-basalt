---
type: plan
title: CLI 配置单源与 DQL 诊断修复计划
description: 修复 X_BASALT_DIR 配置与数据库分家，并为 count() 与 SORT BY 误用增加定向诊断的 TDD 执行计划
tags:
  - plan
  - cli
  - config
  - dql
  - diagnostics
timestamp: 2026-08-13T04:37:41Z
sha256: 50690b09f2d8d1fab2303eddc6832267a749614548ba0a7c3074068355a41bfb
---
# CLI 配置单源与 DQL 诊断修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `X_BASALT_DIR` 的配置与数据库严格同源，并为 `count()`、`SORT BY` 两类高频误用返回可执行的定向提示。

**Architecture:** `loadConfig` 仍负责“全局配置 + 项目配置”合并，但一旦调用方传入 `baseDir`，项目配置只从该目录读取，缺文件视为空配置而非回退 cwd。DQL 不扩展能力：`count()` 在 SQL 生成的非分组投影边界拒绝，`SORT BY` 在 parser 的 Chevrotain 错误映射层转换为定向 `DqlSyntaxError`。

**Tech Stack:** Node.js 22+、TypeScript 5.x（ESM / NodeNext）、cosmiconfig、Chevrotain、`node:test`。

**批准记录:** 2026-08-13，故障报告方批准严格单源方案 A 与两条 DQL 定向诊断；确认无已知调用方依赖旧回退行为。

---

## 文件与职责

- `src/config.ts`：实现 `baseDir` 的严格项目配置来源语义，并同步 `loadConfig` 的行为注释。
- `src/cli.ts`：删除“缺 config 时回退 cwd”的过时入口注释；默认 DB 仍取 `$X_BASALT_DIR/index.db`。
- `src/query/sql-generator.ts`：在无 `GROUP BY` 的 TABLE 投影中定向拒绝 `count()`。
- `src/query/parser.ts`：识别 `SORT BY` 的 `BY` 越界 token，转换为 DQL 排序提示。
- `tests/config.test.ts`、`tests/cli.test.ts`：锁住严格配置来源及真实初始化踩坑。
- `tests/sql-generator.test.ts`、`tests/query-parser.test.ts`：锁住两条诊断的类型、文案和位置。
- `docs/use/config.md`、`docs/use/troubleshooting.md`、`CHANGELOG.md`：同步严格单源与错误引导。

## Task 1：`X_BASALT_DIR` 严格单源

- [x] **Step 1: 写 config 层失败测试**

把原“缺 config 回退 cwd”的三条用例改为：`baseDir` 存在/不存在时均不读取 cwd；目录创建前后结果保持为空项目配置。

```ts
const cfg = loadConfig(cwd, freshDir(), base);
assert.equal(cfg.vault, undefined, "设置 baseDir 后不得回退 cwd 配置");
```

- [x] **Step 2: 写 CLI 初始化踩坑失败测试**

```ts
const r = run(["index"], { cwd, env: { X_BASALT_DIR: base } });
assert.equal(r.status, 1);
assert.match(r.stderr, /需要 <vault> 参数或在配置文件中设置 vault/);
assert.equal(existsSync(join(base, "index.db")), false);
```

- [x] **Step 3: 验证 RED**

Run:

```bash
pnpm exec tsx --test tests/config.test.ts tests/cli.test.ts
```

Expected: 新严格语义断言失败；当前实现从 cwd 读到 vault 并成功创建 `$X_BASALT_DIR/index.db`。

- [x] **Step 4: 最小实现**

`loadConfig` 的项目配置选择改为：

```ts
const projectCfg = baseDir === undefined
  ? loadProject(explorer, cwd)
  : (loadConfigDir(explorer, baseDir) ?? {});
```

同步删除 `src/config.ts`、`src/cli.ts` 中宣称“缺 config 回退 cwd”的注释和 `@behavior`。

- [x] **Step 5: 验证 GREEN**

Run:

```bash
pnpm exec tsx --test tests/config.test.ts tests/cli.test.ts
```

Expected: 两个测试文件全绿；CLI E2E 不生成 DB。

## Task 2：`count()` 无分组定向诊断

- [x] **Step 1: 写失败测试**

在 `tests/sql-generator.test.ts` 断言：

```ts
assert.throws(
  () => generateSql(parseDql('TABLE count() FROM ""')),
  (error: unknown) => {
    assert.ok(error instanceof DqlSyntaxError);
    assert.match(error.message, /count\(\) 仅用于 GROUP BY 聚合列/);
    assert.match(error.message, /total 字段/);
    return true;
  },
);
```

- [x] **Step 2: 验证 RED**

Run:

```bash
pnpm exec tsx --test tests/sql-generator.test.ts
```

Expected: 文案断言失败，实际仍为“不支持的查询字段: count()”。

- [x] **Step 3: 最小实现**

在无 `query.groupBy` 的 TABLE 字段投影前识别 `count()`：

```ts
if (f === "count()") {
  throw new DqlSyntaxError(
    "count() 仅用于 GROUP BY 聚合列；统计总数请读取查询结果的 total 字段",
    0,
  );
}
```

不要把 `count()` 变成全库聚合，也不改已有 GROUP BY 编译路径。

- [x] **Step 4: 验证 GREEN**

Run:

```bash
pnpm exec tsx --test tests/sql-generator.test.ts tests/query.test.ts
```

Expected: 定向错误通过；已有分组计数与端到端查询全绿。

## Task 3：`SORT BY` 定向诊断

- [x] **Step 1: 写失败测试**

在 `tests/query-parser.test.ts` 覆盖大写、小写与位置：

```ts
const dql = 'LIST FROM "" SORT BY file.path';
assert.throws(() => parseDql(dql), (error: unknown) => {
  assert.ok(error instanceof DqlSyntaxError);
  assert.match(error.message, /SORT <field> \[ASC\|DESC\]/);
  assert.match(error.message, /无需 BY/);
  assert.equal(error.pos, dql.indexOf("BY"));
  return true;
});
```

保留合法 `SORT file.path ASC` 的解析回归。

- [x] **Step 2: 验证 RED**

Run:

```bash
pnpm exec tsx --test tests/query-parser.test.ts
```

Expected: 当前 Chevrotain 原始 “Expecting token ... Identifier” 不满足文案断言。

- [x] **Step 3: 最小实现**

在 `parseDql` 的 `parser.errors` 映射中、LIKE 分支附近识别 `BY` token，且其前一个词法 token 为 `SORT`：

```ts
const tokenIndex = lex.tokens.indexOf(tok);
const previous = tokenIndex > 0 ? lex.tokens[tokenIndex - 1] : undefined;
if (tok && /^by$/i.test(tok.image) && previous && /^sort$/i.test(previous.image)) {
  throw new DqlSyntaxError(
    "DQL 排序用 SORT <field> [ASC|DESC]，无需 BY",
    tok.startOffset,
  );
}
```

限制在 `SORT BY` 邻接 token，避免误伤 `GROUP BY`。

- [x] **Step 4: 验证 GREEN**

Run:

```bash
pnpm exec tsx --test tests/query-parser.test.ts
```

Expected: 定向诊断、位置与合法排序全部通过。

## Task 4：消费侧说明与收口

- [x] **Step 1: 同步文档**

- `docs/use/config.md`：明确设置 `X_BASALT_DIR` 后，即便目录缺 `config.*` 也不回退 cwd；显式参数命令仍可运行。
- `docs/use/troubleshooting.md`：新增“env 指向目录缺 config 导致 vault 缺失”的定位与修复。
- `CHANGELOG.md`：Unreleased 记录配置来源契约修复和两条 DQL 诊断。
- `skills-data/core.json5`：现有“config 与 index.db 都落其下”不改签名；仅在需要消除歧义时补“缺 config 不回退”。

- [x] **Step 2: 刷新文档派生元数据**

```bash
x-basalt meta apply llm-wiki docs/use/config.md --refresh-derived
x-basalt meta apply llm-wiki docs/use/troubleshooting.md --refresh-derived
x-basalt meta apply llm-wiki docs/plans/2026-08-13-cli-path-dql-diagnostics.md --refresh-derived
```

- [x] **Step 3: 运行最小充分验证**

```bash
pnpm exec tsx --test tests/config.test.ts tests/cli.test.ts tests/query-parser.test.ts tests/sql-generator.test.ts tests/query.test.ts
pnpm run typecheck
pnpm run build
pnpm run format:check
```

Expected: 全部退出码 0；不出现新增 warning/error。

- [x] **Step 4: 硬约束与脱敏检查**

```bash
rg -n "from ['\"]obsidian['\"]|obsidian://|obsidian-dataview|Electron|Puppeteer|Playwright" src tests
rg -n "/root/|/home/|[A-Za-z]:\\\\" docs README.md CHANGELOG.md src tests
```

Expected: 本次改动无新增命中；历史既有命中须与 diff 区分，不顺手修改。

## 验收标准

1. 设置 `X_BASALT_DIR` 时，config 与默认 DB 始终同一基目录；缺 config 不读 cwd。
2. `TABLE count() FROM ""` 明确指向 GROUP BY 与结果 `total`。
3. `SORT BY file.path` 明确提示 `SORT <field> [ASC|DESC]` 且位置指向 `BY`。
4. 合法分组计数、合法排序、显式 vault/db 调用均不回归。
5. 受影响测试、typecheck、build、format check 全绿。

> Git 提交由当前会话用户另行授权；本计划不执行 `git commit` / `git push`。

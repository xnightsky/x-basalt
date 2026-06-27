# 安装与运行 · x-basalt

> 本页覆盖：环境要求 → 从源码构建 → 三种运行方式 → `npm link` 全局安装 → 验证。
> 回到总览：[usage.md](usage.md)

---

## 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | **≥ 22**（开发用 24.x；`package.json` `engines` 字段强制声明） |
| 包管理器 | **pnpm**（项目锁版本 `pnpm@10.33.0`，`packageManager` 字段声明） |

检查版本：

```bash
node --version    # 须 v22.x 以上
pnpm --version    # 须已安装
```

pnpm 未安装时：`npm install -g pnpm`。

---

## 从源码安装与构建

```bash
# 1. 安装依赖（含编译 better-sqlite3 原生模块）
pnpm install

# 2. 编译 TypeScript → dist/
pnpm run build
```

| 步骤 | 说明 |
|---|---|
| `pnpm install` | 安装所有依赖，同时本地编译 `better-sqlite3`（C++ 原生模块）。已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 放行——pnpm v10 默认拦截原生构建脚本，不放行会报错无法装上。 |
| `pnpm run build` | 调用 `tsc`，将 `src/` 编译输出到 `dist/`；产出 `dist/cli.js`（顶部含 `#!/usr/bin/env node` shebang，可直接执行）。 |

---

## 三种运行方式

| 方式 | 命令形式 | 前提 |
|---|---|---|
| **A 全局命令** | `x-basalt <command>` | 先用 `npm link` 全局安装（见下节） |
| **B 直接跑产物** | `node dist/cli.js <command>` | 已执行 `pnpm run build` |
| **C 开发态（免构建）** | `pnpm run cli -- <command>` | 无需构建，`tsx` 直接运行 `.ts` 源码 |

> `--` 是 pnpm 的透传参数分隔符。`pnpm run cli -- parse note.md` 中，`parse note.md` 才是传给 CLI 的参数；省略 `--` 会导致参数被 pnpm 自身消费而出错。

### 方式 B — 直接跑产物

```bash
node dist/cli.js parse tests/fixtures/sample-vault/Index.md
node dist/cli.js query 'LIST FROM #project' --db ./index.db
```

### 方式 C — 开发态（tsx，免构建）

```bash
pnpm run cli -- parse tests/fixtures/sample-vault/Index.md
pnpm run cli -- index ./tests/fixtures/sample-vault --db ./index.db
pnpm run cli -- skill recall wikilink
```

改了源码后直接重跑，无需重新构建。

---

## 全局安装（npm link）

在**仓库根目录**执行：

```bash
npm link
```

`npm link` 读取 `package.json` 的 `bin` 字段（`"x-basalt": "dist/cli.js"`），在系统全局 `bin` 目录创建指向仓库内 `dist/cli.js` 的符号链接 shim，使 `x-basalt` 命令上 PATH。

> **为何不用 `pnpm link --global`**：pnpm v10 的 `pnpm link --global` 存在已知问题——不创建 bin shim，导致 `x-basalt` 命令无法进入 PATH。`npm link` 无此问题，直接在仓库根跑即可。

### 改了源码要重新编译

`npm link` 建立的是**活符号链接**（live symlink）——全局 `x-basalt` 指向的是编译产物 `dist/cli.js`，而非 `src/` 源码。修改源码后必须重新编译才能生效：

```bash
pnpm run build   # 重编译；npm link shim 立即指向新产物，无需重新 link
```

---

## 验证安装

```bash
x-basalt --version   # 输出: 0.1.0
x-basalt --help      # 列出全部 6 条命令：parse / index / scan / query / skill / watch
```

若提示命令未找到，检查全局 `bin` 目录是否在 PATH（`npm bin -g` 查看路径）。

---

## 下一步

装好后，按需阅读对应章节：

| 目标 | 章节 |
|---|---|
| 6 条命令的参数详解 | [commands.md](commands.md) |
| DQL 查询文法与隐式字段 | [querying-dql.md](querying-dql.md) |
| 索引构建与增量同步 | [indexing-and-sync.md](indexing-and-sync.md) |
| 免去重复传参的配置文件 | [configuration.md](configuration.md) |
| 全部章节总览 | [usage.md](usage.md) |

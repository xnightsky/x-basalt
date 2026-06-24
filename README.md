# x-basalt-cli

> 纯 Node.js CLI 工具：**零依赖 Obsidian GUI / 运行时**，直接通过文件系统 API 操作 Vault 目录，实现 Obsidian 规范的解析、索引、Dataview 子集查询与 Skill 召回。

不引入 `obsidian` npm 包、不调用 `obsidian://` URI、不读取 `app.metadataCache`。所有索引与隐式字段（反向链接等）由自建 SQLite 实时计算。

## 状态

🚧 初始化完成，按 `docs/plans/2026-06-25-x-basalt-cli-mvp.md` 分阶段实现中。当前 `src/` 为可编译骨架（接口已定，主体待填）。

## 安装

```bash
pnpm install
pnpm run build        # tsc → dist/
```

开发态可不构建，直接用 `tsx` 跑：

```bash
pnpm run cli -- <command> [args]
```

## 使用

### 1. 解析单文件 → AST JSON

```bash
x-basalt-cli parse <file.md> [--format json|yaml]
# 开发态：
pnpm run cli -- parse tests/fixtures/sample-vault/Index.md
```

输出标准化的 `ObsidianNode[]` + frontmatter，含 wikilink / embed / tag / callout / task / highlight / blockRef。

### 2. 构建 / 更新 Vault 索引

```bash
x-basalt-cli index <vault-path> [--watch] [--db ./index.db]
pnpm run cli -- index ./tests/fixtures/sample-vault --db ./index.db
```

全量扫描 `.md` 文件写入 SQLite；`--watch` 启用 chokidar 增量监听。自动跳过 `.obsidian/` 与隐藏文件。

### 3. 执行 Dataview 子集查询

```bash
x-basalt-cli query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10" \
  --vault ./tests/fixtures/sample-vault \
  --db ./index.db
```

支持子集：

```
LIST | TABLE <field, ...>
FROM <"folder"> | <#tag> | <[[link]]>
WHERE <condition>            # = != < > <= >= / contains/icontains/startswith/endswith / AND OR NOT / regexmatch
SORT <field> ASC | DESC
LIMIT <number>
```

隐式字段：`file.name/path/folder/extension/size/mtime/ctime/tags/inlinks/outlinks/tasks`。结果为 JSON：

```json
{ "type": "LIST", "columns": ["file.name"], "rows": [ { "file.name": "Note A" } ] }
```

### 4. 召回 Skill 规范

```bash
x-basalt-cli skill recall wikilink
x-basalt-cli skill recall dataview
x-basalt-cli skill list
```

模糊匹配 skill 的 `triggers` 与 `name`，返回规范详情。内置 `obsidian-base-spec`，外部目录为空也能召回基础规范。Skill 目录：环境变量 `OBSIDIAN_SKILL_PATH` > `~/.obsidian-core/skills/` > 内置 `skills/`。

### 5. 监听模式

```bash
x-basalt-cli watch <vault-path> --on-change "echo 'File changed: {file}'"
```

## 开发

详见 `AGENTS.md`（项目约定与硬约束）与 `docs/README.md`（文档路由）。

```bash
pnpm test             # Node 原生 test runner
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # oxlint
pnpm run format       # oxfmt
pnpm run skills:install   # 安装 skills-def/ 业务 skill 到 .claude/skills/
```

## 约束

零 Obsidian 运行时依赖；执行层（DQL → SQL）完全自建；隐式字段一律 SQLite JOIN 实时计算。完整禁止项见 `AGENTS.md`「项目硬约束」。

## License

MIT

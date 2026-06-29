# 变更编排器 P1 写动作 —— CLI if-exists 解析 + 集成测试 + 文档同步（段 2/2）

> **For agentic workers:** 严格 TDD（先 red 后 green）逐子步实现；步骤用 `- [ ]` 跟踪。  
> 日期：2026-06-30 · 主题：把 `--pipe if-exists=` 接入 CLI，补写动作 run() 集成测试与 CLI 端到端测试，同步文档与 skill。  
> 真相源（设计）：[`../specs/2026-06-29-change-orchestration-design.md`](../specs/2026-06-29-change-orchestration-design.md) §8/§12。  
> 前置计划：[`2026-06-29-change-orchestration.md`](2026-06-29-change-orchestration.md)（P0 已落地）。

**Goal:** 完成编排器 P1 写动作最后一公里：CLI `--pipe if-exists=skip|overwrite|merge` 解析进 `PipelineConfig.ifExists`，并补 `apply/set/unset/rename` 的 run() 集成测试与 CLI 端到端测试，最后同步 `docs/guides/commands.md` 与 `skills-def/x-basalt/SKILL.md`。

**Architecture:** 仅动 `src/cli.ts` 的 `resolvePipeline`（命令行覆盖配置基底）；`src/config.ts` 若透传 `ifExists` 则无需改动。测试沿用段 1 已落地的临时 vault + 真实 `VaultIndexer` + subprocess 范式。文档与 skill 仅追加字段/动作说明。

## Global Constraints（逐字继承自 AGENTS.md / 前置 spec）

- 零 `obsidian` 依赖；文件操作仅经 `fs`/`chokidar`。
- `meta` 是唯一写 `.md` 的层；编排器只调度，不绕过。
- 写动作默认 dry-run，显式 `--apply` 才落盘。
- 中文注释解释「为什么/边界/副作用」；Obsidian 规范来源处用 `// === Obsidian 规范来源 ===`，自建逻辑用 `// === 自建实现 ===`。
- 复杂模块重测试：CLI 新选项、写动作冲突策略、dry-run/apply 闸必须逐项独立用例。

---

## 范围切分

| 部件 | 本段 | 说明 |
|---|---|---|
| CLI `resolvePipeline` 解析 `if-exists` | **S2-1** | 校验 + 透传；三命令 help 串补 `/if-exists` |
| `config.ts` 透传检查 | **S2-2** | 若 YAML→对象无白名单则无需改动 |
| 写动作 run() 集成测试 | **S2-3** | `tests/orchestrator-actions.test.ts` 补 apply/set/unset/rename/ifExists/unlink |
| CLI 端到端测试 | **S2-4** | `tests/orchestrator-cli.test.ts` 补 dry-run/apply/rename/if-exists/非法值 |
| 文档同步 | **S2-5** | `docs/guides/commands.md` + `skills-def/x-basalt/SKILL.md` |

---

## 原子子步（TDD）

### S2-1：`src/cli.ts` — `resolvePipeline` 解析 `if-exists`

- [x] **S2-1.1 读源码**：读 `src/cli.ts` 定位 `resolvePipeline`、三命令 `--pipe <kv>` option 帮助串。
- [x] **S2-1.2 写实现**：
  - 在 `resolvePipeline` 内加 `if-exists` 解析与校验（仅接受 `skip|overwrite|merge`，非法报错）。
  - `return { ... }` 对象加 `ifExists: ifExistsRaw`（放在 `dryRun` 附近）。
  - 若 TS 无法收窄，加 `as PipelineConfig["ifExists"]` 断言。
- [x] **S2-1.3 更新 JSDoc**：`resolvePipeline` 的 JSDoc「次级 key」句补 `/if-exists`。
- [x] **S2-1.4 更新 help 串**：`run`/`scan`/`watch` 三命令 `--pipe <kv>` option 描述末尾补 `/if-exists`。
- [x] **S2-1.5 先红后绿**：先写/改测试再看红；再实现看绿。
- [x] **验收**：`pnpm run typecheck` 无错；`pnpm test` 全绿。

### S2-2：`src/config.ts` 透传检查

- [x] **S2-2.1 读源码**：确认 `pipelines.<name>` 是 YAML→对象直接透传，还是字段白名单。
- [x] **S2-2.2 决策**：`parsePipelines` 是白名单构造，补上 `ifExists` 字段透传。
- [x] **验收**：配置加载含 `ifExists` 的 pipeline 后对象保留该字段。

### S2-3：`tests/orchestrator-actions.test.ts` — 写动作 run() 集成

沿用文件内 `mkVault` + 真实 `VaultIndexer` + `ActionContext` 范式。

- [x] **S2-3.1 apply dryRun 不落盘**：`parseAction("apply pkm-note").run(..., {..., dryRun:true})` → `skipped=true`、`changed=false`、文件字节不变。
- [x] **S2-3.2 apply 落盘**：dryRun:false → `changed=true`；文件含 `created:`/`modified:`、正文保留。
- [x] **S2-3.3 set 落盘**：`set status=active` → 文件含 `status: active`。
- [x] **S2-3.4 unset 落盘**：`unset draft` → 文件不含 `draft`。
- [x] **S2-3.5 rename + ifExists=skip**：冲突跳过，文件仍有 `tag` 与 `tags`。
- [x] **S2-3.6 rename + ifExists=overwrite**：文件变成 `tags: x`、无 `tag`。
- [x] **S2-3.7 unlink 跳过**：写动作对 `unlink` 事件 `skipped=true`、`changed=false`。
- [x] **验收**：`pnpm test tests/orchestrator-actions.test.ts` 全绿。

### S2-4：`tests/orchestrator-cli.test.ts` — CLI 端到端

沿用 `setup()`+`run()`+`X_BASALT_DIR` 范式。

- [x] **S2-4.1 apply 默认 dry-run**：`run(["run","--pipe","actions=apply pkm-note",...])` → status 0，文件不变。
- [x] **S2-4.2 apply --apply 落盘**：加 `--apply` → 文件含 `created:`。
- [x] **S2-4.3 rename + if-exists=overwrite**：`run(["run","--pipe","actions=rename tag tags","--pipe","if-exists=overwrite","--apply",...])` → 文件 `tags: x`、无 `tag`。
- [x] **S2-4.4 if-exists 非法值报错**：`if-exists=bogus` → status 1，`stderr` 匹配 `/if-exists/`。
- [x] **验收**：`pnpm test tests/orchestrator-cli.test.ts` 全绿。

### S2-5：文档同步

- [x] **S2-5.1 `docs/guides/commands.md`**：
  - `run` 命令章节补写动作枚举与 dry-run/`--apply` 说明。
  - `--pipe` 次级 key 列表补 `if-exists=skip|overwrite|merge`（默认 skip，仅 rename 冲突）。
  - 明确限制：`set` 仅标量；`apply` 纯 top-up。
  - 加 1~2 条示例。
- [x] **S2-5.2 `skills-def/x-basalt/SKILL.md`**：
  - 「变更编排管道」节 key 列表补 `if-exists`。
  - 内建动作句补 `apply <profile>` / `set` / `unset` / `rename`，标注 dry-run/`--apply`/if-exists。
  - `run` 命令表格行选项列补 `if-exists`。
- [x] **验收**：文档与代码签名一致；无需跑 `skills:install`。

---

## 段 2 收口

- [x] `pnpm run typecheck` 无错。
- [x] `pnpm test` 全绿（段 1 后 361，本段新增 10 条至 371，无 fail）。
- [x] 打印 typecheck 结果 + 测试条数/全绿与否 + 改动文件清单。
- [x] **不 commit**。

---

## 风险与剩余不确定

- `apply` 落盘测试依赖 `pkm-note` profile 的行为；若 profile 字段名调整，测试断言需同步。
- CLI 端到端依赖 subprocess 启动耗时；`--apply` 测试在 Windows 上可能因文件句柄释放顺序出现短暂不稳定，若失败需重跑一次确认。
- `rename` 的 `ifExists=merge` 语义在段 1 已定义；本段 CLI 仅负责透传，具体 merge 行为由 `applyRenamePolicy` 保证，不在本段重复测试。

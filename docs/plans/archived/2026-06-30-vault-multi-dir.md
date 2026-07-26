---
type: plan
title: vault 多目录（multi-dir）支持
description: vault 配置/CLI/indexer/orchestrator 支持多目录索引：按根目录名命名空间 keying，移除公共祖先 base
tags:
  - plan
  - indexer
  - vault
  - x-basalt
timestamp: 2026-06-30T03:11:46Z
sha256: 39f711590145d43d684a7bd0a6b90f6bf338ead79f93b9e449e1b750ec8ba8dc
---
# Plan · vault 多目录（multi-dir）支持

> 日期：2026-06-30 ｜ 范围：config / indexer / watcher / orchestrator / cli / tests
> 关联需求：`vault` 配置从「单目录字符串」扩展为「单目录或多目录列表」，索引这些目录的并集。
> pattern dir（glob）单独评估，见末尾「附：pattern dir 评估」，本次不实现。

## 目标

- `vault` 可写成列表（YAML `- ./a` / `- ./b`），索引多个目录的并集；单字符串行为完全不变（向后兼容）。
- CLI 位置参数 `[vault]` 支持多值（`index ./a ./b`）；`--vault` 选项可重复。
- 不改 DB schema、不引新依赖。

## 核心设计：按根命名空间（per-root namespace）keying —— 不取公共祖先 base

把 `vault` 输入解析为 `VaultLayout = { roots: string[]; toKey(abs); toAbs(key) }`：

- `roots`：实际遍历/监听的目录集合（去重；剔除被其它根包含的子根）。
- **单根**：`toKey` = 相对该根的 POSIX 路径（与历史单根行为字节级一致 → 旧测试全绿）。
- **多根**：`toKey` = `<根目录名>/<相对该根>`，根目录名作命名空间；`toAbs` 按命名空间前缀映射回对应根。
- **为何不取公共祖先 base**（一版设计的修正）：两根相距很远时公共祖先会退到 `/tmp` 甚至 `/`，把主键拉成又长又近乎绝对的路径、泄露绝对前缀，且让 `base` 看起来"参与" watch。按根命名空间则 keys **恒短且根内相对**，与根的物理距离无关；**watch 自始至终只盯 `roots`**，`base` 概念被彻底移除。
- **冲突**：多根目录名（basename）相同 → 报错（命名空间需唯一；显式命名留作后续）。
- 编排器写动作经 `ctx.indexer.toAbsolute(ev.path)`（即 `layout.toAbs`）还原绝对路径，`ActionContext.vaultPath` 弃用；`watchSource(roots, toKey, …)` 不再收 `base`。

## 改动清单

1. `src/utils/path.ts`：新增 `resolveVaultLayout(input) → VaultLayout{roots, toKey, toAbs}`（单根=相对根；多根=根名命名空间，basename 冲突报错；含剔子根）。
2. `src/config.ts`：`BasaltConfig.vault` → `string | string[]`；`pickConfig` 对 vault 特判（string 原样、string[] 过滤非串、空列表丢弃）。
3. `src/indexer/index.ts`：`IndexerOptions.vaultPath` → `string | string[]`；内部持 `layout`；rebuild/computeDiff 遍历 `layout.roots`、键用 `layout.toKey`；`toAbsolute` 改公开（委派 `layout.toAbs`）；watch 传 `layout.roots`。
4. `src/indexer/watcher.ts`：`startWatch(roots: string | string[], …)`，chokidar 监听数组。
5. `src/orchestrator/engine.ts`：`OrchestratorOptions.vaultPath` → `string | string[]`；持 `layout`；`ctx` 去掉 vaultPath（动作改经 indexer）；`watchSource(layout.roots, layout.toKey, …)`。
6. `src/orchestrator/sources.ts`：`watchSource(roots, toKey, …)`（不再收 base）。
7. `src/orchestrator/types.ts`：`ActionContext.vaultPath` 标 `@deprecated` 改可选；`ChangeEvent.path` 注释更新。
7b. `src/orchestrator/actions.ts`：6 处 `join(ctx.vaultPath, ev.path)` → `ctx.indexer.toAbsolute(ev.path)`。
8. `src/cli.ts`：`[vault]`→`[vault...]`（index/scan/watch）；`--vault` 可重复（run/chat）；统一 `requireVault()` 解析。
9. `.x-basalt/config.example.yaml`：补多目录列表示例。
10. 测试：`tests/vault-multidir.test.ts`（resolveVaultRoots 公共祖先/去重/剔子根；多根 build 无碰撞、并集齐全；toAbsolute/toRelative 往返）；`tests/config.test.ts` 补 vault 列表用例。

## 验证

- `pnpm run typecheck`。
- 受影响测试：`tests/config.test.ts`、`tests/indexer.test.ts`、`tests/scan.test.ts`、`tests/rebuild-streaming.test.ts`、新增 `tests/vault-multidir.test.ts`、orchestrator 相关。
- 单根回归：既有 indexer/scan 测试不变即证明向后兼容。

## 附：pattern dir（glob）评估

- 与多 dir 正交：pattern 只是「把 glob 展开成一组具体目录」，展开后喂给本设计的 `roots` 即可复用全部机制。
- 阻力：chokidar v5 已移除 watch 路径的 glob 支持；仓库无 glob 依赖（无 fast-glob/picomatch 直依赖）。
- 结论/建议：**本次不做**。后续可作独立小改：配置加载期用 fs 自建轻量展开（无新依赖）把 glob → 具体目录，供 `index/scan` 静态路径；`watch + pattern` 需「监听父目录 + 回调内 picomatch 过滤」，单列一项。

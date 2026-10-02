---
type: research
title: pipeline index 动作"假成功"根因排查——多根 vault 下旧键删除失效
description: 记录 x-basalt chat pipeline_run 的 index 动作在多根 vault 配置下报告 total/changed 全绿但实际不落盘、计数恒定的根因链：scanSource deleted 列表与 indexAction unlink 分支的 toAbs/toKey 往返归一化冲突，多根 toAbs 对无前缀旧键保守退回首个根导致误删新键。
tags:
  - research
  - rootcause
  - indexer
  - orchestrator
  - chat
  - multi-root
timestamp: 2026-07-02T07:50:33Z
sha256: da0306fe287f318663f71a64701fa0137dbbaff7a84b1e19ec04e1f10e2b3496
---

# pipeline index 动作"假成功"根因排查

> 日期：2026-07-02 · 类型：根因排查（已实测定案）
> 触发：chat 内询问「都做下 index？」后报告重建成功，但再次查询文件计数仍为 410，三轮复现一致。
> 结论：坏点在「管道处理旧式键」——多根 vault 下，旧单根时代键（无前缀）在 unlink 事件中被 `toAbs/toKey` 往返误解析为首个根下的新键，导致刚插入的新键被自删，旧键永远删不中，净变化精确归零。

## 一句话结论

chat `pipeline_run actions=[index]` 在多根 vault 下是**假成功**：它报告 `total 802 / changed 802 / failed 0`，但数据库实际行数不变。根因是 `indexAction` 的 `unlink` 分支删除路径时做了一次 `toAbs → toKey` 往返归一化，而 `src/utils/path.ts` 的 `resolveVaultLayout` 多根分支对**无已知命名空间前缀**的输入采用「保守退回首个根」兜底，把旧键 `ai/cli-search.md` 误判为 `doc/ai/cli-search.md`，从而删掉本轮刚插入的新键；406 条旧键始终无法命中，净效果 `406 + 4 + 396 - 396 = 410`，形成永动机。

## 复现环境

| 项目 | 内容 |
|---|---|
| 宿主仓库 | `cmdb`（`/data/code/gwm/cmdb`） |
| x-basalt 目录 | `X_BASALT_DIR=.tmp/.x-basalt`（相对路径，随 cwd 解析） |
| 配置变更 | 2026-07-01 `config.yaml` 从单根 `./doc` 改为双根 `[./doc, ./docs]` |
| 索引状态 | `index.db` 的 `files` 表 410 行：406 行为单根时代无前缀键（如 `ai/cli-search.md`、`CLAUDE.md`），4 行带 `doc/` 前缀 |

## 症状

chat 输入「都做下 index？」被翻译为 `pipeline_run actions=[index]`，返回：

```text
total 802 / changed 802 / failed 0
```

宣布重建成功；但再次查询计数仍为 `410`。`scan --dry-run` 的差异恒为：

```text
+396 新增 ~0 改动 -406 删除（4 未变）
```

三轮复现一字不差。

## 分层鉴别矩阵

| 实验 | 结果 | 定位意义 |
|---|---|---|
| 全量 `x-basalt index` | 真修好（410 → 400，差异归零） | 问题不在 indexer 全量重建能力 |
| 裸 `x-basalt scan` | 真修好 | 问题不在 scan 差异检测本身 |
| `x-basalt run --pipe actions=index --apply`（无 AI） | 假成功，不落盘 | 坏点在管道路径，非 chat 独有 |
| chat `pipeline_run actions=[index]` | 假成功，不落盘 | 坏点在管道路径，且 chat 内无其他写路径 |
| 管道处理单个健康 `touch` 改动 | 正常落盘 | 坏点被夹逼在「管道处理旧式键」 |

**夹逼结论**：坏点不在 indexer、不在 scan、不在单个事件落盘，而在**管道批量处理旧式无前缀键**。

## 根因链

```text
scanSource.deleted = [ai/x.md, ...]          // 来自 db 的 406 条旧键，无前缀
        ↓
indexAction.unlink 分支调用 indexer.remove(p)
        ↓
remove(p) 内部做 toKey(toAbs(p)) 归一化往返
        ↓
toAbs("ai/x.md") 进入 resolveVaultLayout 多根分支
        ↓
对无已知命名空间前缀的输入，"保守退回首个根" → doc/ai/x.md
        ↓
toKey(doc/ai/x.md) → "doc/ai/x.md"
        ↓
deleteByPath("doc/ai/x.md") 删掉的是同一轮 add 事件刚插入的新键
        ↓
406 条旧键永远删不中；净变化 406 + 4 + 396 - 396 = 410
```

关键代码路径：

- `src/orchestrator/actions.ts`：`indexAction` 的 `unlink` 分支调用 `indexer.remove(p)`。
- `src/indexer/index.ts`：`remove` 使用 `toKey(toAbs(p))` 做路径归一化。
- `src/utils/path.ts`：`resolveVaultLayout` 多根分支对无前缀键采用首个根兜底。

对比：**裸 `scan` 不受害**，因为 `scanIter` 删除直接调用 `deleteByPath(rel)`，不做 `toAbs/toKey` 往返。

## 加重因素

| # | 问题 | 位置 / 表现 |
|---|---|---|
| 1 | `unlink` 删除做路径往返归一化，未按索引主键精确删除 | `src/orchestrator/actions.ts` `indexAction.unlink` → `indexer.remove` |
| 2 | 多根 `toAbs` 对无前缀键静默兜底为首个根，未报错 | `src/utils/path.ts` `resolveVaultLayout` 多根分支 |
| 3 | `indexAction` 对 `update/remove` 结果不检查，无条件返回 `changed:true` | `src/orchestrator/actions.ts` |
| 4 | chat 的 `scan` 工具写死 `dryRun:true` | chat 工具定义 |
| 5 | chat 内自然语言「index」被解读为三种语义 | frontmatter 字段、SQLite 收录、文件名含 `index` |

## 证据留痕

| 类型 | 位置 | 说明 |
|---|---|---|
| chat 日志 | 远端 `/tmp/xb-repro/r1-q1.log` 至 `/tmp/xb-repro/r3-q3.log` | 九轮复现对话 |
| 坏库备份 | 远端 `/tmp/xb-repro/index.db.bak` | 复现前的 `index.db` 快照 |

## 修复方向（同批开发中，可作待办引用）

以下修复正在同批开发中，本报告仅作待办引用：

1. `unlink` 事件按索引主键精确删除，不做 `toAbs` 往返。
2. 多根 `toAbs` 去掉静默兜底，改为报错。
3. `indexAction` 汇报真实 `changed` 与 `failed`。
4. chat `pipeline_run` 返回带 `dryRun` 字段与失败明细。

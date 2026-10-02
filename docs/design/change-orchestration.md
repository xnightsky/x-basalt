---
type: design
title: 变更编排器设计评估（统一 watch/scan/手动 三源的声明式维护管线）
description: 已实现的五段维护流水线、三源与同构 CLI/配置入口；旧能力地图和定义另留归档，当前 Row 算子执行层与未完成关注分开维护。
tags:
  - spec
  - orchestrator
  - design
  - x-basalt
timestamp: 2026-10-02T12:14:45Z
sha256: 2594e86e69544413ee94208c22e6d04c6a0f1dbd417ab8013ad2690359db6208
---

# 设计评估：变更编排器（change orchestration）—— 统一 watch / scan / 手动 三源的声明式维护管线

> **当前状态**：五段管线及 `run` / `watch` / `scan` 接线已落地，执行层以 [`pipeline-op-model.md`](pipeline-op-model.md) 为准。旧能力地图、接口草案与分期已归档；未完成项继续保留根 [`TODO.md`](../../TODO.md)。

> 本文维护当前编排边界；2026-06-29 的立项评估、旧 shell 算子及命名设想只在归档中作为历史阅读。
> 触发：用户问 TODO 里 `migrate`（vault 级批量改造）怎么做 → 三方调研后判定「migrate 这个维度不该单独立项」，真正值得做的是围绕**变更流**的编排能力。
> 关联：承接 [`../../TODO.md`](../../TODO.md) 的 `watch pipeline` 与 `migrate` 两项（本文将二者合并、重定位）；现状见 `src/indexer/index.ts`（scan/watch）、`src/meta/*`（写侧）、`src/query/index.ts`（DQL）。
> 外部调研：① 第三方批量元数据工具（MetaEdit / Obsidian Linter / obsidian-metadata / yq）；② 官方 Obsidian（Properties / Bases / `processFrontMatter` API）；③ 编排/流处理/工作流（watchexec / entr / watchman / dbt / turborepo / RxJS / Kafka Streams / Temporal / Airflow / Prefect）。

## 0. 这份文档要回答的问题

三源共享维护流水线，不另造 migrate 命令；动作是强类型内建动词，不把编排器扩成分布式、AI 或任意脚本平台。立项问题与旧“尚不实施”结论见[归档](../archive/decisions/2026-06-29-change-orchestration-record.md#0-这份文档要回答的问题)，不覆盖已落地状态。

## 1. 设计脊梁（任何与之冲突的设计一律否决）

- **三源统一**：`watch` 是推（事件流）、`scan` 是拉（FS↔DB diff）、`手动` 是点（给定 DQL / 文件列表）。三者只有「源」不同，**堆积 / 去重 / 路由 / 执行四段完全复用**。这是把 TODO 里割裂的 watch-pipeline / scan / migrate 收敛成一个东西的根。
- **动作是强类型内建动词，不是裸 shell**。管道动作 = `index` / `normalize` / `apply` 等 x-basalt 自己的强类型动词，各自有明确的输入 / 输出 / 失败语义 / 幂等性 / 是否写盘契约（§7）。现有 `watch --on-change <裸shell>` **保留作逃生口**，但不是管道的一等公民。
- **声明式、CLI/配置同构**。`--pipe k=v` 是一等入口，`pipelines:` 是命名快照；两侧共用解析/校验，不能再次分裂成两套契约（§8）。
- **显式开写 + 回环防护**。维护写动作默认 dry-run，显式 `--apply` 才落盘；无逐动作确认，失败按 onError 策略汇报。必须防动作写文件再次触发自身；非 TTY 不替代显式开写边界。
- **纯离线、零新重依赖**。不引入 AI、不引入分布式运行时（§11）；编排器是对现有 parser/indexer/query/meta 四层的**编排**，不新造 vault 能力。
- **不变量沿用 AGENTS.md**：indexer 是唯一写 SQLite 的层、meta 是唯一写 `.md` 的层、隐式字段查询期 JOIN 实时算。编排器只调度它们，不绕过边界。

## 2. 背景：为什么不是 `migrate`（三方调研归档）

本节历史内容已归档，见[原章节](../archive/decisions/2026-06-29-change-orchestration-record.md#2-背景为什么不是-migrate三方调研归档)。当前规则与剩余边界见本文有效章节。

## 4. 五段流水线架构（+ 两端）

```
                 ┌─────────────────────── 入口过滤（路径/事件类型/符号链接/临时文件）
                 ▼
① 源 Source     watch(实时事件流·推) │ scan(FS↔DB diff·拉) │ 手动(DQL/文件列表·点)
                 │
                 ▼
② 堆积 Accumulate  debounce(wait + maxWait 上限) —— 把 burst 攒成一批
                 │
                 ▼
③ 去重 Dedup       L2 路径折叠(LWW) + L3 事件类型折叠(create+delete→抵消)
                 │
                 ▼
④ 路由 Route       DQL/标签/路径条件 → 决定「哪些文件 跑 哪些动作子集」(N:M)
                 │
                 ▼
⑤ 执行 Run         强类型动作链 · 有界并发 · 重启语义 · 超时 · 失败策略 · dry-run
                 │
                 ▼
                 └─────────────────────── 出口（结构化报告 / 失败告警 / 优雅退出）
```

每段一个单一职责、可独立测试的单元；段间用明确数据结构传递（事件批 → 去重批 → 路由计划 → 执行报告）。

## 5. 能力维度地图（全集 · 取舍 · 现状）

当前已落地源接线、debounce/max-wait、事件折叠、glob/DQL 路由、Row 算子链、并发、失败传播与报告；`paths` 是过滤，不是源。算子与回归编号见 [pipeline-op-model](pipeline-op-model.md)。

协作取消、`onBusy restart/ignore`、背压、缓存跳过、条件分支、检查点续跑与失败告警仍属[根 TODO](../../TODO.md) 的未完成关注。shell 格式嗅探/ASCII 输出另属[未实现增强提案](shell-pipe-portability.md)。旧优先级与【现状】读数见[归档](../archive/decisions/2026-06-29-change-orchestration-record.md#5-能力维度地图全集--取舍--现状)。

## 6. P0 骨架定义（每段的接口 / 语义 / 失败 / 幂等）

### 6.1 源（Source）

统一产出 `ChangeEvent { path, type: add|change|unlink, mtime?, size? }` 流。

- `watch`：chokidar → 事件流；启动前先跑一次 scan 建基线（初始运行）。
- `scan`：`computeDiff` 的 added/modified/deleted 投影成同构 `ChangeEvent[]`（一次性有界流）。
- `手动`：DQL 查询结果或文件列表 → 投影成 `type=change` 的 `ChangeEvent[]`。
- **失败边界**：非法声明与越界 stdin 路径显式报错，不保证所有源错误都降为 warning；单文件存在性/动作失败按报告与 onError 处理。

### 6.2 堆积（Accumulate）

- 入参：事件流；出参：`ChangeEvent[]` 批。
- 语义：trailing-edge debounce `wait` ms；自第一个事件起超过 `maxWait` ms 强制 flush（防饿死）。`scan`/`手动`源是有界批，跳过堆积直接整批下传。
- 幂等：纯函数式累积，无副作用。

### 6.3 去重（Dedup）

- 按 `path_key` 归并（L2 LWW：留窗口内最新 mtime 的事件）。
- 叠加 L3 折叠规则表：

| 窗口内序列       | 折叠结果                     |
| ---------------- | ---------------------------- |
| add → change(×N) | add                          |
| change(×N)       | change                       |
| add → unlink     | **抵消（丢弃，不触发动作）** |
| change → unlink  | unlink                       |
| unlink → add     | change                       |

- 幂等：同一批重复跑结果相同。

### 6.4 路由（Route）

- 入参：去重批 + 管道声明的 `on`（事件类型）/ `where`（DQL）/ `paths`（glob）。
- 语义：先用便宜的事件类型/glob 过滤（不查库）；再用 DQL 做语义路由。
- **一致性纪律（关键）**：DQL 读的是**索引**，而写动作改的是 `.md`。故 watch 流中 `index` 动作必须排在写动作**之前**先把本批变更落库，使后续 DQL 路由看到的是新鲜索引；`手动`源若依赖 DQL，先确保用户已 `scan`（或编排器在选择前自动增量 scan 一次）。**绝不在陈旧索引上路由写动作。**
- 失败：DQL 语法/字段错 → 该管道拒跑并报错（不静默空选）。

### 6.5 管道动作（Pipeline action）

当前执行统一 `Op` / `OpOutcome` 契约，不沿用旧逐文件 Action 签名；链按声明顺序串行，内部逐行并发由 `rowwise` 决定。不开 DAG 或任意脚本执行。

### 6.6 执行（Run）

当前有界并发限制同时运行的行数；`continue` 剔除失败行，`stop` 在当前算子结束后不再进入下一个算子。仅支持 `onBusy=queue`，restart/ignore 显式拒绝。写动作默认 dry-run，需 `--apply`；当前动词与报告见 [pipeline-op-model](pipeline-op-model.md)，没有旧草案的 shell 算子或“全失败 exit=2”承诺。旧执行/动作表见[归档](../archive/decisions/2026-06-29-change-orchestration-record.md#66-执行run)。

## 8. 命令面与配置（统一管道参数模型）

> **P1 收敛**：P0 初版把"配置段 pipeline"当主入口（`scan`/`watch` 只能 `--pipeline` 引用配置）造成"两套"。收敛为单一模型——
> **管道 = 一组参数；命令行 `--pipe k=v` 是规范落地，配置段是命名快照（加速/复用），二者一一对应。**

### 8.1 两层参数（管道定义 vs 运行环境）

**管道定义**（归属"管道"；命令行 `--pipe k=v` 可重复 ⟷ 配置段 `pipelines.<name>` 一一对应）：

| `--pipe` key  | 值                     | 含义                                                                                | 配置段 key    |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `use`         | name                   | 从配置 `pipelines.<name>` 加载作基底（**"从配置读取"降为次级参数**，不是独立 flag） | （引用入口）  |
| `actions`     | a,b,c                  | 动作链（逗号分隔；与 `step`/`steps` 至少其一）                                      | `actions`     |
| `step`        | spec                   | 声明式步骤（可重复，一 flag 一算子 spec、**不切分**；`steps` 存在时优先，D12）      | `steps`       |
| `where`       | DQL                    | 按 DQL 选文件（手动源 / 语义筛）                                                    | `where`       |
| `paths`       | glob                   | 路径过滤（glob）                                                                    | `paths`       |
| `on`          | add,change             | 事件类型过滤                                                                        | `on`          |
| `concurrency` | N                      | 并发上限                                                                            | `concurrency` |
| `debounce`    | wait,maxWait           | 堆积窗（watch 用）                                                                  | `debounce`    |
| `if-exists`   | skip\|overwrite\|merge | `rename` 键冲突策略                                                                 | `ifExists`    |
| `on-error`    | continue\|stop         | 失败策略                                                                            | `onError`     |
| `on-busy`     | queue                  | 重启语义（§6.6 的 `restart`/`ignore` 尚未实现，给了即报错，不静默按 queue 跑）      | `onBusy`      |

**一一对应是不变量**：命令行多词 key 用 kebab-case、配置段用 camelCase，逐项对得上；例外只有 `use`（引用入口，无配置段项）与 `dryRun`（由运行时 `--apply` 承载）。两侧共用同一套解析与校验（`src/orchestrator/params.ts`），新增字段必须同时补两侧，否则一侧会**静默丢参数**。

**值切分**：逗号切分**括号感知**——`[]`/`{}`/`()` 内的逗号是字面量，不是分隔符。因此 `actions=set tags=[a, b],index` 与 `paths=**/*.{md,txt}` 均可正确切分。括号外的引号内逗号仍是分隔符（splitTopLevel 不认引号）——算子参数含顶层逗号时（如 `filter status == "a,b"`）改用 `step`/`steps` 声明式写法：一元素一算子 spec，**不做任何切分**；`steps` 存在时优先于 `actions`（D12）。命令行显式给出链（`step` 或 `actions` 任一形态）时整体覆盖基底链，基底的另一形态不沿用。

**非法值口径**：未知 key、非法事件类型、非正整数并发、`wait > maxWait`、未知枚举值一律**声明期报错**并指明来源（`--pipe on` vs `pipelines.<name>.on`），不静默忽略、不静默降级——拼错的过滤条件比报错危险。

**运行环境**（顶层 flag，与管道无关）：`--vault` `--db` `--json` `--apply`。

- `--apply` = 运行时落盘闸，覆盖管道 `dryRun` 默认（"这次要不要落盘"是运行时决定，不属管道定义）。

**解析**：收集所有 `--pipe k=v` → 若含 `use=name` 先加载配置基底 → 其余 k=v 覆盖 → 得 `PipelineConfig`。唯一一个 `--pipe` 参数，配置引用（`use`）与内联字段平级；命令行可逐行翻成配置、反之亦然。

### 8.2 三命令共享、命令只决定「源」

`scan`（FS↔DB diff 源）/ `watch`（事件流源）/ `run`（默认 scan 源，`--pipe where=` 切 DQL 手动源、`--stdin` 切文件列表手动源）共用同一套 `--pipe`：

> **`paths` 不切源**：它始终只是 glob 路由过滤（在 `runBatch` 内 `matchEvent` 生效）。显式文件列表源归 §8.3 的 `--stdin`，不污染 `--pipe`。

```bash
x-basalt run --pipe actions=index,normalize --pipe where="LIST FROM #pkm" --apply   # 纯内联（自包含）
x-basalt run --pipe use=maintain --apply                                            # 配置引用
x-basalt run --pipe use=maintain --pipe concurrency=8                               # 引用 + 覆盖
x-basalt scan --pipe use=maintain                                                   # 一次性 diff 源
x-basalt watch --pipe use=maintain --apply                                          # 常驻事件源
```

配置段（命名快照，主要给常驻 / 反复复用；每个 key ⟷ 一个 `--pipe key=val`）：

```yaml
# .x-basalt/config
pipelines:
  maintain:
    actions: [index, normalize] # 与 steps 至少其一（逗号分隔面）
    # steps: # 声明式步骤列表（一元素一算子 spec，不切分；存在时优先于 actions）
    #   - filter status == "a,b"
    #   - limit 5
    where: "contains(file.tags, 'pkm')"
    on: [add, change]
    paths: ["pkm/**"]
    debounce: { wait: 300, maxWait: 3000 }
    concurrency: 4
    dryRun: true # 默认预览；命令行 --apply 覆盖
```

### 8.3 原生管道（stdin）—— 与 `--pipe` 正交的独立设计

`run --stdin` 已支持文本路径列表：读 EOF，逐行 trim，跳过空行与 `#` 注释，TTY 无输入报错；与 `--pipe` 正交，同给 where 时 stdin 供源、where 作过滤。声明期校验 Vault 边界，不实现 JSON 格式嗅探/ASCII 输出。跨平台增强仍见 [shell-pipe-portability](shell-pipe-portability.md)，旧取舍见[归档](../archive/decisions/2026-06-29-change-orchestration-record.md#83-原生管道stdin-与---pipe-正交的独立设计)。

## 9. 关键风险与坑（写动作 + watch 的命门）

1. **无限循环（最高危）**：`normalize`/`apply` 改 `.md` → watch 捕获 → 再触发自己。
   - **天然缓解**：meta 的"无变化不落盘 + 幂等"使回环在**一次收敛后停**（第二遍无变化→不写→无新事件）。
   - **彻底防护**：写动作落盘后登记 `path+mtime` 到"自产生集"，watch 回调比对命中即跳过；叠加 debounce 兜底。当前 `src/orchestrator/engine.ts` 以写后短暂忽略窗降低回环；幂等不等于无并发覆盖风险。
2. 编辑器原子保存竞争：chokidar `atomic`+`awaitWriteFinish` 已兜底。
3. 惊群（git checkout / 同步插件批量写）：debounce + scan 模式天然免疫。
4. inotify 句柄耗尽 / WSL·网络盘失效：提供轮询降级（`usePolling`）。
5. 符号链接环/网络盘：不假设所有文件系统语义已验收，需结合 indexer 配置与实际平台测试；不得把旧建议当已落实的默认值。
6. 临时文件误触发（`.swp`/`~`）：忽略列表 + `.gitignore` 集成。
7. macOS 大小写改名漏检：文档告知，规范化文件名避免仅改大小写。

## 10. 与其它 backlog 的关系

- **吸收并重定位**：TODO 的 `watch pipeline`（= watch 源 + 维护动作链）与 `migrate`（= 手动源 + 写动作）**都是本编排器的子集**，不再各自立项。
- **正交于检索/chat**：编排器是"维护"侧；FTS5/语义检索是"查询"侧；chat 是"对话前端"。互不依赖，可独立推进。
- **复用 profile**：`apply` 动作直接用现有 `pkm-note`/`llm-wiki`/`ssg-blog`，"更多 profile" backlog 自动并入。

## 11. 不做（YAGNI / 守身份）

- 不做独立 `migrate` 命令（§2.3）。
- 不做分布式语义；旧选型全集见 §5 的归档入口。
- 不把动作做成任意脚本编排器（裸 shell 仅留逃生口）。
- P0 不做 DAG / 补偿回滚 / 重试退避 / 定时触发 / 配置热重载。
- 不引入 AI（编排器纯离线确定性）。

## 12. 实现分阶段路线

本节历史内容已归档，见[原章节](../archive/decisions/2026-06-29-change-orchestration-record.md#12-实现分阶段路线)。当前规则与剩余边界见本文有效章节。

## 15. 来源索引

- 第三方：MetaEdit（github.com/chhoumann/MetaEdit）、Obsidian Linter（github.com/platers/obsidian-linter）、obsidian-metadata（github.com/natelandau/obsidian-metadata）、yq（mikefarah.gitbook.io/yq）。
- 官方：Properties（help.obsidian.md/properties）、Bases syntax（help.obsidian.md/bases/syntax）、processFrontMatter（docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter）、MetadataCache（docs.obsidian.md/Reference/TypeScript+API/MetadataCache）。
- 编排/流处理：watchexec（watchexec.github.io/docs）、watchman settle（facebook.github.io/watchman/docs/config）、@parcel/watcher（github.com/parcel-bundler/watcher）、dbt selectors（docs.getdbt.com/reference/node-selection/syntax）、turborepo（turborepo.dev/docs/reference/run）、RxJS operators（rxjs.dev/api/operators）、Kafka Streams windowing（confluent.io/blog/windowing-in-kafka-streams）、Temporal retry（docs.temporal.io/encyclopedia/retry-policies）、Airflow DAG（airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags）、Node.js backpressure（nodejs.org/learn/modules/backpressuring-in-streams）、chokidar（github.com/paulmillr/chokidar）。

[by=x-basalt]

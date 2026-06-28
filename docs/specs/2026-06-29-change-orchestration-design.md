---
type: design
title: 变更编排器设计评估（统一 watch/scan/手动 三源的声明式维护管线）
description: 评估把 watch/scan/migrate 统一为一个声明式「变更编排器」：五段流水线（源→堆积→去重→路由→执行）+ 全维度地图 + P0 骨架 + 实现分阶段；含 migrate 三方调研归档（结论：不单独立项，降级为编排动作）
tags:
  - orchestration
  - watch
  - pipeline
  - migrate
  - design
timestamp: 2026-06-28T17:03:41Z
sha256: d0c272b39c31faadef0fbd4f95b2c939d927d77f74257f5fa792ba3f849365e9
---
# 设计评估：变更编排器（change orchestration）—— 统一 watch / scan / 手动 三源的声明式维护管线

> 日期：2026-06-29 · 类型：设计评估（**非开工**，只论"将来若做，怎么做才立得住"）
> 触发：用户问 TODO 里 `migrate`（vault 级批量改造）怎么做 → 三方调研后判定「migrate 这个维度不该单独立项」，真正值得做的是围绕**变更流**的编排能力。
> 关联：承接 [`../../TODO.md`](../../TODO.md) 的 `watch pipeline` 与 `migrate` 两项（本文将二者合并、重定位）；现状见 `src/indexer/index.ts`（scan/watch）、`src/meta/*`（写侧）、`src/query/index.ts`（DQL）。
> 外部调研：① 第三方批量元数据工具（MetaEdit / Obsidian Linter / obsidian-metadata / yq）；② 官方 Obsidian（Properties / Bases / `processFrontMatter` API）；③ 编排/流处理/工作流（watchexec / entr / watchman / dbt / turborepo / RxJS / Kafka Streams / Temporal / Airflow / Prefect）。

## 0. 这份文档要回答的问题

> 「TODO 里的 `migrate`（批量改 vault 元数据）该怎么做？——调研后发现这个问题问错了：批量改属性**键**官方本体已做，CLI 重复造价值有限。真正的空白是围绕**变更流**的『编排』。那么，一个纯离线、单机的 Obsidian vault『变更编排器』该长什么样，哪些能力维度必须有、哪些是过度设计？」

**结论先行（TL;DR）**

1. **`migrate` 不单独立项**。"批量 rename / delete 属性**键**"官方 Properties 面板已做（1.4 rename / 1.10 delete，全库联动且能更新链接），CLI 离线反而更弱；官方明确留白的是"批量改属性**值** / 条件化 / 无头 / 格式注释保真"。但这些不该按"批量改元数据"维度切——它们是**编排器的一个写动作**，不是顶层功能。（详见 §2 调研归档）
2. **真正要做的是「变更编排器」**：把现在割裂的 `watch`（实时）、`scan`（按需 diff）、未来的"手动批量"统一成**同一条声明式流水线的三个「源」**，经 堆积 → 去重 → 路由 → 执行，自动跑一串**强类型内建动作**维护 vault。（§3、§4）
3. **设计做完整、实现分阶段**。本文把全维度地图（§5）一次性定清以防漏，但落地遵循 dogfood "最小切口"纪律：P0 先用**只读动作**（index / scan / normalize-dryrun）跑通骨架，**写动作后置且默认 dry-run**（§6、§12）。
4. **现在不写实现代码**。本文是可落地性评估，触发条件见 §13；具体算子集见 §14。

## 1. 设计脊梁（任何与之冲突的设计一律否决）

- **三源统一**：`watch` 是推（事件流）、`scan` 是拉（FS↔DB diff）、`手动` 是点（给定 DQL / 文件列表）。三者只有「源」不同，**堆积 / 去重 / 路由 / 执行四段完全复用**。这是把 TODO 里割裂的 watch-pipeline / scan / migrate 收敛成一个东西的根。
- **动作是强类型内建动词，不是裸 shell**。管道动作 = `index` / `normalize` / `apply` 等 x-basalt 自己的强类型动词，各自有明确的输入 / 输出 / 失败语义 / 幂等性 / 是否写盘契约（§7）。现有 `watch --on-change <裸shell>` **保留作逃生口**，但不是管道的一等公民。
- **声明式、配置驱动**。管道声明在配置（`.x-basalt/config` 的 `pipelines:` 段，§8），不在命令行硬拼，便于常驻复用与审计。
- **写动作安全闸 + 无限循环防护是命门**。常驻进程自动改 `.md` 风险最高：默认 dry-run、显式开写、失败汇总不中断、非 TTY 拒写、并**必须防"动作改文件→watch 又触发自己"的回环**（§9 坑①）。
- **纯离线、零新重依赖**。不引入 AI、不引入分布式运行时（§11）；编排器是对现有 parser/indexer/query/meta 四层的**编排**，不新造 vault 能力。
- **不变量沿用 AGENTS.md**：indexer 是唯一写 SQLite 的层、meta 是唯一写 `.md` 的层、隐式字段查询期 JOIN 实时算。编排器只调度它们，不绕过边界。

## 2. 背景：为什么不是 `migrate`（三方调研归档）

> 此节归档"migrate 调研要落地"的结论，供日后回溯"为什么没做独立 migrate"。

### 2.1 第三方工具（MetaEdit / Linter / obsidian-metadata / yq）

- **操作原语**普遍有 set/delete/rename key、改值；少数有 transpose（frontmatter↔inline）。
- **文件选择普遍弱**：最多到路径 glob / 路径 regex / 简单 key 包含匹配。**没有一个能表达**"打了 `#project`、无 `status`、近 30 天被反链"这类语义选择。obsidian-metadata 的 filter 方向对但实现弱（`Issue #85` 把"包含"当"等于"），且 2024-07 已归档。
- **该抄的**：两步提交（内存累积→review diff→commit）、dry-run 一等公民、原子写（tmp+rename）、结构化操作（非 sed 字符串替换）、受控并发（p-limit 防 EMFILE）、结构化报告（改/跳/失败计数）。
- **该避的坑**：parse→stringify 丢注释 / 丢键序 / 改数组格式（污染 git diff）；用 regex 解析 YAML（Linter 的 bug 之源）；YAML 1.1 Norway 陷阱（`yes/no` 当布尔）；批量模式静默降级；`---` 正文分隔线误判为 frontmatter 边界。

### 2.2 官方 Obsidian（Properties / Bases / API）

- **官方已做（不要重复造）**：全库 rename property **key**（1.4+）、delete property **key**（1.10+，且在线 rename 能联动更新引用链接，离线 CLI 做不到）；6 种属性类型系统；`tag→tags` 等单数→复数自动升级。
- **官方明确留白（CLI 机会窗口）**：批量改属性**值**（filter→patch，论坛最高频诉求）、全库 rename 属性**值**、无头/离线、**YAML 注释/格式保真**（官方 `processFrontMatter` 是**故意**破坏注释/引号/内联数组的，开发者原话；我们用 `eemeli/yaml` Document 往返可保真，是真实差异点）、迁移规则链。
- **该对齐的官方语义**：6 种类型名与 ISO 8601 日期格式；`tags/aliases/cssclasses` 视为保留 List；Bases 过滤谓词（`hasTag()` / `inFolder()` / `hasLink()`、`== != > < >= <=`）作为我们 DQL 路由的语义参照。

### 2.3 结论

`migrate`（按"批量改元数据"维度的独立功能）**不立项**。其真正有价值的内核——"**用语义条件选一批文件 + 对它们跑写动作**"——拆成编排器的两个维度：**路由（DQL 选择器，§6.4）** + **写动作（apply/normalize/set，§7）**。"手动批量改造"只是编排器**手动源**的一个用法。

## 3. 现状对接（基于实查 `src/`）

- **`watch`**：chokidar 监听 → 每个事件 fire-and-forget 立即 `update()` 单文件 + 可选跑 `--on-change` 裸 shell。**逐事件、无堆积/去重/管道/批量**；`awaitWriteFinish(100ms)` 仅是单文件稳定窗。
- **`scan`**：`computeDiff`（FS↔DB）→ `scanIter` 分批 (re)build，**已具批量**（`REBUILD_BATCH=100`、批内并发、批间串行）、**断点续扫**（未写文件下次仍被检出）、`--rehash`（内容对比）、`--dry-run`。但**死绑 index 一个动作**。
- **写侧 `src/meta`**：`editMeta`（原子写 tmp+rename、非法 YAML 拒写、**无字节变化不落盘**、dry-run）、`set/unset/rename`、`applyProfile`、`normalizeDoc`、`coerceValue`（**已守 Norway**）。**执行层安全底座已搭一半。**
- **查询 `src/query`**：`DataviewEngine.query(dql)` 只读索引、参数化 SQL——**天然就是路由选择器的引擎**。
- **关键复用点**：`scan` 的"分批+断点续"= 检查点雏形；`--rehash` = 内容 hash 去重（L4）；meta 的"无变化不落盘" = **让写动作的无限循环天然收敛**（§9 坑①）；rebuild/scan 的"单文件失败跳过+warn" = continue 失败策略雏形。

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

> 注：本节是**能力维度**（概念层）；落到可命名、可组合的**具体算子**见 §14「编排算子集」。

> 取舍：🟢P0（骨架成立+安全的最小集）/ 🟡P1（显著价值，次轮）/ ⚪P2（可推迟）/ ✗（单机过度，不做）。【现状】= 已具备可复用。

**前端（源进入堆积前）**

| 维度 | 含义 | 取舍 |
|---|---|---|
| 初始运行 | watch 启动先全量 scan 建基线 | 🟢 |
| 事件类型过滤/分流 | create/modify/delete 驱动不同动作 | 🟢【watch 已分 add/change/unlink，未驱动动作】 |
| 入口过滤 | 路径/glob、`.gitignore`、临时文件、符号链接不穿透 | 🟢【隐藏目录已滤；符号链接默认穿透**未关**】 |
| 手动触发 | 手动跑一次（调试/批量改造入口） | 🟡 |
| 定时/空闲/阈值触发 | cron / on-idle / 累积 N 个 | ⚪（业界几乎无实现） |

**② 堆积**

| 维度 | 含义 | 取舍 |
|---|---|---|
| debounce（时间窗） | 静默 N ms 触发，folds burst | 🟢 |
| **max-wait 上限** | 持续编辑时强制 flush，**防 debounce 饿死** | 🟢 |
| settle-time | 等文件大小稳定 | 🟡【chokidar `awaitWriteFinish` 已是单文件版】 |
| throttle / 固定窗 / 采样 | 其它窗口策略 | ⚪ |

**③ 去重（谱系 L0–L5）**

| 层级 | 语义 | 取舍 |
|---|---|---|
| L2 路径折叠(LWW) | 窗口内同路径留最新 | 🟢 |
| **L3 事件类型折叠** | `create+delete→抵消`、`create+update→create` | 🟢 |
| L4 内容 hash 去重 | 内容没变不触发 | 🟡【`scan --rehash` 已是】 |
| L5 执行层幂等键 | `path+mtime`/hash 兜底，重启不重复 | ⚪ |
| L0 无去重 / L1 相邻去重 | — | ✗（不够）/ ⚪ |

**④ 路由 / 选择**

| 维度 | 含义 | 取舍 |
|---|---|---|
| **DQL 语义路由(N:M)** | 标签/反链/缺字段/日期条件 → 动作子集 | 🟢（独有优势落点） |
| 条件分支 | 不同文件类型走不同动作 | 🟡 |
| 依赖 DAG / 扇出扇入 | 动作图、并行+汇聚 | ⚪（串行够用） |
| 图选择器（上下游） | 沿 wikilink 引用图传播 | ⚪ |

**⑤ 执行**

| 维度 | 含义 | 取舍 |
|---|---|---|
| 有界并发 | `concurrency=N`，防瞬起百进程 | 🟢 |
| **重启/中断语义** | 新批来时正在跑的：排队/杀重来/忙时丢/不动 | 🟢（默认有界并发+排队合并） |
| 超时 | 单任务卡死兜底 | 🟢 |
| 失败策略 | fail-fast vs continue | 🟢【单文件失败跳过=continue 雏形】 |
| dry-run | 写动作默认预览 | 🟢【meta 已支持】 |
| 优雅退出 | 跑完当前批再退，防半写损坏 | 🟢 |
| 背压 | 队列满暂停消费，防 OOM | 🟡 |
| 缓存/跳过 | 动作输入没变就跳过 | 🟡 |
| 检查点/续跑 | 崩溃重启不漏 | 🟡【scan 断点续=天然版本】 |
| 重试退避 | 瞬态失败重试 | ⚪（纯本地意义有限） |
| 补偿/回滚 | 多步部分失败清理 | ⚪（简化版） |

**后端（执行之后）**

| 维度 | 含义 | 取舍 |
|---|---|---|
| 结构化报告 | 改/跳/失败计数 + JSON | 🟢 |
| 失败告警/钩子 | 桌面通知 / webhook | 🟡 |
| 配置热重载 | 改管道不重启 | ⚪ |

**单机一律不做（✗）**：watermark、event-time/processing-time 区分、Kafka log compaction、exactly-once（2PC）、Flink credit 背压、分布式快照、消息总线、Temporal/工作流服务、远程共享缓存、隐式依赖推导。这些是分布式专属，单机用 `Map` / SQLite / `p-limit` / `Promise.race` 即得同等语义。

## 6. P0 骨架定义（每段的接口 / 语义 / 失败 / 幂等）

### 6.1 源（Source）
统一产出 `ChangeEvent { path, type: add|change|unlink, mtime?, size? }` 流。
- `watch`：chokidar → 事件流；启动前先跑一次 scan 建基线（初始运行）。
- `scan`：`computeDiff` 的 added/modified/deleted 投影成同构 `ChangeEvent[]`（一次性有界流）。
- `手动`：DQL 查询结果或文件列表 → 投影成 `type=change` 的 `ChangeEvent[]`。
- **失败语义**：源错误降级为 warn 不崩（沿用现有 `onError`）。

### 6.2 堆积（Accumulate）
- 入参：事件流；出参：`ChangeEvent[]` 批。
- 语义：trailing-edge debounce `wait` ms；自第一个事件起超过 `maxWait` ms 强制 flush（防饿死）。`scan`/`手动`源是有界批，跳过堆积直接整批下传。
- 幂等：纯函数式累积，无副作用。

### 6.3 去重（Dedup）
- 按 `path_key` 归并（L2 LWW：留窗口内最新 mtime 的事件）。
- 叠加 L3 折叠规则表：

| 窗口内序列 | 折叠结果 |
|---|---|
| add → change(×N) | add |
| change(×N) | change |
| add → unlink | **抵消（丢弃，不触发动作）** |
| change → unlink | unlink |
| unlink → add | change |

- 幂等：同一批重复跑结果相同。

### 6.4 路由（Route）
- 入参：去重批 + 管道声明的 `on`（事件类型）/ `where`（DQL）/ `paths`（glob）。
- 语义：先用便宜的事件类型/glob 过滤（不查库）；再用 DQL 做语义路由。
- **一致性纪律（关键）**：DQL 读的是**索引**，而写动作改的是 `.md`。故 watch 流中 `index` 动作必须排在写动作**之前**先把本批变更落库，使后续 DQL 路由看到的是新鲜索引；`手动`源若依赖 DQL，先确保用户已 `scan`（或编排器在选择前自动增量 scan 一次）。**绝不在陈旧索引上路由写动作。**
- 失败：DQL 语法/字段错 → 该管道拒跑并报错（不静默空选）。

### 6.5 管道动作（Pipeline action）
每个动作实现统一契约（见 §7）。链内默认**串行**（顺序即依赖）；P0 不引入 DAG。

### 6.6 执行（Run）
- 有界并发 `concurrency=N`（默认保守，如 4；同步的 better-sqlite3 写动作天然串行，并发主要作用于读盘/解析）。
- **重启语义 `onBusy`**：`queue`（默认，排队并对同文件合并）/ `restart`（弃旧重跑）/ `ignore`（忙时丢弃新批）。
- `timeout` 单动作超时（`Promise.race + AbortController`）。
- **失败策略 `onError`**：`continue`（默认，单文件/单动作失败跳过+记录，沿用现有 warn 模式）/ `stop`。
- 写动作默认 `dryRun:true`，显式 `--apply` 才落盘；非 TTY 默认拒写。
- **优雅退出**：SIGINT/SIGTERM 时停止接新批、跑完当前批、关 DB/watcher 再退。
- 出口：结构化报告 `{ total, changed, skipped, failed[], dryRun }` + exit code（0 全成功 / 1 部分失败 / 2 全失败）。

## 7. 动作清单（内建强类型动词）

| 动作 | 读/写 | 输入 | 幂等 | 失败语义 | 需新鲜索引 |
|---|---|---|---|---|---|
| `index` | 写 DB | 单文件/批 | 是（先删后插） | 跳过+warn | — |
| `normalize` | 写 .md | 单文件 | 是（无变化不落盘） | 拒非法YAML、跳过+warn | 否 |
| `apply <profile>` | 写 .md | 单文件 | 是（top-up） | 同上 | 否 |
| `set/unset/rename` | 写 .md | 单文件 | rename 遇冲突需 `--if-exists` 策略 | 跳过+warn | 否 |
| `parse` | 只读 | 单文件 | 是 | 跳过+warn | — |
| `shell <cmd>`（逃生口） | 任意 | `{file}` 占位 | 不保证 | 上报 stderr | — |

- **写动作分级**：`index`/`parse` 读侧直接放行；`normalize`/`apply`/`set...` 默认 dry-run + 确认闸。
- **`rename` 的批量冲突**：现有 `renameMeta` 遇目标键已存在是抛错；批量场景需 `--if-exists skip|overwrite|merge`，否则一个冲突=整批多文件失败。

## 8. 配置形态（示意，不冻结）

```yaml
# .x-basalt/config
pipelines:
  maintain:                      # 一个命名管道
    on: [add, change]            # 事件类型过滤
    paths: ["pkm/**"]            # glob 入口过滤
    where: "contains(file.tags, 'pkm')"   # DQL 语义路由（可选）
    debounce: { wait: 300, maxWait: 3000 }
    dedup: event-fold            # L2+L3
    concurrency: 4
    onBusy: queue
    onError: continue
    dryRun: true                 # 写动作默认预览
    actions:
      - index                    # 先落库（保证后续 where 新鲜）
      - normalize
      - { apply: pkm-note }
```

命令面设想（不冻结，与现有子命令对齐）：
- `x-basalt watch --pipeline maintain`（常驻，watch 源）
- `x-basalt scan --pipeline maintain`（一次性，diff 源）
- `x-basalt run maintain --where "<dql>"`（手动源，批量改造入口 = 原 migrate 用法）

## 9. 关键风险与坑（写动作 + watch 的命门）

1. **无限循环（最高危）**：`normalize`/`apply` 改 `.md` → watch 捕获 → 再触发自己。
   - **天然缓解**：meta 的"无变化不落盘 + 幂等"使回环在**一次收敛后停**（第二遍无变化→不写→无新事件）。
   - **彻底防护**：写动作落盘后登记 `path+mtime` 到"自产生集"，watch 回调比对命中即跳过；叠加 debounce 兜底。P0 必须实现至少"自产生集"或"写后短暂忽略该路径"。
2. 编辑器原子保存竞争：chokidar `atomic`+`awaitWriteFinish` 已兜底。
3. 惊群（git checkout / 同步插件批量写）：debounce + scan 模式天然免疫。
4. inotify 句柄耗尽 / WSL·网络盘失效：提供轮询降级（`usePolling`）。
5. 符号链接环：`followSymlinks:false`（当前默认穿透，需改）。
6. 临时文件误触发（`.swp`/`~`）：忽略列表 + `.gitignore` 集成。
7. macOS 大小写改名漏检：文档告知，规范化文件名避免仅改大小写。

## 10. 与其它 backlog 的关系

- **吸收并重定位**：TODO 的 `watch pipeline`（= watch 源 + 维护动作链）与 `migrate`（= 手动源 + 写动作）**都是本编排器的子集**，不再各自立项。
- **正交于检索/chat**：编排器是"维护"侧；FTS5/语义检索是"查询"侧；chat 是"对话前端"。互不依赖，可独立推进。
- **复用 profile**：`apply` 动作直接用现有 `pkm-note`/`llm-wiki`/`ssg-blog`，"更多 profile" backlog 自动并入。

## 11. 不做（YAGNI / 守身份）

- 不做独立 `migrate` 命令（§2.3）。
- 不做分布式语义（§5 ✗ 全列）。
- 不把动作做成任意脚本编排器（裸 shell 仅留逃生口）。
- P0 不做 DAG / 补偿回滚 / 重试退避 / 定时触发 / 配置热重载。
- 不引入 AI（编排器纯离线确定性）。

## 12. 实现分阶段路线

- **P0（骨架，只读先行）**：三源统一 + debounce(带 maxWait) + L2/L3 去重 + DQL 路由 + 串行管道 + 有界并发 + 重启语义(queue) + 超时 + 失败 continue + dry-run + 优雅退出 + **无限循环防护**。动作先开 `index` / `scan-reindex` / `normalize --dry-run` 跑通端到端，**写动作默认 dry-run**。
- **P1**：开放写动作落盘（确认闸）、`apply`/`set/unset/rename(+--if-exists)`、背压、缓存跳过、条件分支、检查点续跑、内容 hash 去重、失败告警。
- **P2/✗**：DAG、补偿回滚、定时/空闲触发、配置热重载、桌面通知。

## 13. 触发条件（何时才值得开工）

满足其一即可立计划（对齐 dogfood "等真实需求"纪律）：
1. dogfood 中反复出现"改完一批笔记后要手动 `scan` + 逐个 `apply/normalize`"的重复劳动 → 先做**手动源 + 只读/dry-run 管道**。
2. 出现"希望编辑时自动维护索引/元数据"的常驻需求，且能接受"写动作默认 dry-run、显式开写" → 做 **watch 源 + P0 骨架**。
3. 在此之前：仅存档本评估；TODO 把 `watch pipeline` 与 `migrate` 两项合并重定位为"变更编排器（有评估背书）"。**不写实现代码。**

## 14. 编排算子集（operator catalog）

> 把 §5 的能力维度落成**可命名、可组合的算子**——配置（§8）即这些算子的声明式组合。每个算子标注**现代体系出处**（借自哪个算子/概念）与**引入后对 x-basalt 体系的影响**。命名为设想，不冻结；取舍沿用 §5（🟢P0 / 🟡P1 / ⚪P2）。

### 14.1 源算子（source）

| 算子 | 语义 | 现代体系出处 | 引入对 x-basalt 的影响 | 取舍 |
|---|---|---|---|---|
| `watch` | chokidar 实时事件流源 | RxJS `fromEvent` / watchexec | 执行层须从 fire-and-forget 升级为有状态消费者 | 🟢【现有 watcher，无下游管线】 |
| `scan` | FS↔DB diff 快照源（一次性有界） | dbt `state:modified` / turbo `--affected` | 复用 `computeDiff`；天然免疫惊群 | 🟢【现有】 |
| `select(dql\|files)` | 手动源：DQL 结果或文件列表 | 数据集查询源 | query 引擎从"只读查询出口"扩为"编排源" | 🟢 |

### 14.2 堆积算子（accumulate）

| 算子 | 语义 | 现代体系出处 | 引入对 x-basalt 的影响 | 取舍 |
|---|---|---|---|---|
| `debounce(wait, maxWait)` | 防抖 + 强制 flush 上限 | RxJS `debounceTime`（无 maxWait）/ Lodash `debounce({maxWait})` / watchman settle | 堆积层须维护双计时器；决定触发延迟与"饿死"防护 | 🟢 |
| `settle(ms)` | 文件稳定窗（等大小稳定） | watchman `settle` / chokidar `awaitWriteFinish` | 把单文件稳定窗提升为批级 | 🟡【现有单文件版】 |

### 14.3 去重算子（dedup）

| 算子 | 语义 | 现代体系出处 | 引入对 x-basalt 的影响 | 取舍 |
|---|---|---|---|---|
| `coalesce(byPath)` | 路径折叠 LWW（L2） | Kafka log compaction（单机简化）/ RxJS `groupBy`+`scan` | 去重层须维护 `path→event` 状态 Map | 🟢 |
| `foldEvents` | 事件类型折叠（L3，`add+unlink→抵消`） | @parcel/watcher C++ 折叠规则 | 纯逻辑规则表；消除临时文件白触发 | 🟢 |
| `distinctByHash` | 内容 hash 去重（L4） | RxJS `distinctUntilChanged(byHash)` | 复用 `--rehash`/`sha256-body` | 🟡【现有 rehash】 |
| `idempotencyKey` | `path+mtime`/hash 兜底（L5） | Temporal idempotency key | SQLite UNIQUE 兜底，重启不重复执行 | ⚪ |

### 14.4 路由算子（route）

| 算子 | 语义 | 现代体系出处 | 引入对 x-basalt 的影响 | 取舍 |
|---|---|---|---|---|
| `match(types)` / `glob(pat)` | 事件类型 / 路径过滤 | RxJS `filter` | 便宜过滤先行（不查库） | 🟢【隐藏目录已滤】 |
| `where(dql)` | 语义谓词选择（N:M） | dbt selector / Obsidian Bases filter | **DQL 复用为路由谓词**，使"索引新鲜度"成为编排不变量（§6.4） | 🟢 |
| `branch(cond → actions)` | 条件分支（不同文件走不同动作） | Airflow BranchOperator | 管道从线性变有条件 | 🟡 |

### 14.5 执行算子（run）

| 算子 | 语义 | 现代体系出处 | 引入对 x-basalt 的影响 | 取舍 |
|---|---|---|---|---|
| `pipe(...actions)` | 串行动作链（顺序即依赖） | RxJS `pipe` / gulp `series` | 管道基本组合子 | 🟢 |
| `limit(N)` | 有界并发 | RxJS `mergeMap(_, N)` / p-limit / Airflow pool | 防瞬起百进程；同步 SQLite 写天然串行 | 🟢 |
| `onBusy(queue\|restart\|ignore)` | 重启/中断语义 | RxJS `concatMap` / `switchMap` / `exhaustMap` | **最关键算子**：执行层升为任务状态机 | 🟢 |
| `timeout(ms)` | 单动作超时 | RxJS `timeout` / `Promise.race`+`AbortController` | 防卡死兜底 | 🟢 |
| `onError(continue\|stop)` | 失败策略 | RxJS `catchError` / turbo `--continue` | 复用"单文件失败跳过+warn"雏形 | 🟢 |
| `dryRun` | 写动作预览（安全闸） | x-basalt 独有强约束 | 写动作默认开；§9 命门防护 | 🟢【meta 已支持】 |
| `parallel(...actions)` | 并行动作（DAG 雏形） | gulp `parallel` / `Promise.all` | 引入动作图 | ⚪ |
| `retry(n, backoff)` | 重试退避 | RxJS `retry` / Temporal RetryPolicy | 对外部调用有意义，纯本地小 | ⚪ |

### 14.6 动作算子（action，被编排的内建动词）

算子的"操作数"是 §7 的内建动词（`index` / `normalize` / `apply` / `set` / `unset` / `rename` / `parse` / `shell`）；14.1–14.5 是把它们组合起来的"组合子"。一条管道 = 源算子 → 堆积/去重/路由组合子 → `pipe(动作算子…)`，由执行算子约束其并发/失败/超时语义。

### 14.7 对现代体系的影响

**A. 对 x-basalt 自身架构的结构性影响**（采纳这套算子带来的改变）：

1. **执行层范式转变（最大影响）**：从现在 watch 的 fire-and-forget（来一个 `update` 一个）→ 有状态的**任务调度器**。`onBusy` + `limit` + `timeout` 合起来强制一个执行状态机，这是当前架构完全没有的。
2. **query 引擎角色扩展**：`where(dql)` 把 `DataviewEngine` 从"只读查询出口"变成"**编排谓词源**"，并因此把"**索引新鲜度**"提升为编排硬不变量（写动作前必先 `index`，§6.4）。
3. **配置层升级**：从 CLI flag → `.x-basalt/config` 的 `pipelines:` **声明式 DSL**，审计与复用单元从命令行迁到配置（§8）。
4. **新增有状态中间层**：`coalesce` / `debounce(maxWait)` 要求维护 `path→event` Map + 双计时器——这是现在「源→落库」直连里完全缺失的中间态。

**B. 相对现代编排体系的定位**（取了什么、砍了什么 → 对生态的影响）：

- **取语义、砍基建**：`onBusy` 借 RxJS 高阶 mapping（`concatMap`/`switchMap`/`exhaustMap`）的语义，但用 `Promise`+`Map` 实现，**不引入 RxJS 运行时**；`retry`/`limit`/`idempotencyKey` 借 Temporal/Airflow 概念，但用 `p-limit`/SQLite `UNIQUE` 实现，**不引入工作流服务**。算子 = **概念移植 + 单机最小实现**；§5 标 ✗ 的分布式基建（watermark / exactly-once / 分布式快照）一律不进。
- **对 PKM 工具生态的影响**：现有 Obsidian 自动化（Templater / QuickAdd / Linter）都在 GUI 内、**事件 × 单动作**、无堆积/去重/并发/重启语义。把"流处理算子 + 工作流编排原语"带到**无头 vault 维护**，让 vault 维护从"插件脚本"升级为**可声明、可组合、可审计的管线**——这是这套算子相对现代知识管理工具体系的实际差异点。

## 15. 来源索引

- 第三方：MetaEdit（github.com/chhoumann/MetaEdit）、Obsidian Linter（github.com/platers/obsidian-linter）、obsidian-metadata（github.com/natelandau/obsidian-metadata）、yq（mikefarah.gitbook.io/yq）。
- 官方：Properties（help.obsidian.md/properties）、Bases syntax（help.obsidian.md/bases/syntax）、processFrontMatter（docs.obsidian.md/Reference/TypeScript+API/FileManager/processFrontMatter）、MetadataCache（docs.obsidian.md/Reference/TypeScript+API/MetadataCache）。
- 编排/流处理：watchexec（watchexec.github.io/docs）、watchman settle（facebook.github.io/watchman/docs/config）、@parcel/watcher（github.com/parcel-bundler/watcher）、dbt selectors（docs.getdbt.com/reference/node-selection/syntax）、turborepo（turborepo.dev/docs/reference/run）、RxJS operators（rxjs.dev/api/operators）、Kafka Streams windowing（confluent.io/blog/windowing-in-kafka-streams）、Temporal retry（docs.temporal.io/encyclopedia/retry-policies）、Airflow DAG（airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags）、Node.js backpressure（nodejs.org/learn/modules/backpressuring-in-streams）、chokidar（github.com/paulmillr/chokidar）。

[by=x-basalt]

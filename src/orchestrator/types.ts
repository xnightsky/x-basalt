import type { VaultIndexer } from "../indexer/index.js";
import type { DataviewEngine } from "../query/index.js";

// === 自建实现: 变更编排器类型契约 ===
//
// 设计：docs/design/change-orchestration.md（§6 P0 骨架、§14 算子集）
// 计划：docs/history/plans/2026-06-29-change-orchestration.md
// 纯类型层，无运行时逻辑；被 dedup/accumulate/route/actions/run/engine 共同消费。
// 边界：编排器只调度现有 indexer/meta/query，不绕过其写边界（indexer 唯一写 SQLite、meta 唯一写 .md）。

/** 文件变更事件类型（对齐 chokidar add/change/unlink、scan diff 三态）。 */
export type EventType = "add" | "change" | "unlink";

/**
 * 统一变更事件：三种「源」（watch/scan/手动）都归一为此结构后进入管线。
 * ChangeEvent 是 Row 的窄化投影——event 必有值的那种（见 Row.event 的可选性）。
 */
export interface ChangeEvent {
  /** 相对 base 的 POSIX 路径（索引主键形态；多根 vault 时 base = 各根公共祖先）。 */
  path: string;
  type: EventType;
  /** 文件 mtime（ms）；unlink 或手动源可缺省。用于 LWW 折叠取最新。 */
  mtime?: number;
  /** 文件字节数；可缺省。 */
  size?: number;
}

// === 自建实现：统一算子模型的流动单位（设计：docs/design/pipeline-op-model.md §3.1）===

/** 流动单位：文件事件降为特例——path 保持一等字段以兼容 dedup/accumulate/route/防回环机制。 */
export interface Row {
  /** 索引主键形态的路径（现有 ChangeEvent.path 语义原样保留）。 */
  path: string;
  /** 文件事件类型；仅 scan/watch 源产出的行有，其余算子产出的行没有。 */
  event?: EventType;
  /** 上游算子的产物：DQL/base 的列、search 的评分、lint/links 的诊断。 */
  fields: Record<string, unknown>;
}

/** 动作执行上下文：编排器把现有四层能力注入给动作。 */
export interface ActionContext {
  /** @deprecated 不再使用：写动作改经 {@link ActionContext.indexer}.toAbsolute(ev.path) 还原绝对路径（按根命名空间，避免公共祖先 base 膨胀）。 */
  vaultPath?: string;
  /** 索引器（index 动作用；也是写动作还原 .md 绝对路径 + meta 写后刷新索引的入口）。 */
  indexer: VaultIndexer;
  /** 查询引擎（where 路由 / 需要查库的动作用），可选。 */
  engine?: DataviewEngine;
  /** 写动作安全闸：true 时写动作只预览不落盘（spec §6.6，P0 默认 true）。 */
  dryRun: boolean;
  /** 写动作落盘成功后回调路径（供编排器记录"自产生写"做防回环，spec §9 坑①）。 */
  onWrite?: (path: string) => void;
  /** rename 动作遇目标键已存在时的冲突策略（默认 skip）。 */
  ifExists?: "skip" | "overwrite" | "merge";
}

/** 单个动作对单个文件执行后的结果（供 RunReport 汇总）。 */
export interface ActionResult {
  action: string;
  path: string;
  /** 是否实际产生了变化（写 DB / 写 .md）。 */
  changed: boolean;
  /** 是否被跳过（dry-run 的写动作、或无需处理）。 */
  skipped: boolean;
  /** 失败原因；undefined = 成功。 */
  error?: string;
}

/** 内建动作契约：强类型动词，明确是否写 .md（决定 dry-run 闸）。 */
export interface Action {
  name: string;
  /** 是否写 `.md`（true 才受 dryRun 安全闸约束；写 DB 的 index 为 false）。 */
  write: boolean;
  run(ev: ChangeEvent, ctx: ActionContext): Promise<ActionResult>;
}

// === 自建实现：统一算子模型（设计：docs/design/pipeline-op-model.md §3.2）===

/**
 * 算子执行上下文：内容沿用现有 ActionContext 的字段。
 * 独立演进——算子层与动作层可各自演化，不必耦合。
 */
export interface OpContext {
  /** @deprecated 不再使用：写动作改经 {@link OpContext.indexer}.toAbsolute(row.path) 还原绝对路径。 */
  vaultPath?: string;
  /** 索引器（index 算子用；也是写算子还原 .md 绝对路径 + meta 写后刷新索引的入口）。 */
  indexer: VaultIndexer;
  /** 查询引擎（DQL/base 算子用），可选。 */
  engine?: DataviewEngine;
  /** 写动作安全闸：true 时写动作只预览不落盘。 */
  dryRun: boolean;
  /** 写动作落盘成功后回调路径（供调度层记录"自产生写"做防回环）。 */
  onWrite?: (path: string) => void;
  /** rename 写动作遇目标键已存在时的冲突策略（默认 skip）。 */
  ifExists?: "skip" | "overwrite" | "merge";
}

/** 统一算子签名：批进批出，一个签名覆盖源/转换/动作/汇四种角色。 */
export interface Op {
  name: string;
  /** 是否写 `.md`；true 才受 dry-run 安全闸约束（沿用现有 Action.write 语义）。 */
  write: boolean;
  /**
   * 逐行独立：该算子对每行的处理互不影响，调度层可任意切批并发（§3.2.1）。
   * false（默认，保守）= 必须看到完整批次，整批一次过（dedup/limit/emit 这类）。
   * 默认 false 的理由：若默认 true，依赖全批的算子会被静默切开，产出错误结果且难以复现。
   */
  rowwise: boolean;
  run(rows: Row[], ctx: OpContext): Promise<OpOutcome>;
}

/** 算子产出：**行、失败、变更三者分开返回**。
 * 调度层据 failed 把失败行从后续算子的输入中剔除（onError=continue 的新语义）。
 * `changed` / `skipped` 见 D9：旧模型这两个信号来自 `ActionResult.changed/skipped`，
 * `RunReport` 的 `changed`/`skipped`/`changedPaths`/`byAction` 全部由它们聚合而来；
 * 如果只返回 `rows` + `failed`，这些字段会静默归零——而 `changedPaths` 正是写后刷索引
 * （`d04d47d`）赖以工作的输入。 */
export interface OpOutcome {
  rows: Row[];
  failed: OpFailure[];
  /** 本算子真正改动了的行 path（写 DB 或写 .md）。只读算子恒为空数组。 */
  changed: string[];
  /** 本算子跳过的行 path（dry-run 的写算子、或无需处理）。 */
  skipped: string[];
}

/** 算子级执行步骤报告（runOpPipeline 产出，每条 Op 一条）。 */
export interface StepReport {
  /** 算子名。 */
  op: string;
  /** 进入该 Op 的行数。 */
  rowsIn: number;
  /** 成功通过该 Op 的行数（rowsOut = rowsIn - failed 条数）。 */
  rowsOut: number;
  /** 该 Op 产生的失败记录。 */
  failed: OpFailure[];
}

/** 逐行失败记录。 */
export interface OpFailure {
  /** 失败行的 path（索引主键形态）。 */
  path: string;
  /** 产生失败的算子名。 */
  op: string;
  error: string;
}

/** 一条声明式管道的配置（对应 spec §8 的 pipelines: 段一项）。 */
export interface PipelineConfig {
  /** 事件类型过滤；缺省 = 全部放行。 */
  on?: EventType[];
  /** glob 入口过滤（相对 Vault 路径）；缺省 = 不限。 */
  paths?: string[];
  /** DQL 语义路由谓词；缺省 = 不按语义筛。 */
  where?: string;
  /** 堆积：静默 wait ms 触发；自首事件起超 maxWait ms 强制 flush（防饿死）。 */
  debounce?: { wait: number; maxWait: number };
  /** 有界并发上限（默认 4）。 */
  concurrency?: number;
  /** 重启/中断语义（默认 queue）：排队合并 / 弃旧重跑 / 忙时丢弃。 */
  onBusy?: "queue" | "restart" | "ignore";
  /** 失败策略（默认 continue）：跳过继续 / 立即停止。 */
  onError?: "continue" | "stop";
  /** 写动作 dry-run（默认 true）。 */
  dryRun?: boolean;
  /** rename 写动作的键冲突策略（默认 skip）。 */
  ifExists?: "skip" | "overwrite" | "merge";
  /**
   * 写动作落盘后是否自动把改动文件刷进索引（默认 true）。
   * 关掉 = 落盘后索引与磁盘静默不一致，`query` 会查到旧值；只有在「稍后必定统一 index」时才该关。
   */
  refreshIndex?: boolean;
  /** 内建动作名序列（串行 pipe 执行）。 */
  actions: string[];
}

/**
 * 一次执行（一批事件跑完一条管道）的结构化报告。
 *
 * **口径纪律（2026-07-30 订正）**：`total`/`changed`/`skipped` 三者**同为文件数**。
 * 此前 `changed`/`skipped` 数的是**动作结果数**（文件 × 动作），与 `total`（文件数）不同单位——
 * `actions=set,index` 跑 28 个文件会报 `total:28 / changed:56`，`changed > total` 直接说不通，
 * 调用方根本无法判断「到底改了几篇」。分动作的明细没有丢，挪到 `byAction`。
 */
export interface RunReport {
  /** 处理的文件数（去重后批大小）。 */
  total: number;
  /** 实际产生变化的**文件数**（该文件至少有一个动作 changed）。 */
  changed: number;
  /** 被跳过的**文件数**（该文件至少有一个动作 skipped；含 dry-run 写动作）。 */
  skipped: number;
  /** 失败的动作结果（含路径与原因）。 */
  failed: ActionResult[];
  dryRun: boolean;
  /** 实际产生变化的文件路径（索引主键）。写后刷索引与调用方复核都靠它。 */
  changedPaths: string[];
  /** 分动作的改动计数（动作名 → 该动作改动了几个文件）——保留旧口径的明细。 */
  byAction: Record<string, number>;
  /** 写后自动刷进索引的文件数（dry-run 或动作链已含 index 时为 0）。见 engine.runBatch。 */
  reindexed: number;
  /** 算子管道执行步骤流水（仅 runOpPipeline 会填充，向后兼容保持可选）。 */
  steps?: StepReport[];
}

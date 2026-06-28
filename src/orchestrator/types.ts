import type { VaultIndexer } from "../indexer/index.js";
import type { DataviewEngine } from "../query/index.js";

// === 自建实现: 变更编排器类型契约 ===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md（§6 P0 骨架、§14 算子集）
// 计划：docs/plans/2026-06-29-change-orchestration.md
// 纯类型层，无运行时逻辑；被 dedup/accumulate/route/actions/run/engine 共同消费。
// 边界：编排器只调度现有 indexer/meta/query，不绕过其写边界（indexer 唯一写 SQLite、meta 唯一写 .md）。

/** 文件变更事件类型（对齐 chokidar add/change/unlink、scan diff 三态）。 */
export type EventType = "add" | "change" | "unlink";

/** 统一变更事件：三种「源」（watch/scan/手动）都归一为此结构后进入管线。 */
export interface ChangeEvent {
  /** 相对 Vault 根的 POSIX 路径（索引主键形态）。 */
  path: string;
  type: EventType;
  /** 文件 mtime（ms）；unlink 或手动源可缺省。用于 LWW 折叠取最新。 */
  mtime?: number;
  /** 文件字节数；可缺省。 */
  size?: number;
}

/** 动作执行上下文：编排器把现有四层能力注入给动作。 */
export interface ActionContext {
  vaultPath: string;
  /** 索引器（index 动作用；也是 meta 写后刷新索引的入口）。 */
  indexer: VaultIndexer;
  /** 查询引擎（where 路由 / 需要查库的动作用），可选。 */
  engine?: DataviewEngine;
  /** 写动作安全闸：true 时写动作只预览不落盘（spec §6.6，P0 默认 true）。 */
  dryRun: boolean;
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
  /** 内建动作名序列（串行 pipe 执行）。 */
  actions: string[];
}

/** 一次执行（一批事件跑完一条管道）的结构化报告。 */
export interface RunReport {
  /** 处理的文件数（去重后批大小）。 */
  total: number;
  /** 实际产生变化的动作结果数。 */
  changed: number;
  /** 跳过的动作结果数（含 dry-run 写动作）。 */
  skipped: number;
  /** 失败的动作结果（含路径与原因）。 */
  failed: ActionResult[];
  dryRun: boolean;
}

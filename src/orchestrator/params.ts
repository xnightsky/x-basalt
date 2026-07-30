import type { EventType, PipelineConfig } from "./types.js";

/**
 * 管道参数解析与校验：命令行 `--pipe k=v` 与配置段 `pipelines.<name>` 的**唯一**入口。
 *
 * 上游：`src/cli.ts`（scan/run/watch 的 `--pipe` 薄壳）、`src/config.ts`（`parsePipelines` 配置段）。
 * 下游：产出 {@link PipelineConfig} 交 `Orchestrator`；本文件纯解析，不碰 fs/DB/索引。
 *
 * 设计：docs/specs/2026-06-29-change-orchestration-design.md §8「管道 = 一组参数」。
 * 计划：docs/plans/2026-07-30-pipe-closure.md（PC-1/PC-2）。
 *
 * 跨模块不变量（一一对应）：命令行 key ⟷ 配置段 key 必须逐项对得上，
 * 例外只有两个——`use` 是配置引用入口（无配置段对应项）、`dryRun` 由运行时 `--apply` 承载。
 * 新增管道字段必须同时补 {@link PIPE_KEYS}、{@link CONFIG_KEY_OF} 与本文件的校验，
 * 否则一侧会**静默丢参数**（P0 时期 `debounce` 只能走配置、`onBusy` 被丢弃即此类回归）。
 */

// === 自建实现: 管道参数模型 ===

/** 命令行 `--pipe` 已知 key（多词用 kebab-case，与配置段 camelCase 经 {@link CONFIG_KEY_OF} 映射）。 */
export const PIPE_KEYS = [
  "use",
  "actions",
  "where",
  "paths",
  "on",
  "concurrency",
  "debounce",
  "if-exists",
  "on-error",
  "on-busy",
  "refresh-index",
] as const;

/** `--pipe` key → 配置段 key（同名者省略）；仅多词键需要映射。 */
const CONFIG_KEY_OF: Record<string, string> = {
  "if-exists": "ifExists",
  "on-error": "onError",
  "on-busy": "onBusy",
  "refresh-index": "refreshIndex",
};

/** 合法事件类型（对齐 chokidar add/change/unlink 与 scan diff 三态）。 */
const EVENT_TYPES = ["add", "change", "unlink"] as const;

/**
 * 按**顶层**逗号切分：括号（`[]` / `{}` / `()`）内的逗号不切。
 *
 * 为什么：管道值里的逗号有两种身份——分隔符（`actions=index,normalize`）与字面量
 * （`set tags=[a, b]` 的列表元素、`paths=**\/*.{md,txt}` 的 brace 展开）。裸 `split(",")`
 * 会把后者切碎，产出「动作名莫名多一截」「glob 少半边」这类难查的错。
 * 未闭合括号不在此报错（深度不归零 → 整串作一个 token），交由下游 set/glob 报更贴近的错。
 *
 * @param s - 单个 `--pipe` 值或配置段字符串
 * @returns 切分并 trim 后的非空段
 */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 值归一为字符串列表：命令行给逗号串、配置段给数组，两侧都收。 */
function toStringList(v: unknown, src: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "string") return splitTopLevel(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  throw new Error(`${src} 需字符串（逗号分隔）或字符串数组`);
}

/**
 * 事件类型过滤（`on`）：命令行 `add,change` 或配置段 `[add, change]` → `EventType[]`。
 *
 * @behavior
 * Given on 含非法事件类型（如 `modified`）
 * When toEventTypes
 * Then 抛错并带来源与合法值，而非裸转型后静默过滤掉全部事件
 */
export function toEventTypes(v: unknown, src: string): EventType[] | undefined {
  const list = toStringList(v, src);
  if (list === undefined) return undefined;
  for (const x of list) {
    if (!(EVENT_TYPES as readonly string[]).includes(x)) {
      throw new Error(`${src} 含非法事件类型 "${x}"，合法值：${EVENT_TYPES.join(", ")}`);
    }
  }
  return list as EventType[];
}

/** 路径 glob 过滤（`paths`）：命令行逗号串（brace 内逗号不切）或配置段数组。 */
export function toPaths(v: unknown, src: string): string[] | undefined {
  return toStringList(v, src);
}

/** 动作链（`actions`）：命令行逗号串（`set k=[a, b]` 内逗号不切）或配置段数组。 */
export function toActions(v: unknown, src: string): string[] | undefined {
  return toStringList(v, src);
}

/** 有界并发上限：必须正整数（`Number()` 出 NaN / 0 / 负数 / 小数一律报错，不静默降级）。 */
export function toConcurrency(v: unknown, src: string): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${src} 需正整数，得到 "${String(v)}"`);
  return n;
}

/**
 * 堆积窗（`debounce`）：命令行 `wait,maxWait`（如 `300,3000`）或配置段 `{wait, maxWait}`。
 *
 * @behavior
 * Given wait 大于 maxWait
 * When toDebounce
 * Then 抛错——maxWait 是「防饿死」的强制上限，小于静默窗则该上限永不生效，属配置错
 */
export function toDebounce(v: unknown, src: string): { wait: number; maxWait: number } | undefined {
  if (v === undefined) return undefined;
  let wait: unknown;
  let maxWait: unknown;
  if (typeof v === "string") {
    const parts = splitTopLevel(v);
    if (parts.length !== 2) throw new Error(`${src} 需 wait,maxWait 两个毫秒数，得到 "${v}"`);
    [wait, maxWait] = parts;
  } else if (typeof v === "object" && v !== null) {
    ({ wait, maxWait } = v as { wait?: unknown; maxWait?: unknown });
  } else {
    throw new Error(`${src} 需 "wait,maxWait" 或 {wait, maxWait}`);
  }
  const w = typeof wait === "number" ? wait : Number(String(wait).trim());
  const m = typeof maxWait === "number" ? maxWait : Number(String(maxWait).trim());
  if (!Number.isFinite(w) || !Number.isFinite(m) || w < 0 || m < 0) {
    throw new Error(
      `${src} 的 wait/maxWait 需非负毫秒数，得到 "${String(wait)},${String(maxWait)}"`,
    );
  }
  if (w > m) throw new Error(`${src} 的 wait(${w}) 不得大于 maxWait(${m})`);
  return { wait: w, maxWait: m };
}

/** 枚举字段通用校验：非法值报错并列可选值（`if-exists` / `on-error` 等共用）。 */
export function toEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  src: string,
): T | undefined {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if (!(allowed as readonly string[]).includes(s)) {
    throw new Error(`${src} 仅接受 ${allowed.join("|")}，得到 "${s}"`);
  }
  return s as T;
}

/**
 * 布尔开关（`refresh-index`）：命令行给 `true|false` 字面量、配置段给布尔。
 * 非法值报错，别静默当成 false（关了写后刷索引却不自知，query 会一直查到旧值）。
 */
export function toBoolean(v: unknown, src: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim();
  if (s !== "true" && s !== "false") throw new Error(`${src} 仅接受 true|false，得到 "${s}"`);
  return s === "true";
}

/**
 * 重启语义（`onBusy`，spec §211）。
 *
 * 现状边界：执行引擎只实现 `queue`（批之间串行成链）。`restart`（弃旧重跑）与 `ignore`
 * （忙时丢弃）需要给 `runPipeline` 串 AbortSignal 做协作取消，尚未实现——此处**显式报错**
 * 而不是接受后静默按 queue 跑，避免常驻 watch 的实际语义与声明不符。
 *
 * @behavior
 * Given onBusy=restart 或 ignore
 * When toOnBusy
 * Then 抛「尚未实现」错，指向 TODO 的执行引擎余项
 */
export function toOnBusy(v: unknown, src: string): PipelineConfig["onBusy"] {
  const mode = toEnum(v, ["queue", "restart", "ignore"] as const, src);
  if (mode === "restart" || mode === "ignore") {
    throw new Error(
      `${src}=${mode} 尚未实现（执行引擎当前只支持 queue：批之间串行）；见 TODO「变更编排器 P1 余项」`,
    );
  }
  return mode;
}

/** 把可重复的 `--pipe k=v` 收成映射；未知 key 与非 `k=v` 形态在此报错（拼错不静默）。 */
export function parsePipeFlags(flags: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const f of flags) {
    const i = f.indexOf("=");
    if (i <= 0) throw new Error(`--pipe 需 key=value 形式，得到 "${f}"`);
    const key = f.slice(0, i).trim();
    if (!(PIPE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`未知 --pipe key "${key}"，已知：${PIPE_KEYS.join(", ")}`);
    }
    kv[key] = f.slice(i + 1);
  }
  return kv;
}

/** 取某 key 的值：命令行优先，回落配置基底（基底用 camelCase key）。 */
function pick(kv: Record<string, string>, base: PipelineConfig | undefined, key: string): unknown {
  if (kv[key] !== undefined) return kv[key];
  const configKey = CONFIG_KEY_OF[key] ?? key;
  return (base as unknown as Record<string, unknown> | undefined)?.[configKey];
}

export interface ResolvePipelineOptions {
  /** 运行时落盘闸：`--apply` 覆盖管道定义的 `dryRun`（"这次要不要落盘"不属管道定义）。 */
  apply: boolean;
  /** 配置 `pipelines` 段，供 `use=<name>` 取命名快照作基底；缺省则只接受纯内联管道。 */
  pipelines?: Record<string, PipelineConfig>;
}

/**
 * 解析 `--pipe k=v`（可重复）为完整 {@link PipelineConfig}。
 *
 * 语义：先按 `use=<name>` 载入配置段基底 → 其余 k=v 逐项覆盖 → 校验每个字段。
 * 纯命令行即可自包含（不依赖配置），配置段只是命名快照，二者一一对应。
 *
 * @param flags - 原始 `--pipe` 值列表（commander 累积）
 * @param opts - 运行环境：`--apply` 闸与配置 `pipelines` 段
 * @returns 校验后的管道配置；任何非法/未知参数在此抛错（声明期失败）
 *
 * @behavior
 * Given use=<name> 且再给同名 k=v
 * When resolvePipelineParams
 * Then 命令行值覆盖配置基底，未覆盖字段沿用基底
 *
 * @behavior
 * Given use=<未知名>
 * When resolvePipelineParams
 * Then 抛错并列出配置里已知的管道名
 *
 * @behavior
 * Given 既无 actions 也无带 actions 的基底
 * When resolvePipelineParams
 * Then 抛错并指出内联与引用两种写法（不空跑一条无动作管道）
 */
export function resolvePipelineParams(
  flags: string[],
  opts: ResolvePipelineOptions,
): PipelineConfig {
  const kv = parsePipeFlags(flags);
  let base: PipelineConfig | undefined;
  if (kv.use !== undefined) {
    const name = kv.use.trim();
    base = opts.pipelines?.[name];
    if (!base) {
      const known = Object.keys(opts.pipelines ?? {}).join(", ") || "无";
      throw new Error(`未知管道 "${name}"（配置 pipelines 段；已知：${known}）`);
    }
  }
  const actions = toActions(pick(kv, base, "actions"), "--pipe actions");
  if (!actions || actions.length === 0) {
    throw new Error(
      "缺少管道动作：用 --pipe actions=index,normalize（内联）或 --pipe use=<配置管道>",
    );
  }
  const where = pick(kv, base, "where");
  return {
    actions,
    where: where === undefined ? undefined : String(where),
    paths: toPaths(pick(kv, base, "paths"), "--pipe paths"),
    on: toEventTypes(pick(kv, base, "on"), "--pipe on"),
    concurrency: toConcurrency(pick(kv, base, "concurrency"), "--pipe concurrency"),
    debounce: toDebounce(pick(kv, base, "debounce"), "--pipe debounce"),
    onBusy: toOnBusy(pick(kv, base, "on-busy"), "--pipe on-busy"),
    onError: toEnum(pick(kv, base, "on-error"), ["continue", "stop"] as const, "--pipe on-error"),
    // refresh-index：写动作落盘后是否自动刷索引；undefined 由引擎层 `?? true` 兜底，
    // 只有「稍后必定统一 index」的批处理才该显式关掉。
    refreshIndex: toBoolean(pick(kv, base, "refresh-index"), "--pipe refresh-index"),
    // --apply 是运行时闸，覆盖管道定义；否则用基底 dryRun，缺省保守预览。
    dryRun: opts.apply ? false : (base?.dryRun ?? true),
    ifExists: toEnum(
      pick(kv, base, "if-exists"),
      ["skip", "overwrite", "merge"] as const,
      "--pipe if-exists",
    ),
  };
}

import { cosmiconfigSync, type PublicExplorerSync } from "cosmiconfig";
import JSON5 from "json5";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { LintIgnoreConfig } from "./links/ignore.js";
import type { ProfileConfig } from "./lint/profile.js";
import type { PipelineConfig } from "./orchestrator/types.js";

// === 自建实现: 项目/全局配置加载，给 CLI 选项提供默认值（免去每次重复 --db/--vault 等）===
//
// 上游：cli.ts 启动时加载一次；下游：各子命令以 `flag ?? config.X ?? 内置默认` 解析。
// 不在 git 管理（项目配置已 gitignore）：相当于「本机/本项目该怎么跑」的记忆。
// 路径搜索用 cosmiconfig（M4.3）：项目配置从 cwd 向上找 searchPlaces；全局固定 <home>/.x-basalt/config.*。
// 解析：yaml 走 `yaml` 包、json5/json 走 JSON5。仅挑出已知字符串键；解析失败降级为 {}（warn 不抛错）。

/** 配置项（全部可选，字符串）。键名与 CLI 概念对应。 */
export interface BasaltConfig {
  /** 默认 SQLite 索引路径（对应 --db） */
  db?: string;
  /** 默认 Vault 根（对应 index/watch 的 <vault> 与 query 的 --vault）；支持单目录或多目录列表。 */
  vault?: string | string[];
  /** 默认 skill 目录（等价 OBSIDIAN_SKILL_PATH；设置后经 SkillRecall 优先生效） */
  skillPath?: string;
  /** 默认输出格式 json|yaml（对应 parse 的 --format） */
  format?: string;
  /** watch 默认的 on-change 命令模板（{file} 占位） */
  onChange?: string;
  /** 声明式管道（变更编排器，spec §8）：name → 管道配置。 */
  pipelines?: Record<string, PipelineConfig>;
  /** lint / links 配置（KB compiler P1）：目前仅 ignore 段。 */
  lint?: LintConfig;
  /** 自定义 metadata profile（KB compiler P3b）：name → 原始配置（extends 合并延后到 lint-run 期）。 */
  profiles?: Record<string, ProfileConfig>;
}

/** lint 配置（P1 仅 ignore）。 */
export interface LintConfig {
  ignore?: LintIgnoreConfig;
}

/** 从任意值挑出字符串数组（非数组 → 空；过滤掉非字符串项）。 */
function pickStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 解析配置的 lint 段：只挑 ignore.{paths,targets,rules}，畸形项静默丢弃（与 pickConfig 容错一致）。 */
export function parseLintConfig(raw: unknown): LintConfig {
  if (raw == null || typeof raw !== "object") return {};
  const ig = (raw as { ignore?: unknown }).ignore;
  if (ig == null || typeof ig !== "object") return {};
  const o = ig as Record<string, unknown>;
  const rulesRaw = (o.rules ?? {}) as Record<string, unknown>;
  const rules: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rulesRaw)) rules[k] = pickStringArray(v);
  return {
    ignore: { paths: pickStringArray(o.paths), targets: pickStringArray(o.targets), rules },
  };
}

/**
 * 解析配置的 profiles 段为原始 ProfileConfig 映射（自定义 metadata profile，KB compiler P3b）。
 * 宽容挑键（畸形字段静默丢弃，与 parseLintConfig 一致）：extends/include 非串 → 省略；required、
 * enums.<field> 非数组 → 空数组；profile 值非对象 → 视为空定义 `{ required:[], enums:{} }`。
 * extends 合并 / 环检测 / 未知父校验延后到 lint-run 期（src/lint/profile.ts resolveLintProfile）。
 */
export function parseProfiles(raw: unknown): Record<string, ProfileConfig> {
  if (raw == null || typeof raw !== "object") return {};
  const out: Record<string, ProfileConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const p = (value != null && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const enumsRaw = (p.enums != null && typeof p.enums === "object" ? p.enums : {}) as Record<
      string,
      unknown
    >;
    const enums: Record<string, string[]> = {};
    for (const [field, vals] of Object.entries(enumsRaw)) enums[field] = pickStringArray(vals);
    const cfg: ProfileConfig = { required: pickStringArray(p.required), enums };
    if (typeof p.extends === "string") cfg.extends = p.extends;
    if (typeof p.include === "string") cfg.include = p.include;
    out[name] = cfg;
  }
  return out;
}

/** 允许的字符串键（其余键忽略，避免误用）。 */
const KEYS = ["db", "vault", "skillPath", "format", "onChange"] as const;

// cosmiconfig 搜索位置（按优先级）：隐藏目录形式优先于扁平形式；同形式内 yaml > yml > json5 > json。
const SEARCH_PLACES = [
  ".x-basalt/config.yaml",
  ".x-basalt/config.yml",
  ".x-basalt/config.json5",
  ".x-basalt/config.json",
  ".x-basalt.yaml",
  ".x-basalt.yml",
  ".x-basalt.json5",
  ".x-basalt.json",
];

// 自定义 loader：yaml 走 `yaml` 包，json5/json 走 JSON5（容注释/尾逗号）。cosmiconfig 默认不识别 .json5。
const LOADERS = {
  ".yaml": (_p: string, c: string) => parseYaml(c),
  ".yml": (_p: string, c: string) => parseYaml(c),
  ".json5": (_p: string, c: string) => JSON5.parse(c),
  ".json": (_p: string, c: string) => JSON5.parse(c),
};

/** 全局配置候选扩展名（优先级同 SEARCH_PLACES 同形式内顺序）。 */
const GLOBAL_EXTS = ["yaml", "yml", "json5", "json"];

/**
 * 解析配置的 pipelines 段为带缺省值的 PipelineConfig 映射（变更编排器，spec §8）。
 * 每个 pipeline 必须有 actions（字符串数组），否则报错（不静默忽略，防拼错）；
 * concurrency/onBusy/onError/dryRun 缺省填 4/queue/continue/true。
 */
export function parsePipelines(raw: unknown): Record<string, PipelineConfig> {
  if (raw == null) return {};
  if (typeof raw !== "object") throw new Error("pipelines 必须是对象");
  const out: Record<string, PipelineConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const p = (value ?? {}) as Record<string, unknown>;
    if (!Array.isArray(p.actions) || p.actions.some((a) => typeof a !== "string")) {
      throw new Error(`pipeline "${name}" 缺少 actions（字符串数组）`);
    }
    out[name] = {
      actions: p.actions as string[],
      on: p.on as PipelineConfig["on"],
      paths: Array.isArray(p.paths) ? (p.paths as string[]) : undefined,
      where: typeof p.where === "string" ? p.where : undefined,
      debounce: p.debounce as PipelineConfig["debounce"],
      concurrency: typeof p.concurrency === "number" ? p.concurrency : 4,
      onBusy: (p.onBusy as PipelineConfig["onBusy"]) ?? "queue",
      onError: (p.onError as PipelineConfig["onError"]) ?? "continue",
      dryRun: typeof p.dryRun === "boolean" ? p.dryRun : true,
      ifExists: (p.ifExists as PipelineConfig["ifExists"]) ?? "skip",
    };
  }
  return out;
}

/**
 * vault 取值：字符串原样；字符串数组过滤掉非串项；空 / 非串 / 空数组 → undefined（被忽略）。
 *
 * @behavior
 * Given vault 为字符串
 * When pickVault
 * Then 原样返回（单目录）
 *
 * @behavior
 * Given vault 为数组（可能含非字符串项）
 * When pickVault
 * Then 过滤掉非字符串项返回字符串列表；过滤后为空则返回 undefined（被丢弃）
 *
 * @behavior
 * Given vault 为非字符串非数组（如数字 / 对象）
 * When pickVault
 * Then 返回 undefined（被忽略，不写入配置）
 */
function pickVault(v: unknown): string | string[] | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const list = v.filter((x): x is string => typeof x === "string");
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

/** 仅挑出已知的字符串键（vault 另支持字符串数组）+ pipelines 段；忽略未知键与非字符串值。 */
function pickConfig(obj: Record<string, unknown>): BasaltConfig {
  const out: BasaltConfig = {};
  for (const k of KEYS) {
    if (k === "vault") continue; // vault 支持 string | string[]，下方单独挑
    const v = obj[k];
    if (typeof v === "string") out[k] = v;
  }
  const vault = pickVault(obj.vault);
  if (vault !== undefined) out.vault = vault;
  if (obj.pipelines !== undefined) out.pipelines = parsePipelines(obj.pipelines);
  if (obj.lint !== undefined) out.lint = parseLintConfig(obj.lint);
  if (obj.profiles !== undefined) out.profiles = parseProfiles(obj.profiles);
  return out;
}

/** 构造一个 cosmiconfig 同步实例（自定义 searchPlaces + loaders；project 策略向上逐级查找）。 */
function makeExplorer(): PublicExplorerSync {
  return cosmiconfigSync("x-basalt", {
    searchPlaces: SEARCH_PLACES,
    loaders: LOADERS,
    searchStrategy: "project", // "project" 策略向上搜索到含 package.json / .git 的目录为止，不越过项目边界；"global" 策略会一路搜到文件系统根，在 monorepo / 嵌套工程中可能误命中上层无关配置
  });
}

/** 项目配置：从 cwd 向上搜索 SEARCH_PLACES；解析失败降级为 {}（warn 不抛错）。 */
function loadProject(explorer: PublicExplorerSync, cwd: string): BasaltConfig {
  try {
    const r = explorer.search(cwd);
    return pickConfig((r?.config ?? {}) as Record<string, unknown>);
  } catch (err) {
    console.warn(`⚠ 跳过无法解析的项目配置（从 ${cwd} 向上）：${(err as Error).message}`);
    return {};
  }
}

/** 从某 `.x-basalt` 目录加载 `config.{ext}`（不向上走）；解析失败降级为 {}。 */
function loadConfigDir(explorer: PublicExplorerSync, dir: string): BasaltConfig {
  for (const ext of GLOBAL_EXTS) {
    const p = join(dir, `config.${ext}`);
    if (!existsSync(p)) continue;
    try {
      return pickConfig((explorer.load(p)?.config ?? {}) as Record<string, unknown>);
    } catch (err) {
      console.warn(`⚠ 跳过无法解析的配置文件 ${p}：${(err as Error).message}`);
      return {};
    }
  }
  return {};
}

/**
 * 加载并合并配置：项目配置覆盖全局配置（`<globalHome>/.x-basalt/config.{...}`）。
 * 项目配置来源：`X_BASALT_DIR` 设了则读 `$X_BASALT_DIR/config.{...}`（指定基目录，替代就近发现）；
 * 否则 cwd 向上找 `.x-basalt/config.{yaml,...}`（回退扁平 `.x-basalt.{...}`）。
 * 优先级与 CLI flag（flag 最高）由调用方 `flag ?? config.X` 处理；本函数只做「文件层」合并。
 *
 * @param cwd - 起始目录，默认 process.cwd()
 * @param globalHome - 全局配置所在 home，默认 homedir()（测试可注入隔离）
 * @param baseDir - 基目录（设了则项目配置从此目录读）；调用方如 CLI 可传入 `process.env.X_BASALT_DIR`
 *
 * @behavior
 * Given 设了 X_BASALT_DIR（指向某 .x-basalt 目录）
 * When 加载
 * Then 项目配置从 $X_BASALT_DIR/config.* 读，替代 cwd 就近发现
 *
 * @behavior
 * Given 项目目录无配置、全局 <home>/.x-basalt/config 存在
 * When 加载
 * Then 回退使用全局配置
 *
 * @behavior
 * Given 项目与全局都有配置且键重叠
 * When 加载
 * Then 项目键覆盖全局，全局独有键保留
 *
 * @behavior
 * Given 命中的配置文件畸形（解析抛错）
 * When 加载
 * Then warn 并降级为空配置，不中断 CLI
 */
export function loadConfig(
  cwd: string = process.cwd(),
  globalHome: string = homedir(),
  baseDir?: string,
): BasaltConfig {
  const explorer = makeExplorer();
  const globalCfg = loadConfigDir(explorer, join(globalHome, ".x-basalt"));
  // X_BASALT_DIR 设了 → 项目配置从该基目录读（替代 cwd 上溯发现）；否则 cosmiconfig 就近发现。
  const projectCfg = baseDir ? loadConfigDir(explorer, baseDir) : loadProject(explorer, cwd);
  return { ...globalCfg, ...projectCfg }; // 项目覆盖全局
}

import matter from "gray-matter";
import JSON5 from "json5";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// === 自建实现: 项目/全局配置加载，给 CLI 选项提供默认值（免去每次重复 --db/--vault 等）===
//
// 上游：cli.ts 启动时加载一次；下游：各子命令以 `flag ?? config.X ?? 内置默认` 解析。
// 不在 git 管理（项目配置已 gitignore）：相当于「本机/本项目该怎么跑」的记忆。
// 格式：默认 YAML（.yaml/.yml），也支持 JSON5/JSON。YAML 复用 gray-matter（已是依赖）的引擎
//       解析，故不新增 YAML 依赖。

/** 配置项（全部可选，字符串）。键名与 CLI 概念对应。 */
export interface BasaltConfig {
  /** 默认 SQLite 索引路径（对应 --db） */
  db?: string;
  /** 默认 Vault 根（对应 index/watch 的 <vault> 与 query 的 --vault） */
  vault?: string;
  /** 默认 skill 目录（等价 OBSIDIAN_SKILL_PATH；设置后经 SkillRecall 优先生效） */
  skillPath?: string;
  /** 默认输出格式 json|yaml（对应 parse 的 --format） */
  format?: string;
  /** watch 默认的 on-change 命令模板（{file} 占位） */
  onChange?: string;
}

/** 项目隐藏目录名：默认把配置/示例/索引等项目本地物放这里（类比 .obsidian/）。 */
const PROJECT_DIR = ".x-basalt";
/** 全局配置基名（拼接扩展名）。全局本就放隐藏目录 ~/.x-basalt/。 */
const GLOBAL_BASENAME = join(homedir(), ".x-basalt", "config");
/** 候选扩展名优先级：默认 yaml，其次 yml，再 json5/json（同目录多份时取靠前者）。 */
const EXTS = [".yaml", ".yml", ".json5", ".json"];
/** 允许的字符串键（其余键忽略，避免误用）。 */
const KEYS = ["db", "vault", "skillPath", "format", "onChange"] as const;

/** 给定无扩展名基路径，按 EXTS 优先级返回首个存在的文件。 */
function firstExisting(baseNoExt: string): string | undefined {
  for (const ext of EXTS) {
    const p = baseNoExt + ext;
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * 单个目录层级内的配置候选（按优先级）：
 * 1. 隐藏目录形式 `.x-basalt/config.*`（默认/推荐）
 * 2. 扁平文件形式 `.x-basalt.*`（也支持，便于轻量项目）
 */
function configAtLevel(dir: string): string | undefined {
  return firstExisting(join(dir, PROJECT_DIR, "config")) ?? firstExisting(join(dir, PROJECT_DIR));
}

/** 从 startDir 向上逐级查找项目配置，返回首个命中（含文件系统根）。 */
function findProjectConfig(startDir: string): string | undefined {
  let dir = startDir;
  // 未到根（dirname(root) === root）时持续上溯；用相等判定收敛，避免 while(true) 常量条件。
  while (dir !== dirname(dir)) {
    const hit = configAtLevel(dir);
    if (hit) return hit;
    dir = dirname(dir);
  }
  return configAtLevel(dir);
}

/** 仅挑出已知的字符串键，忽略未知键与非字符串值。 */
function pickConfig(obj: Record<string, unknown>): BasaltConfig {
  const out: BasaltConfig = {};
  for (const k of KEYS) {
    const v = obj[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** 按扩展名解析：.yaml/.yml 走 gray-matter（包成 frontmatter 取 data），其余走 JSON5（兼容 JSON）。 */
function parseByExt(path: string, raw: string): Record<string, unknown> {
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    // 复用 gray-matter 的 YAML 引擎解析独立 YAML：包一层 --- 围栏即可，避免引入新的 YAML 依赖。
    return matter(`---\n${raw}\n---\n`).data as Record<string, unknown>;
  }
  return JSON5.parse(raw) as Record<string, unknown>;
}

/** 读单个配置文件；无路径→{}；解析失败→warn 并返回 {}（降级，不中断 CLI）。 */
function readConfigFile(path: string | undefined): BasaltConfig {
  if (!path) return {};
  try {
    return pickConfig(parseByExt(path, readFileSync(path, "utf8")));
  } catch (err) {
    console.warn(`⚠ 跳过无法解析的配置文件 ${path}：${(err as Error).message}`);
    return {};
  }
}

/**
 * 加载并合并配置：项目配置（cwd 向上找 `.x-basalt/config.{yaml,...}`，回退扁平
 * `.x-basalt.{yaml,...}`）覆盖全局配置（`~/.x-basalt/config.{yaml,...}`）。
 * 仅做「文件层」合并；与 CLI flag 的优先级（flag 最高）由调用方 `flag ?? config.X` 处理。
 *
 * @param cwd - 起始目录，默认 process.cwd()
 */
export function loadConfig(cwd: string = process.cwd()): BasaltConfig {
  const globalCfg = readConfigFile(firstExisting(GLOBAL_BASENAME));
  const projectCfg = readConfigFile(findProjectConfig(cwd));
  return { ...globalCfg, ...projectCfg }; // 项目覆盖全局
}

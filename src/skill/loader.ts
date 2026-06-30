import JSON5 from "json5";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// === 自建实现: Skill 加载（JSON5 文件 + 目录解析 + 内置兜底）===
//
// 上游：SkillRecall 构造；下游：读 skill-data/*.json5 解析为 SkillDefinition[]。
// 内置 skill-data/ 目录随包发布（src/skill 与 dist/skill 同为上溯两级到仓库根的 skill-data/）。

/** 单条规范规则。 */
export interface SkillRule {
  pattern: string;
  description: string;
  examples?: string[];
}

/** 一个 skill 的定义结构（对应 skill-data/*.json5）。 */
export interface SkillDefinition {
  name: string;
  /** 一句话用途（`skills list` 展示、`skills get` 渲染标题下方）。 */
  description?: string;
  /** 触发召回的关键字列表（如 `["wikilink", "link"]`）；SkillRecall 在 name+triggers 上做 Fuse 模糊匹配。 */
  triggers: string[];
  /** 本 skill 关注的代码匹配模式（可选）；由外层调用方解析使用，加载层不感知。 */
  patterns?: string[];
  rules: SkillRule[];
  metadata?: Record<string, unknown>;
}

/** 随包发布的内置 skill 目录（兜底来源）。src/skill 与 dist/skill 上溯两级均为仓库根。 */
const BUILTIN_DIR = fileURLToPath(new URL("../../skill-data", import.meta.url));
/**
 * 始终可召回的内置 skill 名：基础规范 + 本 CLI 自我说明书。
 * 即便外部 skill 目录（OBSIDIAN_SKILL_PATH 等）缺失/为空/无效，这两者也兜底补回，
 * 使「CLI 召回自身用法」(`skills get core`) 与基础规范召回永远可用。
 * 外部目录若自带同名 skill 则不覆盖（允许使用者 shadow）。
 */
const ALWAYS_AVAILABLE = ["obsidian-base-spec", "core"];

/**
 * 解析最终使用的 skill 目录。
 * 优先级：显式 skillPath > env `OBSIDIAN_SKILL_PATH` > `~/.obsidian-core/skills`（存在时）> 内置 `skill-data/`。
 */
export function resolveSkillDir(skillPath?: string): string {
  if (skillPath) return skillPath;
  const env = process.env.OBSIDIAN_SKILL_PATH;
  if (env) return env;
  const userDir = join(homedir(), ".obsidian-core", "skills");
  if (existsSync(userDir)) return userDir;
  return BUILTIN_DIR;
}

/** 读取某目录下全部 `*.json5` 并解析；解析失败的单个文件跳过并 warn（设计 §5 降级）。 */
function loadDir(dir: string): SkillDefinition[] {
  if (!existsSync(dir)) return [];
  const out: SkillDefinition[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".json5")) continue;
    try {
      const def = JSON5.parse(readFileSync(join(dir, name), "utf8")) as Partial<SkillDefinition>;
      // 最小校验：必须有 name 与 rules 数组，否则视为无效跳过。
      if (typeof def.name === "string" && Array.isArray(def.rules)) {
        out.push({
          name: def.name,
          description: def.description,
          triggers: Array.isArray(def.triggers) ? def.triggers : [],
          patterns: def.patterns,
          rules: def.rules,
          metadata: def.metadata,
        });
      }
    } catch (err) {
      console.warn(`⚠ 跳过无法解析的 skill 文件 ${name}：${(err as Error).message}`);
    }
  }
  return out;
}

/**
 * 从 skill 目录加载全部 JSON5 skill 文件。
 * 目录解析顺序见 {@link resolveSkillDir}。内置 `obsidian-base-spec` 始终可用作兜底：
 * 当解析出的集合缺少它时（外部目录为空/无效），补加内置版本。
 *
 * @param skillPath - 覆盖默认 skill 目录（可选）
 *
 * @behavior
 * Given 外部 skill 目录为空、不存在或全部 json5 均解析/校验失败
 * When loadSkills
 * Then obsidian-base-spec 与 core 仍出现在结果中（内置兜底），使基础召回永远可用
 *
 * @behavior
 * Given skill 目录内某个 json5 格式错误或缺少必要字段（name / rules）
 * When loadSkills
 * Then 该文件被跳过并 warn，其余合法 skill 照常加载（单文件失败不中断全量）
 */
export function loadSkills(skillPath?: string): SkillDefinition[] {
  const dir = resolveSkillDir(skillPath);
  const defs = loadDir(dir);
  // 兜底：补齐缺失的「始终可召回」内置 skill（解析到 BUILTIN_DIR 时一般已齐，missing 为空不重复加载）。
  const missing = ALWAYS_AVAILABLE.filter((name) => !defs.some((d) => d.name === name));
  if (missing.length > 0) {
    defs.push(...loadDir(BUILTIN_DIR).filter((d) => missing.includes(d.name)));
  }
  return defs;
}

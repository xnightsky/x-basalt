// === 自建实现: Skill 加载（JSON5 文件，阶段 4）===

/** 单条规范规则。 */
export interface SkillRule {
  pattern: string;
  description: string;
  examples?: string[];
}

/** 一个 skill 的定义结构（对应 skills/*.json5）。 */
export interface SkillDefinition {
  name: string;
  triggers: string[];
  patterns?: string[];
  rules: SkillRule[];
  metadata?: Record<string, unknown>;
}

/**
 * 从 skill 目录加载全部 JSON5 skill 文件。
 * 目录解析顺序：env `OBSIDIAN_SKILL_PATH` > `~/.obsidian-core/skills` > 内置 `skills/`。
 * 内置 `obsidian-base-spec` 始终可用作兜底。
 *
 * @param skillPath - 覆盖默认 skill 目录（可选）
 */
export function loadSkills(skillPath?: string): SkillDefinition[] {
  void skillPath;
  throw new Error("not implemented: loadSkills（阶段 4）");
}

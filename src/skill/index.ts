import { loadSkills, type SkillDefinition } from "./loader.js";

export type { SkillDefinition, SkillRule } from "./loader.js";

// === 自建实现: Skill 召回，对 triggers 与 name 做模糊匹配，内置 obsidian-base-spec 兜底 ===
//
// 上游：cli 的 skill recall/list 子命令；下游：loadSkills 提供的 SkillDefinition[]。

/** skill 列表项的精简元信息。 */
export interface SkillMeta {
  name: string;
  triggers: string[];
}

/** 关键字与某 skill 是否匹配：命中 name 子串，或与任一 trigger 互为子串（双向，宽松召回）。 */
function matches(skill: SkillDefinition, keyword: string): boolean {
  if (skill.name.toLowerCase().includes(keyword)) return true;
  for (const t of skill.triggers) {
    const tl = t.toLowerCase();
    if (tl.includes(keyword) || keyword.includes(tl)) return true;
  }
  return false;
}

export class SkillRecall {
  private readonly skills: SkillDefinition[];

  constructor(opts?: { skillPath?: string }) {
    this.skills = loadSkills(opts?.skillPath);
  }

  /** 列出全部可用 skill 的精简元信息。 */
  list(): SkillMeta[] {
    return this.skills.map((s) => ({ name: s.name, triggers: s.triggers }));
  }

  /**
   * 按关键字模糊召回 skill 规范详情。
   *
   * @param keyword - 召回关键字（匹配 triggers / name，大小写不敏感）
   * @returns 命中的完整 SkillDefinition 列表；无命中返回空数组
   */
  recall(keyword: string): SkillDefinition[] {
    const kw = keyword.toLowerCase().trim();
    if (!kw) return [];
    return this.skills.filter((s) => matches(s, kw));
  }
}

import type { SkillDefinition } from "./loader.js";

export type { SkillDefinition, SkillRule } from "./loader.js";

/** skill 列表项的精简元信息。 */
export interface SkillMeta {
  name: string;
  triggers: string[];
}

/**
 * Skill 召回：对 `triggers` 与 `name` 做模糊匹配，内置 `obsidian-base-spec` 兜底。
 * 阶段 4 实现。
 */
export class SkillRecall {
  constructor(opts?: { skillPath?: string }) {
    void opts;
  }

  /** 列出全部可用 skill。 */
  list(): SkillMeta[] {
    throw new Error("not implemented: SkillRecall.list（阶段 4）");
  }

  /**
   * 按关键字模糊召回 skill 规范详情。
   *
   * @param keyword - 召回关键字（匹配 triggers / name）
   */
  recall(keyword: string): SkillDefinition[] {
    void keyword;
    throw new Error("not implemented: SkillRecall.recall（阶段 4）");
  }
}

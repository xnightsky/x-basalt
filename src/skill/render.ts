import type { SkillMeta } from "./index.js";
import type { SkillDefinition } from "./loader.js";

// === 自建实现: Skill 可读渲染（Markdown）===
//
// 上游：cli 的 skills get/list/recall（默认输出）；下游：纯字符串，由 console.log 落 stdout。
// 目的：把结构化 SkillDefinition 渲染成「喂 AI 最省 token、人也好读」的 Markdown，
// 对标 agent-browser `skills get` 直接吐文档的取向。`--json` 分支不走这里，直接 emit 结构化。

/** 把单个 skill 渲染为 Markdown：标题 + 描述 + 触发词 + 模式 + 逐条规范（含 pattern/示例）。 */
export function renderSkill(def: SkillDefinition): string {
  const lines: string[] = [`# ${def.name}`];
  if (def.description) lines.push("", def.description);
  if (def.triggers.length > 0) lines.push("", `**触发词**：${def.triggers.join("、")}`);
  if (def.patterns && def.patterns.length > 0) {
    lines.push("", `**模式**：${def.patterns.map((p) => `\`${p}\``).join(" ")}`);
  }
  if (def.rules.length > 0) {
    lines.push("", "## 规范");
    for (const r of def.rules) {
      lines.push("", `### ${r.description}`, "", `\`${r.pattern}\``);
      if (r.examples && r.examples.length > 0) {
        lines.push("", "示例：");
        for (const ex of r.examples) lines.push(`- \`${ex}\``);
      }
    }
  }
  return lines.join("\n");
}

/** 把多个 skill 拼接渲染（`skills get --all`），用分隔线隔开。 */
export function renderSkills(defs: SkillDefinition[]): string {
  return defs.map(renderSkill).join("\n\n---\n\n");
}

/** 渲染 skill 列表（`skills list`）：每行 `name — description`。 */
export function renderSkillList(metas: SkillMeta[]): string {
  return metas.map((m) => (m.description ? `${m.name} — ${m.description}` : m.name)).join("\n");
}

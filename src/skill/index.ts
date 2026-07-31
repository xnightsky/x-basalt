import Fuse from "fuse.js";
import { loadSkills, resolveSkillDir, type SkillDefinition } from "./loader.js";

export type { SkillDefinition, SkillRule } from "./loader.js";

// === 自建实现: Skill 召回，Fuse.js 对 name+triggers 模糊匹配并按相关性排序，内置兜底 ===
//
// 上游：cli 的 skills get/recall/list 子命令；下游：loadSkills 提供的 SkillDefinition[]。
// 用 Fuse.js（编辑距离 + 相关性排序）替代朴素子串匹配（M4.1）：容拼写错、结果有序；
// 阈值收紧到 0.4 避免把无关 skill 也召回。空目录兜底逻辑仍在 loader（此处不感知）。

/** Fuse 模糊匹配阈值：0=精确、1=匹配任意；0.4 容许少量拼写偏差，又不至召回无关 skill。 */
const FUSE_THRESHOLD = 0.4;

/** skill 列表项的精简元信息。 */
export interface SkillMeta {
  name: string;
  triggers: string[];
  /** 一句话用途（`skills list` 展示）。 */
  description?: string;
}

export class SkillRecall {
  private readonly skills: SkillDefinition[];
  private readonly fuse: Fuse<SkillDefinition>;
  private readonly dir: string;

  constructor(opts?: { skillPath?: string }) {
    this.skills = loadSkills(opts?.skillPath);
    this.dir = resolveSkillDir(opts?.skillPath);
    // 构造期建一次模糊索引（skills 一次性加载、不变）。name 权重高于单个 trigger：
    // 名字直接命中比触发器命中更相关，排序时优先。
    //
    // 只以 name+triggers 为检索键（P2 · 刻意不纳入 description/rules）：description 里含「语法/规范/
    // 查询」等泛化词，一旦纳入检索键，中文多词查询（如「…注意事项 规范」）会因命中「规范」而误召回，
    // 重演「召回失真」。中文概念召回改由 triggers 的中文别名精确承载（见 skills-data 触发词），
    // 泛化词不入 triggers → 不误召回。includeScore 供 recall 多词合并按最优分排序。
    this.fuse = new Fuse(this.skills, {
      keys: [
        { name: "name", weight: 2 },
        { name: "triggers", weight: 1 },
      ],
      threshold: FUSE_THRESHOLD,
      ignoreLocation: true, // 触发器可落在任意位置，不偏向串首
      minMatchCharLength: 2,
      includeScore: true,
    });
  }

  /** 列出全部可用 skill 的精简元信息（name + triggers + description）。 */
  list(): SkillMeta[] {
    return this.skills.map((s) => ({
      name: s.name,
      triggers: s.triggers,
      description: s.description,
    }));
  }

  /** 按名精确取完整 skill 定义；不存在返回 undefined。 */
  get(name: string): SkillDefinition | undefined {
    return this.skills.find((s) => s.name === name);
  }

  /** 全部已加载 skill 的完整定义（含兜底补齐项）。 */
  all(): SkillDefinition[] {
    return [...this.skills];
  }

  /**
   * 取某 skill 的**指定条目**，返回只含这些条的浅拷贝定义（条级召回）。
   *
   * 存在意义：`get` / `recall` 的返回单位天然是「整篇」，想要 core 里 meta 那一条就得吞下全篇。
   * 有了条级寻址，大篇不必再为了「便宜」而被拆碎——按需取条即可。
   *
   * @param name - skill 名
   * @param ids - 条目 id 列表（顺序即输出顺序，重复项按给定次数重复输出）
   * @returns 命中的定义；skill 不存在返回 `undefined`
   * @throws 任一 id 在该 skill 中不存在时抛出，错误信息附可用 id 列表（不静默丢弃）
   *
   * @behavior
   * Given 一组存在的条目 id
   * When pick
   * Then 返回的 rules 按**传入顺序**排列，其余字段（name/description/triggers）保持原样
   *
   * @behavior
   * Given 含未知 id（拼错或该条没登记 id）
   * When pick
   * Then 抛错并列出该 skill 全部可用 id，而不是返回少一条的结果——静默少给会让调用方以为已取全
   */
  pick(name: string, ids: string[]): SkillDefinition | undefined {
    const def = this.get(name);
    if (!def || ids.length === 0) return def;
    const byId = new Map(def.rules.filter((r) => r.id).map((r) => [r.id as string, r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      const available = [...byId.keys()];
      throw new Error(
        `未知条目 ${missing.map((m) => `"${m}"`).join("、")}；${name} 可用条目：${
          available.length > 0 ? available.join(" ") : "（该 skill 未登记条目 id）"
        }`,
      );
    }
    return { ...def, rules: ids.map((id) => byId.get(id) as SkillDefinition["rules"][number]) };
  }

  /** 最终解析使用的 skill 数据目录（优先级见 {@link resolveSkillDir}）。 */
  resolvedDir(): string {
    return this.dir;
  }

  /**
   * 按关键字模糊召回 skill 规范详情，结果按相关性降序（最相关在前）。
   *
   * @param keyword - 召回关键字（模糊匹配 name / triggers，大小写不敏感、容拼写错）
   * @returns 命中的完整 SkillDefinition 列表（已排序）；空关键字或无命中返回空数组
   *
   * @behavior
   * Given 与某 skill 的 name 或 trigger 拼写相近（含个别错字）的关键字
   * When 召回
   * Then 该 skill 仍被命中，且更相关者排在结果前列
   *
   * @behavior
   * Given 空白关键字，或与任何 name/trigger 都不沾边的串
   * When 召回
   * Then 返回空数组（阈值收紧，不放水召回无关 skill）
   */
  recall(keyword: string): SkillDefinition[] {
    const kw = keyword.trim();
    if (!kw) return [];
    // 多词查询按空白切词分别召回再并集（P2）：模型常传整条短语（「双向链接 语法」「wikilink heading」），
    // 而 Fuse 对含噪短语整体模糊匹配会因距离过大漏掉本可命中的概念词。逐 token 搜、按最优 score 合并，
    // 只要任一 token 命中 trigger/name 即召回；泛化词（规范/语法…）不在 triggers 内、不会误召回。
    const tokens = kw.split(/\s+/).filter(Boolean);
    const queries = tokens.length > 1 ? [kw, ...tokens] : [kw];
    const best = new Map<string, { item: SkillDefinition; score: number }>();
    for (const q of queries) {
      for (const r of this.fuse.search(q)) {
        const score = r.score ?? 1;
        const prev = best.get(r.item.name);
        if (!prev || score < prev.score) best.set(r.item.name, { item: r.item, score });
      }
    }
    // 按最优（最小）score 升序 = 相关性降序；同分保持稳定。
    return [...best.values()].toSorted((a, b) => a.score - b.score).map((e) => e.item);
  }
}

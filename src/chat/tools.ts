// === 自建实现: chat 工具面装配——cli 单工具 + skills 元工具（切 C，2026-07-30 拍板）===
//
// 上游：loop.ts；下游：cli-tool.ts（唯一执行口）、skill 召回。
// 切 C 要点（chat-tool-surface.md §决策）：15 个手写工具（query/search/meta_*/pipeline_run…）
// 已删除——它们与 CLI 各维护一份参数语义、必漂移（paths bug 实证）。现在模型只拿一个
// `cli` 工具（argv 数组直传 execFile，schema 与 CLI 一处定义），外加两个 grounding 元工具
// （skills_recall/skills_get，agent-browser 同款单列——它们是「模型说明书」、非 vault 能力面）。
// RECALL_TOOL_NAMES 收编为 ["cli"]：调用 cli = 真查过 vault（skills_* 不算）。
import { jsonSchema, tool, type ToolSet } from "ai";
import { SkillRecall } from "../skill/index.js";
import { buildCliTool } from "./cli-tool.js";
import type { Safety } from "./safety.js";
import { wrapToolErrors } from "./tool-errors.js";

export interface ToolContext {
  dbPath: string;
  vaultPath: string | string[];
  skillPath?: string;
}

/**
 * 计入"已从 vault 召回"的工具名（P1）：cli 工具是唯一 vault 操作入口，模型调用了它即视为
 * 真的查过 vault，chat 收尾不加"未召回"标注。**skills_recall / skills_get 取的是本 CLI 的
 * 规范说明、不是 vault 内容**，故刻意不列入——只用它们作答仍属"未从 vault 召回"。
 */
export const RECALL_TOOL_NAMES = ["cli"];

/** "未从 vault 召回"如实标注文案（P1）：本轮零 cli 调用却给了实质答复时提示。 */
export const NO_RECALL_NOTICE =
  "⚠ 本次未调用任何 vault 检索工具（cli），以上为模型通用知识、并非从该 Obsidian vault 召回——若需基于 vault 内容作答，请改用 cli（query/search/scan 等子命令）后再答。";

/** 读工具结果统一过 safety：非字符串先 JSON 化，再截断+边界包裹。 */
function observe(safety: Safety, v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return safety.wrap(safety.truncate(s));
}

export function buildTools(ctx: ToolContext, safety: Safety): ToolSet {
  // 末尾过 wrapToolErrors：工具失败统一分类、包成「带换策略建议」的结构化错误回灌模型（详见 tool-errors.ts）。
  return wrapToolErrors({
    // 唯一执行口：所有 vault 操作（读/写/查询/批量）都经 cli 子命令。argv 数组直传，无 shell。
    cli: buildCliTool(ctx, safety),

    // ---- grounding 元工具（模型说明书，非 vault 能力面；切 C 保留）----
    skills_recall: tool({
      description: "按关键字模糊召回 Obsidian/DQL/Bases 规范与 CLI 说明书。",
      inputSchema: jsonSchema<{ keyword: string }>({
        type: "object",
        properties: { keyword: { type: "string" } },
        required: ["keyword"],
        additionalProperties: false,
      }),
      execute: ({ keyword }) =>
        observe(safety, new SkillRecall({ skillPath: ctx.skillPath }).recall(keyword)),
    }),
    skills_get: tool({
      description:
        "按名读取规范全文（skills_recall 召不回时用此精确读取）。可用：core(x-basalt 能力总览/CLI 用法/DQL 基础/meta·pipeline)、obsidian-base-spec(精确 DQL 文法+frontmatter/tag 提取规则)。",
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: {
          name: { type: "string", description: "skill 名，如 core / obsidian-base-spec" },
        },
        required: ["name"],
        additionalProperties: false,
      }),
      execute: ({ name }) =>
        observe(
          safety,
          new SkillRecall({ skillPath: ctx.skillPath }).get(name) ?? `✗ 未找到 skill：${name}`,
        ),
    }),
  });
}

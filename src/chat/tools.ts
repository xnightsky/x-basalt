// === 自建实现: chat 工具面——既有原语包成 AI SDK tool（读直放 / 写直接落盘）===
//
// 上游：loop.ts；下游：query/parser/indexer/meta/skill/orchestrator 既有库。
// 纪律：不重写原语，只包 tool-call schema；读工具结果经 safety 截断+包裹；
// 写工具直接以非 dry-run 调原语落盘（无确认闸——安全靠 Ctrl+C 中断 + 既有原子写 + 流式可观测）。
import { readFileSync } from "node:fs";
import { jsonSchema, tool, type ToolSet } from "ai";
import { VaultIndexer } from "../indexer/index.js";
import {
  applyProfile,
  coerceValue,
  editMeta,
  type MetaScalarType,
  normalizeDoc,
  readMeta,
  renameMeta,
  setMeta,
  unsetMeta,
} from "../meta/index.js";
import { Orchestrator } from "../orchestrator/index.js";
import type { PipelineConfig } from "../orchestrator/index.js";
import { VaultParser } from "../parser/index.js";
import { DataviewEngine } from "../query/index.js";
import { SkillRecall } from "../skill/index.js";
import type { Safety } from "./safety.js";
import { resolveVaultLayout } from "../utils/path.js";

export interface ToolContext {
  dbPath: string;
  vaultPath: string | string[];
  skillPath?: string;
}

/** 读工具结果统一过 safety：非字符串先 JSON 化，再截断+边界包裹。 */
function observe(safety: Safety, v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return safety.wrap(safety.truncate(s));
}

export function buildTools(ctx: ToolContext, safety: Safety): ToolSet {
  const layout = resolveVaultLayout(ctx.vaultPath);
  const toAbs = (file: string): string => layout.toAbs(file);

  return {
    // ---- 读工具（带 execute，自动跑）----
    query: tool({
      description:
        "执行 Dataview(DQL) 子集查询，返回匹配行。结构化只读，查不了正文。构造 DQL 不确定文法时，先 skills_get 取 obsidian-base-spec。",
      inputSchema: jsonSchema<{ dql: string }>({
        type: "object",
        properties: { dql: { type: "string", description: "DQL 查询语句" } },
        required: ["dql"],
        additionalProperties: false,
      }),
      execute: ({ dql }) => {
        const engine = new DataviewEngine(ctx.dbPath);
        try {
          return observe(safety, engine.query(dql));
        } finally {
          engine.close();
        }
      },
    }),
    parse: tool({
      description: "解析单个 .md 文件为 Obsidian AST（wikilink/tag/task/callout 等）。",
      inputSchema: jsonSchema<{ file: string }>({
        type: "object",
        properties: { file: { type: "string", description: ".md 文件路径" } },
        required: ["file"],
        additionalProperties: false,
      }),
      execute: ({ file }) => observe(safety, new VaultParser().parse(readFileSync(toAbs(file), "utf8"))),
    }),
    scan: tool({
      description: "对比文件系统与索引，报告新增/改动/删除（不写库）。",
      inputSchema: jsonSchema<{ rehash?: boolean }>({
        type: "object",
        properties: {
          rehash: { type: "boolean", description: "按内容对比（慢但稳），默认 mtime+size" },
        },
        additionalProperties: false,
      }),
      execute: async ({ rehash }) => {
        const indexer = new VaultIndexer({ vaultPath: ctx.vaultPath, dbPath: ctx.dbPath });
        try {
          return observe(safety, await indexer.scan({ rehash: rehash ?? false, dryRun: true }));
        } finally {
          indexer.close();
        }
      },
    }),
    meta_get: tool({
      description: "读某笔记的 frontmatter；省略 key 返回整个元数据。",
      inputSchema: jsonSchema<{ file: string; key?: string }>({
        type: "object",
        properties: { file: { type: "string" }, key: { type: "string" } },
        required: ["file"],
        additionalProperties: false,
      }),
      execute: ({ file, key }) => observe(safety, readMeta(toAbs(file), key) ?? null),
    }),
    skills_recall: tool({
      description: "按关键字模糊召回 Obsidian/DQL 规范与 CLI 说明书。",
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
        properties: { name: { type: "string", description: "skill 名，如 core / obsidian-base-spec" } },
        required: ["name"],
        additionalProperties: false,
      }),
      execute: ({ name }) =>
        observe(safety, new SkillRecall({ skillPath: ctx.skillPath }).get(name) ?? `✗ 未找到 skill：${name}`),
    }),

    // ---- 写工具（execute 直接以非 dry-run 落盘，无 confirm）----
    meta_set: tool({
      description: "设置/更新某笔记的一个 frontmatter 属性（直接写入）。值类型/归一规则见 obsidian-base-spec。",
      inputSchema: jsonSchema<{ file: string; key: string; value: string; type?: string }>({
        type: "object",
        properties: {
          file: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
          type: { type: "string", enum: ["string", "number", "boolean", "null", "list", "auto"] },
        },
        required: ["file", "key", "value"],
        additionalProperties: false,
      }),
      execute: ({ file, key, value, type }) => {
        const typed = coerceValue(value, (type ?? "auto") as MetaScalarType);
        const r = editMeta(toAbs(file), (d) => setMeta(d, key, typed), { dryRun: false });
        return r.changed ? `✓ set ${key} → ${file}` : `· 无变化：${file}`;
      },
    }),
    meta_unset: tool({
      description: "删除某笔记的一个 frontmatter 属性（直接写入）。",
      inputSchema: jsonSchema<{ file: string; key: string }>({
        type: "object",
        properties: { file: { type: "string" }, key: { type: "string" } },
        required: ["file", "key"],
        additionalProperties: false,
      }),
      execute: ({ file, key }) => {
        const r = editMeta(toAbs(file), (d) => unsetMeta(d, key), { dryRun: false });
        return r.changed ? `✓ unset ${key} → ${file}` : `· 无变化：${file}`;
      },
    }),
    meta_rename: tool({
      description: "重命名某笔记的一个 frontmatter 键（直接写入）。",
      inputSchema: jsonSchema<{ file: string; oldKey: string; newKey: string }>({
        type: "object",
        properties: {
          file: { type: "string" },
          oldKey: { type: "string" },
          newKey: { type: "string" },
        },
        required: ["file", "oldKey", "newKey"],
        additionalProperties: false,
      }),
      execute: ({ file, oldKey, newKey }) => {
        const r = editMeta(toAbs(file), (d) => renameMeta(d, oldKey, newKey), { dryRun: false });
        return r.changed ? `✓ rename ${oldKey}→${newKey} → ${file}` : `· 无变化：${file}`;
      },
    }),
    meta_normalize: tool({
      description: "归一某笔记 frontmatter（tags 列表化/去#/去重/单数键迁移）（直接写入）。",
      inputSchema: jsonSchema<{ file: string; sortKeys?: boolean }>({
        type: "object",
        properties: { file: { type: "string" }, sortKeys: { type: "boolean" } },
        required: ["file"],
        additionalProperties: false,
      }),
      execute: ({ file, sortKeys }) => {
        const r = editMeta(
          toAbs(file),
          (d) => {
            normalizeDoc(d, { sortKeys: sortKeys ?? false });
          },
          { dryRun: false },
        );
        return r.changed ? `✓ normalize → ${file}` : `· 已规范：${file}`;
      },
    }),
    meta_apply: tool({
      description: "套用元数据 profile：机械预填 + sets 补缺（直接写入）。profile 语义见 core。",
      inputSchema: jsonSchema<{
        profile: string;
        file: string;
        sets?: Record<string, string>;
        refreshDerived?: boolean;
      }>({
        type: "object",
        properties: {
          profile: { type: "string" },
          file: { type: "string" },
          sets: { type: "object", additionalProperties: { type: "string" } },
          refreshDerived: { type: "boolean" },
        },
        required: ["profile", "file"],
        additionalProperties: false,
      }),
      execute: ({ profile, file, sets, refreshDerived }) => {
        const r = applyProfile(toAbs(file), profile, { sets, refreshDerived, dryRun: false });
        return observe(safety, {
          filled: r.filled,
          overridden: r.overridden,
          refreshed: r.refreshed,
          missing: r.missing,
          changed: r.changed,
        });
      },
    }),
    pipeline_run: tool({
      description:
        "对一批笔记跑声明式管道（actions: index/normalize/apply/set/unset/rename）。批量直接写入。where 用 DQL 选源（见 obsidian-base-spec），省略则用 scan 差异源；actions 语义见 core。",
      inputSchema: jsonSchema<{
        actions: string[];
        where?: string;
        paths?: string[];
        ifExists?: string;
        concurrency?: number;
      }>({
        type: "object",
        properties: {
          actions: { type: "array", items: { type: "string" } },
          where: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
          ifExists: { type: "string", enum: ["skip", "overwrite", "merge"] },
          concurrency: { type: "number" },
        },
        required: ["actions"],
        additionalProperties: false,
      }),
      execute: async ({ actions, where, paths, ifExists, concurrency }) => {
        const cfg: PipelineConfig = {
          actions,
          where,
          paths: paths?.map(toAbs),
          ifExists: (ifExists as PipelineConfig["ifExists"]) ?? "skip",
          concurrency: concurrency ?? 4,
          onBusy: "queue",
          onError: "continue",
          dryRun: false,
        };
        const orch = new Orchestrator({ vaultPath: ctx.vaultPath, dbPath: ctx.dbPath });
        try {
          const r = where ? await orch.runManual(cfg, { dql: where }) : await orch.runScan(cfg);
          return observe(safety, {
            total: r.total,
            changed: r.changed,
            skipped: r.skipped,
            failed: r.failed,
          });
        } finally {
          orch.close();
        }
      },
    }),
  };
}

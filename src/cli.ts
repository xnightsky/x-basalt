#!/usr/bin/env node
import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { emit } from "./format.js";
import { VaultIndexer } from "./indexer/index.js";
import { VaultParser } from "./parser/index.js";
import {
  type ApplyResult,
  applyProfile,
  coerceValue,
  editMeta,
  type EditResult,
  getProfile,
  listProfiles,
  type MetaScalarType,
  normalizeDoc,
  readMeta,
  renameMeta,
  setMeta,
  unsetMeta,
} from "./meta/index.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { EventType, PipelineConfig, RunReport } from "./orchestrator/index.js";
import { runLinksCheck, runLinksSuggest } from "./links/index.js";
import { renderHuman } from "./links/report.js";
import { runLint } from "./lint/index.js";
import { renderHuman as renderLintHuman } from "./lint/report.js";
import { DataviewEngine } from "./query/index.js";
import { SkillRecall } from "./skill/index.js";
import { renderSkill, renderSkillList, renderSkills } from "./skill/render.js";

// === 自建实现: CLI 入口（commander），命令 parse / index / scan / query / skills / meta / watch ===
//
// 上游：终端用户 / pnpm cli；下游：装配 parser / indexer / query / skill 四层库能力。
// 本文件只做参数装配与输出格式化，不内联业务逻辑（逻辑在各层并各有单测）。

// 启动时加载一次项目/全局配置；各命令以 `flag ?? config.X ?? 内置默认` 解析，免去重复传参。
// CLI 显式传入 X_BASALT_DIR；若环境变量指向的目录不存在（如测试子进程换了 cwd），
// 则忽略它，避免外部进程环境污染项目配置发现。
const envBaseDir = process.env.X_BASALT_DIR;
const config = loadConfig(
  process.cwd(),
  homedir(),
  envBaseDir && existsSync(envBaseDir) ? envBaseDir : undefined,
);

// 基目录：env `X_BASALT_DIR` 指定则用它（可把 .x-basalt 整块搬到任意位置），否则就近隐藏目录 `.x-basalt/`。
const BASE_DIR = process.env.X_BASALT_DIR ?? ".x-basalt";
/** 默认索引路径：基目录下 index.db（indexer 会自动建该目录）。 */
const DEFAULT_DB = join(BASE_DIR, "index.db");

/** 取值，缺失则以统一 ✗ 报错（用于必需但可来自 config 的项）。 */
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null || value === "") throw new Error(message);
  return value;
}

/** commander 累积器：把可重复的 `--vault <path>` 收进数组（多根 vault）。 */
function collectVault(v: string, prev: string[]): string[] {
  return [...prev, v];
}

/**
 * 解析 vault 输入：CLI 多值（位置参数或重复 --vault）优先、回退配置；空则统一 ✗ 报错（复用 required 文案）。
 * 返回 string（单根，保持单值日志/向后兼容）或 string[]（多根）。
 */
function requireVault(
  cli: string[] | undefined,
  cfg: string | string[] | undefined,
  message: string,
): string | string[] {
  const picked = cli && cli.length > 0 ? cli : cfg;
  const list = picked === undefined ? [] : Array.isArray(picked) ? picked : [picked];
  required(list.length > 0 ? list : undefined, message);
  return list.length === 1 ? (list[0] as string) : list;
}

/** vault 值用于日志显示（多根用 , 连接）。 */
function fmtVault(v: string | string[]): string {
  return Array.isArray(v) ? v.join(", ") : v;
}

/** 合并 `--flag value part2 part3` 为 `--flag` + 单值（commander 的 `<cmd>` 只吃一 token，含空格 shell 会被拆参）。 */
function mergeSpacedOptionValue(argv: string[], flag: string): void {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag || i + 1 >= argv.length) continue;
    const first = argv[i + 1];
    if (first === undefined || first.startsWith("-")) continue;
    const parts = [first];
    let j = i + 2;
    while (j < argv.length) {
      const tok = argv[j];
      if (tok === undefined || tok.startsWith("--")) break;
      parts.push(tok);
      j++;
    }
    if (parts.length > 1) argv.splice(i + 1, parts.length, parts.join(" "));
  }
}

/** 启动前 argv 归一：去误传 `--`、合并含空格的 `--on-change` 等。 */
function normalizeArgv(argv: readonly string[]): string[] {
  const out = [...argv];
  while (out[2] === "--") out.splice(2, 1);
  mergeSpacedOptionValue(out, "--on-change");
  return out;
}

/** 汇报一次 meta 写操作结果：dry-run 打印将写入的完整内容到 stdout；否则打印 ✓/无变化摘要。 */
function reportEdit(r: EditResult, label: string): void {
  if (r.dryRun) {
    process.stdout.write(r.content);
    console.error(`· dry-run（未写入）：${label} → ${r.file}`);
    return;
  }
  console.log(r.changed ? `✓ ${label} → ${r.file}` : `· 无变化：${r.file}`);
}

/** 汇报一次 normalize：列出应用的归一项；无变更则提示已规范。 */
function reportNormalize(r: EditResult, changes: string[]): void {
  const summary = changes.length > 0 ? changes.join("；") : "无变更";
  if (r.dryRun) {
    process.stdout.write(r.content);
    console.error(`· dry-run（未写入）：${summary} → ${r.file}`);
    return;
  }
  console.log(r.changed ? `✓ normalize（${summary}）→ ${r.file}` : `· 已是规范形态：${r.file}`);
}

/** 解析重复的 --set key=value 为对象（无 `=` 报错）。 */
function parseSets(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`--set 需 key=value 形式，得到 "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

/** 汇报一次 apply：补入 / 跳过 / 仍缺；仍缺指向 profile show 让消费者决定补什么。 */
function reportApply(r: ApplyResult): void {
  const lines: string[] = [];
  if (r.filled.length > 0) lines.push(`补入：${r.filled.join(", ")}`);
  if (r.overridden.length > 0) lines.push(`覆盖(--set)：${r.overridden.join(", ")}`);
  if (r.refreshed.length > 0) lines.push(`重算(--refresh-derived)：${r.refreshed.join(", ")}`);
  const miss = [
    ...r.missing.required.map((k) => `${k}(必填)`),
    ...r.missing.recommended,
    ...r.missing.optional.map((k) => `${k}(可选)`),
  ];
  if (miss.length > 0) {
    lines.push(
      `仍缺：${miss.join(", ")}（读规范 meta profile show ${r.profile}；可 --set 或 meta set 补）`,
    );
  }
  if (r.dryRun) {
    process.stdout.write(r.content);
    console.error(
      `· dry-run（未写入）apply ${r.profile} → ${r.file}${lines.length > 0 ? `\n  ${lines.join("\n  ")}` : ""}`,
    );
    return;
  }
  console.log(`${r.changed ? "✓" : "·"} apply ${r.profile} → ${r.file}`);
  for (const l of lines) console.log(`  ${l}`);
}

/** 汇报一次编排器 run：文件/改动/跳过/失败计数；有失败置退出码 1。 */
function reportRun(report: RunReport, name: string, json: boolean): void {
  if (json) {
    emit(report);
  } else {
    const mark = report.failed.length === 0 ? "✓" : "⚠";
    console.log(
      `${mark} run ${name}：${report.total} 文件 / ${report.changed} 改动 / ${report.skipped} 跳过 / ${report.failed.length} 失败${report.dryRun ? "（dry-run，写动作未落盘）" : ""}`,
    );
    for (const f of report.failed) console.error(`  ✗ ${f.action} ${f.path}：${f.error}`);
  }
  if (report.failed.length > 0) process.exitCode = 1;
}

/** commander 累积器：把可重复的 `--pipe k=v` 收进数组。 */
function collectPipe(v: string, prev: string[]): string[] {
  return [...prev, v];
}

/** 逗号分隔串 → trim 去空的数组（管道值如 actions/on/paths）。 */
function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 解析统一管道参数 `--pipe k=v`（可重复）+ `--apply`，产出 PipelineConfig。
 * 次级 key：`use`（从配置 pipelines.<name> 加载作基底）/ actions / where / paths / on / concurrency / if-exists。
 * 命令行是规范落地、配置段是命名快照——`use` 加载后其余 k=v 覆盖；纯命令行即可自包含、不依赖配置。
 * scan/run/watch 三命令共用本解析（命令只决定「源」）。
 */
function resolvePipeline(pipeFlags: string[], apply: boolean): PipelineConfig {
  const kv: Record<string, string> = {};
  for (const p of pipeFlags) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`--pipe 需 key=value 形式，得到 "${p}"`);
    kv[p.slice(0, i).trim()] = p.slice(i + 1);
  }
  // use=<name>：从配置 pipelines 段加载作基底，其余 --pipe 覆盖它。
  let base: PipelineConfig | undefined;
  if (kv.use !== undefined) {
    base = config.pipelines?.[kv.use];
    if (!base) {
      const known = Object.keys(config.pipelines ?? {}).join(", ") || "无";
      throw new Error(`未知管道 "${kv.use}"（配置 pipelines 段；已知：${known}）`);
    }
  }
  const actions = kv.actions !== undefined ? splitList(kv.actions) : base?.actions;
  if (!actions || actions.length === 0) {
    throw new Error(
      "缺少管道动作：用 --pipe actions=index,normalize（内联）或 --pipe use=<配置管道>",
    );
  }
  // if-exists：rename 冲突策略（命令行覆盖配置基底）；非法值报错。
  const ifExistsRaw = kv["if-exists"] ?? base?.ifExists;
  if (
    ifExistsRaw !== undefined &&
    ifExistsRaw !== "skip" &&
    ifExistsRaw !== "overwrite" &&
    ifExistsRaw !== "merge"
  ) {
    throw new Error(`--pipe if-exists 仅接受 skip|overwrite|merge，得到 "${ifExistsRaw}"`);
  }
  return {
    actions,
    where: kv.where ?? base?.where,
    paths: kv.paths !== undefined ? splitList(kv.paths) : base?.paths,
    on: kv.on !== undefined ? (splitList(kv.on) as EventType[]) : base?.on,
    concurrency: kv.concurrency !== undefined ? Number(kv.concurrency) : base?.concurrency,
    debounce: base?.debounce,
    onError: base?.onError,
    dryRun: apply ? false : (base?.dryRun ?? true), // --apply 覆盖；否则配置 dryRun 或默认 true
    ifExists: ifExistsRaw as PipelineConfig["ifExists"],
  };
}

const program = new Command();

program
  .name("x-basalt")
  .description("零依赖 Obsidian 运行时的 Vault 解析 / 索引 / 查询 / Skill 召回 CLI")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("parse")
  .description("解析单文件，输出 AST JSON")
  .argument("<file>", "Markdown 文件路径")
  .option("--format <fmt>", "输出格式 json|yaml（默认 json，可由配置 format 覆盖）")
  .action((file: string, opts: { format?: string }) => {
    const content = readFileSync(file, "utf8");
    emit(new VaultParser().parse(content), opts.format ?? config.format ?? "json");
  });

program
  .command("index")
  .description("构建 / 更新 Vault 索引")
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--watch", "启用文件监听增量更新", false)
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .action(async (vaults: string[], opts: { watch: boolean; db?: string }) => {
    const vaultPath = requireVault(
      vaults,
      config.vault,
      "需要 <vault> 参数或在配置文件中设置 vault",
    );
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
    const indexer = new VaultIndexer({ vaultPath, dbPath });
    await indexer.rebuild();
    console.log(`✓ 已索引 ${fmtVault(vaultPath)} → ${dbPath}`);
    if (opts.watch) {
      indexer.watch((event, file) => console.log(`· ${event} ${file}`));
      console.log("监听中… 按 Ctrl+C 退出。");
    } else {
      indexer.close();
    }
  });

program
  .command("scan")
  .description(
    "按需增量重索引：diff 文件系统 vs 索引，只重扫新增/改动/删除的文件（无需常驻 watch）",
  )
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--rehash", "按内容对比检测变化（慢但稳），默认 mtime+size", false)
  .option("--dry-run", "只报告差异，不写库（供触发前预览）", false)
  .option("--json", "输出结构化差异报告（默认人读摘要；始终含 byDir 按目录计数）", false)
  .option(
    "--by-dir",
    "人读模式下追加按目录标量计数明细（只报计数不列文件名，规模再大也不截断）",
    false,
  )
  .option(
    "--pipe <kv>",
    "用管道处理 scan 出的变更（key=value 可重复：actions/use/where/on/concurrency/if-exists）",
    collectPipe,
    [] as string[],
  )
  .option("--apply", "管道写动作落盘（默认 dry-run；仅 --pipe 时有效）", false)
  .action(
    async (
      vaults: string[],
      opts: {
        db?: string;
        rehash: boolean;
        dryRun: boolean;
        json: boolean;
        byDir: boolean;
        pipe: string[];
        apply: boolean;
      },
    ) => {
      const vaultPath = requireVault(
        vaults,
        config.vault,
        "需要 <vault> 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      // 管道模式：scan 源（FS↔DB diff）→ 声明式管道（替代默认仅 index 落库）。
      if (opts.pipe.length > 0) {
        const pipeline = resolvePipeline(opts.pipe, opts.apply);
        const orch = new Orchestrator({ vaultPath, dbPath });
        try {
          reportRun(await orch.runScan(pipeline), "scan", opts.json);
        } finally {
          orch.close();
        }
        return;
      }
      const indexer = new VaultIndexer({ vaultPath, dbPath });
      try {
        const report = await indexer.scan({ rehash: opts.rehash, dryRun: opts.dryRun });
        if (opts.json) {
          emit(report);
        } else {
          const tag = opts.dryRun ? "（dry-run 未写入）" : "";
          console.log(
            `✓ scan ${fmtVault(vaultPath)}${tag}：+${report.added.length} 新增 ~${report.modified.length} 改动 -${report.deleted.length} 删除（${report.unchanged} 未变跳过）`,
          );
          if (opts.byDir) {
            const entries = Object.entries(report.byDir).toSorted(([a], [b]) => a.localeCompare(b));
            if (entries.length === 0) {
              console.log("  （无变更，按目录明细为空）");
            } else {
              for (const [dir, c] of entries) console.log(`  ${dir}  +${c.added} ~${c.modified} -${c.deleted}`);
            }
          }
        }
      } finally {
        indexer.close();
      }
    },
  );

program
  .command("query")
  .description("执行 Dataview 子集查询")
  .argument("<dql>", "DQL 查询语句")
  .option("--vault <path>", "Vault 目录（查询仅读索引，可省略）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--offset <n>", "结果起始偏移（默认 0）")
  .option("--size <n>", "本页最大行数（默认不分页/全部；给定则分页，结果含 total/hasMore）")
  .action((dql: string, opts: { db?: string; offset?: string; size?: string }) => {
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
    const engine = new DataviewEngine(dbPath);
    try {
      const offset = opts.offset !== undefined ? Number(opts.offset) : 0;
      const size = opts.size !== undefined ? Number(opts.size) : undefined;
      emit(engine.query(dql, { offset, size }));
    } finally {
      engine.close();
    }
  });

program
  .command("search")
  .description("全文检索笔记正文（FTS5 + trigram 子串匹配，覆盖中英文；S3.5）")
  .argument("<query>", "查询文本，至少 3 个字符（整体按字面短语匹配，不支持 FTS5 查询语法）")
  .option("--vault <path>", "Vault 目录（查询仅读索引，可省略）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--offset <n>", "结果起始偏移（默认 0）")
  .option("--size <n>", "本页最大行数（默认不分页/全部；给定则分页，结果含 total/hasMore）")
  .action((query: string, opts: { db?: string; offset?: string; size?: string }) => {
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
    const engine = new DataviewEngine(dbPath);
    try {
      const offset = opts.offset !== undefined ? Number(opts.offset) : 0;
      const size = opts.size !== undefined ? Number(opts.size) : undefined;
      emit(engine.search(query, { offset, size }));
    } finally {
      engine.close();
    }
  });

const skills = program
  .command("skills")
  .description("Skill 规范召回（内置 Obsidian/DQL 规范 + CLI 自我说明书）")
  .action(() => {
    // 无子命令时默认等价 list（人类/AI 可读）。
    console.log(renderSkillList(new SkillRecall({ skillPath: config.skillPath }).list()));
  });
skills
  .command("list")
  .description("列出全部可用 skill（name — description）")
  .option("--json", "结构化 JSON 输出")
  .action((opts: { json?: boolean }) => {
    const metas = new SkillRecall({ skillPath: config.skillPath }).list();
    if (opts.json) emit(metas);
    else console.log(renderSkillList(metas));
  });
skills
  .command("get")
  .description("按名输出 skill 完整内容；--all 输出全部")
  .argument("[name]", "skill 名（省略时须配 --all）")
  .option("--all", "输出全部 skill")
  .option("--json", "结构化 JSON 输出（原始 SkillDefinition）")
  .action((name: string | undefined, opts: { all?: boolean; json?: boolean }) => {
    const recall = new SkillRecall({ skillPath: config.skillPath });
    if (opts.all) {
      const defs = recall.all();
      if (opts.json) emit(defs);
      else console.log(renderSkills(defs));
      return;
    }
    if (!name) {
      console.error("✗ 用法：x-basalt skills get <name> | x-basalt skills get --all");
      process.exitCode = 1;
      return;
    }
    const def = recall.get(name);
    if (!def) {
      console.error(`✗ 未找到名为 "${name}" 的 skill（用 \`skills list\` 查看可用名）`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) emit(def);
    else console.log(renderSkill(def));
  });
skills
  .command("recall")
  .description("按关键字模糊召回规范（Fuse.js，容拼写错、相关性排序）")
  .argument("<keyword>", "召回关键字")
  .option("--json", "结构化 JSON 输出")
  .action((keyword: string, opts: { json?: boolean }) => {
    const hits = new SkillRecall({ skillPath: config.skillPath }).recall(keyword);
    if (hits.length === 0) {
      console.error(`✗ 未召回到与 "${keyword}" 相关的 skill`);
      process.exitCode = 1;
      return;
    }
    if (opts.json) emit(hits);
    else console.log(renderSkills(hits));
  });
skills
  .command("path")
  .description("打印解析出的 skill 数据目录；带 name 打印该 skill 文件路径")
  .argument("[name]", "skill 名")
  .action((name: string | undefined) => {
    const dir = new SkillRecall({ skillPath: config.skillPath }).resolvedDir();
    console.log(name ? join(dir, `${name}.json5`) : dir);
  });

// meta：读/改单文件 frontmatter（元数据头）。写操作原子写、可 --dry-run 预览。
const meta = program.command("meta").description("读/改笔记 frontmatter（元数据头）");
meta
  .command("get")
  .description("读取 frontmatter（省略 key 输出整个元数据）")
  .argument("<file>", "Markdown 文件路径")
  .argument("[key]", "属性名（省略则输出整个 frontmatter）")
  .option("--format <fmt>", "输出格式 json|yaml（默认 json，可由配置 format 覆盖）")
  .action((file: string, key: string | undefined, opts: { format?: string }) => {
    emit(readMeta(file, key) ?? null, opts.format ?? config.format ?? "json");
  });
meta
  .command("set")
  .description("设置 / 更新一个属性")
  .argument("<file>", "Markdown 文件路径")
  .argument("<key>", "属性名")
  .argument("<value>", "属性值（按 --type 解释）")
  .option("--type <t>", "值类型 string|number|boolean|null|list|auto（默认 auto，保守推断）")
  .option("--dry-run", "只预览将写入的内容，不落盘", false)
  .action((file: string, key: string, value: string, opts: { type?: string; dryRun: boolean }) => {
    const typed = coerceValue(value, (opts.type ?? "auto") as MetaScalarType);
    reportEdit(
      editMeta(file, (d) => setMeta(d, key, typed), { dryRun: opts.dryRun }),
      `set ${key}`,
    );
  });
meta
  .command("unset")
  .description("删除一个属性")
  .argument("<file>", "Markdown 文件路径")
  .argument("<key>", "属性名")
  .option("--dry-run", "只预览，不落盘", false)
  .action((file: string, key: string, opts: { dryRun: boolean }) => {
    reportEdit(
      editMeta(file, (d) => unsetMeta(d, key), { dryRun: opts.dryRun }),
      `unset ${key}`,
    );
  });
meta
  .command("rename")
  .description("重命名一个属性键（保位置/值，重名或缺失则报错）")
  .argument("<file>", "Markdown 文件路径")
  .argument("<oldKey>", "原键名")
  .argument("<newKey>", "新键名")
  .option("--dry-run", "只预览，不落盘", false)
  .action((file: string, oldKey: string, newKey: string, opts: { dryRun: boolean }) => {
    reportEdit(
      editMeta(file, (d) => renameMeta(d, oldKey, newKey), { dryRun: opts.dryRun }),
      `rename ${oldKey} → ${newKey}`,
    );
  });
meta
  .command("normalize")
  .description("归一 frontmatter：tags/aliases/cssclasses 列表化、去 #、去重、单数键→复数键迁移")
  .argument("<file>", "Markdown 文件路径")
  .option("--sort-keys", "额外按字母序排序顶层键（opt-in，可能动空行）", false)
  .option("--dry-run", "只预览，不落盘", false)
  .action((file: string, opts: { sortKeys: boolean; dryRun: boolean }) => {
    let changes: string[] = [];
    const r = editMeta(
      file,
      (d) => {
        changes = normalizeDoc(d, { sortKeys: opts.sortKeys });
      },
      { dryRun: opts.dryRun },
    );
    reportNormalize(r, changes);
  });

// meta profile：列出 / 查看元数据策略规范（“告知”能力——x-basalt 只告知，补全由消费者 AI/人）。
const metaProfile = meta.command("profile").description("元数据策略 profile：列出 / 查看规范");
metaProfile
  .command("list")
  .description("列出可用 profile")
  .action(() => {
    emit(listProfiles().map((p) => ({ name: p.name, title: p.title, source: p.source })));
  });
metaProfile
  .command("show")
  .description("输出某 profile 的规范+模板（供 AI/人读后决定补什么）")
  .argument("<name>", "profile 名")
  .option("--format <fmt>", "输出格式 json|yaml（默认 json，可由配置 format 覆盖）")
  .action((name: string, opts: { format?: string }) => {
    emit(getProfile(name), opts.format ?? config.format ?? "json");
  });
meta
  .command("apply")
  .description("套用 profile：机械预填（created/modified/sha256）+ --set 补缺 + 报告仍缺")
  .argument("<profile>", "profile 名")
  .argument("<file>", "Markdown 文件路径")
  .option(
    "--set <kv>",
    "key=value（可重复，按 profile 字段类型转值）",
    (v: string, prev: string[]) => [...prev, v],
    [] as string[],
  )
  .option("--dry-run", "只预览，不落盘", false)
  .option(
    "--refresh-derived",
    "重算内容派生的机械字段（modified/timestamp/sha256）覆盖旧值；created/pubDate 恒定不动",
    false,
  )
  .action(
    (
      profile: string,
      file: string,
      opts: { set: string[]; dryRun: boolean; refreshDerived: boolean },
    ) => {
      reportApply(
        applyProfile(file, profile, {
          sets: parseSets(opts.set),
          dryRun: opts.dryRun,
          refreshDerived: opts.refreshDerived,
        }),
      );
    },
  );

program
  .command("run")
  .description(
    "按管道处理变更：--pipe 内联(actions=…) 或引用配置(use=…)；默认 scan 源，--pipe where=/paths= 切手动源",
  )
  .option(
    "--pipe <kv>",
    "管道参数 key=value（可重复）：use/actions/where/paths/on/concurrency/if-exists",
    collectPipe,
    [] as string[],
  )
  .option("--apply", "写动作落盘（默认 dry-run 只预览）", false)
  .option(
    "--vault <path>",
    "Vault 目录（可多个，重复 --vault；可回退配置 vault）",
    collectVault,
    [] as string[],
  )
  .option("--db <path>", "SQLite 索引路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--json", "结构化报告输出", false)
  .action(
    async (opts: {
      pipe: string[];
      apply: boolean;
      vault: string[];
      db?: string;
      json: boolean;
    }) => {
      const vaultPath = requireVault(
        opts.vault,
        config.vault,
        "需要 --vault 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      const pipeline = resolvePipeline(opts.pipe, opts.apply);
      const orch = new Orchestrator({ vaultPath, dbPath });
      try {
        // 源：--pipe where= → DQL 手动源；否则默认 scan 源。
        // 注：--pipe paths= 是 glob 路由过滤（在 runBatch 内 matchEvent 生效），不作源；显式文件列表源属正交的 stdin 设计（后续）。
        const report =
          pipeline.where !== undefined
            ? await orch.runManual(pipeline, { dql: pipeline.where })
            : await orch.runScan(pipeline);
        reportRun(report, "run", opts.json);
      } finally {
        orch.close();
      }
    },
  );

program
  .command("watch")
  .description("监听模式：索引 + 文件变更实时输出")
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--on-change <cmd>", "变更时执行的命令模板（{file} 占位；可由配置 onChange 提供）")
  .option(
    "--pipe <kv>",
    "用管道维护（key=value 可重复：actions/use/where/on/concurrency/if-exists）；替代 --on-change 裸 shell",
    collectPipe,
    [] as string[],
  )
  .option("--apply", "管道写动作落盘（默认 dry-run；常驻自动改文件，慎用）", false)
  .action(
    async (
      vaults: string[],
      opts: { db?: string; onChange?: string; pipe: string[]; apply: boolean },
    ) => {
      const vaultPath = requireVault(
        vaults,
        config.vault,
        "需要 <vault> 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      // 管道模式：常驻编排器（启动先全量 scan 建基线，再 watch 增量维护，SIGINT 优雅退出）。
      if (opts.pipe.length > 0) {
        const pipeline = resolvePipeline(opts.pipe, opts.apply);
        const orch = new Orchestrator({ vaultPath, dbPath });
        await orch.runScan(pipeline); // 初始运行：建基线
        orch.watch(
          pipeline,
          (r) => console.log(`· 管道：${r.total} 文件 / ${r.changed} 改 / ${r.failed.length} 败`),
          () => console.log("✓ 监听中（管道）… 按 Ctrl+C 退出。"),
        );
        const shutdown = (): void => void orch.stop().then(() => process.exit(0));
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return;
      }
      const onChange = opts.onChange ?? config.onChange;
      const indexer = new VaultIndexer({ vaultPath, dbPath });
      await indexer.rebuild();
      console.log(`✓ 已索引 ${fmtVault(vaultPath)} → ${dbPath}，开始监听… 按 Ctrl+C 退出。`);
      indexer.watch((event, file) => {
        console.log(`· ${event} ${file}`);
        // on-change 命令模板：{file} 占位替换为变更文件路径，经 shell 执行。
        if (onChange) {
          const cmd = onChange.replaceAll("{file}", file);
          exec(cmd, (err, stdout, stderr) => {
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
            if (err) console.error(`✗ on-change 失败：${err.message}`);
          });
        }
      });
    },
  );

program
  .command("chat")
  .description("自然语言驱动 vault（可选 AI；需 AI_GATEWAY_API_KEY，无则禁用，不影响其他命令）")
  .argument("[input]", "自然语言指令（省略则进 REPL）")
  .option("--model <name>", "覆盖 AI_GATEWAY_MODEL")
  .option(
    "--max-steps <n>",
    "agentic 最大步数（撞顶不再静默停：单发提示、REPL 可「继续」续跑）",
    "20",
  )
  .option("--db <path>", "SQLite 索引路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option(
    "--vault <path>",
    "Vault 目录（可多个，重复 --vault；可回退配置 vault）",
    collectVault,
    [] as string[],
  )
  .option("-q, --quiet", "单发只输出答案与 no-recall/exhausted 结果限定，完全隐藏工具过程")
  .option("--json", "单发结束后输出一个结构化 JSON 对象（优先于 --quiet）")
  .option("--trace [file]", "落盘 chat 事件到 JSONL（省略 file 则按时间戳自动命名）")
  .action(
    async (
      input: string | undefined,
      opts: {
        model?: string;
        maxSteps: string;
        db?: string;
        vault: string[];
        quiet?: boolean;
        json?: boolean;
        trace?: string | true;
      },
    ) => {
      // 先检查 AI key：无 key 直接友好退出，避免先报 "需要 --vault" 造成误导。
      // provider.ts 无 AI SDK 顶层依赖，可安全懒加载；真正触达 SDK 的 index.ts 仍延后到本分支有 key 之后。
      const { resolveProvider, NO_KEY_MESSAGE } = await import("./chat/provider.js");
      const res = resolveProvider(process.env, opts.model);
      if ("error" in res) {
        console.error(NO_KEY_MESSAGE);
        process.exitCode = 1;
        return;
      }
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      const vaultPath = requireVault(
        opts.vault,
        config.vault,
        "需要 --vault 参数或在配置文件中设置 vault",
      );
      const tracePath =
        opts.trace === true
          ? join(
              BASE_DIR,
              "chat-traces",
              `${new Date().toISOString().replaceAll(/[:.]/g, "-")}.jsonl`,
            )
          : opts.trace;
      const chatOpts = {
        model: opts.model,
        maxSteps: Number(opts.maxSteps),
        dbPath,
        vaultPath,
        skillPath: config.skillPath,
        trace: tracePath,
        version: program.version(),
        quiet: opts.quiet,
        json: opts.json,
      };
      // 懒加载：只有确认有 key 后才触达 src/chat（及其 AI SDK 依赖）。
      const { runOnce, runRepl, readPipedStdin } = await import("./chat/index.js");
      let prompt = input?.trim() ?? "";
      if (!prompt && !process.stdin.isTTY) prompt = await readPipedStdin();
      if (!prompt && !process.stdin.isTTY) {
        console.error("✗ chat 未提供输入");
        process.exitCode = 1;
        return;
      }
      process.exitCode = prompt ? await runOnce(prompt, chatOpts) : await runRepl(chatOpts);
    },
  );

const links = program
  .command("links")
  .description("本地链接诊断（断链检查 + 修复建议；KB compiler P1）");

links
  .command("check")
  .description("扫全 vault 报断链（wikilink/embed/markdown link/图片本地目标存在性）")
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--format <fmt>", "输出格式 human|json|yaml（默认 human）")
  .action(async (vaults: string[], opts: { format?: string }) => {
    const vault = vaults.length > 0 ? vaults : config.vault;
    if (vault === undefined) {
      console.error("✗ 未指定 vault：传目录参数或在配置中设 vault");
      process.exitCode = 2;
      return;
    }
    const { diagnostics, exitCode } = await runLinksCheck({ vault, ignore: config.lint?.ignore });
    if (opts.format === "json" || opts.format === "yaml") emit(diagnostics, opts.format);
    else console.log(renderHuman(diagnostics));
    process.exitCode = exitCode;
  });

links
  .command("suggest")
  .description("单文件断链 + 路径建议（按 basename 命中给相对路径）")
  .argument("<file>", "目标 Markdown 文件（vault 相对主键 / cwd 相对 / 绝对）")
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--format <fmt>", "输出格式 human|json|yaml（默认 human）")
  .action(async (file: string, vaults: string[], opts: { format?: string }) => {
    const vault = vaults.length > 0 ? vaults : config.vault;
    if (vault === undefined) {
      console.error("✗ 未指定 vault：传目录参数或在配置中设 vault");
      process.exitCode = 2;
      return;
    }
    const { diagnostics, exitCode } = await runLinksSuggest(file, { vault, ignore: config.lint?.ignore });
    if (opts.format === "json" || opts.format === "yaml") emit(diagnostics, opts.format);
    else console.log(renderHuman(diagnostics));
    process.exitCode = exitCode;
  });

program
  .command("lint")
  .description("按规则集诊断 vault，产出统一 BasaltDiagnostic（KB compiler；规则：links、metadata）")
  .argument("[vault...]", "Vault 目录（可多个；省略则回退配置 vault）")
  .option("--rules <list>", "规则集，逗号分隔（默认 links；给 --profile 时默认 metadata）")
  .option(
    "--profile <name>",
    "metadata 规则用的 profile：config profiles.<name> 优先（同名覆盖内置），否则内置 pkm-note|llm-wiki|ssg-blog",
  )
  .option("--format <fmt>", "输出格式 human|json|yaml（默认 human）")
  .action(async (vaults: string[], opts: { rules?: string; profile?: string; format?: string }) => {
    const vault = vaults.length > 0 ? vaults : config.vault;
    if (vault === undefined) {
      console.error("✗ 未指定 vault：传目录参数或在配置中设 vault");
      process.exitCode = 2;
      return;
    }
    const rules = opts.rules
      ?.split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    const { diagnostics, exitCode } = await runLint({
      vault,
      rules,
      profile: opts.profile,
      profiles: config.profiles,
      ignore: config.lint?.ignore,
    });
    if (opts.format === "json" || opts.format === "yaml") emit(diagnostics, opts.format);
    else console.log(renderLintHuman(diagnostics));
    process.exitCode = exitCode;
  });

program.parseAsync(normalizeArgv(process.argv)).catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});

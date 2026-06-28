#!/usr/bin/env node
import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
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
import type { RunReport } from "./orchestrator/index.js";
import { DataviewEngine } from "./query/index.js";
import { SkillRecall } from "./skill/index.js";
import { renderSkill, renderSkillList, renderSkills } from "./skill/render.js";

// === 自建实现: CLI 入口（commander），命令 parse / index / scan / query / skills / meta / watch ===
//
// 上游：终端用户 / pnpm cli；下游：装配 parser / indexer / query / skill 四层库能力。
// 本文件只做参数装配与输出格式化，不内联业务逻辑（逻辑在各层并各有单测）。

// 启动时加载一次项目/全局配置；各命令以 `flag ?? config.X ?? 内置默认` 解析，免去重复传参。
const config = loadConfig();

// 基目录：env `X_BASALT_DIR` 指定则用它（可把 .x-basalt 整块搬到任意位置），否则就近隐藏目录 `.x-basalt/`。
const BASE_DIR = process.env.X_BASALT_DIR ?? ".x-basalt";
/** 默认索引路径：基目录下 index.db（indexer 会自动建该目录）。 */
const DEFAULT_DB = join(BASE_DIR, "index.db");

/** 取值，缺失则以统一 ✗ 报错（用于必需但可来自 config 的项）。 */
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null || value === "") throw new Error(message);
  return value;
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
  .argument("[vault]", "Vault 目录（可省略，回退配置 vault）")
  .option("--watch", "启用文件监听增量更新", false)
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .action(async (vault: string | undefined, opts: { watch: boolean; db?: string }) => {
    const vaultPath = required(vault ?? config.vault, "需要 <vault> 参数或在配置文件中设置 vault");
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
    const indexer = new VaultIndexer({ vaultPath, dbPath });
    await indexer.rebuild();
    console.log(`✓ 已索引 ${vaultPath} → ${dbPath}`);
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
  .argument("[vault]", "Vault 目录（可省略，回退配置 vault）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--rehash", "按内容对比检测变化（慢但稳），默认 mtime+size", false)
  .option("--dry-run", "只报告差异，不写库（供触发前预览）", false)
  .option("--json", "输出结构化差异报告（默认人读摘要）", false)
  .action(
    async (
      vault: string | undefined,
      opts: { db?: string; rehash: boolean; dryRun: boolean; json: boolean },
    ) => {
      const vaultPath = required(
        vault ?? config.vault,
        "需要 <vault> 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      const indexer = new VaultIndexer({ vaultPath, dbPath });
      try {
        const report = await indexer.scan({ rehash: opts.rehash, dryRun: opts.dryRun });
        if (opts.json) {
          emit(report);
        } else {
          const tag = opts.dryRun ? "（dry-run 未写入）" : "";
          console.log(
            `✓ scan ${vaultPath}${tag}：+${report.added.length} 新增 ~${report.modified.length} 改动 -${report.deleted.length} 删除（${report.unchanged} 未变跳过）`,
          );
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
  .action((dql: string, opts: { db?: string }) => {
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
    const engine = new DataviewEngine(dbPath);
    try {
      emit(engine.query(dql));
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
  .action((profile: string, file: string, opts: { set: string[]; dryRun: boolean }) => {
    reportApply(applyProfile(file, profile, { sets: parseSets(opts.set), dryRun: opts.dryRun }));
  });

program
  .command("run")
  .description("按声明式管道处理变更（默认 scan 全库 diff；--where/--paths 切手动源）")
  .argument("<pipeline>", "管道名（定义在配置 pipelines 段）")
  .option("--where <dql>", "用 DQL 选文件作为手动源（= 原 migrate 的语义选一批）")
  .option("--paths <p...>", "文件相对路径列表作为手动源")
  .option("--vault <path>", "Vault 目录（可回退配置 vault）")
  .option("--db <path>", "SQLite 索引路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--json", "结构化报告输出", false)
  .action(
    async (
      name: string,
      opts: { where?: string; paths?: string[]; vault?: string; db?: string; json: boolean },
    ) => {
      const vaultPath = required(
        opts.vault ?? config.vault,
        "需要 --vault 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      const pipeline = config.pipelines?.[name];
      if (!pipeline) {
        const known = Object.keys(config.pipelines ?? {}).join(", ") || "无";
        throw new Error(`未知管道 "${name}"（在配置 pipelines 段定义；已知：${known}）`);
      }
      const orch = new Orchestrator({ vaultPath, dbPath });
      try {
        const report =
          opts.where !== undefined
            ? await orch.runManual(pipeline, { dql: opts.where })
            : opts.paths !== undefined
              ? await orch.runManual(pipeline, { paths: opts.paths })
              : await orch.runScan(pipeline);
        reportRun(report, name, opts.json);
      } finally {
        orch.close();
      }
    },
  );

program
  .command("watch")
  .description("监听模式：索引 + 文件变更实时输出")
  .argument("[vault]", "Vault 目录（可省略，回退配置 vault）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--on-change <cmd>", "变更时执行的命令模板（{file} 占位；可由配置 onChange 提供）")
  .option("--pipeline <name>", "用声明式管道维护（配置 pipelines 段）；替代 --on-change 裸 shell")
  .action(
    async (
      vault: string | undefined,
      opts: { db?: string; onChange?: string; pipeline?: string },
    ) => {
      const vaultPath = required(
        vault ?? config.vault,
        "需要 <vault> 参数或在配置文件中设置 vault",
      );
      const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
      // 管道模式：常驻编排器（启动先全量 scan 建基线，再 watch 增量维护，SIGINT 优雅退出）。
      if (opts.pipeline) {
        const pipeline = config.pipelines?.[opts.pipeline];
        if (!pipeline) {
          const known = Object.keys(config.pipelines ?? {}).join(", ") || "无";
          throw new Error(`未知管道 "${opts.pipeline}"（配置 pipelines 段；已知：${known}）`);
        }
        const orch = new Orchestrator({ vaultPath, dbPath });
        await orch.runScan(pipeline); // 初始运行：建基线
        orch.watch(
          pipeline,
          (r) =>
            console.log(
              `· 管道 ${opts.pipeline}：${r.total} 文件 / ${r.changed} 改 / ${r.failed.length} 败`,
            ),
          () => console.log(`✓ 监听中（管道 ${opts.pipeline}）… 按 Ctrl+C 退出。`),
        );
        const shutdown = (): void => void orch.stop().then(() => process.exit(0));
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return;
      }
      const onChange = opts.onChange ?? config.onChange;
      const indexer = new VaultIndexer({ vaultPath, dbPath });
      await indexer.rebuild();
      console.log(`✓ 已索引 ${vaultPath} → ${dbPath}，开始监听… 按 Ctrl+C 退出。`);
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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});

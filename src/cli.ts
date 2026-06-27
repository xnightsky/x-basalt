#!/usr/bin/env node
import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { emit } from "./format.js";
import { VaultIndexer } from "./indexer/index.js";
import { VaultParser } from "./parser/index.js";
import { DataviewEngine } from "./query/index.js";
import { SkillRecall } from "./skill/index.js";

// === 自建实现: CLI 入口（commander），五子命令 parse / index / query / skill / watch ===
//
// 上游：终端用户 / pnpm cli；下游：装配 parser / indexer / query / skill 四层库能力。
// 本文件只做参数装配与输出格式化，不内联业务逻辑（逻辑在各层并各有单测）。

// 启动时加载一次项目/全局配置；各命令以 `flag ?? config.X ?? 内置默认` 解析，免去重复传参。
const config = loadConfig();

/** 默认索引路径：放仓库内隐藏目录 .x-basalt/（indexer 会自动建该目录）。 */
const DEFAULT_DB = ".x-basalt/index.db";

/** 取值，缺失则以统一 ✗ 报错（用于必需但可来自 config 的项）。 */
function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === null || value === "") throw new Error(message);
  return value;
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
  .description("按需增量重索引：diff 文件系统 vs 索引，只重扫新增/改动/删除的文件（无需常驻 watch）")
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
      const vaultPath = required(vault ?? config.vault, "需要 <vault> 参数或在配置文件中设置 vault");
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

const skill = program.command("skill").description("Skill 规范召回");
skill
  .command("recall")
  .description("按关键字召回规范")
  .argument("<keyword>", "召回关键字")
  .action((keyword: string) => {
    const hits = new SkillRecall({ skillPath: config.skillPath }).recall(keyword);
    if (hits.length === 0) {
      console.error(`✗ 未召回到与 "${keyword}" 相关的 skill`);
      process.exitCode = 1;
      return;
    }
    emit(hits);
  });
skill
  .command("list")
  .description("列出全部可用 skill")
  .action(() => {
    emit(new SkillRecall({ skillPath: config.skillPath }).list());
  });

program
  .command("watch")
  .description("监听模式：索引 + 文件变更实时输出")
  .argument("[vault]", "Vault 目录（可省略，回退配置 vault）")
  .option("--db <path>", "SQLite 索引文件路径（默认 .x-basalt/index.db，可由配置 db 覆盖）")
  .option("--on-change <cmd>", "变更时执行的命令模板（{file} 占位；可由配置 onChange 提供）")
  .action(async (vault: string | undefined, opts: { db?: string; onChange?: string }) => {
    const vaultPath = required(vault ?? config.vault, "需要 <vault> 参数或在配置文件中设置 vault");
    const dbPath = opts.db ?? config.db ?? DEFAULT_DB;
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
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});

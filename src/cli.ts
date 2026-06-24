#!/usr/bin/env node
import { Command } from "commander";

// === 自建实现: CLI 入口（commander），五子命令 parse / index / query / skill / watch ===
// 阶段 0 仅接线命令与选项；各动作的真实实现随对应阶段填充（见 docs/plans）。

/** 标记某命令尚未实现，给出阶段指引。 */
class NotImplemented extends Error {
  constructor(command: string, phase: number) {
    super(
      `命令 "${command}" 尚未实现（计划阶段 ${phase}，见 docs/plans/2026-06-25-x-basalt-cli-mvp.md）`,
    );
    this.name = "NotImplemented";
  }
}

const program = new Command();

program
  .name("x-basalt-cli")
  .description("零依赖 Obsidian 运行时的 Vault 解析 / 索引 / 查询 / Skill 召回 CLI")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("parse")
  .description("解析单文件，输出 AST JSON")
  .argument("<file>", "Markdown 文件路径")
  .option("--format <fmt>", "输出格式 json|yaml", "json")
  .action(() => {
    throw new NotImplemented("parse", 1);
  });

program
  .command("index")
  .description("构建 / 更新 Vault 索引")
  .argument("<vault>", "Vault 目录")
  .option("--watch", "启用文件监听增量更新", false)
  .option("--db <path>", "SQLite 索引文件路径", "./index.db")
  .action(() => {
    throw new NotImplemented("index", 2);
  });

program
  .command("query")
  .description("执行 Dataview 子集查询")
  .argument("<dql>", "DQL 查询语句")
  .option("--vault <path>", "Vault 目录")
  .requiredOption("--db <path>", "SQLite 索引文件路径")
  .action(() => {
    throw new NotImplemented("query", 3);
  });

const skill = program.command("skill").description("Skill 规范召回");
skill
  .command("recall")
  .description("按关键字召回规范")
  .argument("<keyword>", "召回关键字")
  .action(() => {
    throw new NotImplemented("skill recall", 4);
  });
skill
  .command("list")
  .description("列出全部可用 skill")
  .action(() => {
    throw new NotImplemented("skill list", 4);
  });

program
  .command("watch")
  .description("监听模式：索引 + 文件变更实时输出")
  .argument("<vault>", "Vault 目录")
  .option("--on-change <cmd>", "变更时执行的命令模板（{file} 占位）")
  .action(() => {
    throw new NotImplemented("watch", 4);
  });

try {
  program.parse(process.argv);
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
}

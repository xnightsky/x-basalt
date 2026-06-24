import type { ParsedFile } from "./types.js";

export type { ObsidianNode, ParsedFile } from "./types.js";

/**
 * Vault 解析器：输入文件内容 → 标准化 AST。
 * 纯函数，不触碰文件系统或数据库（边界见 AGENTS.md「代码与规范」）。
 *
 * 阶段 1 编排：parseFrontmatter → extractWikilinks → 行内 tag/callout/task/highlight/blockRef 提取。
 */
export class VaultParser {
  /**
   * 解析单文件内容为 frontmatter + ObsidianNode[]。
   *
   * @param content - 文件完整内容
   */
  parse(content: string): ParsedFile {
    void content;
    throw new Error("not implemented: VaultParser.parse（阶段 1）");
  }
}

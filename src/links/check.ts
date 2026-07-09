import { readFile } from "node:fs/promises";
import { VaultParser } from "../parser/index.js";
import { resolveVaultLayout } from "../utils/path.js";
import { compileIgnore, type IgnoreMatcher, type LintIgnoreConfig } from "./ignore.js";
import { resolveMarkdownLink, resolveWikilink } from "./resolve.js";
import { buildTargetIndex, collectFiles } from "./scan.js";
import type { BasaltIssue, LinkFinding, TargetIndex } from "./types.js";

// === 自建实现: links 检查编排（内存 per-run，不碰 SQLite）===
//
// 上游：src/links/index.ts 的 runLinksCheck / runLinksSuggest；
// 下游：report.ts 渲染、CLI emit。设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §3.2/§5。

export interface CheckOptions {
  vault: string | string[];
  ignore?: LintIgnoreConfig;
}

const RULE = "links/no-broken-link";

const MESSAGES: Record<string, (target: string) => string> = {
  not_found: (t) => `链接目标不存在：${t}`,
  outside_vault: (t) => `链接逃出 vault 根：${t}`,
  backslash_path: (t) => `路径含反斜杠（应改用 /）：${t}`,
  ambiguous_target: (t) => `链接目标同名多处，需限定路径：${t}`,
};

/** 由链接节点 + 判定结果组装 issue（reason 非空且非 external_skipped 才产出）。 */
function toIssue(
  fileRel: string,
  line: number,
  column: number,
  target: string,
  finding: LinkFinding,
): BasaltIssue | undefined {
  if (!finding.reason || finding.reason === "external_skipped") return undefined;
  const message = (MESSAGES[finding.reason] ?? ((t: string) => t))(target);
  return {
    file: fileRel,
    line,
    column,
    rule: RULE,
    severity: "error",
    message,
    target,
    reason: finding.reason,
    suggestions: finding.suggestions,
    fixable: false,
  };
}

/** 纯函数：吃已读内容 + 已建索引，产出该文件的断链 issue（已过 ignore）。 */
export function checkFile(
  _fileAbs: string,
  fileRel: string,
  content: string,
  index: TargetIndex,
  ignore: IgnoreMatcher,
): BasaltIssue[] {
  const { nodes } = new VaultParser().parse(content);
  const out: BasaltIssue[] = [];
  for (const node of nodes) {
    let issue: BasaltIssue | undefined;
    if (node.type === "wikilink") {
      issue = toIssue(fileRel, node.line, node.column, node.raw, resolveWikilink(node, index, fileRel));
    } else if (node.type === "markdownLink") {
      issue = toIssue(
        fileRel,
        node.line,
        node.column,
        node.target,
        resolveMarkdownLink(node, index, fileRel),
      );
    }
    if (issue && !ignore.ignored(issue)) out.push(issue);
  }
  return out;
}

/** 编排全 vault 检查：枚举→建索引→逐 .md 解析判定→汇总排序。 */
export async function checkVault(opts: CheckOptions): Promise<BasaltIssue[]> {
  const layout = resolveVaultLayout(opts.vault);
  const { all, markdown } = await collectFiles(layout.roots, layout.toKey);
  const index = buildTargetIndex(all);
  const ignore = compileIgnore(opts.ignore);
  const issues: BasaltIssue[] = [];
  for (const file of markdown) {
    const content = await readFile(file.abs, "utf8");
    issues.push(...checkFile(file.abs, file.key, content, index, ignore));
  }
  return issues.toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );
}

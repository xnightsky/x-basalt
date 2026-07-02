/**
 * Parser 模块入口：将 Vault 文件内容解析为标准化 ObsidianNode[]，纯函数，不触碰 fs/DB。
 *
 * 上游：src/indexer（index/watch 子命令通过 VaultParser 解析每个文件内容）。
 * 下游：parseFrontmatter（./frontmatter.ts）、extractWikilinks（./wikilink.ts）；
 *       其余提取器（tag/callout/task/highlight/blockRef/inlineField）在本文件内实现并保持模块私有。
 *
 * 不变量：parser 产出的 ObsidianNode[] 是 indexer/query 对 Markdown 的唯一解析来源；
 *         indexer 不重复解析原始正文，query 不感知 ObsidianNode。
 */
import { parseFrontmatter } from "./frontmatter.js";
import type { ObsidianNode, ParsedFile } from "./types.js";
import { extractWikilinks } from "./wikilink.js";

export type { ObsidianNode, ParsedFile } from "./types.js";

// === Obsidian 规范来源: 行内专有语法的提取规则，详见 skill biz-obsidian-spec / 调研 §2 ===
// 这些正则按行或全局匹配，逐类产出 ObsidianNode；frontmatter 已先行剥离，故不会误吃顶部 YAML。

// Tag：# 前不能是字母/数字/下划线（word 字符）——比「行首或空白」更贴近 Obsidian：
//   允许 CJK 标点后成标签（如「标签：#moc」），但排除 word#x / 123#x / Concepts#heading。
// 标签体取 Unicode 字母/数字/下划线/连字符/斜杠；纯数字（如 #123）由下方过滤排除。
const TAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_/-]+)/gu;
// Task：行首可缩进的 - 或 *，方括号内单字符状态，其后正文。
const TASK_RE = /^\s*[-*]\s+\[(.)\]\s+(.*)$/;
// Callout 头：> [!type] 可带折叠标记 +/-，其后为标题。
const CALLOUT_HEAD_RE = /^>\s*\[!([^\]]+)\]([+-]?)\s*(.*)$/;
// Highlight：成对 ==...==，非贪婪，至少一个字符。
const HIGHLIGHT_RE = /==(.+?)==/g;
// BlockRef 定义：行尾 ^id（id 为字母数字与连字符）；^ 前需行首或空白，排除 [[#^id]] 这类引用。
const BLOCKREF_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

// === Obsidian 规范来源: Dataview inline fields（key:: value 三形态）===
// 整行 `key:: value`（允许列表项前缀 `- ` / `* `）、方括号 `[key:: value]`（键可见）、
// 圆括号 `(key:: value)`（键隐藏）。设计真相源 docs/specs/2026-07-02-inline-fields-design.md §6.1。
// === 自建实现: v1 子集收窄 ===
// key 仅收 [A-Za-z0-9_]+（与查询层字段名白名单对齐 → DQL 文法零改动，D4；带空格/连字符 key 列 backlog）；
// 三条正则均线性、无嵌套量词（ReDoS 安全口径见 spec §7）。`https://x` 天然不命中（`//` 非 `::`）。
const INLINE_FIELD_LINE_RE = /^\s*(?:[-*]\s+)?([A-Za-z0-9_]+)\s*::\s*(.*)$/;
const INLINE_FIELD_BRACKET_RE = /\[([A-Za-z0-9_]+)\s*::\s*([^\]]*)\]/g;
const INLINE_FIELD_PAREN_RE = /\(([A-Za-z0-9_]+)\s*::\s*([^)]*)\)/g;

// === Obsidian 规范来源: 代码块/行内代码内不解析行内语法 ===
// Obsidian（同 CommonMark）不在围栏代码块（``` / ~~~）与行内代码（成对反引号）内识别
// #tag、==高亮== 等行内语法。提取前先把代码区域「掩码」掉，避免代码里的 `# 注释`、字符串中的
// `==x==` 被误当标签/高亮（调研 §3.3#4 列为已知偏差，本次收口）。
//
// === 自建实现: 等长掩码（保留换行与字符偏移）===
// 把代码区域内的非换行字符替换为等长空白：总长度、行数、列位均不变，故仍按原始 lines 计算
// 行号的 task/blockRef 提取完全不受影响；tag/highlight 改在掩码后的正文上提取。

/** 把字符串中每个非换行字符替换为空格（等长掩码，保留 \n）。 */
function blankNonNewline(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

/** 掩码单行内的行内代码：成对反引号（开合等长）之间内容置空，保留反引号本身。无闭合则按普通文本。 */
function maskInlineCode(line: string): string {
  let result = "";
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (line.charAt(i) !== "`") {
      result += line.charAt(i);
      i++;
      continue;
    }
    // 数出开标记反引号串长度（CommonMark：开合反引号数量需相等）。
    let open = i;
    while (open < n && line.charAt(open) === "`") open++;
    const fenceLen = open - i;
    // 向后找等长的闭合反引号串。
    let cursor = open;
    let closeStart = -1;
    while (cursor < n) {
      if (line.charAt(cursor) !== "`") {
        cursor++;
        continue;
      }
      let run = cursor;
      while (run < n && line.charAt(run) === "`") run++;
      if (run - cursor === fenceLen) {
        closeStart = cursor;
        break;
      }
      cursor = run;
    }
    if (closeStart === -1) {
      result += line.slice(i, open); // 无闭合：反引号当普通字符，后续不掩码
      i = open;
      continue;
    }
    result += line.slice(i, open); // 开反引号原样保留
    result += blankNonNewline(line.slice(open, closeStart)); // 中间内容置空
    result += line.slice(closeStart, closeStart + fenceLen); // 闭反引号原样保留
    i = closeStart + fenceLen;
  }
  return result;
}

/**
 * 掩码整段正文的代码区域：先逐行识别围栏代码块（整块置空），围栏外的行再处理行内代码。
 * 返回与输入等长、行结构一致的字符串，仅代码区域被空白化。未闭合的围栏掩码至文末（贴近渲染行为）。
 */
function maskCode(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let fenceChar = ""; // 当前围栏标记字符（` 或 ~）；空串表示不在围栏内
  let fenceLen = 0;
  for (const line of lines) {
    if (fenceChar) {
      out.push(blankNonNewline(line));
      // 闭合围栏：整行仅由围栏标记构成，且同字符、长度不小于开围栏。
      const closeMark = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closeMark && closeMark.charAt(0) === fenceChar && closeMark.length >= fenceLen) {
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }
    const openMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (openMark) {
      fenceChar = openMark.charAt(0);
      fenceLen = openMark.length;
      out.push(blankNonNewline(line)); // 开围栏行（含 info string）一并置空
      continue;
    }
    out.push(maskInlineCode(line));
  }
  return out.join("\n");
}

/** 提取行内 tag 节点：保留嵌套全名，排除纯数字，按 value 去重。 */
function extractTags(text: string): ObsidianNode[] {
  const seen = new Set<string>();
  const out: ObsidianNode[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const value = m[1] ?? "";
    // === Obsidian 规范来源: 标签须含至少一个非数字字符，纯数字 #123 不是标签 ===
    if (!/[\p{L}_]/u.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ type: "tag", value });
  }
  return out;
}

/** 提取 highlight 节点。 */
function extractHighlights(text: string): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (const m of text.matchAll(HIGHLIGHT_RE)) {
    out.push({ type: "highlight", content: m[1] ?? "" });
  }
  return out;
}

/** 提取 task 节点：逐行匹配，status 取方括号内单字符，line 为 1-based 正文行号。 */
function extractTasks(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = TASK_RE.exec(line);
    // line = i + 1：1-based 行号，供 indexer 回填 tasks.line_number（见 types.ts 注释）。
    if (m) out.push({ type: "task", status: m[1] ?? " ", text: (m[2] ?? "").trim(), line: i + 1 });
  }
  return out;
}

/** 提取 blockRef 定义节点：逐行匹配行尾 ^id，line 为 1-based 正文行号。 */
function extractBlockRefs(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const m = BLOCKREF_RE.exec(line);
    // line = i + 1：indexer 据此定位块所在正文行，截取去 ^id 后的文本作为 blocks.content。
    if (m?.[1]) out.push({ type: "blockRef", id: m[1], line: i + 1 });
  }
  return out;
}

/**
 * 提取 inline fields（`key:: value`）节点：整行 / 方括号 / 圆括号三形态。
 *
 * 在 maskCode 后的正文上提取（代码区已等长掩码，围栏/行内代码内的 `k:: v` 天然不误吃；
 * 掩码保持行结构，行号仍与原文对齐）。
 *
 * @param masked - 已过 maskCode 的正文（与原文等长、行结构一致）
 * @returns inlineField 节点：同名 key（按小写归一）last-wins，仅保留最后一次出现
 *
 * @behavior
 * Given 同一文件内同名 key 多次出现（含大小写差异）
 * When 提取
 * Then 只保留最后一次出现的 key 原文/值/行号（D3 last-wins 在提取期兑现，
 *      inline_fields 表内每 file × key_norm 至多一行，查询层 LIMIT 1 仅为防御护栏）
 *
 * @behavior
 * Given `key::`（空值）、非白名单 key（含空格/连字符/非 ASCII）
 * When 提取
 * Then 不产出节点（v1 负例口径：空值与 D4 之外的 key 一律不解析，列 backlog）
 */
function extractInlineFields(masked: string): ObsidianNode[] {
  // last-wins（D3）：按 key 小写形式去重，重复出现整体覆盖（key 原文/值/行号皆取最后一次）。
  const byKeyNorm = new Map<string, Extract<ObsidianNode, { type: "inlineField" }>>();
  const put = (key: string, rawValue: string, line: number): void => {
    const value = rawValue.trim();
    if (key === "" || value === "") return; // 空 key/空 value 为负例，不产出节点
    byKeyNorm.set(key.toLowerCase(), { type: "inlineField", key, value, line });
  };
  const lines = masked.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const full = INLINE_FIELD_LINE_RE.exec(line);
    if (full?.[1] !== undefined) {
      // 整行形态独占该行：值取到行尾（可含 [ ] ( ) 字面），不再叠加行内形态扫描。
      put(full[1], full[2] ?? "", i + 1);
      continue;
    }
    for (const m of line.matchAll(INLINE_FIELD_BRACKET_RE)) put(m[1] ?? "", m[2] ?? "", i + 1);
    for (const m of line.matchAll(INLINE_FIELD_PAREN_RE)) put(m[1] ?? "", m[2] ?? "", i + 1);
  }
  return [...byKeyNorm.values()];
}

/**
 * 提取 callout 节点：头行 `> [!type]...` 起始，后续连续 `>` 引用行聚合为 content。
 * type 归一化为小写；折叠标记 `+`/`-` → foldable=true。
 */
function extractCallouts(lines: string[]): ObsidianNode[] {
  const out: ObsidianNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const head = CALLOUT_HEAD_RE.exec(line);
    if (!head) continue;
    const marker = head[2] ?? ""; // 折叠标记 +/-（无则空）
    // 聚合后续连续的 `>` 行作为正文（去掉前缀 `>` 与一个空格）。
    const content: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j];
      if (next === undefined || !next.startsWith(">")) break;
      content.push(next.replace(/^>\s?/, ""));
    }
    out.push({
      type: "callout",
      calloutType: (head[1] ?? "").trim().toLowerCase(),
      title: (head[3] ?? "").trim(),
      foldable: marker === "+" || marker === "-",
      content: content.join("\n"),
    });
    i = j - 1; // 跳过已并入正文的行，避免把正文行当作新 callout。
  }
  return out;
}

/**
 * Vault 解析器：输入文件内容 → 标准化 AST。
 * 纯函数，不触碰文件系统或数据库（边界见 AGENTS.md「代码与规范」）。
 *
 * 编排：parseFrontmatter → extractWikilinks → 行内 tag/callout/task/highlight/blockRef 提取。
 * 说明：tag 节点只含**行内**标签；frontmatter 的 tags 通过 ParsedFile.frontmatter 单独传递，
 * 由 indexer 负责并入 tags 表（in_frontmatter=1），parser 不在 nodes 中重复产出，保持单一职责。
 */
export class VaultParser {
  /**
   * 解析单文件内容为 frontmatter + ObsidianNode[]。
   *
   * @param content - 文件完整内容
   *
   * @behavior
   * Given 文件含合法 frontmatter 且正文含各类 Obsidian 语法
   * When 调用 parse()
   * Then 返回 frontmatter 键值对 + 含 wikilink/tag/callout/task/highlight/blockRef 节点的数组
   *
   * @behavior
   * Given 正文代码块或行内代码内含 #tag 或 ==text==
   * When 调用 parse()
   * Then 代码区域被等长掩码，其内的 # 与 == 不被识别为标签或高亮；行号计算不受影响
   *
   * @behavior
   * Given frontmatter YAML 非法
   * When 调用 parse()
   * Then 降级为空 frontmatter {}，整个文件内容作为正文继续提取，不向上抛出异常
   *
   * @behavior
   * Given 正文含 `key:: value`（整行 / [方括号] / (圆括号) 任一形态）
   * When 调用 parse()
   * Then 产出 inlineField 节点（同名 key last-wins）；代码区内的 `k:: v` 不被提取
   */
  parse(content: string): ParsedFile {
    const { frontmatter, body } = parseFrontmatter(content);
    const lines = body.split(/\r?\n/);
    // 代码区域掩码：tag/highlight 在掩码后的正文上提取，避免围栏代码块/行内代码内的 #、== 被误识。
    // task/blockRef/callout 仍用原始 lines（行号需对应原文；代码块内的任务行较罕见，列为后续）。
    const masked = maskCode(body);

    const nodes: ObsidianNode[] = [
      ...extractWikilinks(body),
      ...extractTags(masked),
      ...extractCallouts(lines),
      ...extractTasks(lines),
      ...extractHighlights(masked),
      ...extractBlockRefs(lines),
      // inline fields 与 tag/highlight 同走掩码后正文（代码区不误吃）；掩码等长故行号仍对齐原文。
      ...extractInlineFields(masked),
    ];

    return { frontmatter, nodes };
  }
}

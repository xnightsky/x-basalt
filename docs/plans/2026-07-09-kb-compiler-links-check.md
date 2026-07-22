---
type: plan
title: KB compiler P1 · links check / links suggest 实现计划
description: 在 P0 parser 定位契约上落地本地链接诊断（wikilink/embed/markdownLink/图片存在性 + basename 建议 + ignore + JSON/人读输出），内存 per-run、不碰 indexer/SQLite
tags:
  - plan
  - kb-compiler
  - links
  - lint
  - x-basalt
timestamp: 2026-07-09T00:00:00Z
---

# KB compiler P1 · links check / links suggest 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **P2 更新（2026-07-22）**：本计划落地的诊断类型 `BasaltIssue` 已在 P2 更名为 `BasaltDiagnostic` 并提升为公共稳定契约（落 `src/diagnostic.ts`），详见 [design §6](../specs/2026-07-09-kb-compiler-lint-links-design.md) 与 P2 计划 [`2026-07-22-kb-compiler-p2-diagnostic-contract.md`](2026-07-22-kb-compiler-p2-diagnostic-contract.md)。下文代码片段保留 P1 落地时的原始命名 `BasaltIssue` 作为历史记录，不逐处回改。

**Goal:** 给 x-basalt 新增 `links check`（扫全 vault 报断链）与 `links suggest <file>`（单文件断链 + 修复建议）两条 CLI 命令，产出带 `line`/`column` 定位的诊断。

**Architecture:** 纯函数式一次性静态检查——遍历 vault 用现有 `VaultParser` 现解析拿带位置链接节点，先构建「白名单目标索引」（Docusaurus 式：文件路径 Set + basename/stem Map），再逐链接 O(1) 比对判定断链与建议。全程内存 per-run，输出即弃；**不新增 SQLite 表、不改 indexer**。新模块 `src/links/` 是继 query/chat 之后 parser 的又一消费者。

**Tech Stack:** TypeScript（ESM，`.js` 导入后缀）、commander、`node:test` + `node:assert/strict`、tsx、oxlint/oxfmt。设计真相源：[`docs/specs/2026-07-09-kb-compiler-lint-links-design.md`](../specs/2026-07-09-kb-compiler-lint-links-design.md)。

## Global Constraints

- ESM：所有相对导入带 `.js` 后缀（如 `./types.js`）；类型导入用 `import type`。
- 路径键统一 POSIX：任何写入索引/输出的路径先过 `toPosix()`；vault 内相对路径用 `resolveVaultLayout().toKey(abs)` 生成，不自行 `relative`。
- 链接大小写不敏感（Obsidian 语义）：白名单 Map/Set 的 key 一律小写；值保留原始大小写相对路径。
- `links/` 模块为纯逻辑，除 `scan.ts`（walk + readFile）外不碰 fs/DB；解析/判定/建议全是吃数据的纯函数，便于单测（本仓库对解析核心做重测试）。
- 测试用 `node:test`：`import { test } from "node:test"` + `import assert from "node:assert/strict"`；单文件跑 `node --import tsx --test tests/links/<name>.test.ts`。
- 每个任务结束跑 `pnpm run typecheck`；触及 `src/cli.ts` 的任务额外跑 `pnpm run build`。收口任务跑 `pnpm run lint` + 全量 `pnpm test`。
- 提交在当前分支（main），不新开分支。

---

## 文件结构

新增模块 `src/links/`，职责单一、可独立测试：

- `src/links/types.ts` — `BasaltIssue`、`LinkIssueReason`、`TargetIndex`、`LinkFinding` 类型 + rule 常量。纯类型，无行为。
- `src/links/scan.ts` — `collectFiles(roots)`（walk vault 收所有文件 + 挑 .md）、`buildTargetIndex(files, roots)`（构建白名单索引）。唯一碰 fs 的文件。
- `src/links/resolve.ts` — `resolveWikilink(node, index, fileAbs, roots)` / `resolveMarkdownLink(node, index, fileAbs, roots)`：吃链接节点 + 白名单 → 返回 `LinkFinding`（reason?/suggestions）。纯函数。
- `src/links/ignore.ts` — `compileIgnore(cfg)` → `IgnoreMatcher`；判断某 issue 是否被 ignore（paths/targets/rules）。纯函数。
- `src/links/check.ts` — `checkVault(opts)` / `checkFile(fileAbs, index, roots, ignore)`：编排（解析→resolve→组装 issues→排序）。碰 fs（读文件内容）。
- `src/links/report.ts` — `renderHuman(issues)` → 字符串；JSON 直接由 CLI 用 `emit`。纯函数。
- `src/links/index.ts` — `runLinksCheck` / `runLinksSuggest` 入口 + re-export。
- `src/config.ts`（改）— `BasaltConfig` 加 `lint?: LintConfig`；`pickConfig` 挑 `lint` 段。
- `src/cli.ts`（改）— 新增 `links` 子命令组：`links check` / `links suggest`。
- `tests/links/*.test.ts` — 分模块测试 + `tests/links/fixtures/` 临时 vault。

---

## Task 1: 类型契约 + 白名单目标索引（scan）

**Files:**
- Create: `src/links/types.ts`
- Create: `src/links/scan.ts`
- Test: `tests/links/scan.test.ts`

**Interfaces:**
- Consumes: `resolveVaultLayout`、`toPosix`、`linkKey`、`pathKey` from `../utils/path.js`；`readFile`/`readdir` from `node:fs/promises`。
- Produces:
  - `types.ts`:
    ```ts
    export type LinkIssueReason =
      | "not_found"
      | "outside_vault"
      | "backslash_path"
      | "ambiguous_target"
      | "external_skipped";

    export interface BasaltIssue {
      file: string; // vault 相对 POSIX 路径
      line: number; // 1-based 完整文件行号
      column: number; // 1-based UTF-16 code unit 列
      rule: string; // 如 "links/no-broken-link"
      severity: "error" | "warning" | "info";
      message: string;
      target?: string;
      reason?: LinkIssueReason;
      suggestions?: string[];
      fixable: boolean; // P1 恒为 false（不落盘修复）
    }

    export interface TargetIndex {
      pathSet: Set<string>; // 所有文件相对 vault 的 POSIX 路径（含扩展名），已小写
      notesByStem: Map<string, string[]>; // .md：linkKey → 原始相对路径列表
      notesByPathKey: Set<string>; // .md：pathKey（去扩展名 POSIX 小写）
      filesByBasename: Map<string, string[]>; // 所有文件：小写含扩展名 basename → 原始相对路径列表
    }

    export interface CollectedFile {
      abs: string; // 绝对路径
      key: string; // vault 相对 POSIX 路径（layout.toKey）
    }

    export interface LinkFinding {
      reason?: LinkIssueReason; // undefined = 链接有效
      suggestions?: string[];
    }
    ```
  - `scan.ts`:
    ```ts
    export function collectFiles(roots: string[], toKey: (abs: string) => string): Promise<{ all: CollectedFile[]; markdown: CollectedFile[] }>;
    export function buildTargetIndex(all: CollectedFile[]): TargetIndex;
    ```

- [ ] **Step 1: 写失败测试 `buildTargetIndex`**

`tests/links/scan.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTargetIndex } from "../../src/links/scan.js";
import type { CollectedFile } from "../../src/links/types.js";

const files: CollectedFile[] = [
  { abs: "/v/Notes/Alpha.md", key: "Notes/Alpha.md" },
  { abs: "/v/Archive/Alpha.md", key: "Archive/Alpha.md" },
  { abs: "/v/assets/img.png", key: "assets/img.png" },
];

test("buildTargetIndex: pathSet 含全部文件（小写 POSIX）", () => {
  const idx = buildTargetIndex(files);
  assert.ok(idx.pathSet.has("notes/alpha.md"));
  assert.ok(idx.pathSet.has("assets/img.png"));
});

test("buildTargetIndex: notesByStem 聚合同名 .md（歧义可查）", () => {
  const idx = buildTargetIndex(files);
  assert.deepEqual(idx.notesByStem.get("alpha")?.toSorted(), ["Archive/Alpha.md", "Notes/Alpha.md"]);
});

test("buildTargetIndex: notesByPathKey 用 pathKey（去扩展名 POSIX 小写）", () => {
  const idx = buildTargetIndex(files);
  assert.ok(idx.notesByPathKey.has("notes/alpha"));
  assert.ok(idx.notesByPathKey.has("archive/alpha"));
});

test("buildTargetIndex: filesByBasename 含资源（含扩展名 basename）", () => {
  const idx = buildTargetIndex(files);
  assert.deepEqual(idx.filesByBasename.get("img.png"), ["assets/img.png"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/scan.test.ts`
Expected: FAIL（`Cannot find module '../../src/links/scan.js'`）

- [ ] **Step 3: 写 `src/links/types.ts`**

粘贴上面 Interfaces/Produces 里 `types.ts` 的完整内容，文件头加模块注释：

```ts
/**
 * links 模块公共类型：诊断结果 BasaltIssue、白名单目标索引 TargetIndex、链接判定 LinkFinding。
 *
 * 上游：src/links/scan（建索引）、resolve（判定）、check（编排）。
 * 下游：src/cli.ts links 命令输出。
 * 契约冻结程度：P1 放内部模块，字段暂不作为公共 API；P2 statik 化为 lint --format json 稳定输出。
 */
```
（其后接上面列出的所有 `export`。）

- [ ] **Step 4: 写 `src/links/scan.ts` 的 `buildTargetIndex`**

```ts
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { linkKey, pathKey, toPosix } from "../utils/path.js";
import type { CollectedFile, TargetIndex } from "./types.js";

// === 自建实现: links 白名单目标索引 + vault 文件枚举（Docusaurus 式集合，内存 per-run，不碰 SQLite）===
//
// 上游：src/links/check.ts 在 checkVault 开头调用；下游：resolve.ts 消费索引判存在性/建议。
// 设计要点：一次遍历同时产出「待解析 .md 列表」与「所有文件白名单」——资源 embed（![[img.png]]）
// 的目标是非 .md 文件，故白名单必须收全部文件，否则图片链接永远误报 not_found。

/** 由已收集文件构建白名单目标索引（key 全小写，Obsidian 链接大小写不敏感；值保留原始大小写）。 */
export function buildTargetIndex(all: CollectedFile[]): TargetIndex {
  const pathSet = new Set<string>();
  const notesByStem = new Map<string, string[]>();
  const notesByPathKey = new Set<string>();
  const filesByBasename = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const f of all) {
    const rel = toPosix(f.key);
    pathSet.add(rel.toLowerCase());
    push(filesByBasename, basename(rel).toLowerCase(), rel);
    if (extname(rel).toLowerCase() === ".md") {
      push(notesByStem, linkKey(rel), rel);
      notesByPathKey.add(pathKey(rel));
    }
  }
  return { pathSet, notesByStem, notesByPathKey, filesByBasename };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --import tsx --test tests/links/scan.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: 追加 `collectFiles` 测试（真实 fs，临时 vault）**

在 `tests/links/scan.test.ts` 追加：

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFiles } from "../../src/links/scan.js";

test("collectFiles: 收全部文件、挑出 .md、跳过隐藏与 .obsidian", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-scan-"));
  try {
    mkdirSync(join(root, "sub"));
    mkdirSync(join(root, ".obsidian"));
    writeFileSync(join(root, "A.md"), "# A");
    writeFileSync(join(root, "sub", "B.md"), "# B");
    writeFileSync(join(root, "sub", "img.png"), "x");
    writeFileSync(join(root, ".obsidian", "app.json"), "{}");
    writeFileSync(join(root, ".hidden.md"), "# hidden");
    const { all, markdown } = await collectFiles([root], (abs) => abs.slice(root.length + 1).replaceAll("\\", "/"));
    assert.deepEqual(markdown.map((f) => f.key).toSorted(), ["A.md", "sub/B.md"]);
    assert.ok(all.some((f) => f.key === "sub/img.png"));
    assert.ok(!all.some((f) => f.key.includes(".obsidian")));
    assert.ok(!all.some((f) => f.key.includes(".hidden")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 7: 实现 `collectFiles`（照 indexer walk 模式，跳过 `.` 开头项）**

在 `src/links/scan.ts` 追加：

```ts
import type { CollectedFile } from "./types.js";

/**
 * 递归收集 roots 下所有文件（跳过任意 `.` 开头目录/文件，含 .obsidian/ 与隐藏项）。
 * 返回 all（全部文件，建白名单用）与 markdown（.md 子集，待解析找链接）。
 * 语义与 indexer 的 walk 一致，但同时保留非 .md 文件（资源 embed 目标需要）。
 */
export async function collectFiles(
  roots: string[],
  toKey: (abs: string) => string,
): Promise<{ all: CollectedFile[]; markdown: CollectedFile[] }> {
  const all: CollectedFile[] = [];
  const markdown: CollectedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const file: CollectedFile = { abs: full, key: toKey(full) };
        all.push(file);
        if (e.name.toLowerCase().endsWith(".md")) markdown.push(file);
      }
    }
  };
  for (const root of roots) await walk(root);
  return { all, markdown };
}
```

- [ ] **Step 8: 跑测试确认全通过**

Run: `node --import tsx --test tests/links/scan.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 9: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/types.ts src/links/scan.ts tests/links/scan.test.ts
git commit -m "feat(links): 白名单目标索引 + vault 文件枚举（P1 scan）"
```

---

## Task 2: wikilink / embed 目标判定（resolve）

**Files:**
- Create: `src/links/resolve.ts`
- Test: `tests/links/resolve-wikilink.test.ts`

**Interfaces:**
- Consumes: `TargetIndex`、`LinkFinding` from `./types.js`；`linkKey`、`pathKey`、`isAssetEmbed`、`toPosix` from `../utils/path.js`；`ObsidianNode` from `../parser/types.js`；`posix`/`relative` from `node:path`。
- Produces:
  ```ts
  type WikilinkNode = Extract<ObsidianNode, { type: "wikilink" }>;
  export function resolveWikilink(node: WikilinkNode, index: TargetIndex, fileRel: string): LinkFinding;
  ```
  判定规则：
  - `target` 含 `/`（qualified）→ 用 `pathKey(target)` 查 `notesByPathKey`（笔记）或 `pathSet`（资源，含扩展名比对）。
  - bare 笔记 → `notesByStem.get(linkKey(target))`：1 命中=有效；≥2=`ambiguous_target`（suggestions=候选相对路径）；0=`not_found`（suggestions 空，因无同名）。
  - 资源（`isAssetEmbed(target)`）→ `filesByBasename.get(basename.toLowerCase())`：同上 1/多/0 规则。
  - `fileRel` 是当前文件相对路径，用于把候选转成相对当前文件的建议（`toRelative`）。

- [ ] **Step 1: 写失败测试**

`tests/links/resolve-wikilink.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTargetIndex } from "../../src/links/scan.js";
import { resolveWikilink } from "../../src/links/resolve.js";
import type { CollectedFile, TargetIndex } from "../../src/links/types.js";
import type { ObsidianNode } from "../../src/parser/types.js";

type WL = Extract<ObsidianNode, { type: "wikilink" }>;
const wl = (target: string, embed = false): WL => ({
  type: "wikilink", target, embed, line: 1, column: 1, raw: embed ? `![[${target}]]` : `[[${target}]]`,
});
const files: CollectedFile[] = [
  { abs: "", key: "Notes/Alpha.md" },
  { abs: "", key: "Archive/Alpha.md" },
  { abs: "", key: "Notes/Beta.md" },
  { abs: "", key: "assets/img.png" },
];
const idx: TargetIndex = buildTargetIndex(files);

test("bare wikilink 唯一命中 → 有效（无 reason）", () => {
  assert.equal(resolveWikilink(wl("Beta"), idx, "Notes/x.md").reason, undefined);
});

test("bare wikilink 多命中 → ambiguous_target + 候选", () => {
  const f = resolveWikilink(wl("Alpha"), idx, "Notes/x.md");
  assert.equal(f.reason, "ambiguous_target");
  assert.equal(f.suggestions?.length, 2);
});

test("bare wikilink 无命中 → not_found", () => {
  assert.equal(resolveWikilink(wl("Ghost"), idx, "Notes/x.md").reason, "not_found");
});

test("qualified wikilink 精确命中 → 有效", () => {
  assert.equal(resolveWikilink(wl("Archive/Alpha"), idx, "Notes/x.md").reason, undefined);
});

test("资源 embed 命中 → 有效；缺失 → not_found", () => {
  assert.equal(resolveWikilink(wl("img.png", true), idx, "Notes/x.md").reason, undefined);
  assert.equal(resolveWikilink(wl("missing.png", true), idx, "Notes/x.md").reason, "not_found");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/resolve-wikilink.test.ts`
Expected: FAIL（`Cannot find module '.../resolve.js'`）

- [ ] **Step 3: 实现 `src/links/resolve.ts`（wikilink 部分 + 共享助手）**

```ts
import { basename, extname } from "node:path";
import { posix } from "node:path";
import { isAssetEmbed, linkKey, pathKey, toPosix } from "../utils/path.js";
import type { ObsidianNode } from "../parser/types.js";
import type { LinkFinding, TargetIndex } from "./types.js";

// === 自建实现: 链接目标判定（纯函数，吃白名单索引，不碰 fs）===
//
// 上游：src/links/check.ts 逐节点调用；下游：产出 LinkFinding（reason?/suggestions）交编排层组装 BasaltIssue。
// 规则真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §5。

type WikilinkNode = Extract<ObsidianNode, { type: "wikilink" }>;

/** 把候选 vault 相对路径转成「相对当前文件目录」的 POSIX 建议路径。 */
function toRelative(fromFileRel: string, candidateRel: string): string {
  const rel = posix.relative(posix.dirname(toPosix(fromFileRel)), toPosix(candidateRel));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** 由候选列表构造建议（相对当前文件）；空列表返回 undefined。 */
function suggestFrom(fromFileRel: string, candidates: string[] | undefined): string[] | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  return candidates.map((c) => toRelative(fromFileRel, c)).toSorted();
}

/** 判定 wikilink / embed 目标（笔记按 stem/pathKey，资源按含扩展名 basename/path）。 */
export function resolveWikilink(node: WikilinkNode, index: TargetIndex, fileRel: string): LinkFinding {
  const target = node.target;
  const qualified = target.includes("/");
  const asset = isAssetEmbed(target);

  if (asset) {
    if (qualified) {
      return index.pathSet.has(toPosix(target).toLowerCase()) ? {} : { reason: "not_found" };
    }
    const hits = index.filesByBasename.get(basename(target).toLowerCase());
    if (!hits) return { reason: "not_found" };
    if (hits.length > 1) return { reason: "ambiguous_target", suggestions: suggestFrom(fileRel, hits) };
    return {};
  }

  // 笔记
  if (qualified) {
    return index.notesByPathKey.has(pathKey(target)) ? {} : { reason: "not_found" };
  }
  const hits = index.notesByStem.get(linkKey(target));
  if (!hits) return { reason: "not_found" };
  if (hits.length > 1) return { reason: "ambiguous_target", suggestions: suggestFrom(fileRel, hits) };
  return {};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/resolve-wikilink.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/resolve.ts tests/links/resolve-wikilink.test.ts
git commit -m "feat(links): wikilink/embed 目标判定（bare/qualified/资源/歧义）"
```

---

## Task 3: markdown link / 图片目标判定（resolve 续）

**Files:**
- Modify: `src/links/resolve.ts`
- Test: `tests/links/resolve-markdown.test.ts`

**Interfaces:**
- Produces（追加到 `resolve.ts`）:
  ```ts
  type MarkdownLinkNode = Extract<ObsidianNode, { type: "markdownLink" }>;
  export function resolveMarkdownLink(node: MarkdownLinkNode, index: TargetIndex, fileRel: string): LinkFinding;
  ```
  判定顺序（命中即返回）：
  1. `target` 为空 → `{}`（parser 已不产出空 target，防御性）。
  2. 匹配 `/^(https?|mailto|tel|ftp):/i` 或以 `#` 开头（anchor-only）→ `external_skipped`。
  3. 含反斜杠 `\` → `backslash_path`（仍继续用替换 `/` 后的路径判存在，建议在 message 提示改 `/`）。
  4. 去掉 `#...` 锚点段（P1 只查文件部分）。
  5. 解析相对当前文件目录得到 vault 相对 POSIX 路径；逃出 vault 根（路径以 `../` 开头且规范化后离开根）→ `outside_vault`。
  6. 命中 `pathSet` → `{}`；无扩展名时补 `.md` 再查一次。
  7. 否则 `not_found`，按 basename 在 `filesByBasename` 找同名候选做 suggestions。

- [ ] **Step 1: 写失败测试**

`tests/links/resolve-markdown.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTargetIndex } from "../../src/links/scan.js";
import { resolveMarkdownLink } from "../../src/links/resolve.js";
import type { CollectedFile, TargetIndex } from "../../src/links/types.js";
import type { ObsidianNode } from "../../src/parser/types.js";

type ML = Extract<ObsidianNode, { type: "markdownLink" }>;
const ml = (target: string, image = false): ML => ({
  type: "markdownLink", text: "t", target, image, line: 1, column: 1, raw: `[t](${target})`,
});
const files: CollectedFile[] = [
  { abs: "", key: "Notes/Alpha.md" },
  { abs: "", key: "Notes/sub/Gamma.md" },
  { abs: "", key: "assets/img.png" },
];
const idx: TargetIndex = buildTargetIndex(files);

test("相对路径命中 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./sub/Gamma.md"), idx, "Notes/x.md").reason, undefined);
});

test("相对路径缺失 → not_found + 同名建议", () => {
  const f = resolveMarkdownLink(ml("./Gamma.md"), idx, "Notes/x.md");
  assert.equal(f.reason, "not_found");
  assert.ok(f.suggestions?.some((s) => s.includes("Gamma.md")));
});

test("逃出 vault 根 → outside_vault", () => {
  assert.equal(resolveMarkdownLink(ml("../../../etc/passwd"), idx, "Notes/x.md").reason, "outside_vault");
});

test("反斜杠路径 → backslash_path", () => {
  assert.equal(resolveMarkdownLink(ml("sub\\Gamma.md"), idx, "Notes/x.md").reason, "backslash_path");
});

test("外部 URL / mailto / anchor-only → external_skipped", () => {
  assert.equal(resolveMarkdownLink(ml("https://x.com")).reason, "external_skipped");
  assert.equal(resolveMarkdownLink(ml("mailto:a@b.c")).reason, "external_skipped");
  assert.equal(resolveMarkdownLink(ml("#section")).reason, "external_skipped");
});

test("省略扩展名补 .md 命中 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./Alpha"), idx, "Notes/x.md").reason, undefined);
});

test("带锚点只查文件部分 → 有效", () => {
  assert.equal(resolveMarkdownLink(ml("./Alpha.md#heading"), idx, "Notes/x.md").reason, undefined);
});
```

注意：末三个用例的 `ml()` 省第二参数即可（默认 image=false）；`external_skipped` 用例不传 index/fileRel，因此把 `resolveMarkdownLink` 的调用签名对齐——见 Step 2 实现里 external 分支在用到 index 前返回。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/resolve-markdown.test.ts`
Expected: FAIL（`resolveMarkdownLink is not a function`）

- [ ] **Step 3: 实现 `resolveMarkdownLink`（追加到 `src/links/resolve.ts`）**

在 `resolve.ts` 追加：

```ts
type MarkdownLinkNode = Extract<ObsidianNode, { type: "markdownLink" }>;

const EXTERNAL_RE = /^(https?|mailto|tel|ftp):/i;

/** 判定 Markdown inline link / 图片的本地目标。外部/锚点跳过；相对路径按当前文件目录解析。 */
export function resolveMarkdownLink(
  node: MarkdownLinkNode,
  index?: TargetIndex,
  fileRel = "",
): LinkFinding {
  const rawTarget = node.target;
  if (rawTarget === "") return {};
  if (EXTERNAL_RE.test(rawTarget) || rawTarget.startsWith("#")) return { reason: "external_skipped" };

  const backslash = rawTarget.includes("\\");
  const normalized = backslash ? rawTarget.replaceAll("\\", "/") : rawTarget;
  // 去锚点段（P1 只查文件目标；#heading / #^block 校验后置 P1.5）。
  const hashAt = normalized.indexOf("#");
  const pathPart = hashAt === -1 ? normalized : normalized.slice(0, hashAt);
  if (pathPart === "") return { reason: "external_skipped" }; // 纯锚点（去反斜杠后）

  // 相对当前文件目录解析为 vault 相对 POSIX 路径。
  const fromDir = posix.dirname(toPosix(fileRel));
  const joined = posix.normalize(posix.join(fromDir, toPosix(decodeURITarget(pathPart))));
  if (joined.startsWith("..")) return { reason: "outside_vault" };

  const idx = index as TargetIndex;
  const lower = joined.toLowerCase();
  const hit = idx.pathSet.has(lower) || (extname(lower) === "" && idx.pathSet.has(`${lower}.md`));
  if (hit) return backslash ? { reason: "backslash_path" } : {};
  if (backslash) return { reason: "backslash_path" };

  const candidates = idx.filesByBasename.get(basename(joined).toLowerCase());
  return { reason: "not_found", suggestions: suggestFrom(fileRel, candidates) };
}

/** 宽容 decodeURIComponent：非法转义序列时原样返回，不抛错。 */
function decodeURITarget(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}
```

说明：`backslash_path` 优先级——只要出现反斜杠即报 `backslash_path`（哪怕替换 `/` 后目标存在），因为 Windows 风格反斜杠链接在 Obsidian/其他平台会断，属于必须修的写法问题。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/resolve-markdown.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/resolve.ts tests/links/resolve-markdown.test.ts
git commit -m "feat(links): markdown link/图片目标判定（相对/outside/backslash/external/补.md）"
```

---

## Task 4: ignore 匹配（config lint.ignore）

**Files:**
- Create: `src/links/ignore.ts`
- Test: `tests/links/ignore.test.ts`

**Interfaces:**
- Consumes: `BasaltIssue` from `./types.js`。
- Produces:
  ```ts
  export interface LintIgnoreConfig {
    paths?: string[]; // 被检查文件（issue.file）glob
    targets?: string[]; // 目标字符串（issue.target）glob
    rules?: Record<string, string[]>; // rule → 该 rule 下额外忽略的 file/target glob
  }
  export interface IgnoreMatcher {
    ignored(issue: BasaltIssue): boolean;
  }
  export function compileIgnore(cfg: LintIgnoreConfig | undefined): IgnoreMatcher;
  export function globToRegExp(glob: string): RegExp; // 导出供测试
  ```
  glob 语义：`**`→`.*`；`*`→`[^/]*`；`?`→`.`；其余字符转义；整体锚定 `^...$`。

- [ ] **Step 1: 写失败测试**

`tests/links/ignore.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { compileIgnore, globToRegExp } from "../../src/links/ignore.js";
import type { BasaltIssue } from "../../src/links/types.js";

const issue = (over: Partial<BasaltIssue>): BasaltIssue => ({
  file: "docs/a.md", line: 1, column: 1, rule: "links/no-broken-link",
  severity: "error", message: "", fixable: false, ...over,
});

test("globToRegExp: ** 跨段、* 单段", () => {
  assert.ok(globToRegExp(".tmp/**").test(".tmp/x/y.png"));
  assert.ok(globToRegExp("http://*").test("http://example.com"));
  assert.ok(!globToRegExp("legacy/*").test("legacy/deep/x.md"));
});

test("paths 命中被检查文件 → 忽略", () => {
  const m = compileIgnore({ paths: ["archive/**"] });
  assert.equal(m.ignored(issue({ file: "archive/old.md" })), true);
  assert.equal(m.ignored(issue({ file: "docs/a.md" })), false);
});

test("targets 命中目标字符串 → 忽略", () => {
  const m = compileIgnore({ targets: ["http://*", "https://*"] });
  assert.equal(m.ignored(issue({ target: "https://x.com" })), true);
});

test("rules.<rule> 仅对该 rule 忽略指定 file/target", () => {
  const m = compileIgnore({ rules: { "links/no-broken-link": ["legacy/**"] } });
  assert.equal(m.ignored(issue({ file: "legacy/x.md" })), true);
  assert.equal(m.ignored(issue({ file: "legacy/x.md", rule: "links/other" })), false);
});

test("空配置 → 从不忽略", () => {
  assert.equal(compileIgnore(undefined).ignored(issue({})), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/ignore.test.ts`
Expected: FAIL（`Cannot find module '.../ignore.js'`）

- [ ] **Step 3: 实现 `src/links/ignore.ts`**

```ts
import type { BasaltIssue } from "./types.js";

// === 自建实现: links ignore 匹配（极简 glob，无外部依赖）===
//
// 上游：src/links/check.ts 用 config.lint.ignore 编译后逐 issue 过滤；
// 语义真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §7。

export interface LintIgnoreConfig {
  paths?: string[];
  targets?: string[];
  rules?: Record<string, string[]>;
}

export interface IgnoreMatcher {
  ignored(issue: BasaltIssue): boolean;
}

/** 极简 glob → RegExp：`**`=跨段任意、`*`=单段任意、`?`=单字符；其余字面转义，整体锚定。 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 编译 ignore 配置为匹配器；paths 比对 issue.file，targets 比对 issue.target，rules 二者皆比。 */
export function compileIgnore(cfg: LintIgnoreConfig | undefined): IgnoreMatcher {
  const paths = (cfg?.paths ?? []).map(globToRegExp);
  const targets = (cfg?.targets ?? []).map(globToRegExp);
  const rules = new Map<string, RegExp[]>(
    Object.entries(cfg?.rules ?? {}).map(([r, pats]) => [r, pats.map(globToRegExp)]),
  );
  return {
    ignored(issue: BasaltIssue): boolean {
      if (paths.some((re) => re.test(issue.file))) return true;
      if (issue.target !== undefined && targets.some((re) => re.test(issue.target as string))) return true;
      const rulePats = rules.get(issue.rule);
      if (rulePats) {
        if (rulePats.some((re) => re.test(issue.file))) return true;
        if (issue.target !== undefined && rulePats.some((re) => re.test(issue.target as string))) return true;
      }
      return false;
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/ignore.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/ignore.ts tests/links/ignore.test.ts
git commit -m "feat(links): ignore 匹配（paths/targets/rules + 极简 glob）"
```

---

## Task 5: checkVault / checkFile 编排

**Files:**
- Create: `src/links/check.ts`
- Test: `tests/links/check.test.ts`

**Interfaces:**
- Consumes: `collectFiles`/`buildTargetIndex`（scan）、`resolveWikilink`/`resolveMarkdownLink`（resolve）、`compileIgnore`/`IgnoreMatcher`/`LintIgnoreConfig`（ignore）、`resolveVaultLayout` from `../utils/path.js`、`VaultParser` from `../parser/index.js`、`readFile` from `node:fs/promises`。
- Produces:
  ```ts
  export interface CheckOptions {
    vault: string | string[];
    ignore?: LintIgnoreConfig;
  }
  export function checkVault(opts: CheckOptions): Promise<BasaltIssue[]>;
  export function checkFile(fileAbs: string, fileRel: string, content: string, index: TargetIndex, ignore: IgnoreMatcher): BasaltIssue[];
  ```
  - `checkFile` 是纯函数（吃已读内容 + 已建索引），逐 wikilink/markdownLink 节点判定，reason 非空则组装 `BasaltIssue`（rule=`links/no-broken-link`，severity=`error`，fixable=false）。
  - `checkVault` 编排：resolveVaultLayout → collectFiles → buildTargetIndex → 逐 .md readFile+parse+checkFile → 汇总 → 按 `file/line/column` 稳定排序。

- [ ] **Step 1: 写失败测试（临时 vault 端到端）**

`tests/links/check.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkVault } from "../../src/links/check.js";

test("checkVault: 报断链、跳过有效链、按 file/line 排序", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-check-"));
  try {
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "Alpha.md"), "# Alpha");
    writeFileSync(
      join(root, "notes", "Index.md"),
      ["[[Alpha]]", "[[Ghost]]", "[有效](./Alpha.md)", "[断](./Missing.md)"].join("\n"),
    );
    const issues = await checkVault({ vault: root });
    assert.equal(issues.length, 2);
    assert.deepEqual(issues.map((i) => i.reason), ["not_found", "not_found"]);
    assert.deepEqual(issues.map((i) => i.line), [2, 4]); // Ghost 在 2 行、Missing 在 4 行
    assert.equal(issues[0]?.file, "notes/Index.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkVault: ignore.paths 过滤整文件", async () => {
  const root = mkdtempSync(join(tmpdir(), "links-check-ig-"));
  try {
    mkdirSync(join(root, "legacy"));
    writeFileSync(join(root, "legacy", "Old.md"), "[[Ghost]]");
    const issues = await checkVault({ vault: root, ignore: { paths: ["legacy/**"] } });
    assert.equal(issues.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/check.test.ts`
Expected: FAIL（`Cannot find module '.../check.js'`）

- [ ] **Step 3: 实现 `src/links/check.ts`**

```ts
import { readFile } from "node:fs/promises";
import { VaultParser } from "../parser/index.js";
import { resolveVaultLayout } from "../utils/path.js";
import { resolveMarkdownLink, resolveWikilink } from "./resolve.js";
import { buildTargetIndex, collectFiles } from "./scan.js";
import { compileIgnore, type IgnoreMatcher, type LintIgnoreConfig } from "./ignore.js";
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
  external_skipped: (t) => `（外部/锚点已跳过）：${t}`, // 不产出 issue，仅防御
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
  return {
    file: fileRel,
    line,
    column,
    rule: RULE,
    severity: "error",
    message: (MESSAGES[finding.reason] ?? ((t: string) => t))(target),
    target,
    reason: finding.reason,
    suggestions: finding.suggestions,
    fixable: false,
  };
}

/** 纯函数：吃已读内容 + 已建索引，产出该文件的断链 issue（未过 ignore）。 */
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
      issue = toIssue(fileRel, node.line, node.column, node.target, resolveMarkdownLink(node, index, fileRel));
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
```

说明：`checkFile` 内用 `node.type` 窄化联合类型，无需单独导入 `ObsidianNode`；若 typecheck 提示缺类型再补 `import type { ObsidianNode }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/check.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/check.ts tests/links/check.test.ts
git commit -m "feat(links): checkVault/checkFile 编排（解析→判定→ignore→排序）"
```

---

## Task 6: 人读渲染 report

**Files:**
- Create: `src/links/report.ts`
- Test: `tests/links/report.test.ts`

**Interfaces:**
- Consumes: `BasaltIssue` from `./types.js`。
- Produces:
  ```ts
  export function renderHuman(issues: BasaltIssue[]): string;
  ```
  格式：无 issue → `✓ 未发现断链`；有则每条一行 `<file>:<line>:<column>  <message>`，有 suggestions 追加 `    → 建议: a, b`；末尾汇总 `共 N 处断链`。

- [ ] **Step 1: 写失败测试**

`tests/links/report.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHuman } from "../../src/links/report.js";
import type { BasaltIssue } from "../../src/links/types.js";

test("renderHuman: 空 → 成功文案", () => {
  assert.match(renderHuman([]), /未发现断链/);
});

test("renderHuman: 含定位、消息、建议、汇总", () => {
  const out = renderHuman([{
    file: "notes/Index.md", line: 2, column: 1, rule: "links/no-broken-link",
    severity: "error", message: "链接目标不存在：[[Ghost]]", target: "[[Ghost]]",
    reason: "not_found", suggestions: ["../Ghost.md"], fixable: false,
  }]);
  assert.match(out, /notes\/Index\.md:2:1/);
  assert.match(out, /链接目标不存在/);
  assert.match(out, /建议.*Ghost\.md/);
  assert.match(out, /共 1 处断链/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/report.test.ts`
Expected: FAIL（`Cannot find module '.../report.js'`）

- [ ] **Step 3: 实现 `src/links/report.ts`**

```ts
import type { BasaltIssue } from "./types.js";

// === 自建实现: links 人读渲染（JSON 输出由 CLI 用 format.emit）===

/** 把 issue 列表渲染为人读文本；空列表给成功文案。 */
export function renderHuman(issues: BasaltIssue[]): string {
  if (issues.length === 0) return "✓ 未发现断链";
  const lines: string[] = [];
  for (const i of issues) {
    lines.push(`${i.file}:${i.line}:${i.column}  ${i.message}`);
    if (i.suggestions && i.suggestions.length > 0) {
      lines.push(`    → 建议: ${i.suggestions.join(", ")}`);
    }
  }
  lines.push(`\n共 ${issues.length} 处断链`);
  return lines.join("\n");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/report.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/links/report.ts tests/links/report.test.ts
git commit -m "feat(links): 人读渲染 report"
```

---

## Task 7: config lint.ignore 段解析

**Files:**
- Modify: `src/config.ts`
- Test: `tests/links/config-lint.test.ts`

**Interfaces:**
- Consumes: `LintIgnoreConfig` from `./links/ignore.js`。
- Produces（改 `config.ts`）:
  ```ts
  export interface LintConfig { ignore?: LintIgnoreConfig }
  // BasaltConfig 增加：lint?: LintConfig
  // pickConfig 增加：if (obj.lint !== undefined) out.lint = parseLintConfig(obj.lint);
  export function parseLintConfig(raw: unknown): LintConfig;
  ```
  `parseLintConfig`：`raw` 非对象 → `{}`；只挑 `ignore.{paths,targets,rules}`，paths/targets 过滤为字符串数组，rules 为 `Record<string,string[]>`（值过滤字符串）。畸形段静默丢弃（与现有 pickConfig 容错一致），不抛错。

- [ ] **Step 1: 写失败测试**

`tests/links/config-lint.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLintConfig } from "../../src/config.js";

test("parseLintConfig: 挑 ignore.paths/targets/rules", () => {
  const cfg = parseLintConfig({
    ignore: {
      paths: ["archive/**", 123],
      targets: ["http://*"],
      rules: { "links/no-broken-link": ["legacy/**", 5], bad: "x" },
    },
  });
  assert.deepEqual(cfg.ignore?.paths, ["archive/**"]);
  assert.deepEqual(cfg.ignore?.targets, ["http://*"]);
  assert.deepEqual(cfg.ignore?.rules?.["links/no-broken-link"], ["legacy/**"]);
  assert.deepEqual(cfg.ignore?.rules?.bad, []); // 非数组 → 空
});

test("parseLintConfig: 非对象 → 空", () => {
  assert.deepEqual(parseLintConfig(null), {});
  assert.deepEqual(parseLintConfig("x"), {});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/config-lint.test.ts`
Expected: FAIL（`parseLintConfig is not a function`）

- [ ] **Step 3: 改 `src/config.ts`**

在 imports 追加：
```ts
import type { LintIgnoreConfig } from "./links/ignore.js";
```

在 `BasaltConfig` 接口内追加字段：
```ts
  /** lint / links 配置（KB compiler P1）：目前仅 ignore 段。 */
  lint?: LintConfig;
```

在 `BasaltConfig` 定义后新增类型与解析函数：
```ts
/** lint 配置（P1 仅 ignore）。 */
export interface LintConfig {
  ignore?: LintIgnoreConfig;
}

/** 解析配置的 lint 段：只挑 ignore.{paths,targets,rules}，畸形项静默丢弃（容错一致）。 */
export function parseLintConfig(raw: unknown): LintConfig {
  if (raw == null || typeof raw !== "object") return {};
  const ig = (raw as { ignore?: unknown }).ignore;
  if (ig == null || typeof ig !== "object") return {};
  const o = ig as Record<string, unknown>;
  const strs = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const rulesRaw = (o.rules ?? {}) as Record<string, unknown>;
  const rules: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rulesRaw)) rules[k] = strs(v);
  return { ignore: { paths: strs(o.paths), targets: strs(o.targets), rules } };
}
```

在 `pickConfig` 函数体内（`if (obj.pipelines !== undefined) ...` 之后）追加：
```ts
  if (obj.lint !== undefined) out.lint = parseLintConfig(obj.lint);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/links/config-lint.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: typecheck + 提交**

```bash
pnpm run typecheck
git add src/config.ts tests/links/config-lint.test.ts
git commit -m "feat(config): lint.ignore 段解析（links check 消费）"
```

---

## Task 8: index 入口 + CLI links check / suggest 接线

**Files:**
- Create: `src/links/index.ts`
- Modify: `src/cli.ts`
- Test: `tests/links/cli.test.ts`

**Interfaces:**
- Consumes: `checkVault`/`checkFile`（check）、`buildTargetIndex`/`collectFiles`（scan）、`compileIgnore`（ignore）、`resolveVaultLayout` from `../utils/path.js`、`readFile` from `node:fs/promises`、`renderHuman`（report）。
- Produces（`src/links/index.ts`）:
  ```ts
  export interface LinksRunOptions { vault: string | string[]; ignore?: LintIgnoreConfig; format?: string }
  export function runLinksCheck(opts: LinksRunOptions): Promise<{ issues: BasaltIssue[]; exitCode: number }>;
  export function runLinksSuggest(fileRel: string, opts: LinksRunOptions): Promise<{ issues: BasaltIssue[]; exitCode: number }>;
  export type { BasaltIssue } from "./types.js";
  ```
  - `runLinksCheck`：调 `checkVault`，返回 issues + exitCode（有 error 级 issue → 1，否则 0）。
  - `runLinksSuggest`：建同一索引，只对单文件 `checkFile`，返回该文件 issues（含 suggestions）。
  - CLI 负责按 `--format` 用 `emit`（json/yaml）或 `renderHuman`（人读默认）打印。

- [ ] **Step 1: 写失败测试（子进程跑真 CLI）**

`tests/links/cli.test.ts`:

```ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const CLI = join(process.cwd(), "src", "cli.ts");
function run(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", CLI, ...args], { encoding: "utf8" });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", code: err.status ?? 1 };
  }
}

test("links check: 断链退出码 1 + JSON 输出", () => {
  const root = mkdtempSync(join(tmpdir(), "links-cli-"));
  try {
    writeFileSync(join(root, "A.md"), "[[Ghost]]");
    const { stdout, code } = run(["links", "check", "--vault", root, "--format", "json"]);
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout) as Array<{ reason: string }>;
    assert.equal(parsed[0]?.reason, "not_found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("links check: 全有效退出码 0", () => {
  const root = mkdtempSync(join(tmpdir(), "links-cli-ok-"));
  try {
    writeFileSync(join(root, "A.md"), "# A");
    writeFileSync(join(root, "B.md"), "[[A]]");
    const { code } = run(["links", "check", "--vault", root]);
    assert.equal(code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/links/cli.test.ts`
Expected: FAIL（commander 报 `unknown command 'links'`，退出码非预期）

- [ ] **Step 3: 实现 `src/links/index.ts`**

```ts
import { readFile } from "node:fs/promises";
import { resolveVaultLayout } from "../utils/path.js";
import { checkFile, checkVault } from "./check.js";
import { compileIgnore } from "./ignore.js";
import type { LintIgnoreConfig } from "./ignore.js";
import { buildTargetIndex, collectFiles } from "./scan.js";
import type { BasaltIssue } from "./types.js";

// === 自建实现: links 模块对外入口（CLI 装配点）===
//
// 上游：src/cli.ts links check / suggest；下游：check/scan/ignore 纯逻辑。

export interface LinksRunOptions {
  vault: string | string[];
  ignore?: LintIgnoreConfig;
  format?: string;
}

export interface LinksRunResult {
  issues: BasaltIssue[];
  exitCode: number;
}

/** 全 vault 断链检查。 */
export async function runLinksCheck(opts: LinksRunOptions): Promise<LinksRunResult> {
  const issues = await checkVault({ vault: opts.vault, ignore: opts.ignore });
  return { issues, exitCode: issues.some((i) => i.severity === "error") ? 1 : 0 };
}

/** 单文件断链 + 建议（建同一 vault 白名单索引，只检查目标文件）。 */
export async function runLinksSuggest(fileRel: string, opts: LinksRunOptions): Promise<LinksRunResult> {
  const layout = resolveVaultLayout(opts.vault);
  const { all } = await collectFiles(layout.roots, layout.toKey);
  const index = buildTargetIndex(all);
  const ignore = compileIgnore(opts.ignore);
  const fileAbs = layout.toAbs(fileRel);
  const content = await readFile(fileAbs, "utf8");
  const key = layout.toKey(fileAbs);
  const issues = checkFile(fileAbs, key, content, index, ignore);
  return { issues, exitCode: issues.some((i) => i.severity === "error") ? 1 : 0 };
}

export type { BasaltIssue } from "./types.js";
```

- [ ] **Step 4: 接线 `src/cli.ts`**

在文件顶部 import 区追加：
```ts
import { runLinksCheck, runLinksSuggest } from "./links/index.js";
import { renderHuman } from "./links/report.js";
```

在 `meta` 子命令组定义（`const meta = program.command("meta")...`）附近、`program.parse()` 之前，追加 links 子命令组：
```ts
const links = program.command("links").description("本地链接诊断（断链检查 + 修复建议；KB compiler P1）");

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
    const { issues, exitCode } = await runLinksCheck({ vault, ignore: config.lint?.ignore });
    if (opts.format === "json" || opts.format === "yaml") emit(issues, opts.format);
    else console.log(renderHuman(issues));
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
    const { issues, exitCode } = await runLinksSuggest(file, { vault, ignore: config.lint?.ignore });
    if (opts.format === "json" || opts.format === "yaml") emit(issues, opts.format);
    else console.log(renderHuman(issues));
    process.exitCode = exitCode;
  });
```

注意：`config` 是 cli.ts 顶部已 `loadConfig(...)` 得到的变量（沿用现有命令读取方式，如 query 命令的 `config.vault`）。确认引用名与现有代码一致（若现有变量名不同，按现有为准）。

- [ ] **Step 5: 跑测试 + build 确认通过**

Run: `node --import tsx --test tests/links/cli.test.ts`
Expected: PASS（2 tests）

Run: `pnpm run build`
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add src/links/index.ts src/cli.ts tests/links/cli.test.ts
git commit -m "feat(links,cli): links check / links suggest 命令接线"
```

---

## Task 9: 文档 + 收口验证

**Files:**
- Modify: `docs/guides/commands.md`
- Modify: `TODO.md`
- Modify: `docs/specs/2026-07-09-kb-compiler-lint-links-design.md`（§11 勾选 P1）

- [ ] **Step 1: 在 `docs/guides/commands.md` 补 `links` 命令条目**

在命令列表/目录相应位置追加（贴合该文件现有条目格式）：

```markdown
### links check / links suggest

本地链接诊断（KB compiler P1）。内存 per-run，不依赖已建索引。

- `x-basalt links check [vault...] [--format human|json|yaml]`：扫全 vault 报断链——
  检查 wikilink `[[..]]`、embed `![[..]]`、Markdown `[](..)`、图片 `![](..)` 的本地目标存在性；
  外部 URL / mailto / 纯锚点跳过；`#heading` / `#^block` 锚点校验后置（P1 只查文件目标）。
  有 error 级断链退出码 1。
- `x-basalt links suggest <file> [vault...]`：只查单文件，断链附 basename 命中的相对路径建议。
- ignore：在 `.x-basalt/config.*` 配 `lint.ignore.{paths,targets,rules}` 屏蔽历史附件/生成目录/外链。
  reasons：not_found / outside_vault / backslash_path / ambiguous_target / external_skipped。
```

- [ ] **Step 2: 更新 `TODO.md`（KB compiler 段勾选 P1、指向本计划）**

把 `📋 2026-07-09 文档质量 / KB compiler` 段的第 2 条改为：
```markdown
2. **P1 `links check` / `links suggest`**：✅ 已落地（`src/links/`，内存 per-run 不碰 SQLite，白名单集合 + basename 建议 + ignore + JSON/人读输出）。见 [`docs/plans/2026-07-09-kb-compiler-links-check.md`](docs/plans/2026-07-09-kb-compiler-links-check.md)。
```
把 backlog 段 KB compiler 那条的「下一步开 P1」改为「下一步 P2 统一 BasaltIssue + lint 壳」；并新增一行 backlog：`links P1 未做项：行内注释禁用（disable-next-line）、mtime 解析缓存、锚点/heading 校验（P1.5）、tmp_path reason（P1 靠 ignore.paths 覆盖）`。

- [ ] **Step 3: 在 spec §11 勾选 P1**

把 `docs/specs/2026-07-09-kb-compiler-lint-links-design.md` §11 第 2 条 `**P1 links check/suggest**：...` 行尾追加：`✅ 已落地（内存 per-run 白名单集合；锚点/tmp_path 后置）。`

- [ ] **Step 4: 全量收口验证**

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
```
Expected: lint 通过（oxlint 无 error）、typecheck 无错、build 成功、全量测试全绿（含新增 `tests/links/*`）。

- [ ] **Step 5: 提交**

```bash
git add docs/guides/commands.md TODO.md docs/specs/2026-07-09-kb-compiler-lint-links-design.md
git commit -m "docs(links): commands 指南 + TODO/spec 勾选 P1"
```

---

## Self-Review 记录

- **Spec 覆盖**（对照 spec §3.2 / §5 / §6 / §7 / §9 / §10.2）：
  - §3.2 检查 wikilink/embed/markdown/图片本地目标 → Task 2/3/5；首版不查 HTTP → Task 3 external_skipped；basename 唯一命中建议、多命中只排序不修 → Task 2/3 suggestions + ambiguous_target；ignore → Task 4/7。✓
  - §5.1 相对路径/省扩展名补 .md/反斜杠/outside → Task 3。✓（§5.1 的 `tmp_path` 降级为 ignore 覆盖，已在 Task 9 backlog 注明——P1 不产出该 reason，属有意收敛。）
  - §5.2 wikilink bare/qualified/资源/ambiguous、锚点后置 → Task 2 + 全局约束。✓
  - §5.3 suggest 排序（同名候选相对路径、可解释）→ Task 2/3 `suggestFrom`（`toSorted` 稳定序；spec 的「同目录/README 优先」精排降级为字典序，P1 收敛，可在 P2 增强）。✓（注：精排未做，列 backlog 候选。）
  - §6 BasaltIssue 字段 → Task 1 类型（reasons 少了 `tmp_path` / `unsupported_reference_link`：前者降级 ignore、后者属 P0 parser 不产出 reference link，P1 无从触发，故不纳入 LinkIssueReason）。✓
  - §7 ignore paths/targets/rules → Task 4/7。✓
  - §9 命令面 `links check` / `links suggest --format json` → Task 8。✓
  - §10.2 测试清单（相对存在/缺失/escape、wikilink 命中/多命中/不存在、embed 存在/不存在、backslash、ignore 三类、JSON 排序）→ Task 2/3/4/5/8 全覆盖。✓
- **Placeholder 扫描**：已复查全部步骤，无 TBD/TODO/"类似 Task N"/裸描述——每个 code step 均含完整可粘贴代码；无引用未定义符号。
- **类型一致性**：`TargetIndex` 字段（pathSet/notesByStem/notesByPathKey/filesByBasename）在 Task 1 定义，Task 2/3/5 消费一致；`LinkFinding`/`BasaltIssue`/`LintIgnoreConfig` 跨任务签名一致；`resolveVaultLayout().toKey/toAbs/roots` 用法与 `src/utils/path.ts` 一致。
- **收敛声明（P1 有意不做，已入 backlog）**：锚点/heading 校验（P1.5）、`tmp_path` reason（靠 ignore）、suggest 精排、行内注释禁用、mtime 解析缓存、reference link。

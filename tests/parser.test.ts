import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseFrontmatter } from "../src/parser/frontmatter.js";
import { VaultParser } from "../src/parser/index.js";
import type { ObsidianNode } from "../src/parser/types.js";
import { extractWikilinks } from "../src/parser/wikilink.js";
import { isAssetEmbed, linkKey } from "../src/utils/path.js";

/** 取出 wikilink 节点，便于断言。 */
function wikilinks(nodes: ObsidianNode[]) {
  return nodes.filter(
    (n): n is Extract<ObsidianNode, { type: "wikilink" }> => n.type === "wikilink",
  );
}

/** 取出 Markdown inline link / image link 节点，便于断言 P0 links 定位契约。 */
function markdownLinks(nodes: ObsidianNode[]) {
  return nodes.filter(
    (n): n is Extract<ObsidianNode, { type: "markdownLink" }> => n.type === "markdownLink",
  );
}

test("VaultParser 可实例化", () => {
  assert.ok(new VaultParser());
});

test("parseFrontmatter：首行 --- 时解析 YAML 并剥离正文", () => {
  const { frontmatter, body } = parseFrontmatter(
    "---\ntitle: 索引\ntags: [moc, home]\nstatus: active\n---\n\n# 正文\n内容",
  );
  assert.equal(frontmatter.title, "索引");
  assert.deepEqual(frontmatter.tags, ["moc", "home"]);
  assert.equal(frontmatter.status, "active");
  // body 不含 frontmatter 分隔块
  assert.ok(!body.includes("title:"));
  assert.ok(body.includes("# 正文"));
});

test("parseFrontmatter：无 frontmatter 时返回空对象与原文", () => {
  const { frontmatter, body } = parseFrontmatter("# 没有 frontmatter\n正文");
  assert.deepEqual(frontmatter, {});
  assert.ok(body.includes("# 没有 frontmatter"));
});

test("parseFrontmatter：--- 不在首行不视为 frontmatter", () => {
  const input = "前置文字\n---\ntitle: x\n---\n正文";
  const { frontmatter, body } = parseFrontmatter(input);
  assert.deepEqual(frontmatter, {});
  assert.equal(body, input);
});

test("extractWikilinks：基础 / 别名 / 路径 / heading / blockId / 组合", () => {
  // 各形态用不同笔记名，避免 basename 去重把它们合并（去重语义另有专测）。
  const links = wikilinks(
    extractWikilinks(
      [
        "[[NoteA]]",
        "[[NoteB|Alias]]",
        "[[Folder/NoteC]]",
        "[[NoteD#Heading]]",
        "[[NoteE#^block-id]]",
        "[[Folder/NoteF#Heading|Alias]]",
      ].join("\n"),
    ),
  );
  assert.deepEqual(
    links.map(({ line: _line, column: _column, raw: _raw, ...link }) => link),
    [
      { type: "wikilink", target: "NoteA", embed: false },
      { type: "wikilink", target: "NoteB", alias: "Alias", embed: false },
      { type: "wikilink", target: "Folder/NoteC", embed: false },
      {
        type: "wikilink",
        target: "NoteD",
        heading: "Heading",
        embed: false,
      },
      {
        type: "wikilink",
        target: "NoteE",
        blockId: "block-id",
        embed: false,
      },
      {
        type: "wikilink",
        target: "Folder/NoteF",
        heading: "Heading",
        alias: "Alias",
        embed: false,
      },
    ],
  );
});

test("extractWikilinks：source span 默认为正文相对位置", () => {
  const links = wikilinks(extractWikilinks("前缀 [[Note]]\n下一行 ![[Asset.png]]"));
  assert.deepEqual(
    links.map((l) => ({
      target: l.target,
      embed: l.embed,
      line: l.line,
      column: l.column,
      raw: l.raw,
    })),
    [
      { target: "Note", embed: false, line: 1, column: 4, raw: "[[Note]]" },
      { target: "Asset.png", embed: true, line: 2, column: 5, raw: "![[Asset.png]]" },
    ],
  );
});

test("extractWikilinks：parser 诊断源不按 basename 去重", () => {
  const links = wikilinks(extractWikilinks("[[Note]] [[Note|别名]] [[Folder/Note]]"));
  assert.deepEqual(
    links.map((l) => ({ target: l.target, alias: l.alias, column: l.column, raw: l.raw })),
    [
      { target: "Note", alias: undefined, column: 1, raw: "[[Note]]" },
      { target: "Note", alias: "别名", column: 10, raw: "[[Note|别名]]" },
      { target: "Folder/Note", alias: undefined, column: 22, raw: "[[Folder/Note]]" },
    ],
  );
});

test("extractWikilinks：同文件相同 target+anchor 重复出现也保留，embed 仍标记", () => {
  const links = wikilinks(
    extractWikilinks("[[Note]] 又一次 [[Note]]\n[[Note#核心]] 和 ![[Note#核心]]"),
  );
  assert.equal(links.length, 4);
  assert.equal(links.filter((l) => l.embed).length, 1);
  assert.deepEqual(
    links.map((l) => l.raw),
    ["[[Note]]", "[[Note]]", "[[Note#核心]]", "![[Note#核心]]"],
  );
});

test("extractWikilinks：heading / blockId / alias 字段解析", () => {
  const links = wikilinks(
    extractWikilinks("[[NoteD#Heading]]\n[[NoteE#^block-id]]\n[[Folder/NoteF#Heading|Alias]]"),
  );
  assert.deepEqual(links[0], {
    type: "wikilink",
    target: "NoteD",
    heading: "Heading",
    embed: false,
    line: 1,
    column: 1,
    raw: "[[NoteD#Heading]]",
  });
  assert.deepEqual(links[1], {
    type: "wikilink",
    target: "NoteE",
    blockId: "block-id",
    embed: false,
    line: 2,
    column: 1,
    raw: "[[NoteE#^block-id]]",
  });
  assert.deepEqual(links[2], {
    type: "wikilink",
    target: "Folder/NoteF",
    heading: "Heading",
    alias: "Alias",
    embed: false,
    line: 3,
    column: 1,
    raw: "[[Folder/NoteF#Heading|Alias]]",
  });
});

test("extractWikilinks：embed 前缀 ! 标记 embed=true（笔记与资源）", () => {
  const links = wikilinks(
    extractWikilinks("![[Notes/Concepts#核心概念]]\n![[assets/diagram.png]]"),
  );
  assert.equal(links[0].embed, true);
  assert.equal(links[0].target, "Notes/Concepts");
  assert.equal(links[0].heading, "核心概念");
  assert.equal(links[1].embed, true);
  assert.equal(links[1].target, "assets/diagram.png");
});

test("VaultParser.parse：wikilink 定位契约使用完整文件行号、UTF-16 列与原始 raw", () => {
  const { nodes } = new VaultParser().parse(
    "---\ntitle: T\n---\n\n前缀 [[Note|别名]]\n![[assets/diagram.png]]",
  );
  assert.deepEqual(wikilinks(nodes), [
    {
      type: "wikilink",
      target: "Note",
      alias: "别名",
      embed: false,
      line: 5,
      column: 4,
      raw: "[[Note|别名]]",
    },
    {
      type: "wikilink",
      target: "assets/diagram.png",
      embed: true,
      line: 6,
      column: 1,
      raw: "![[assets/diagram.png]]",
    },
  ]);
});

test("VaultParser.parse：wikilink 不为诊断去重，代码区域内链接不产出", () => {
  const { nodes } = new VaultParser().parse(
    ["[[Missing]] 再次 [[Missing]]", "```", "[[CodeOnly]]", "```", "行内 `[[InlineCode]]`"].join(
      "\n",
    ),
  );
  assert.deepEqual(
    wikilinks(nodes).map((l) => ({ target: l.target, line: l.line, column: l.column, raw: l.raw })),
    [
      { target: "Missing", line: 1, column: 1, raw: "[[Missing]]" },
      { target: "Missing", line: 1, column: 16, raw: "[[Missing]]" },
    ],
  );
});

/** 按类型筛选 VaultParser.parse 的节点。 */
function nodesOfType<T extends ObsidianNode["type"]>(
  nodes: ObsidianNode[],
  type: T,
): Extract<ObsidianNode, { type: T }>[] {
  return nodes.filter((n): n is Extract<ObsidianNode, { type: T }> => n.type === type);
}

test("VaultParser.parse：透传 frontmatter，正文 wikilink 进入 nodes", () => {
  const { frontmatter, nodes } = new VaultParser().parse("---\ntitle: T\n---\n\n正文 [[Other]]");
  assert.equal(frontmatter.title, "T");
  assert.equal(nodesOfType(nodes, "wikilink").length, 1);
});

test("VaultParser.parse：行内 tag——嵌套保留全名、排除 #123、去重", () => {
  const { nodes } = new VaultParser().parse(
    "#moc #area/knowledge #area/knowledge 编号 #123 尾 #moc",
  );
  const tags = nodesOfType(nodes, "tag").map((t) => t.value);
  assert.deepEqual(tags.toSorted(), ["area/knowledge", "moc"]);
});

test("VaultParser.parse：frontmatter 的 tags 不混入行内 tag 节点", () => {
  const { nodes } = new VaultParser().parse("---\ntags: [fm-only]\n---\n\n正文 #inline");
  const tags = nodesOfType(nodes, "tag").map((t) => t.value);
  assert.deepEqual(tags, ["inline"]);
});

test("VaultParser.parse：callout——type 归一化小写、折叠标记、聚合 content", () => {
  const { nodes } = new VaultParser().parse(
    "> [!WARNING]- 风险（默认折叠）\n> 第一行\n> 第二行\n\n正文",
  );
  const c = nodesOfType(nodes, "callout")[0];
  assert.equal(c.calloutType, "warning");
  assert.equal(c.title, "风险（默认折叠）");
  assert.equal(c.foldable, true);
  assert.equal(c.content, "第一行\n第二行");
});

test("VaultParser.parse：无折叠标记的 callout foldable=false", () => {
  const { nodes } = new VaultParser().parse("> [!note] 提示\n> 内容");
  const c = nodesOfType(nodes, "callout")[0];
  assert.equal(c.foldable, false);
});

test("VaultParser.parse：task——状态取方括号单字符，含自定义状态", () => {
  const { nodes } = new VaultParser().parse(
    "- [ ] 未完成 2026-06-28\n- [x] 完成\n- [-] 放弃\n- [?] 待定",
  );
  const tasks = nodesOfType(nodes, "task");
  assert.deepEqual(
    tasks.map((t) => t.status),
    [" ", "x", "-", "?"],
  );
  assert.equal(tasks[0].text, "未完成 2026-06-28");
});

test("VaultParser.parse：highlight 提取 == 内文本", () => {
  const { nodes } = new VaultParser().parse("==高亮一==，普通，==高亮二==");
  assert.deepEqual(
    nodesOfType(nodes, "highlight").map((h) => h.content),
    ["高亮一", "高亮二"],
  );
});

test("VaultParser.parse：围栏代码块内的 #tag 与 ==高亮== 不被提取", () => {
  const { nodes } = new VaultParser().parse(
    ["#realtag 与 ==realhl==", "```python", "# 注释 #faketag", "s = '==fakehl=='", "```"].join(
      "\n",
    ),
  );
  assert.deepEqual(
    nodesOfType(nodes, "tag").map((t) => t.value),
    ["realtag"],
  );
  assert.deepEqual(
    nodesOfType(nodes, "highlight").map((h) => h.content),
    ["realhl"],
  );
});

test("VaultParser.parse：行内代码内的 #tag 与 ==高亮== 不被提取", () => {
  const { nodes } = new VaultParser().parse(
    "真实 #realtag，代码 `#faketag` 和 `==fakehl==`，真实 ==realhl==",
  );
  assert.deepEqual(
    nodesOfType(nodes, "tag").map((t) => t.value),
    ["realtag"],
  );
  assert.deepEqual(
    nodesOfType(nodes, "highlight").map((h) => h.content),
    ["realhl"],
  );
});

test("VaultParser.parse：Markdown link / image link 产出定位节点", () => {
  const { nodes } = new VaultParser().parse(
    [
      "见 [Alpha](Projects/Alpha.md) 与 ![图](assets/diagram.png)",
      '标题 [Beta](Projects/Beta.md "Beta 标题")',
      "外部 [站点](https://example.com) 邮件 [mail](mailto:a@example.com) 锚点 [top](#top)",
    ].join("\n"),
  );
  assert.deepEqual(markdownLinks(nodes), [
    {
      type: "markdownLink",
      text: "Alpha",
      target: "Projects/Alpha.md",
      image: false,
      line: 1,
      column: 3,
      raw: "[Alpha](Projects/Alpha.md)",
    },
    {
      type: "markdownLink",
      text: "图",
      target: "assets/diagram.png",
      image: true,
      line: 1,
      column: 32,
      raw: "![图](assets/diagram.png)",
    },
    {
      type: "markdownLink",
      text: "Beta",
      target: "Projects/Beta.md",
      title: "Beta 标题",
      image: false,
      line: 2,
      column: 4,
      raw: '[Beta](Projects/Beta.md "Beta 标题")',
    },
    {
      type: "markdownLink",
      text: "站点",
      target: "https://example.com",
      image: false,
      line: 3,
      column: 4,
      raw: "[站点](https://example.com)",
    },
    {
      type: "markdownLink",
      text: "mail",
      target: "mailto:a@example.com",
      image: false,
      line: 3,
      column: 33,
      raw: "[mail](mailto:a@example.com)",
    },
    {
      type: "markdownLink",
      text: "top",
      target: "#top",
      image: false,
      line: 3,
      column: 65,
      raw: "[top](#top)",
    },
  ]);
});

test("VaultParser.parse：代码块 / 行内代码内的 Markdown link 不产出", () => {
  const { nodes } = new VaultParser().parse(
    [
      "[Real](real.md)",
      "```",
      "[Code](code.md)",
      "![CodeImg](code.png)",
      "```",
      "行内 `[Inline](inline.md)` 之后 ![RealImg](real.png)",
    ].join("\n"),
  );
  assert.deepEqual(
    markdownLinks(nodes).map((l) => ({ text: l.text, target: l.target, image: l.image })),
    [
      { text: "Real", target: "real.md", image: false },
      { text: "RealImg", target: "real.png", image: true },
    ],
  );
});

test("VaultParser.parse：blockRef 取行尾 ^id 定义，不误判 [[#^id]] 引用", () => {
  const { nodes } = new VaultParser().parse(
    "可被块引用。 ^decision-1\n引用 [[Note#^decision-1]] 不是定义",
  );
  const blocks = nodesOfType(nodes, "blockRef");
  assert.deepEqual(
    blocks.map((b) => b.id),
    ["decision-1"],
  );
});

// === 2026-07-02 #28 inline fields（key:: value 三形态，spec §6.1）===

test("VaultParser.parse：inline fields 三形态——整行 / [方括号] / (圆括号)", () => {
  const { nodes } = new VaultParser().parse(
    "rating:: 5\n这本书 [author:: 张三] 值得重读\n看完 (published:: 2026-01) 再说",
  );
  assert.deepEqual(nodesOfType(nodes, "inlineField"), [
    { type: "inlineField", key: "rating", value: "5", line: 1 },
    { type: "inlineField", key: "author", value: "张三", line: 2 },
    { type: "inlineField", key: "published", value: "2026-01", line: 3 },
  ]);
});

test("VaultParser.parse：整行形态允许列表项前缀；同一行多个行内形态都提取", () => {
  const { nodes } = new VaultParser().parse(
    "- k1:: v1\n* k2:: v2\n- [[三体]] (rating:: 5) [read:: 2026-01]",
  );
  const byKey = Object.fromEntries(nodesOfType(nodes, "inlineField").map((f) => [f.key, f.value]));
  assert.deepEqual(byKey, { k1: "v1", k2: "v2", read: "2026-01", rating: "5" });
});

test("VaultParser.parse：inline fields 边界——a::b 无空格提取；https://x 与无 :: 行不提取", () => {
  const { nodes } = new VaultParser().parse("a::b\nhttps://example.com\n普通一行没有双冒号");
  assert.deepEqual(nodesOfType(nodes, "inlineField"), [
    { type: "inlineField", key: "a", value: "b", line: 1 },
  ]);
});

test("VaultParser.parse：inline fields 负例——空 value、带连字符/空格/中文 key 不提取（D4 backlog）", () => {
  const { nodes } = new VaultParser().parse(
    "empty::\nbad-key:: v\n中文键:: v\n行内 [reading time:: 5] 不收",
  );
  assert.deepEqual(nodesOfType(nodes, "inlineField"), []);
});

test("VaultParser.parse：同名 key（含大小写差异）last-wins，行号为最后出现行", () => {
  const { nodes } = new VaultParser().parse("k:: first\nK:: second\n其它行");
  assert.deepEqual(nodesOfType(nodes, "inlineField"), [
    { type: "inlineField", key: "K", value: "second", line: 2 },
  ]);
});

test("VaultParser.parse：代码块 / 行内代码内的 key:: value 不提取", () => {
  const { nodes } = new VaultParser().parse(
    ["real:: 1", "```", "fake:: 2", "```", "行内 `code:: 3` 之后 (ok:: 4)"].join("\n"),
  );
  const byKey = Object.fromEntries(nodesOfType(nodes, "inlineField").map((f) => [f.key, f.value]));
  assert.deepEqual(byKey, { real: "1", ok: "4" });
});

test("VaultParser.parse：任务行上的 (due:: ...) 与 task 节点共存", () => {
  const { nodes } = new VaultParser().parse("- [x] 完成评审 (due:: 2026-07-10)");
  assert.equal(nodesOfType(nodes, "task").length, 1);
  assert.deepEqual(nodesOfType(nodes, "inlineField"), [
    { type: "inlineField", key: "due", value: "2026-07-10", line: 1 },
  ]);
});

test("VaultParser.parse：inline fields ReDoS 对抗——超长行线性完成", () => {
  // 三条正则均无嵌套量词（spec §7）：超长值 + 大量未闭合 [ 前缀两类对抗输入都应线性完成。
  const longValue = `k:: ${"a".repeat(200_000)}`;
  const manyOpens = `${"[x".repeat(50_000)} 尾部`;
  const start = Date.now();
  const a = new VaultParser().parse(longValue);
  new VaultParser().parse(manyOpens);
  assert.ok(Date.now() - start < 2000, "超长行应在线性时间内完成");
  assert.equal(nodesOfType(a.nodes, "inlineField")[0]?.value.length, 200_000);
});

test("linkKey：去扩展名 + 小写 basename", () => {
  assert.equal(linkKey("Folder/Note"), "note");
  assert.equal(linkKey("image.PNG"), "image");
});

test("isAssetEmbed：区分资源嵌入与笔记嵌入", () => {
  assert.equal(isAssetEmbed("image.png"), true);
  assert.equal(isAssetEmbed("video.mp4"), true);
  assert.equal(isAssetEmbed("Note"), false);
  assert.equal(isAssetEmbed("Note.md"), false);
});

/** 读取样例 vault 文件并解析。 */
function parseFixture(relPath: string): ReturnType<VaultParser["parse"]> {
  const url = new URL(`./fixtures/sample-vault/${relPath}`, import.meta.url);
  return new VaultParser().parse(readFileSync(url, "utf8"));
}

test("端到端：Index.md 各类节点与 link/embed 去重", () => {
  const { frontmatter, nodes } = parseFixture("Index.md");
  assert.equal(frontmatter.title, "索引");
  assert.deepEqual(frontmatter.tags, ["moc", "home"]);

  const links = nodesOfType(nodes, "wikilink");
  // Alpha / Beta / Concepts#核心概念(link) / Concepts#核心概念(embed) / diagram.png(embed) = 5
  assert.equal(links.length, 5);
  assert.equal(links.filter((l) => l.embed).length, 2);

  // 行内 tag 仅 #moc #area/knowledge；frontmatter 的 moc/home 不进 nodes
  assert.deepEqual(
    nodesOfType(nodes, "tag")
      .map((t) => t.value)
      .toSorted(),
    ["area/knowledge", "moc"],
  );

  const callouts = nodesOfType(nodes, "callout");
  assert.equal(callouts.length, 1);
  assert.equal(callouts[0].calloutType, "note");
  assert.equal(callouts[0].foldable, false);

  assert.equal(nodesOfType(nodes, "highlight").length, 1);
});

test("端到端：Alpha.md 任务状态、折叠 callout、blockRef 定义", () => {
  const { nodes } = parseFixture("Projects/Alpha.md");

  assert.deepEqual(
    nodesOfType(nodes, "task").map((t) => t.status),
    [" ", "x", "-", "?"],
  );

  const callout = nodesOfType(nodes, "callout")[0];
  assert.equal(callout.calloutType, "warning");
  assert.equal(callout.foldable, true);

  assert.deepEqual(
    nodesOfType(nodes, "blockRef").map((b) => b.id),
    ["decision-1"],
  );
});

test("端到端：Beta.md 的 [[Note#^id]] 引用携带 blockId", () => {
  const { nodes } = parseFixture("Projects/Beta.md");
  const ref = nodesOfType(nodes, "wikilink").find((l) => l.blockId === "decision-1");
  assert.ok(ref, "应解析出指向 Alpha#^decision-1 的 wikilink");
  assert.equal(ref.target, "Projects/Alpha");
});

test("端到端：Concepts.md 嵌套标签全名与展开折叠 callout", () => {
  const { nodes } = parseFixture("Notes/Concepts.md");
  assert.ok(
    nodesOfType(nodes, "tag").some((t) => t.value === "area/knowledge/obsidian"),
    "应保留三级嵌套标签全名",
  );
  const callout = nodesOfType(nodes, "callout")[0];
  assert.equal(callout.calloutType, "tip");
  assert.equal(callout.foldable, true);
});

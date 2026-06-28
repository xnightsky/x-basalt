import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeDocument, splitDocument } from "../src/meta/document.js";

// === MW1.1 往返内核：content ⇄ {bom, hasFrontmatter, doc, body, eol} ===
// 计划：docs/plans/2026-06-28-meta-frontmatter-write.md
// 硬要求：body 逐字节保真（绝不经 YAML 解析）；EOL/BOM 保留；只认顶部 ---YAML--- 块。

test("MW1.1 Given frontmatter+body When split Then 切出 doc/body 且 body 逐字节保留、无变换往返一致", () => {
  const content = "---\ntitle: A\ntags:\n  - x\n  - y\n---\n# Heading\n\nbody text\n";
  const p = splitDocument(content);
  assert.equal(p.hasFrontmatter, true);
  assert.equal(p.body, "# Heading\n\nbody text\n");
  assert.equal(p.doc.get("title"), "A");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given 无 frontmatter When split Then hasFrontmatter=false 且整文件为 body", () => {
  const content = "# Just a note\n\nno frontmatter here\n";
  const p = splitDocument(content);
  assert.equal(p.hasFrontmatter, false);
  assert.equal(p.body, content);
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given 空 frontmatter (---\\n---) When split Then doc 空且往返一致", () => {
  const content = "---\n---\nbody\n";
  const p = splitDocument(content);
  assert.equal(p.hasFrontmatter, true);
  assert.equal(p.body, "body\n");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given CRLF 文件 When split→serialize Then EOL 与 body 保留", () => {
  const content = "---\r\ntitle: A\r\n---\r\n# H\r\nbody\r\n";
  const p = splitDocument(content);
  assert.equal(p.eol, "\r\n");
  assert.equal(p.body, "# H\r\nbody\r\n");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given BOM 开头 When split→serialize Then BOM 保留在最前", () => {
  const content = "﻿---\ntitle: A\n---\nbody\n";
  const p = splitDocument(content);
  assert.equal(p.bom, "﻿");
  assert.equal(p.hasFrontmatter, true);
  assert.equal(p.doc.get("title"), "A");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given body 内含 --- When split Then 只识别顶部块，body 内 --- 不被吞", () => {
  const content = "---\ntitle: A\n---\nabove\n\n---\n\nbelow\n";
  const p = splitDocument(content);
  assert.equal(p.body, "above\n\n---\n\nbelow\n");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given 有开头 --- 但无闭合 When split Then 视为无 frontmatter（不毁文件）", () => {
  const content = "---\ntitle: A\nno closing here\n";
  const p = splitDocument(content);
  assert.equal(p.hasFrontmatter, false);
  assert.equal(p.body, content);
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given body 末尾无换行 When split→serialize Then 不增删尾换行", () => {
  const content = "---\ntitle: A\n---\nno trailing newline";
  const p = splitDocument(content);
  assert.equal(p.body, "no trailing newline");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given 闭合 --- 在文件末且无换行（无 body）When split→serialize Then 保真", () => {
  const content = "---\ntitle: A\n---";
  const p = splitDocument(content);
  assert.equal(p.hasFrontmatter, true);
  assert.equal(p.body, "");
  assert.equal(serializeDocument(p), content);
});

test("MW1.1 Given 含注释的 frontmatter When 二次往返 Then 稳定（注释尽力保留）", () => {
  const content = "---\ntitle: A # inline\n# leading\nstatus: active\n---\nbody\n";
  const once = serializeDocument(splitDocument(content));
  const twice = serializeDocument(splitDocument(once));
  assert.equal(twice, once);
});

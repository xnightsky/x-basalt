import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { editMeta, readMeta } from "../src/meta/index.js";
import { setMeta } from "../src/meta/operations.js";

// === MW1.4 对抗与边界（重测试）===
// 计划：docs/plans/2026-06-28-meta-frontmatter-write.md
// 重点：恶意值不能越权造键 / 注入；特殊字符由序列化兜住；别名炸弹不展开/不挂死；坏路径报错。

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-adv-"));
  tmpDirs.push(dir);
  const file = join(dir, "note.md");
  writeFileSync(file, content, "utf8");
  return file;
}

test("MW1.4 Given 含换行+伪键的值 When setMeta Then 序列化为标量、不越权造新键（防注入）", () => {
  const file = tmpFile("---\na: 1\n---\nbody\n");
  editMeta(file, (d) => setMeta(d, "note", "x\ninjected: true"));
  const fm = readMeta(file) as Record<string, unknown>;
  assert.equal(fm.note, "x\ninjected: true");
  assert.equal("injected" in fm, false);
});

test("MW1.4 Given 值含 : # 引号 When setMeta Then 转义且往返一致", () => {
  const file = tmpFile("---\na: 1\n---\nbody\n");
  editMeta(file, (d) => setMeta(d, "v", `a: b # c "q" 'p'`));
  assert.equal(readMeta(file, "v"), `a: b # c "q" 'p'`);
});

test("MW1.4 Given 键含特殊字符 When setMeta Then 转义且可读回", () => {
  const file = tmpFile("---\na: 1\n---\nbody\n");
  editMeta(file, (d) => setMeta(d, "key with: colon", "v"));
  assert.equal(readMeta(file, "key with: colon"), "v");
});

test("MW1.4 Given 值内含 --- When setMeta Then 不破坏正文、值往返一致", () => {
  const file = tmpFile("---\na: 1\n---\nbody\n");
  editMeta(file, (d) => setMeta(d, "sep", "before\n---\nafter"));
  assert.equal(readMeta(file, "sep"), "before\n---\nafter");
  assert.ok(readFileSync(file, "utf8").endsWith("body\n"), "正文应保留");
});

test("MW1.4 Given 不存在的文件 When readMeta/editMeta Then 报错（不静默）", () => {
  const ghost = join(tmpdir(), "x-basalt-no-such-file-zzz.md");
  assert.throws(() => readMeta(ghost));
  assert.throws(() => editMeta(ghost, (d) => setMeta(d, "a", 1)));
});

test("MW1.4 Given YAML 别名炸弹 When editMeta Then 不展开/不挂死（toString 保留别名，秒级完成）", () => {
  // 10^4 展开量级；若写路径误调 toJS 展开会爆内存/挂死。写路径只 toString，应保留别名引用。
  const bomb =
    "---\n" +
    "a: &a [x,x,x,x,x,x,x,x,x,x]\n" +
    "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n" +
    "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n" +
    "d: [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\n" +
    "---\nbody\n";
  const file = tmpFile(bomb);
  const r = editMeta(file, (d) => setMeta(d, "added", 1));
  assert.equal(r.changed, true);
  assert.match(readFileSync(file, "utf8"), /added: 1/);
});

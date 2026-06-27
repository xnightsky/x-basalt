import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config.js";

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "x-basalt-cfg-"));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

test("读取 YAML 项目配置（默认格式）并仅挑出已知字符串键", () => {
  const dir = freshDir();
  // skillPath 给数字、ignored 未知键 —— 都应被丢弃。
  writeFileSync(
    join(dir, ".x-basalt.yaml"),
    "db: ./my.db\nvault: ./vault\nformat: yaml\nskillPath: 123\nignored: true\n",
  );
  const cfg = loadConfig(dir);
  assert.equal(cfg.db, "./my.db");
  assert.equal(cfg.vault, "./vault");
  assert.equal(cfg.format, "yaml");
  assert.equal(cfg.skillPath, undefined, "非字符串值应被丢弃");
  assert.equal((cfg as Record<string, unknown>).ignored, undefined, "未知键应被丢弃");
});

test("默认隐藏目录 .x-basalt/config.yaml 被读取", () => {
  const dir = freshDir();
  mkdirSync(join(dir, ".x-basalt"), { recursive: true });
  writeFileSync(join(dir, ".x-basalt", "config.yaml"), "db: ./hidden.db\n");
  assert.equal(loadConfig(dir).db, "./hidden.db");
});

test("隐藏目录优先于扁平文件", () => {
  const dir = freshDir();
  mkdirSync(join(dir, ".x-basalt"), { recursive: true });
  writeFileSync(join(dir, ".x-basalt", "config.yaml"), "db: ./hidden.db\n");
  writeFileSync(join(dir, ".x-basalt.yaml"), "db: ./flat.db\n");
  assert.equal(loadConfig(dir).db, "./hidden.db");
});

test("仍支持 JSON5 项目配置", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".x-basalt.json5"), `{ db: "./j.db", vault: "./v" }`);
  const cfg = loadConfig(dir);
  assert.equal(cfg.db, "./j.db");
  assert.equal(cfg.vault, "./v");
});

test("同目录多格式：yaml 优先于 json5", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".x-basalt.yaml"), "db: ./yaml.db\n");
  writeFileSync(join(dir, ".x-basalt.json5"), `{ db: "./json5.db" }`);
  assert.equal(loadConfig(dir).db, "./yaml.db");
});

test("向上逐级查找：子目录运行也能命中父目录配置", () => {
  const root = freshDir();
  writeFileSync(join(root, ".x-basalt.yaml"), "db: ./root.db\n");
  const nested = join(root, "a", "b", "c");
  mkdirSync(nested, { recursive: true });
  assert.equal(loadConfig(nested).db, "./root.db");
});

test("C4 修复：以 --- 开头的 YAML 配置不被吞掉（真 yaml.parse，非 frontmatter hack）", () => {
  const dir = freshDir();
  // YAML 文件常以文档分隔符 --- 起头；旧 hack 把 raw 包进 ---\n...\n--- 当 frontmatter，
  // 会被这行 --- 提前闭合而丢光全部键。yaml.parse 直接解析则正常。
  writeFileSync(join(dir, ".x-basalt.yaml"), "---\ndb: ./doc.db\nvault: ./v\n");
  const cfg = loadConfig(dir);
  assert.equal(cfg.db, "./doc.db");
  assert.equal(cfg.vault, "./v");
});

test("C4 修复：含 : 与 # 的引号值正确解析", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".x-basalt.yaml"), 'onChange: "echo {file}: done #now"\n');
  assert.equal(loadConfig(dir).onChange, "echo {file}: done #now");
});

test("畸形配置降级为不抛错（返回对象）", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".x-basalt.json5"), "{ db: ");
  let cfg: ReturnType<typeof loadConfig> | undefined;
  assert.doesNotThrow(() => {
    cfg = loadConfig(dir);
  });
  assert.equal(typeof cfg, "object");
});

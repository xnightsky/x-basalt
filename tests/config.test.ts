import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config.js";

/** 在临时 home 下写 ~/.x-basalt/config.<ext> 风格的全局配置，返回该 home 路径。 */
function writeGlobal(content: string, ext = "yaml"): string {
  const home = mkdtempSync(join(tmpdir(), "x-basalt-home-"));
  tmpDirs.push(home);
  mkdirSync(join(home, ".x-basalt"), { recursive: true });
  writeFileSync(join(home, ".x-basalt", `config.${ext}`), content);
  return home;
}

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

test("M4.3 全局配置链：无项目配置时回退到全局 ~/.x-basalt/config", () => {
  const home = writeGlobal("db: ./global.db\nformat: yaml\n");
  const projDir = freshDir(); // 该项目目录无任何配置
  const cfg = loadConfig(projDir, home);
  assert.equal(cfg.db, "./global.db");
  assert.equal(cfg.format, "yaml");
});

test("M4.3 全局配置链：项目配置覆盖全局、全局独有键保留", () => {
  const home = writeGlobal("db: ./global.db\nformat: yaml\n");
  const projDir = freshDir();
  writeFileSync(join(projDir, ".x-basalt.yaml"), "db: ./project.db\n");
  const cfg = loadConfig(projDir, home);
  assert.equal(cfg.db, "./project.db", "项目应覆盖全局 db");
  assert.equal(cfg.format, "yaml", "全局独有键应保留");
});

test("X_BASALT_DIR 指定基目录：从 $dir/config.* 读项目配置", () => {
  const base = freshDir();
  writeFileSync(join(base, "config.yaml"), "db: ./env.db\nvault: ./envvault\n");
  // cwd 与 globalHome 都给空目录，确认配置来自 env 基目录。
  const cfg = loadConfig(freshDir(), freshDir(), base);
  assert.equal(cfg.db, "./env.db");
  assert.equal(cfg.vault, "./envvault");
});

test("X_BASALT_DIR 优先于 cwd 就近发现的配置", () => {
  const base = freshDir();
  writeFileSync(join(base, "config.yaml"), "db: ./env.db\n");
  const cwd = freshDir();
  writeFileSync(join(cwd, ".x-basalt.yaml"), "db: ./cwd.db\n");
  const cfg = loadConfig(cwd, freshDir(), base);
  assert.equal(cfg.db, "./env.db", "env 基目录配置应替代 cwd 就近发现");
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

// === P3b: profiles 段解析（自定义 config profile；design §8.2）===

test("profiles 段：解析 extends/required/enums/include", () => {
  const dir = freshDir();
  writeFileSync(
    join(dir, ".x-basalt.yaml"),
    [
      "profiles:",
      "  my-wiki:",
      "    extends: llm-wiki",
      "    required:",
      "      - author",
      "    enums:",
      "      type: [note, person]",
      "      status: [draft, active]",
      '    include: "docs/**/*.md"',
      "  team-note:",
      "    required: [owner, area]",
      "    enums:",
      "      area: [infra, product]",
      "",
    ].join("\n"),
  );
  const cfg = loadConfig(dir);
  assert.equal(cfg.profiles?.["my-wiki"]?.extends, "llm-wiki");
  assert.deepEqual(cfg.profiles?.["my-wiki"]?.required, ["author"]);
  assert.deepEqual(cfg.profiles?.["my-wiki"]?.enums, {
    type: ["note", "person"],
    status: ["draft", "active"],
  });
  assert.equal(cfg.profiles?.["my-wiki"]?.include, "docs/**/*.md");
  assert.deepEqual(cfg.profiles?.["team-note"]?.required, ["owner", "area"]);
  assert.deepEqual(cfg.profiles?.["team-note"]?.enums, { area: ["infra", "product"] });
});

test("profiles 段：畸形字段静默丢弃（extends/include 非串→undefined，required/enum 非数组→空）", () => {
  const dir = freshDir();
  writeFileSync(
    join(dir, ".x-basalt.json5"),
    `{ profiles: { bad: { extends: 123, required: "nope", enums: { type: "x" }, include: 5 } } }`,
  );
  const cfg = loadConfig(dir);
  const bad = cfg.profiles?.bad;
  assert.equal(bad?.extends, undefined);
  assert.deepEqual(bad?.required, []);
  assert.deepEqual(bad?.enums, { type: [] });
  assert.equal(bad?.include, undefined);
});

test("profiles 段：profile 值非对象 → 视为空定义（不抛）", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".x-basalt.json5"), `{ profiles: { weird: 42 } }`);
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.profiles?.weird, { required: [], enums: {} });
});

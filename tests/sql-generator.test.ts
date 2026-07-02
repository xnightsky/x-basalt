import assert from "node:assert/strict";
import { test } from "node:test";
import { DqlSyntaxError } from "../src/query/errors.js";
import { parseDql } from "../src/query/parser.js";
import { generateListSql, generateSql } from "../src/query/sql-generator.js";

// === 自建实现: sql-generator 纯函数单测（DQL AST → 参数化 SQL）===
// 直接断言生成的 SQL 片段与绑定参数，精准覆盖编译层 bug（不依赖 fixture 数据）。
// 不变量：所有用户输入走占位符；LIKE 通配符转义防误匹配。对应 dql-kernel-steps Part C。

test("S2.9 LIKE 通配符转义：contains 含 % 字面匹配 + ESCAPE", () => {
  const c = generateSql(parseDql('LIST WHERE contains(title, "50%")'));
  // % 必须转义为字面并带 ESCAPE 子句，否则 LIKE 把 % 当任意匹配。
  assert.match(c.sql, /LIKE \? ESCAPE '\\'/);
  assert.ok(
    c.params.includes("%50\\%%"),
    `params 应含转义后的 %50\\%%，实际: ${JSON.stringify(c.params)}`,
  );
});

test("S2.9 startswith/endswith 转义下划线", () => {
  const s = generateSql(parseDql('LIST WHERE startswith(title, "a_b")'));
  assert.match(s.sql, /LIKE \? ESCAPE '\\'/);
  assert.ok(s.params.includes("a\\_b%"));
  const e = generateSql(parseDql('LIST WHERE endswith(title, "a_b")'));
  assert.ok(e.params.includes("%a\\_b"));
});

test("S2.9 icontains 转义 + 大小写不敏感（标量字段）", () => {
  const c = generateSql(parseDql('LIST WHERE icontains(title, "X%")'));
  assert.match(c.sql, /LOWER\(.*\) LIKE LOWER\(\?\) ESCAPE '\\'/);
  assert.ok(c.params.includes("%X\\%%"));
});

test("S2.9 反斜杠本身也被转义", () => {
  const c = generateSql(parseDql('LIST WHERE contains(title, "a\\\\b")'));
  // 输入字面值 a\b → 转义为 a\\b（ESCAPE 字符 \ 自身需转义）。
  assert.ok(
    c.params.some((p) => String(p).includes("a\\\\b")),
    JSON.stringify(c.params),
  );
});

test("全部用户输入走参数占位符（无字面拼接）", () => {
  const c = generateSql(parseDql("LIST WHERE status = 'a' AND file.size > 5 LIMIT 3"));
  // status 值、size 值、limit 全部应为绑定参数。
  assert.deepEqual(c.params, ["a", 5, 3]);
  assert.doesNotMatch(c.sql, /'a'/);
});

test("S2.10 icontains 对 file.tags 大小写不敏感", () => {
  const c = generateSql(parseDql('LIST WHERE icontains(file.tags, "Work")'));
  assert.match(c.sql, /LOWER\(t\.tag\)/);
});

test("S2.10 contains 对 file.tags 保持精确前缀语义（不 LOWER）", () => {
  const c = generateSql(parseDql('LIST WHERE contains(file.tags, "work")'));
  assert.doesNotMatch(c.sql, /LOWER\(t\.tag\)/);
});

test("S2.11 TABLE 显式 file.name 不产生重复列", () => {
  const c = generateSql(parseDql("TABLE file.name, status"));
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["file.name", "status"],
  );
});

test("S2.11 TABLE 字段列表内部去重", () => {
  const c = generateSql(parseDql("TABLE status, status, due"));
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["file.name", "status", "due"],
  );
});

test("S2.12 未知字段抛 DqlSyntaxError（非裸 Error）", () => {
  assert.throws(() => generateSql(parseDql("TABLE file.day")), DqlSyntaxError);
  assert.throws(() => generateSql(parseDql("LIST WHERE file.unknown = 1")), DqlSyntaxError);
});

test("S2.13 对聚合 JSON 列排序报错（不能 ORDER BY 数组）", () => {
  assert.throws(() => generateSql(parseDql("LIST SORT file.tags")), DqlSyntaxError);
  assert.throws(() => generateSql(parseDql("LIST SORT file.inlinks DESC")), DqlSyntaxError);
});

test("S2.13 标量列排序正常", () => {
  const c = generateSql(parseDql("LIST SORT file.mtime DESC"));
  assert.match(c.sql, /ORDER BY f\.mtime DESC/);
});

test("S2.14 多键 SORT 生成多列 ORDER BY（按 AST 顺序 + 默认 ASC）", () => {
  const c = generateSql(parseDql("LIST SORT file.folder ASC, file.name DESC, file.size"));
  assert.match(c.sql, /ORDER BY f\.folder ASC, f\.name DESC, f\.size ASC/);
});

test("S2.15 WHERE null → IS NULL / IS NOT NULL（不参数化 null）", () => {
  const a = generateSql(parseDql("LIST WHERE due = null"));
  assert.match(a.sql, /IS NULL/);
  assert.deepEqual(a.params, []);
  const b = generateSql(parseDql("LIST WHERE due != null"));
  assert.match(b.sql, /IS NOT NULL/);
});

test("S2.15 null 仅支持 = / !=（其他比较符报错）", () => {
  assert.throws(() => parseDql("LIST WHERE due < null"), DqlSyntaxError);
  assert.throws(() => parseDql("LIST WHERE due >= null"), DqlSyntaxError);
});

test("S2.15 null 与普通比较混用（AND）", () => {
  const c = generateSql(parseDql("LIST WHERE due = null AND status = 'active'"));
  assert.match(c.sql, /IS NULL.*AND.*= \?/s);
  assert.deepEqual(c.params, ["active"]);
});

test("S2.16 日期比较：frontmatter 日期按 ISO 字典序参数化（区间）", () => {
  const c = generateSql(parseDql('LIST WHERE due >= "2026-01-01" AND due < "2027-01-01"'));
  // #28 后 frontmatter 标量为 COALESCE(fm, inline) 合并形态（spec §6.3）。
  assert.match(
    c.sql,
    /COALESCE\(json_extract\(f\.frontmatter, '\$\.due'\), \(SELECT value FROM inline_fields WHERE file_path = f\.path AND key_norm = 'due' LIMIT 1\)\) >= \?/,
  );
  // ISO 字符串字典序 = 日期序（SQLite 文本比较），无需特殊日期类型。
  assert.deepEqual(c.params, ["2026-01-01", "2027-01-01"]);
});

test("S2.16 日期比较：file.mtime/ctime 数值列直接比较", () => {
  const c = generateSql(parseDql("LIST WHERE file.mtime >= 1700000000"));
  assert.match(c.sql, /f\.mtime >= \?/);
  assert.deepEqual(c.params, [1700000000]);
});

test("S2.20 TABLE WITHOUT ID 隐藏默认 file.name 列", () => {
  const c = generateSql(parseDql("TABLE WITHOUT ID status, due"));
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["status", "due"],
  );
});

test("S2.20 不带 WITHOUT ID 仍起头 file.name", () => {
  const c = generateSql(parseDql("TABLE status"));
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["file.name", "status"],
  );
});

test("S2.20 LIST WITHOUT ID 去 file.name 保留 file.path 标识", () => {
  const c = generateSql(parseDql("LIST WITHOUT ID"));
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["file.path"],
  );
});

test("S2.18 GROUP BY：分组键 + rows 聚合列 + GROUP BY 子句", () => {
  const c = generateSql(parseDql("LIST GROUP BY status"));
  // #28 后分组键同样是 COALESCE(fm, inline) 合并形态。
  assert.match(c.sql, /GROUP BY COALESCE\(json_extract\(f\.frontmatter, '\$\.status'\)/);
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["status", "rows"],
  );
  assert.equal(c.columns.find((x) => x.name === "rows")?.json, true);
});

test("S2.18 GROUP BY TABLE：length(rows) / count() 聚合列", () => {
  const c = generateSql(parseDql('TABLE type, length(rows) FROM "" GROUP BY type'));
  assert.match(c.sql, /COUNT\(DISTINCT f\.path\)/);
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["type", "length(rows)"],
  );
  const c2 = generateSql(parseDql('TABLE type, count() FROM "" GROUP BY type'));
  assert.match(c2.sql, /COUNT\(DISTINCT f\.path\)/);
  assert.deepEqual(
    c2.columns.map((x) => x.name),
    ["type", "count()"],
  );
});

test("S2.19 FLATTEN：json_each 展开 + 展开值列", () => {
  const c = generateSql(parseDql("LIST FLATTEN file.tags"));
  assert.match(c.sql, /, json_each\(.*\) AS _flat/);
  assert.match(c.sql, /_flat\.value AS "file\.tags"/);
});

test("S2.19 FLATTEN TABLE tag 列绑定展开值", () => {
  const c = generateSql(parseDql("TABLE file.name, tag FROM #guide FLATTEN file.tags LIMIT 5"));
  assert.match(c.sql, /_flat\.value AS "tag"/);
  assert.doesNotMatch(c.sql, /_flat\.value AS "file\.tags"/);
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["file.name", "tag"],
  );
});

test('FROM "" 表示全库（不加 folder 约束）', () => {
  const c = generateSql(parseDql('LIST FROM ""'));
  assert.doesNotMatch(c.sql, /f\.folder/);
});

test("S2.19 FLATTEN 非数组字段报错", () => {
  assert.throws(() => generateSql(parseDql("LIST FLATTEN file.name")), DqlSyntaxError);
});

test("S2.21 TASK：tasks JOIN files 返回任务行列", () => {
  const c = generateSql(parseDql("TASK"));
  assert.match(c.sql, /FROM tasks k JOIN files f ON k\.file_path = f\.path/);
  assert.deepEqual(
    c.columns.map((x) => x.name),
    ["task.text", "task.status", "task.due", "file.path"],
  );
});

test("S2.21 TASK FROM/WHERE 复用文件级过滤 + LIMIT", () => {
  const c = generateSql(parseDql('TASK FROM "Projects" LIMIT 5'));
  assert.match(c.sql, /f\.folder = \? OR f\.folder LIKE \?/);
  assert.match(c.sql, /LIMIT \?/);
  assert.deepEqual(c.params, ["Projects", "Projects/%", 5]);
});

test("S2.17 lower/upper 包裹比较左操作数", () => {
  const c = generateSql(parseDql('LIST WHERE lower(file.name) = "alpha"'));
  assert.match(c.sql, /LOWER\(f\.name\) = \?/);
  assert.deepEqual(c.params, ["alpha"]);
  assert.match(generateSql(parseDql('LIST WHERE upper(status) = "A"')).sql, /UPPER\(/);
});

test("S2.17 length：数组字段用 json_array_length、标量用 LENGTH", () => {
  assert.match(
    generateSql(parseDql("LIST WHERE length(file.tasks) > 0")).sql,
    /json_array_length\(.*\) > \?/s,
  );
  assert.match(
    generateSql(parseDql("LIST WHERE length(file.name) > 3")).sql,
    /LENGTH\(f\.name\) > \?/,
  );
});

test("S2.17 round", () => {
  assert.match(
    generateSql(parseDql("LIST WHERE round(file.size) >= 100")).sql,
    /ROUND\(f\.size\) >= \?/,
  );
});

test("S2.17 date(today)/date(now) 求值为 ISO 串作右值（参数化）", () => {
  const t = generateSql(parseDql("LIST WHERE due < date(today)"));
  assert.match(String(t.params[0]), /^\d{4}-\d{2}-\d{2}$/);
  const n = generateSql(parseDql("LIST WHERE due >= date(now)"));
  assert.match(String(n.params[0]), /^\d{4}-\d{2}-\d{2}T/);
});

// === 2026-07-01 S2.15b：truthy → isTruthy SQL，与 = null 语义分离 ===

test("裸字段真值：frontmatter 标量 → json_type CASE（复刻 isTruthy），无参数", () => {
  const c = generateSql(parseDql("LIST WHERE status"));
  assert.match(c.sql, /json_type\(f\.frontmatter, '\$\.status'\)/);
  assert.match(c.sql, /CASE/);
  assert.match(c.sql, /'array'/); // 覆盖数组分支
  assert.match(c.sql, /'object'/); // 覆盖对象分支
  assert.deepEqual(c.params, []);
});

test("!field → (NOT (CASE ...))", () => {
  assert.match(generateSql(parseDql("LIST WHERE !status")).sql, /\(NOT \(CASE/);
});

test("语义分离：field != null 走 IS NOT NULL、不是真值 CASE（0/空串视为有值）", () => {
  const t = generateSql(parseDql("LIST WHERE status"));
  const n = generateSql(parseDql("LIST WHERE status != null"));
  assert.match(n.sql, /IS NOT NULL/);
  assert.ok(!/CASE/.test(n.sql), "!= null 不应用真值 CASE");
  assert.ok(/CASE/.test(t.sql), "裸字段真值应用 isTruthy CASE");
});

test("裸字段真值：聚合数组字段 → json_array_length > 0", () => {
  assert.match(generateSql(parseDql("LIST WHERE file.tags")).sql, /json_array_length\(.*\) > 0/);
});

test("裸字段真值：file.* 标量列 → 非空且非空串", () => {
  assert.match(
    generateSql(parseDql("LIST WHERE file.name")).sql,
    /f\.name IS NOT NULL AND f\.name <> ''/,
  );
});

// === 2026-07-02：file.frontmatter 存在性——「有/无任意 frontmatter 键」===
// 对治场景库 messy/no-index-count 坐实的缺口：DQL 曾无法表达"完全没有 frontmatter"、
// `WHERE file.frontmatter = null` 曾直接报"不支持的查询字段"（见 sql-generator.ts FM_KEY_COUNT 注释）。

test("file.frontmatter 真值：WHERE file.frontmatter → json_each 顶层键计数 > 0（不是通用列真值）", () => {
  const c = generateSql(parseDql("LIST WHERE file.frontmatter"));
  assert.match(c.sql, /SELECT COUNT\(\*\) FROM json_each\(f\.frontmatter\)\) > 0/);
  assert.deepEqual(c.params, []);
  // 不应误走「非空字符串」判真——'{}' 作为字符串非空，若走 FILE_COLUMNS 通用真值会被误判为真。
  assert.ok(!/f\.frontmatter IS NOT NULL AND f\.frontmatter/.test(c.sql));
});

test("!file.frontmatter → (NOT (... > 0))，即顶层键计数 = 0", () => {
  const c = generateSql(parseDql("LIST WHERE !file.frontmatter"));
  assert.match(c.sql, /\(NOT \(\(SELECT COUNT\(\*\) FROM json_each\(f\.frontmatter\)\) > 0\)\)/);
});

test("file.frontmatter = null / != null → 顶层键计数 = 0 / > 0（与 !/裸字段真值同义）", () => {
  const eq = generateSql(parseDql("LIST WHERE file.frontmatter = null"));
  assert.match(eq.sql, /SELECT COUNT\(\*\) FROM json_each\(f\.frontmatter\)\) = 0/);
  assert.deepEqual(eq.params, []);
  const neq = generateSql(parseDql("LIST WHERE file.frontmatter != null"));
  assert.match(neq.sql, /SELECT COUNT\(\*\) FROM json_each\(f\.frontmatter\)\) > 0/);
  // frontmatter 列本身 schema 上 NOT NULL：不应走通用 IS NULL（该列永不为 SQL NULL）。
  assert.ok(!/f\.frontmatter IS( NOT)? NULL/.test(eq.sql));
});

test("选列 TABLE file.frontmatter：整块列直接投影，标 json 走 JSON.parse 出参", () => {
  const c = generateSql(parseDql("TABLE file.frontmatter"));
  assert.match(c.sql, /f\.frontmatter AS "file\.frontmatter"/);
  const col = c.columns.find((x) => x.name === "file.frontmatter");
  assert.equal(col?.json, true);
});

// === 2026-07-02 #28 inline fields（spec §6.3）：frontmatter ∪ inline 同一字段命名空间 ===

test("#28 frontmatter 标量 → COALESCE(fm, inline 子查询)：key 原样进 json path、小写进 key_norm，值仍参数化", () => {
  const c = generateSql(parseDql('LIST WHERE Rating > "4"'));
  assert.match(
    c.sql,
    /COALESCE\(json_extract\(f\.frontmatter, '\$\.Rating'\), \(SELECT value FROM inline_fields WHERE file_path = f\.path AND key_norm = 'rating' LIMIT 1\)\) > \?/,
  );
  assert.deepEqual(c.params, ["4"]);
});

test("#28 裸字段真值：fm 缺键 / 显式 null 分支兜底 inline（LENGTH>0），其余分支仍按 fm 类型", () => {
  const c = generateSql(parseDql("LIST WHERE status"));
  assert.match(
    c.sql,
    /WHEN json_type\(f\.frontmatter, '\$\.status'\) IS NULL THEN \(COALESCE\(LENGTH\(\(SELECT value FROM inline_fields WHERE file_path = f\.path AND key_norm = 'status' LIMIT 1\)\), 0\) > 0\)/,
  );
  assert.match(c.sql, /'array'/); // fm 侧类型分支保留（对象/数组等仍按 json_type 判真值）
  assert.deepEqual(c.params, []);
});

test("#28 = null / != null 存在性对 COALESCE 结果判（只有 inline 也算「有」）", () => {
  const a = generateSql(parseDql("LIST WHERE due = null"));
  assert.match(
    a.sql,
    /\(COALESCE\(json_extract\(f\.frontmatter, '\$\.due'\), \(SELECT value FROM inline_fields[^)]*\)\) IS NULL\)/,
  );
  assert.deepEqual(a.params, []);
});

// === generateListSql（list 工具的纯 SQL 编译层，与 generateSql 同一防注入不变量：全参数化）===

test("generateListSql：无过滤条件时不加 WHERE，按 path 排序，无参数", () => {
  const c = generateListSql({});
  assert.doesNotMatch(c.sql, /WHERE/);
  assert.match(c.sql, /ORDER BY f\.path$/);
  assert.deepEqual(c.params, []);
});

test("generateListSql：folder 前缀匹配（含子目录），参数化", () => {
  const c = generateListSql({ folder: "Projects" });
  assert.match(c.sql, /WHERE \(f\.folder = \? OR f\.folder LIKE \?\)/);
  assert.deepEqual(c.params, ["Projects", "Projects/%"]);
});

test("generateListSql：tag 用 EXISTS 子查询 + 前缀语义（同 FROM #tag）", () => {
  const c = generateListSql({ tag: "area" });
  assert.match(c.sql, /EXISTS \(SELECT 1 FROM tags t WHERE t\.file_path = f\.path/);
  assert.deepEqual(c.params, ["area", "area/%"]);
});

test("generateListSql：name 子串不区分大小写 + LIKE 通配符转义", () => {
  const c = generateListSql({ name: "50%" });
  assert.match(c.sql, /LOWER\(f\.name\) LIKE LOWER\(\?\) ESCAPE '\\'/);
  assert.deepEqual(c.params, ["%50\\%%"]);
});

test("generateListSql：folder+tag+name 组合按 AND 拼接，全部参数化", () => {
  const c = generateListSql({ folder: "Projects", tag: "project", name: "Alpha" });
  assert.match(c.sql, /WHERE .*AND.*AND/s);
  assert.deepEqual(c.params, ["Projects", "Projects/%", "project", "project/%", "%Alpha%"]);
});

test("generateListSql：空字符串过滤值等同未提供（不加对应条件）", () => {
  const c = generateListSql({ folder: "", tag: "", name: "" });
  assert.doesNotMatch(c.sql, /WHERE/);
  assert.deepEqual(c.params, []);
});

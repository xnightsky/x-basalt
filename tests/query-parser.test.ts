import assert from "node:assert/strict";
import { test } from "node:test";
import { DqlSyntaxError } from "../src/query/index.js";
import { parseDql } from "../src/query/parser.js";
import { generateSql } from "../src/query/sql-generator.js";
import { tokenizeDql } from "../src/query/tokens.js";

// === 自建实现: DQL 词法层（chevrotain lexer）单测 ===
// 覆盖：每类记号、关键字大小写不敏感、关键字前缀标识符回退、多词关键字、unicode 标签、
//       字符串/数字边界、操作符、错误定位。对应 dql-kernel-steps S2.3「全 token 覆盖」+ 重测试要求。

/** 取 token 类型名序列（不含被跳过的空白）。 */
function kinds(s: string): string[] {
  return tokenizeDql(s).tokens.map((t) => t.tokenType.name);
}
/** 取 token 原文序列。 */
function images(s: string): string[] {
  return tokenizeDql(s).tokens.map((t) => t.image);
}

test("关键字大小写不敏感：LIST/list/LiSt 均为 List", () => {
  assert.deepEqual(kinds("LIST list LiSt"), ["List", "List", "List"]);
});

test("查询头关键字 LIST/TABLE/TASK 各自识别", () => {
  assert.deepEqual(kinds("LIST"), ["List"]);
  assert.deepEqual(kinds("TABLE"), ["Table"]);
  assert.deepEqual(kinds("TASK"), ["Task"]);
});

test("子句关键字 FROM/WHERE/SORT/LIMIT/ASC/DESC/AND/OR/NOT/NULL", () => {
  assert.deepEqual(kinds("FROM WHERE SORT LIMIT ASC DESC AND OR NOT NULL"), [
    "From",
    "Where",
    "Sort",
    "Limit",
    "Asc",
    "Desc",
    "And",
    "Or",
    "Not",
    "Null",
  ]);
});

test("多词关键字 GROUP BY 拆为 Group + By", () => {
  assert.deepEqual(kinds("GROUP BY"), ["Group", "By"]);
});

test("多词关键字 WITHOUT ID 拆为 Without + Id", () => {
  assert.deepEqual(kinds("WITHOUT ID"), ["Without", "Id"]);
});

test("FLATTEN 关键字识别", () => {
  assert.deepEqual(kinds("FLATTEN"), ["Flatten"]);
});

test("字段路径含点为单个 Identifier", () => {
  assert.deepEqual(kinds("file.tags"), ["Identifier"]);
  assert.deepEqual(images("file.mtime"), ["file.mtime"]);
});

test("函数名按 Identifier 切（函数性由 parser 据后随 ( 判定）", () => {
  assert.deepEqual(kinds("contains"), ["Identifier"]);
  assert.deepEqual(kinds("date"), ["Identifier"]);
});

test("关键字前缀的标识符回退为 Identifier（longer_alt）", () => {
  // "listing" 不应被吞成 List；"forms" 不应被吞成 From。
  assert.deepEqual(kinds("listing"), ["Identifier"]);
  assert.deepEqual(kinds("forms"), ["Identifier"]);
  assert.deepEqual(images("listing"), ["listing"]);
});

test("#tag：含 # 原文、支持嵌套与 unicode 标签体", () => {
  assert.deepEqual(kinds("#area"), ["Tag"]);
  assert.deepEqual(images("#area"), ["#area"]);
  assert.deepEqual(images("#area/work"), ["#area/work"]);
  // unicode 标签体（Obsidian 规范，spike 时 ASCII 退化，正式实现须支持）。
  assert.deepEqual(kinds("#中文标签"), ["Tag"]);
  assert.deepEqual(images("#项目/进行中"), ["#项目/进行中"]);
});

test("[[link]]：取整段原文，含锚点/别名", () => {
  assert.deepEqual(kinds("[[Index]]"), ["WikiLink"]);
  assert.deepEqual(images("[[Index]]"), ["[[Index]]"]);
  assert.deepEqual(images("[[Projects/Alpha#^decision-1]]"), ["[[Projects/Alpha#^decision-1]]"]);
  assert.deepEqual(images("[[Note|别名]]"), ["[[Note|别名]]"]);
});

test("字符串字面量：单/双引号 + 反斜杠转义", () => {
  assert.deepEqual(kinds('"hello"'), ["StringLiteral"]);
  assert.deepEqual(kinds("'hello'"), ["StringLiteral"]);
  assert.deepEqual(images('"a\\"b"'), ['"a\\"b"']);
});

test("数字：整数 / 负数 / 小数", () => {
  assert.deepEqual(kinds("5"), ["NumberLiteral"]);
  assert.deepEqual(images("-5"), ["-5"]);
  assert.deepEqual(images("3.14"), ["3.14"]);
});

test("比较操作符：= != <= >= < >（多字符优先）", () => {
  assert.deepEqual(images("= != <= >= < >"), ["=", "!=", "<=", ">=", "<", ">"]);
  assert.deepEqual(kinds("!="), ["Op"]);
});

test("括号与逗号", () => {
  assert.deepEqual(kinds("( , )"), ["LParen", "Comma", "RParen"]);
});

test("空白被跳过，不产出 token", () => {
  assert.deepEqual(kinds("  LIST   FROM  "), ["List", "From"]);
});

test("完整样例句的 token 序列", () => {
  const dql = `LIST FROM #x WHERE a = 1 AND contains(file.tags,"y") SORT b DESC LIMIT 5`;
  assert.deepEqual(kinds(dql), [
    "List",
    "From",
    "Tag",
    "Where",
    "Identifier",
    "Op",
    "NumberLiteral",
    "And",
    "Identifier",
    "LParen",
    "Identifier",
    "Comma",
    "StringLiteral",
    "RParen",
    "Sort",
    "Identifier",
    "Desc",
    "Limit",
    "NumberLiteral",
  ]);
});

test("非法字符报错并带位置（offset/line/column）", () => {
  const r = tokenizeDql("LIST @ FROM");
  assert.ok(r.errors.length > 0, "应有词法错误");
  const e = r.errors[0]!;
  assert.equal(e.offset, 5, "@ 在 offset 5");
  assert.equal(e.line, 1);
  assert.equal(typeof e.column, "number");
});

test("未闭合字符串报错", () => {
  const r = tokenizeDql('LIST WHERE a = "abc');
  assert.ok(r.errors.length > 0, "未闭合字符串应报词法错误");
});

// === parser（chevrotain）AST 产出 · 对应 S2.4–S2.7 ===

test("parser 头：LIST", () => {
  assert.deepEqual(parseDql("LIST"), {
    type: "LIST",
    fields: [],
    from: undefined,
    where: undefined,
    groupBy: undefined,
    flatten: undefined,
    withoutId: undefined,
    sort: undefined,
    limit: undefined,
  });
});

test("parser 头：TABLE 字段列表", () => {
  const q = parseDql("TABLE file.name, status, due");
  assert.equal(q.type, "TABLE");
  assert.deepEqual(q.fields, ["file.name", "status", "due"]);
});

test("parser 头：TASK", () => {
  const q = parseDql("TASK");
  assert.equal(q.type, "TASK");
});

test("parser 头：TABLE 无字段（直接接子句）", () => {
  const q = parseDql('TABLE FROM "Projects"');
  assert.equal(q.type, "TABLE");
  assert.deepEqual(q.fields, []);
  assert.deepEqual(q.from, { kind: "folder", value: "Projects" });
});

test("parser FROM：#tag / folder / [[link]]", () => {
  assert.deepEqual(parseDql("LIST FROM #area/work").from, { kind: "tag", value: "area/work" });
  assert.deepEqual(parseDql('LIST FROM "Projects"').from, { kind: "folder", value: "Projects" });
  assert.deepEqual(parseDql("LIST FROM [[Index]]").from, { kind: "link", value: "Index" });
});

test("parser WHERE：比较 + 数值/字符串值", () => {
  assert.deepEqual(parseDql("LIST WHERE status = 'active'").where, {
    kind: "compare",
    field: "status",
    op: "=",
    value: "active",
  });
  assert.deepEqual(parseDql("LIST WHERE file.size >= 100").where, {
    kind: "compare",
    field: "file.size",
    op: ">=",
    value: 100,
  });
});

test("parser WHERE：AND/OR/NOT 优先级（OR < AND < NOT）", () => {
  // a = 1 AND b = 2 OR c = 3  →  (and(a,b)) or c
  const w = parseDql("LIST WHERE a = 1 AND b = 2 OR c = 3").where;
  assert.equal(w?.kind, "or");
  assert.equal((w as { left: { kind: string } }).left.kind, "and");
});

test("parser WHERE：NOT 绑定 primary", () => {
  const w = parseDql("LIST WHERE NOT a = 1").where;
  assert.equal(w?.kind, "not");
});

test("parser WHERE：括号改变优先级", () => {
  // a=1 AND (b=2 OR c=3) → and(a, or(b,c))
  const w = parseDql("LIST WHERE a = 1 AND (b = 2 OR c = 3)").where;
  assert.equal(w?.kind, "and");
  assert.equal((w as { right: { kind: string } }).right.kind, "or");
});

test('parser 字符串转义解码：\\" → " 、\\\\ → \\（S2.8 回归修复）', () => {
  assert.deepEqual(parseDql('LIST WHERE title = "a\\"b"').where, {
    kind: "compare",
    field: "title",
    op: "=",
    value: 'a"b',
  });
  assert.deepEqual(parseDql('LIST WHERE title = "a\\\\b"').where, {
    kind: "compare",
    field: "title",
    op: "=",
    value: "a\\b",
  });
});

test("parser WHERE：函数调用 contains/regexmatch", () => {
  assert.deepEqual(parseDql('LIST WHERE contains(file.tags, "x")').where, {
    kind: "call",
    fn: "contains",
    field: "file.tags",
    arg: "x",
  });
  assert.deepEqual(parseDql('LIST WHERE regexmatch(file.name, "^A")').where, {
    kind: "call",
    fn: "regexmatch",
    field: "file.name",
    arg: "^A",
  });
  assert.deepEqual(parseDql('LIST WHERE file.name REGEXP "^A"').where, {
    kind: "call",
    fn: "regexmatch",
    field: "file.name",
    arg: "^A",
  });
});

test("S2.17 parser：scalar 函数 length(field) op value → compare 带 fn", () => {
  assert.deepEqual(parseDql("LIST WHERE length(file.tasks) > 0").where, {
    kind: "compare",
    field: "file.tasks",
    fn: "length",
    op: ">",
    value: 0,
  });
  assert.deepEqual(parseDql('LIST WHERE lower(file.name) = "a"').where, {
    kind: "compare",
    field: "file.name",
    fn: "lower",
    op: "=",
    value: "a",
  });
});

test("S2.17 parser：scalar 函数缺比较 / 谓词接比较 报错", () => {
  // length(x) 单独不构成条件。
  assert.throws(() => parseDql("LIST WHERE length(file.tasks)"), DqlSyntaxError);
  // 谓词函数后不能再接比较。
  assert.throws(() => parseDql('LIST WHERE contains(file.tags,"x") = 1'), DqlSyntaxError);
  // scalar 函数不接两参。
  assert.throws(() => parseDql('LIST WHERE lower(file.name, "x") = "a"'), DqlSyntaxError);
});

test("S2.17 parser：date(today) 作右值", () => {
  const w = parseDql("LIST WHERE due < date(today)").where;
  assert.equal(w?.kind, "compare");
  assert.match(String((w as { value: string }).value), /^\d{4}-\d{2}-\d{2}$/);
});

test("parser SORT：多键 + 方向", () => {
  const q = parseDql("LIST SORT a ASC, b DESC, c");
  assert.deepEqual(q.sort, [
    { field: "a", dir: "ASC" },
    { field: "b", dir: "DESC" },
    { field: "c", dir: "ASC" },
  ]);
});

test("parser LIMIT：数字", () => {
  assert.equal(parseDql("LIST LIMIT 10").limit, 10);
});

test("S2.13 LIMIT 负数报错（带位置 DqlSyntaxError）", () => {
  assert.throws(() => parseDql("LIST LIMIT -5"), DqlSyntaxError);
  // 0 合法（空结果），不报错。
  assert.equal(parseDql("LIST LIMIT 0").limit, 0);
});

test("parser 新子句：WITHOUT ID / GROUP BY / FLATTEN", () => {
  assert.equal(parseDql("TABLE WITHOUT ID status").withoutId, true);
  assert.deepEqual(parseDql("LIST GROUP BY status").groupBy, { expr: "status" });
  assert.deepEqual(parseDql("LIST FLATTEN file.tags").flatten, { field: "file.tags" });
  assert.deepEqual(parseDql('TABLE type, length(rows) FROM "" GROUP BY type').fields, [
    "type",
    "length(rows)",
  ]);
  assert.deepEqual(parseDql('TABLE type, count() FROM "" GROUP BY type').fields, [
    "type",
    "count()",
  ]);
});

test("parser 综合：完整样例句", () => {
  const q = parseDql(`LIST FROM #x WHERE a = 1 AND contains(file.tags,"y") SORT b DESC LIMIT 5`);
  assert.equal(q.type, "LIST");
  assert.deepEqual(q.from, { kind: "tag", value: "x" });
  assert.equal(q.where?.kind, "and");
  assert.deepEqual(q.sort, [{ field: "b", dir: "DESC" }]);
  assert.equal(q.limit, 5);
});

test("parser 语法错误：带位置 DqlSyntaxError", () => {
  assert.throws(() => parseDql("LISTE"), DqlSyntaxError);
  assert.throws(() => parseDql("LIST FROM"), DqlSyntaxError);
  // 注：`WHERE a`（裸字段）现为合法真值判断（truthy）、不再报错；空 WHERE 仍报错。
  assert.throws(() => parseDql("LIST WHERE"), DqlSyntaxError);
});

// === 2026-07-15 P3：SQL 习惯 LIKE 的定向报错引导（不新增算子，对标官方 Dataview）===

test("P3 WHERE ... LIKE 抛定向 DqlSyntaxError：指向 contains、带越界 token 位置", () => {
  const dql = 'LIST FROM "" WHERE type="research" AND name LIKE "%test%"';
  assert.throws(
    () => parseDql(dql),
    (e: unknown) => {
      assert.ok(e instanceof DqlSyntaxError, "应为 DqlSyntaxError");
      // 引导到正确算子：文案必须点名 contains（可用 icontains/startswith/endswith）
      assert.match(e.message, /contains/, "错误文案应指向 contains()");
      assert.match(e.message, /LIKE/, "错误文案应点名 LIKE 不受支持");
      // 位置定位在 LIKE 越界 token（源串中 LIKE 起始偏移 = 44）
      assert.equal(e.pos, dql.indexOf("LIKE"), "位置应落在 LIKE 处");
      return true;
    },
  );
});

test("P3 大小写不敏感：小写 like 同样触发定向引导", () => {
  assert.throws(
    () => parseDql('LIST WHERE name like "%x%"'),
    (e: unknown) => e instanceof DqlSyntaxError && /contains/.test((e as DqlSyntaxError).message),
  );
});

test('P3 正解仍正常：contains(field,"子串") 可解析', () => {
  // 不应抛错——LIKE 的替代写法保持合法。
  assert.doesNotThrow(() => parseDql('LIST WHERE contains(name, "test")'));
});

// === 2026-07-01 S2.15b：一元 `!` + 裸字段真值（truthy），对标官方 Dataview isTruthy ===

test("词法：孤立 ! 为 Bang，!= 仍为 Op（多字符先吃）", () => {
  assert.deepEqual(kinds("!index"), ["Bang", "Identifier"]);
  assert.deepEqual(kinds("a != 1"), ["Identifier", "Op", "NumberLiteral"]);
  assert.deepEqual(kinds("!="), ["Op"]);
});

test("裸字段真值：WHERE field → truthy 节点", () => {
  assert.deepEqual(parseDql("LIST WHERE index").where, { kind: "truthy", field: "index" });
});

test("一元 !field → not(truthy)；NOT field 等价", () => {
  const bang = { kind: "not", expr: { kind: "truthy", field: "index" } };
  assert.deepEqual(parseDql("LIST WHERE !index").where, bang);
  assert.deepEqual(parseDql("LIST WHERE NOT index").where, bang);
});

test("! 优先级高于 AND：!a AND b → and(not(truthy a), truthy b)", () => {
  assert.deepEqual(parseDql("LIST WHERE !a AND b").where, {
    kind: "and",
    left: { kind: "not", expr: { kind: "truthy", field: "a" } },
    right: { kind: "truthy", field: "b" },
  });
});

test('!(expr) 取反括号内布尔：!(status = "x") → not(compare)', () => {
  const q = parseDql('LIST WHERE !(status = "x")');
  assert.equal(q.where?.kind, "not");
  assert.equal((q.where as { expr: { kind: string } }).expr.kind, "compare");
});

test("裸字段真值不干扰 = null（仍为 isnull，显式 null 比较）", () => {
  assert.deepEqual(parseDql("LIST WHERE index = null").where, {
    kind: "isnull",
    field: "index",
    negated: false,
  });
});

// === 2026-07-02：file.frontmatter 存在性（对治场景库 messy/no-index-count 坐实的缺口）===
// 词法/语法层与普通字段无异——"file." 前缀的特殊语义只在 sql-generator 解释（见 query-parser 报告）。

test("file.frontmatter 真值：WHERE file.frontmatter → truthy 节点（同普通字段路径）", () => {
  assert.deepEqual(parseDql("LIST WHERE file.frontmatter").where, {
    kind: "truthy",
    field: "file.frontmatter",
  });
});

test("!file.frontmatter → not(truthy file.frontmatter)", () => {
  assert.deepEqual(parseDql("LIST WHERE !file.frontmatter").where, {
    kind: "not",
    expr: { kind: "truthy", field: "file.frontmatter" },
  });
});

test("file.frontmatter = null / != null → isnull 节点", () => {
  assert.deepEqual(parseDql("LIST WHERE file.frontmatter = null").where, {
    kind: "isnull",
    field: "file.frontmatter",
    negated: false,
  });
  assert.deepEqual(parseDql("LIST WHERE file.frontmatter != null").where, {
    kind: "isnull",
    field: "file.frontmatter",
    negated: true,
  });
});

test("TASK WHERE completed = false LIMIT 可解析并编译", () => {
  const q = parseDql("TASK WHERE completed = false LIMIT 5");
  assert.equal(q.type, "TASK");
  assert.equal(q.limit, 5);
  const c = generateSql(q);
  assert.match(c.sql, /k\.status NOT IN/);
  assert.match(c.sql, /LIMIT \?/);
  assert.deepEqual(c.params, [5]);
});

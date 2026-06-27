# DQL 查询指南 · x-basalt

> 上级索引：[使用指南](usage.md) · 同级：[安装](installation.md) · [命令参考](commands.md) · [索引与同步](indexing-and-sync.md) · [配置文件](configuration.md) · [Obsidian 语法](obsidian-syntax.md) · [AI 与 Skill](ai-and-skills.md) · [故障排查](troubleshooting.md)
>
> 真相源：`src/query/parser.ts`、`src/query/sql-generator.ts`、`src/query/ast.ts`、`.claude/skills/biz-dql-subset/SKILL.md`、`docs/specs/2026-06-27-dql-subset-frozen.md`。

---

## 1. 概览

x-basalt 自建 DQL 执行层，**不依赖 obsidian-dataview 的 Evaluator/Executor**。流水线：

```
DQL 字符串
  → chevrotain tokenize（词法，带位置错误）
  → parse（递归下降，产出 DqlQuery AST）
  → generateSql（AST → 参数化 SQL）
  → better-sqlite3 执行
  → QueryResult { type, columns, rows }
```

**安全保障**：所有用户输入值一律走 `?` 占位符参数化绑定，禁止字符串拼接；唯一直接内联进 SQL 的是 frontmatter 字段名，且须通过 `/^[A-Za-z0-9_]+$/` 白名单校验，否则报错。

---

## 2. 完整文法

```
(LIST | TABLE [WITHOUT ID] <field, ...> | TASK)
[WITHOUT ID]                      # 仅 LIST 时可置于此处；TABLE 须在字段列前
[FROM (#tag | "folder" | [[link]])]
[WHERE <condition>]
[GROUP BY <field>]
[FLATTEN <arrayField>]
[SORT <field> [ASC|DESC] (, <field> [ASC|DESC])*]
[LIMIT <n>]
```

**子句顺序固定**（解析器强约束）；关键字**大小写不敏感**（`list`/`LIST`/`List` 均可）。

---

## 3. 查询类型

### 3.1 LIST

返回文件列表，固定输出列 `file.name`（除非 `WITHOUT ID`）和 `file.path`。

```bash
x-basalt query "LIST FROM #project"
# → { type:"LIST", columns:["file.name","file.path"], rows:[...] }

x-basalt query "LIST WITHOUT ID FROM #project"
# → { type:"LIST", columns:["file.path"], rows:[...] }
```

### 3.2 TABLE

返回指定列，默认以 `file.name` 起头（`WITHOUT ID` 后移除）。重复字段自动去重。

```bash
x-basalt query 'TABLE status, due FROM "Projects"'
# columns: ["file.name", "status", "due"]

x-basalt query 'TABLE WITHOUT ID file.path, status FROM "Archive"'
# columns: ["file.path", "status"]
```

### 3.3 TASK

返回任务行（每条 `- [ ] …` 一行），FROM/WHERE 做**文件级**过滤，输出列固定为：

| 列 | 含义 |
|---|---|
| `task.text` | 任务正文（`- [x]` 后的文本） |
| `task.status` | 方括号内单字符（` ` 未完成，`x` 已完成，`-` 取消，`?` 疑问等） |
| `task.due` | 从文本提取的 `YYYY-MM-DD`（无则 `null`） |
| `file.path` | 来源文件路径 |

```bash
x-basalt query 'TASK FROM #todo WHERE status = "x"'
# 所有已完成任务（file 含 #todo 的文件下）

x-basalt query "TASK LIMIT 20"
# 全库前 20 条任务
```

> TASK 不接字段列表（`TASK f1, f2` 报错）；task 内部字段级过滤（如"只看 due < today 的任务"）为后续版本特性。

---

## 4. FROM 来源

单一来源，不支持 and/or 组合（报 `DqlSyntaxError`）。

| 写法 | 命中范围 | 说明 |
|---|---|---|
| `FROM #area` | 含标签 `area` 的文件 | **前缀匹配**：同时命中 `#area` 与嵌套 `#area/work`；SQL：`tag = 'area' OR tag LIKE 'area/%'` |
| `FROM "Projects"` | `Projects/` 文件夹及所有子文件夹 | SQL：`folder = 'Projects' OR folder LIKE 'Projects/%'` |
| `FROM [[Note]]` | 拥有指向 Note 的链接的文件（Note 的反向链接集合） | bare 链接按 basename 大小写不敏感匹配；`[[Dir/Note]]` 按全路径精确匹配（路径感知，见下） |

**路径感知（S3.2）**：`[[Dir/Note]]`（含 `/`）按 `target_path_key` 精确匹配，消除同名异目录歧义；bare `[[Note]]`（不含 `/`）按 basename `target_key` 回退。

---

## 5. WHERE 条件

### 5.1 比较操作符

```
field op value
fn(field) op value   # 标量函数包裹左操作数，见 §6
```

| 操作符 | 说明 |
|---|---|
| `=` `!=` | 等值 / 不等值 |
| `<` `>` `<=` `>=` | 顺序比较（数值 / ISO 日期字典序） |

```bash
x-basalt query 'LIST WHERE priority = 1'
x-basalt query 'TABLE status WHERE file.size >= 10000'
```

### 5.2 逻辑操作符

**优先级**（低 → 高）：`OR < AND < NOT < 原子（比较/函数/括号）`

```bash
x-basalt query 'LIST WHERE status = "active" AND priority > 2'
x-basalt query 'LIST WHERE NOT (status = "done" OR status = "cancelled")'
x-basalt query 'LIST WHERE (tag1 = "a" OR tag1 = "b") AND file.size > 1024'
```

### 5.3 字符串谓词

谓词函数直接作 WHERE 条件（返回布尔），不能再接比较操作符。

| 函数 | 含义 | SQL 展开 |
|---|---|---|
| `contains(field, "x")` | 包含子串 `x`（大小写敏感） | `field LIKE '%x%' ESCAPE '\'` |
| `icontains(field, "x")` | 包含子串 `x`（大小写不敏感） | `LOWER(field) LIKE LOWER('%x%') ESCAPE '\'` |
| `startswith(field, "x")` | 以 `x` 开头 | `field LIKE 'x%' ESCAPE '\'` |
| `endswith(field, "x")` | 以 `x` 结尾 | `field LIKE '%x' ESCAPE '\'` |

LIKE 通配符 `%` `_` 与转义符 `\` 自身在参数中自动转义，无需手动处理。

**聚合字段的特殊语义**：

| 字段 | 函数 | 含义 |
|---|---|---|
| `file.tags` | `contains(file.tags, "area")` | 含标签 `area` 或子标签 `area/…`（前缀语义） |
| `file.tags` | `icontains(file.tags, "area")` | 同上，大小写不敏感 |
| `file.outlinks` | `contains(file.outlinks, "Dir/Note")` | 含对 `Dir/Note` 的链接（路径精确） |
| `file.outlinks` | `contains(file.outlinks, "Note")` | 含对 basename 为 Note 的链接（basename 回退） |
| `file.inlinks` | `contains(file.inlinks, "Source")` | 被 `Source` 链接（路径感知） |

```bash
x-basalt query 'LIST WHERE contains(file.tags, "project")'
x-basalt query 'LIST WHERE icontains(file.name, "meeting")'
x-basalt query 'LIST WHERE startswith(file.name, "2026-")'
x-basalt query 'LIST WHERE contains(file.outlinks, "Index")'
```

### 5.4 正则匹配

```
regexmatch(field, "pattern")
```

使用 SQLite 自定义 `REGEXP` 函数，语义对应 JS 正则。含 ReDoS 防护（pattern 长度上限 + 执行超时）。

```bash
x-basalt query 'LIST WHERE regexmatch(file.name, "^20[0-9]{2}-[0-9]{2}")'
x-basalt query 'LIST WHERE regexmatch(status, "active|pending")'
```

### 5.5 null 判断

```
field = null     →  IS NULL
field != null    →  IS NOT NULL
```

仅支持 `=` 和 `!=`，其他操作符对 null 报错。常用于判断 frontmatter 字段是否存在：

```bash
x-basalt query 'LIST WHERE due = null'
x-basalt query 'TABLE status, due WHERE due != null SORT due ASC'
```

### 5.6 日期比较

frontmatter 中的 `YYYY-MM-DD` 日期以 ISO 字符串存储，可直接用字典序比较（`<` `>` `<=` `>=`）：

```bash
x-basalt query 'TABLE due WHERE due >= "2026-01-01" AND due < "2027-01-01"'
x-basalt query 'TABLE due, status WHERE due < date(today) AND status != "done"'
```

> 注意：frontmatter 日期精确等值 `= "2026-06-28"` 通常不命中（YAML 解析为 Date 后以完整 ISO 串存储），请用 `>= "2026-06-28" AND < "2026-06-29"` 替代。详见 [indexing-and-sync.md](indexing-and-sync.md)。

---

## 6. 内置函数

### 6.1 标量函数（包裹比较左操作数）

用于在比较前对字段值做变换；**后须接比较操作符**（否则报错）。

| 函数 | 签名 | SQL 展开 | 典型用途 |
|---|---|---|---|
| `lower` | `lower(field) op value` | `LOWER(field) op ?` | 大小写不敏感等值比较 |
| `upper` | `upper(field) op value` | `UPPER(field) op ?` | 同上（大写侧） |
| `length` | `length(field) op n` | 标量→`LENGTH(field)`；数组字段→`json_array_length(...)` | 文本长度 / 任务/链接数量 |
| `round` | `round(field) op n` | `ROUND(field) op ?` | 数值四舍五入后比较 |

```bash
# 大小写不敏感等值
x-basalt query 'LIST WHERE lower(status) = "active"'

# 文件名长度超过 30 字符
x-basalt query 'LIST WHERE length(file.name) > 30'

# 含任务的文件（任务数 > 0）
x-basalt query 'TABLE file.tasks WHERE length(file.tasks) > 0'

# 反向链接多于 5 个
x-basalt query 'LIST WHERE length(file.inlinks) > 5'
```

### 6.2 值函数 `date()`

作为比较右值使用，解析期求值为 ISO 字符串后参数化绑定（可测、确定性）。

| 调用 | 含义 | 求值结果示例 |
|---|---|---|
| `date(today)` | 今日日期（`YYYY-MM-DD`） | `"2026-06-28"` |
| `date(now)` | 当前时刻（完整 ISO 8601） | `"2026-06-28T14:23:00.000Z"` |

```bash
x-basalt query 'TABLE due WHERE due < date(today) AND status != "done"'
x-basalt query 'LIST WHERE file.mtime > date(now)'  # 将来时间（通常无结果，用于测试）
```

> `date()` 仅支持 `today` / `now` 两个参数，其他值报 `DqlSyntaxError`。

---

## 7. 隐式字段

x-basalt 通过 SQLite JOIN 实时计算隐式字段（**不建物化视图**，硬约束）。数据模型细节见 [indexing-and-sync.md](indexing-and-sync.md)。

### 7.1 file.* 直接列

| 字段 | 类型 | 说明 |
|---|---|---|
| `file.name` | 字符串 | 无扩展名的文件 basename（如 `"MyNote"`） |
| `file.path` | 字符串 | POSIX 路径（如 `"Projects/MyNote.md"`） |
| `file.folder` | 字符串 | 父目录 POSIX 路径（根文件为空串） |
| `file.extension` | 字符串 | 扩展名（不含点，如 `"md"`） |
| `file.size` | 整数 | 文件字节数 |
| `file.mtime` | 整数 | 最后修改时间（epoch 毫秒） |
| `file.ctime` | 整数 | 创建时间（epoch 毫秒） |

### 7.2 聚合字段（JSON 数组，查询期 JOIN 实时计算）

| 字段 | 类型 | 含义 | WHERE 用法 |
|---|---|---|---|
| `file.tags` | `string[]` | 文件所有标签（不含 `#`；含 frontmatter tags） | `contains(file.tags, "x")` 前缀语义 |
| `file.inlinks` | `string[]` | 其他文件指向本文件的链接来源路径（去重） | `contains(file.inlinks, "Source")` |
| `file.outlinks` | `string[]` | 本文件指向其他文件的链接 target（含 embed，去重） | `contains(file.outlinks, "Target")` |
| `file.tasks` | `object[]` | 本文件所有任务（`{status,text,due}`） | `length(file.tasks) > 0` 计数 |

> 聚合字段**不能用于 SORT**（报错）；可用于 SELECT 列（TABLE 中展示为 JSON 数组）。`file.inlinks`/`file.outlinks` 的链接解析路径感知：含 `/` 的按全路径精确，bare 按 basename 回退。

### 7.3 frontmatter 标量

任意 frontmatter 键（字段名须满足 `^[A-Za-z0-9_]+$`）直接作字段名使用：

```bash
x-basalt query 'TABLE status, priority, due WHERE priority >= 2'
x-basalt query 'LIST WHERE author = "Alice" AND category = "tech"'
```

底层映射：`json_extract(files.frontmatter, '$.status')`（参数化绑定，无注入面）。不在白名单内的字段名（含点等特殊字符）报 `DqlSyntaxError`（非 `file.*` 的点号字段）。

---

## 8. GROUP BY

按表达式分组，非分组列聚合为 `rows` 数组（对齐 Dataview 「分组后行列表」语义）。

```
GROUP BY <field>
```

输出固定两列：

| 列 | 含义 |
|---|---|
| `<field>` | 分组键值 |
| `rows` | 该组的文件路径数组（`json_group_array(DISTINCT f.path)`） |

```bash
# 按状态分组，查看各状态下的文件
x-basalt query 'TABLE status GROUP BY status'

# 从某文件夹按分类分组
x-basalt query 'TABLE category GROUP BY category FROM "Projects"'
```

> GROUP BY 后接 FLATTEN 或多列 TABLE 字段目前仅保留分组键 + rows，无法在组内做额外投影；复杂分组后处理建议在调用层消费 `rows` 数组。

---

## 9. FLATTEN

把数组字段展开为多行（笛卡尔展开），每个元素对应一行。

```
FLATTEN <arrayField>
```

只接受聚合 JSON 字段（`file.tags`/`file.inlinks`/`file.outlinks`/`file.tasks`），非数组字段报错。展开后数组字段列值为单个元素（非数组），可被 WHERE/SORT 引用。

```bash
# 每个标签单独一行（一个文件可展开为多行）
x-basalt query 'TABLE file.tags FLATTEN file.tags FROM "Projects"'

# 展开 outlinks，配合 WHERE 过滤特定目标
x-basalt query 'TABLE file.outlinks FLATTEN file.outlinks WHERE startswith(file.name, "2026")'
```

---

## 10. SORT（多键排序）

```
SORT <field> [ASC|DESC] (, <field> [ASC|DESC])*
```

- 默认 `ASC`；多键按数组顺序生成 `ORDER BY`。
- 聚合 JSON 列（`file.tags`/`file.inlinks`/`file.outlinks`/`file.tasks`）**不能排序**（报 `DqlSyntaxError`）。
- frontmatter 日期字段按 ISO 字典序比较，`SORT due ASC` 即按日期升序。

```bash
# 单键降序
x-basalt query 'TABLE status, due SORT file.mtime DESC'

# 多键：先按 priority 降序，再按 file.name 升序
x-basalt query 'TABLE priority, status SORT priority DESC, file.name ASC'

# 日期排序（ISO 字典序正确）
x-basalt query 'TABLE due, status WHERE due != null SORT due ASC LIMIT 10'
```

---

## 11. WITHOUT ID

移除默认的 `file.name`（标识）列：

- `LIST WITHOUT ID`：只返回 `file.path`（不含 `file.name`）。
- `TABLE WITHOUT ID f1, f2`：只返回 `f1, f2`（`WITHOUT ID` 须在字段列前）。

```bash
x-basalt query 'LIST WITHOUT ID FROM #project'
# columns: ["file.path"]

x-basalt query 'TABLE WITHOUT ID file.path, status FROM "Projects"'
# columns: ["file.path", "status"]
```

---

## 12. LIMIT

```
LIMIT <n>     # n 为非负整数；负数在解析期报 DqlSyntaxError
```

```bash
x-basalt query 'LIST SORT file.mtime DESC LIMIT 10'
x-basalt query 'TASK LIMIT 50'
```

---

## 13. 非目标（明确报错，不静默）

以下特性**超出当前子集范围**，遇到时抛带位置的 `DqlSyntaxError`：

| 特性 | 说明 |
|---|---|
| `FROM A AND B` / `FROM A OR B` | 多来源组合，不支持 |
| `CALENDAR` | 日历视图，不支持 |
| DataviewJS（`` ```dataviewjs `` 块） | 需运行时执行任意 JS，安全问题，不支持 |
| 未知字段（如 `file.day`、`file.aliases`） | 报 `DqlSyntaxError: 不支持的查询字段` |
| 未知函数（如 `dateformat()`、`eachday()`） | 报 `DqlSyntaxError: 不支持的函数` |
| 对聚合 JSON 列排序（`SORT file.tags`） | 报 `DqlSyntaxError: 不能对聚合列排序` |
| `LIMIT -1` 等负数 | 报 `DqlSyntaxError: LIMIT 不能为负数` |
| `length()` 以外的数值运算（如 `a + b`） | 不在子集内，报语法错误 |
| `round(field, n)` 双参 | 当前仅支持 `round(field)` 单参 |

---

## 14. 示例集

### 14.1 基础 LIST / TABLE

```bash
# 全库文件列表
x-basalt query "LIST"

# #project 标签族的最近 10 篇（含子标签如 #project/work）
x-basalt query "LIST FROM #project SORT file.mtime DESC LIMIT 10"

# Projects 文件夹下 status=active 的文件，含 due 列
x-basalt query 'TABLE status, due FROM "Projects" WHERE status = "active" SORT due ASC'

# 不含 file.name 的简洁路径列表
x-basalt query 'LIST WITHOUT ID FROM #area SORT file.name ASC'
```

### 14.2 TASK 查询

```bash
# 全库未完成任务
x-basalt query 'TASK WHERE status = " "'

# #todo 下有 due 且 due 已过期的任务
x-basalt query 'TASK FROM #todo WHERE due != null AND due < date(today)'

# 最近 20 条已完成任务
x-basalt query 'TASK WHERE status = "x" SORT file.mtime DESC LIMIT 20'
```

### 14.3 FROM 三种来源

```bash
# 标签前缀匹配（#area 与 #area/work 均命中）
x-basalt query 'TABLE status FROM #area'

# 子文件夹递归（Projects/Alpha 也命中）
x-basalt query 'TABLE due, status FROM "Projects"'

# 反向链接：谁引用了 Index（bare 链接按 basename 匹配）
x-basalt query 'TABLE file.inlinks FROM [[Index]]'

# 反向链接：精确路径（Dir/Index，避免同名异目录串味）
x-basalt query 'TABLE file.inlinks FROM [[Dir/Index]]'
```

### 14.4 WHERE 综合

```bash
# AND / OR / NOT
x-basalt query 'LIST WHERE status = "active" AND NOT (priority = 0 OR priority = null)'

# null 判断
x-basalt query 'TABLE due, status WHERE due != null AND status != "done"'

# 字符串谓词
x-basalt query 'LIST WHERE startswith(file.name, "2026-") AND endswith(file.folder, "daily")'
x-basalt query 'LIST WHERE icontains(file.name, "meeting")'

# 链接包含判断（path-aware）
x-basalt query 'LIST WHERE contains(file.outlinks, "Reference/Glossary")'

# 标签包含判断（前缀语义）
x-basalt query 'LIST WHERE contains(file.tags, "project")'

# 正则
x-basalt query 'LIST WHERE regexmatch(file.name, "^20[0-9]{2}-[0-9]{2}-[0-9]{2}")'
x-basalt query 'LIST WHERE regexmatch(status, "^(active|pending)$")'
```

### 14.5 日期与函数

```bash
# due 在今天之前（过期）
x-basalt query 'TABLE due, status WHERE due < date(today) AND status != "done"'

# 大小写不敏感状态等值
x-basalt query 'LIST WHERE lower(status) = "in progress"'

# 文件名超过 40 字符
x-basalt query 'LIST WHERE length(file.name) > 40'

# 含任务的文件（任务数大于 0）
x-basalt query 'TABLE file.tasks WHERE length(file.tasks) > 0'

# 反向链接多于 3 个的笔记
x-basalt query 'TABLE file.inlinks WHERE length(file.inlinks) > 3 SORT file.name ASC'
```

### 14.6 多键 SORT

```bash
# 先按优先级降序，再按 due 升序，再按文件名
x-basalt query 'TABLE priority, due, status SORT priority DESC, due ASC, file.name ASC LIMIT 20'

# 文件夹内按创建时间升序排列
x-basalt query 'TABLE file.ctime, status FROM "Archive" SORT file.ctime ASC'
```

### 14.7 GROUP BY

```bash
# 按 status 分组，每组返回文件路径数组
x-basalt query 'TABLE status GROUP BY status'

# 特定文件夹内按 category 分组
x-basalt query 'TABLE category GROUP BY category FROM "Projects"'
```

### 14.8 FLATTEN

```bash
# 展开标签，每个标签一行（一个文件可出现多行）
x-basalt query 'TABLE file.tags FLATTEN file.tags FROM "Projects" SORT file.name ASC'

# 展开 outlinks 后过滤特定前缀的目标
x-basalt query 'TABLE file.name, file.outlinks FLATTEN file.outlinks WHERE startswith(file.outlinks, "Reference")'
```

### 14.9 TABLE 默认列去重 + WITHOUT ID

```bash
# file.name 显式出现也不产生重复列
x-basalt query 'TABLE file.name, status, file.name FROM "Projects"'
# → columns: ["file.name", "status"]  (去重后)

# 只看 file.path，完全不要 file.name
x-basalt query 'TABLE WITHOUT ID file.path, status'
```

---

## 15. Shell 引号速查

DQL 中的 `"folder"` 需要把双引号传入进程，不同 shell 写法不同：

| Shell | 推荐写法 |
|---|---|
| PowerShell | `x-basalt query 'TABLE status FROM "Projects"'`（外层单引号，内层双引号保留） |
| Bash / zsh | `x-basalt query 'TABLE status FROM "Projects"'`（同上） |
| cmd.exe | `x-basalt query "TABLE status FROM ""Projects"""` （双引号转义为 `""`） |

详见 [commands.md](commands.md) §query 的 Shell 引号提示。

---

> 数据模型（`files`/`links`/`tags`/`tasks`/`blocks` 表结构）与链接解析细节见 [indexing-and-sync.md](indexing-and-sync.md)。

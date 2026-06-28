# 规范覆盖矩阵（x-basalt · 2026-06-26）

> 目的：一眼看清「到底支持什么、近似什么、没做什么」——消除黑盒的真相源。
> 口径：✅ 完整 / ⚠️ 近似或有缺陷 / ❌ 未实现。证据列给 `文件:行号` 或测试。
> 关联：体检 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md)、依赖决策 [`2026-06-26-deps-build-vs-buy.md`](2026-06-26-deps-build-vs-buy.md)
> 校准：基于 2026-06-26 直接读源码；标 ⚠️待核实 者未逐行复核。

## A. Obsidian 语法解析覆盖

| 语法 | 状态 | 证据 | 备注 |
|---|---|---|---|
| Frontmatter（YAML） | ✅ | `frontmatter.ts`、`parser.test` | gray-matter；首行 `---` 才识别 |
| Wikilink `[[t]]` / `\|alias` / `#heading` / `#^block` / 组合 | ✅ | `wikilink.ts`、`parser.test` | —— |
| Embed `![[...]]`（笔记/资源） | ✅ | `wikilink.ts`（embed 标记） | —— |
| 行内 Tag `#a` / 嵌套 `#a/b` | ✅ | `index.ts:113-126` | 排除 `#123`；已在掩码后正文提取 |
| Frontmatter tags | ✅(分工) | `index.ts:200-201` | 不入 nodes，交 indexer（`in_frontmatter=1`） |
| Highlight `==text==` | ✅ | `index.ts:128-135` | 代码块/行内代码已掩码 |
| Callout `> [!type] title` + 正文 | ⚠️ | `index.ts:167-193` | type 归一化小写、聚合正文 OK |
| Callout 折叠 `+`/`-` 默认态 | ⚠️ | `index.ts:187` | `+`/`-` 合并为 `foldable:boolean`，丢默认展开/折叠区分 |
| 嵌套 callout `>>` | ⚠️待核实 | —— | 未见专门处理 |
| Task `- [ ]`/`- [x]`/自定义状态 | ✅ | `index.ts:137-148` | status 取方括号单字符 |
| Task `due_date`（文本内 `YYYY-MM-DD`） | ❌ | `types.ts:19`、schema:63 有列但 parser 不提取 | **恒 NULL**；调研 §2 line 58 要求 |
| BlockRef 行尾 `^id` 定义 | ✅ | `index.ts:150-161` | 不误判 `[[#^id]]` 引用 |
| 代码块/行内代码内不解析（tag/highlight） | ✅ | `maskCode` `index.ts:85-110` | —— |
| 代码块内不解析（wikilink/task/callout/blockRef） | ❌ | `index.ts:217-222` 用原始文本 | 与 tag/highlight 标准不一致 |
| HTML 注释 `<!-- -->` 内不解析 | ❌ | 全局无处理 | —— |
| 转义 `\[\[` / `\#` | ⚠️待核实 | —— | 未见转义处理 |
| Basename 链接解析（同名异目录区分） | ⚠️ | `utils/path.ts` linkKey | 同名误合并（MVP 近似，已承认） |

## B. DQL（Dataview 子集）覆盖

> **2026-06-27 收口（阶段2 Part A–E）**：DQL 引擎已 chevrotain 重写——`tokens.ts`(lexer)/`parser.ts`(EmbeddedActionsParser)/`sql-generator.ts`，执行层全参数化。测试：`tests/query-parser.test.ts`（词法+parser AST）、`tests/sql-generator.test.ts`（SQL 生成纯函数）、`tests/query.test.ts`（端到端）、`tests/regexp.test.ts`（ReDoS）。子步编号见 `../plans/2026-06-26-dql-kernel-steps.md`。

### 查询类型
| 子句 | 状态 | 证据 |
|---|---|---|
| `LIST` | ✅ | query/query-parser/sql-generator.test |
| `TABLE col, ...` | ✅ | 列去重（S2.11）；sql-generator.test |
| `TASK` | ✅ | tasks JOIN files（S2.21）；query.test 端到端 |
| `CALENDAR` | ❌ 范围外 | goal 明确不做 |

### FROM
| 来源 | 状态 | 证据 |
|---|---|---|
| `FROM #tag`（含子标签前缀） | ✅ | sql-generator.test |
| `FROM "folder"`（含子目录前缀） | ✅ | sql-generator.test |
| `FROM [[link]]`（反向链接） | ✅ | query.test 端到端 |
| `FROM` 多源 `AND`/`OR` | ❌ 范围外 | 报错（goal 不做） |

### WHERE
| 能力 | 状态 | 证据 |
|---|---|---|
| 比较 `=` `!=` `<` `>` `<=` `>=` | ✅ | sql-generator/query-parser.test |
| `AND` / `OR` / `NOT` / 括号优先级 | ✅ | query-parser.test（优先级用例） |
| `contains` / `icontains` | ✅ | LIKE 通配符转义（S2.9）+ icontains 大小写（S2.10） |
| `startswith` / `endswith` | ✅ | LIKE 转义（S2.9） |
| `regexmatch` | ✅ | ReDoS 缓解（S2.23）；regexp.test |
| null 判断（`= null` / `!= null`） | ✅ | S2.15（isnull→IS NULL/IS NOT NULL） |
| 日期比较（ISO 字典序） | ✅ | S2.16 |
| 内置标量 `lower`/`upper`/`length`/`round` | ✅ | S2.17（length 数组→json_array_length） |
| `date(today)` / `date(now)` | ✅ | S2.17（求值 ISO 串作右值） |

### SORT / LIMIT / 其他
| 能力 | 状态 | 证据 |
|---|---|---|
| `SORT field ASC\|DESC` | ✅ | query-parser/sql-generator.test |
| `SORT` 多键 | ✅ | S2.14（多列 ORDER BY） |
| `SORT` JSON 聚合字段 | ✅ 报错 | S2.13（DqlSyntaxError，非静默） |
| `LIMIT n`（负数校验） | ✅ | S2.13（负数报错，0 合法） |
| `GROUP BY` | ✅ | S2.18（分组键+rows 聚合，端到端） |
| `FLATTEN` | ✅ | S2.19（json_each 展开，端到端） |
| `WITHOUT ID` | ✅ | S2.20（列控制） |
| 未知字段 / 未知函数 | ✅ 报错 | S2.12（DqlSyntaxError） |
| SQL 注入 | ✅ 防护 | 全参数化（S2.23 端到端注入用例） |

### 隐式字段
| 字段 | 状态 | 证据 |
|---|---|---|
| `file.name/.path/.folder/.extension/.size/.mtime/.ctime` | ✅ | S2.22 全集核对 |
| `file.tags` | ✅ | query.test |
| `file.inlinks` / `file.outlinks` | ✅ | 查询期 JOIN 实时计算（硬约束6）；S2.22 |
| `file.tasks` | ✅ | S2.21/S2.22（任务 `due` 提取待阶段1 S1.3） |
| frontmatter 标量字段 | ✅ | 白名单字段名 |
| `file.link/.day/.cday/.aliases/.etags/.lists` 等 | ❌ 范围外 | 未知字段明确报错 |

> 遗留底层边界（非 DQL 引擎层，留各自阶段）：`FROM "folder"` 末尾 `/`、inlinks basename 歧义（阶段3 S3.2）、ctime 跨平台、task `due` 提取（阶段1 S1.3）。

## C. 工程/质量覆盖
| 项 | 状态 | 备注 |
|---|---|---|
| parser/indexer/query/skill/config 单测 | ✅ | 52 pass，但多为正路径 |
| CLI 端到端测试 | ❌ | 无 `tests/cli.test.ts` |
| watch 增量 / 错误降级 / 路径边界 / 全局配置链 测试 | ❌ | 见体检 §3-4 |
| `--format yaml` 全命令支持 | ⚠️ | 仅 `parse`；query/skills 恒 JSON |
| 日志脱敏 | ❌ | 无实现（影响低） |
| 仓库 `oxfmt --check .` | ⚠️ | docs/json 18 文件红（中文 prose 漂移） |

## D. 怎么读这张表

- ✅ 之外的每一格，都是当前「用着用着会踩到的边界」——这是黑盒的具体清单。
- 规范覆盖：解析 ~60%（阶段1 待办）/ **DQL 子集 ~95%（阶段2 收口完成）**：LIST/TABLE/TASK + 完整 WHERE（比较/逻辑/null/日期/谓词函数/内置标量函数）+ 多键 SORT + GROUP BY/FLATTEN/WITHOUT ID + LIMIT，全参数化 + ReDoS 缓解；仅 CALENDAR/DataviewJS/FROM-and-or 为范围外。
- 后续做深内核时，本表即「目标 vs 现状」差距表；每补一格就更新一格。

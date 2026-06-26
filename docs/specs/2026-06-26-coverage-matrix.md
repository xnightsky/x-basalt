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

### 查询类型
| 子句 | 状态 | 证据 |
|---|---|---|
| `LIST` | ✅ | `sql-generator.ts:208-210`、`query.test` |
| `TABLE col, ...` | ⚠️ | `:211-214`（显式 `file.name` 致**重复列**） |
| `TASK` | ❌ | ast 要求「以 LIST/TABLE 开头」 |
| `CALENDAR` | ❌ | —— |

### FROM
| 来源 | 状态 | 证据 |
|---|---|---|
| `FROM #tag`（含子标签前缀） | ✅ | `:178-182` |
| `FROM "folder"`（含子目录前缀） | ✅ | `:183-186`（末尾 `/` 边界 ⚠️） |
| `FROM [[link]]`（反向链接） | ✅ | `:187-191` |
| `FROM` 多源组合 `AND`/`OR` | ❌ | ast 单来源 |

### WHERE
| 能力 | 状态 | 证据 |
|---|---|---|
| 比较 `=` `!=` `<` `>` `<=` `>=` | ✅ | `:112-116` |
| `AND` / `OR` / `NOT` | ✅ | `:98-111`、`query.test` |
| `contains` / `icontains` | ⚠️ | `:135-159`（icontains 对聚合字段退化为大小写敏感；LIKE 通配符未转义） |
| `startswith` / `endswith` | ⚠️ | `:161-163`（LIKE 通配符未转义） |
| `regexmatch` | ⚠️ | `query/index.ts` REGEXP（无 ReDoS 防护） |
| null 判断 / 日期函数 / 算术 / `date(today)` | ❌ | —— |

### SORT / LIMIT / 其他
| 能力 | 状态 | 证据 |
|---|---|---|
| `SORT field ASC\|DESC`（单键） | ✅ | `:218-221` |
| `SORT` 多键 | ❌ | ast 单字段 |
| `SORT` JSON 聚合字段 | ⚠️ | `:218-220`（按 JSON 串排序，无意义不报错） |
| `LIMIT n` | ✅ | `:222-225`（负数不校验 ⚠️） |
| `GROUP BY` | ❌ | —— |
| `FLATTEN` | ❌ | —— |
| `WITHOUT ID` | ❌ | —— |

### 隐式字段
| 字段 | 状态 | 证据 |
|---|---|---|
| `file.name` `.path` `.folder` `.extension` `.size` `.mtime` `.ctime` | ✅ | `:25-33`（ctime 跨平台语义 ⚠️） |
| `file.tags` | ✅ | `:58-62` |
| `file.inlinks` / `file.outlinks` | ✅ | `:63-75`（basename 歧义 ⚠️） |
| `file.tasks` | ⚠️ | `:76-80`（`due` 恒 null） |
| frontmatter 标量字段 | ✅ | `:81-87`（字段名白名单） |
| `file.link` `.day` `.cday` `.aliases` `.etags` `.lists` 等 | ❌ | `file.day` 测试中明确报错 |

## C. 工程/质量覆盖
| 项 | 状态 | 备注 |
|---|---|---|
| parser/indexer/query/skill/config 单测 | ✅ | 52 pass，但多为正路径 |
| CLI 端到端测试 | ❌ | 无 `tests/cli.test.ts` |
| watch 增量 / 错误降级 / 路径边界 / 全局配置链 测试 | ❌ | 见体检 §3-4 |
| `--format yaml` 全命令支持 | ⚠️ | 仅 `parse`；query/skill 恒 JSON |
| 日志脱敏 | ❌ | 无实现（影响低） |
| 仓库 `oxfmt --check .` | ⚠️ | docs/json 18 文件红（中文 prose 漂移） |

## D. 怎么读这张表

- ✅ 之外的每一格，都是当前「用着用着会踩到的边界」——这是黑盒的具体清单。
- 规范覆盖：解析 ~60% / DQL 子集 ~70%（详见体检 §5）。
- 后续做深内核时，本表即「目标 vs 现状」差距表；每补一格就更新一格。

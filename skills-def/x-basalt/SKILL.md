---
name: x-basalt
description: 用 x-basalt CLI 在终端无头操作 Obsidian vault（不依赖 Obsidian App）——解析笔记为 AST、构建/增量刷新 SQLite 索引、用 Dataview(DQL) 子集查询笔记、按需重扫文件夹变更、读改笔记 frontmatter 元数据（get/set/unset/rename、normalize 归一、按 profile 策略补全）、召回 Obsidian/DQL 语法规范。当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用。
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

`x-basalt` 是纯 Node CLI，零依赖 Obsidian 运行时，直接读文件系统：解析 Obsidian 专有语法、把 vault 索引进 SQLite、用 Dataview 子集 (DQL) 查询。**全局已装：直接 `x-basalt <command>`。**

## 何时用

- 要从终端 / 脚本 / AI 流程里**查询或提取** Obsidian vault 的结构化信息（链接、标签、任务、frontmatter），而不打开 Obsidian。
- 要像 Dataview 那样 `LIST/TABLE/TASK ... FROM ... WHERE ...` 查笔记。
- 索引建好后，**周期性触发**让它自己找出哪些文件变了并只重扫（无需常驻监听）。

## 典型流程

```bash
x-basalt index <vault>                 # 首次：全量建索引（默认库 <vault基目录>/.x-basalt/index.db）
x-basalt query "LIST FROM #project WHERE status = 'active' SORT file.mtime DESC LIMIT 10"
x-basalt query 'TABLE count() FROM "" GROUP BY file.extension'   # 计数：读 count()，或任一 query 结果的 total
x-basalt query 'LIST FROM ""' --size 50 --offset 0              # 大结果分页：每页 50，读 total 知总量
x-basalt scan <vault>                  # 之后：增量重扫，只处理新增/改动/删除（diff mtime+size）
```

## 命令速查

| 命令                               | 作用                                                                                                                         | 关键选项                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `parse <file>`                     | 单文件 → AST（wikilink/Markdown link/tag/task/callout/highlight/blockRef/inlineField + frontmatter；链接节点含完整文件位置） | `--format json\|yaml`                                                                    |
| `index [vault]`                    | 全量建/重建索引                                                                                                              | `--db <path>` · `--watch`(常驻监听)                                                      |
| `scan [vault]`                     | **按需增量重索引**：diff 文件系统 vs 库，只重扫变化的                                                                        | `--rehash`(按内容比，稳但慢) · `--dry-run`(只报告不写) · `--json` · `--pipe k=v`(走管道) |
| `query "<dql>"`                    | 执行 DQL 查询，输出 `{type,columns,total,offset,size,returned,hasMore,rows}`（带分页）                                       | `--db <path>` · `--offset <n>` · `--size <n>`(分页;不传=全量返回)                        |
| `meta get <file> [key]`            | 读 frontmatter（缺 key 读全部，缺失键输出 null）                                                                             | `--format json\|yaml`                                                                    |
| `meta set/unset/rename <file> ...` | 改单个属性（set 增改 / unset 删 / rename 改键名）                                                                            | `--type` · `--dry-run`                                                                   |
| `meta normalize <file>`            | **无约定纯标准化**：tags 列表化/去#/去重/单数键迁移                                                                          | `--sort-keys` · `--dry-run`                                                              |
| `meta profile list / show <name>`  | 列出 / 查看元数据策略（profile）的规范+模板                                                                                  | —                                                                                        |
| `meta apply <profile> <file>`      | **按策略补全**：机械补时间/哈希 + `--set` 补语义 + 自动标准化                                                                | `--set k=v`(可重复) · `--refresh-derived`(重算 mtime/sha256) · `--dry-run`               |
| `skills get <name>`                | 按名取整篇规范（`obsidian-base-spec` / `x-basalt`）                                                                          | `--all` · `--json`                                                                       |
| `skills recall <kw>`               | 模糊召回规范详情（容拼写错、相关性排序）                                                                                     | `--json`                                                                                 |
| `skills list` / `skills path`      | 列出可召回规范 / 打印数据目录                                                                                                | `--json`                                                                                 |
| `watch [vault]`                    | 常驻监听增量更新（有守护进程时用；否则首选 `scan`）                                                                          | `--db` · `--on-change <cmd>`(`{file}` 占位) · `--pipe k=v`/`--apply`(走管道)             |
| `run`                              | **变更编排管道**：源→去重→路由→动作链（index/normalize/parse/apply/set/unset/rename）                                        | `--pipe k=v`(可重复，含 `if-exists`) · `--apply`(写动作落盘)                             |
| `chat ["<NL>"]`                    | **可选 AI**：自然语言驱动既有原语（单发/REPL）；无 key 则禁用、不影响其他命令                                                | `--model` · `--max-steps` · 需 env `AI_GATEWAY_API_KEY`                                  |

## 变更编排管道（`run` / `scan --pipe` / `watch --pipe`）

把"源 → 去重 → 路由 → 一串内建动作"声明成一条管道，自动维护 vault。**写动作默认 dry-run，加 `--apply` 才落盘**。

- **管道参数 `--pipe k=v`（可重复）**：`actions=index,normalize`（动作链，必填）· `where="<dql>"`（按 DQL 选文件）· `on=add,change`（事件类型）· `paths=<glob>` · `concurrency=N` · `if-exists=skip|overwrite|merge`（`rename` 键冲突策略，默认 `skip`）· `use=<name>`（从配置 `pipelines` 段加载作基底，再被其它 `--pipe` 覆盖）。
- **命令决定「源」**：`run`（默认 scan 全库 diff；`--pipe where=`/`paths=` 切手动源）· `scan --pipe`（一次性 diff 源）· `watch --pipe`（常驻事件源）。
- **命令行 = 规范，配置段 = 加速**：`--pipe k=v` 与配置 `pipelines.<name>` 一一对应；**纯命令行即可自包含运行，无需先写配置**。
  ```bash
  x-basalt run --pipe actions="apply pkm-note, normalize" --pipe where="LIST FROM #pkm" --apply   # 内联，免配置
  x-basalt run --pipe actions="rename tag tags" --pipe if-exists=skip --apply                     # 批量改名，冲突跳过
  x-basalt run --pipe use=maintain --apply                                                         # 引用配置段
  ```
- 内建动作：`index`（落库）· `normalize`（归一 frontmatter）· `parse`（校验）· `apply <profile>`（按 profile 纯 top-up 补字段）· `set <key>=<value>`（仅标量）· `unset <key>`· `rename <old> <new>`（冲突按 `if-exists`）。**写动作默认 dry-run，必须 `--apply` 才落盘**；**原 migrate（语义选一批改造）= `run --pipe actions=… --pipe where=… --apply`**。

## 改元数据（meta，唯一写侧）

写操作**只动 frontmatter、正文逐字节不变**；YAML 往返保真（保键序/注释尽力）、原子写、幂等、`--dry-run` 预览、非法 YAML 拒写。

- **直接改**：`meta set note.md status active`（`--type string|number|boolean|null|list|auto`，默认 auto 保守推断）/ `meta unset` / `meta rename old new`。
- **`normalize`（无约定纯标准化）**：把已有字段改合规——tags 列表化、去 `#`、去重、单数键 `tag→tags` 迁移。不挑 profile、不加新字段。「只想把笔记变干净」用它。
- **`apply <profile>`（按约定补全）= 元数据策略**：x-basalt 只「告知」规范，**补不补/补什么由你（AI）决定，它不调 LLM**。内置 3 套：`pkm-note`(Obsidian,第一推荐) / `llm-wiki`(OKF) / `ssg-blog`(SSG)。
  - **AI 用法**：① `meta apply <profile> <file>` —— 机械补 created/modified/pubDate/timestamp/sha256，并报告「仍缺」哪些语义字段；② 缺的字段你 `meta profile show <profile>` 读规范（每个字段什么意思）+ 读文档内容，自己判断值；③ 再 `meta apply <profile> <file> --set key=value ...` 一次补上（`--set` 按 profile 类型转值、**显式覆盖**已有值；apply 收尾自动 normalize）。额外字段也可直接 `--set` 加。
  - 例：`meta apply pkm-note daily.md --set tags=area/work,moc --set status=active`
  - **改完正文重算**：`meta apply <profile> <file> --refresh-derived` —— 内容派生字段（modified/timestamp/sha256）即使已有也重算覆盖；创建时间（created/pubDate）恒定不动，`--set` 显式值不被覆盖。（不加该开关时机械字段是 top-up 只补缺，改正文后须用它才刷新。）

## 可选 AI：chat（自然语言驱动 vault）

`x-basalt chat` 把上面的原语包成 AI 工具，用自然语言驱动（plan→act→observe）。**最小可选 AI**：内核零 AI、chat 懒加载 SDK；**没配 key = chat 禁用，其余命令全功能照常**。

- **两形态**：`x-basalt chat "<指令>"`（单发，翻译→执行→退）/ `x-basalt chat`（REPL，`quit`/`exit`/`q` 退出）。
- **需配 `AI_GATEWAY_API_KEY`**（兼容 agent-browser；可选 `AI_GATEWAY_MODEL`/`AI_GATEWAY_URL`，`--model` 覆盖模型，`AI_GATEWAY_URL` 指本地端点可离线）。无 key → 友好退出码 1、不影响其他命令。**各平台怎么设、怎么持久化（Linux/macOS 的 `~/.bashrc`/`~/.zshrc`、Windows 的 PowerShell profile / `setx`）见 [docs/guides/ai-and-skills.md](../../docs/guides/ai-and-skills.md) 第四节。**
- **写动作直接落盘、无确认弹窗**——安全靠流式可观测 + **Ctrl+C 中断在途** + 既有原子写（kill 不损坏文件）+ git 兜底。
- **只做一次性操作，不支持常驻 watch / 监听**：**绝不要让它跑 `watch` 或 `index --watch` 这类常驻命令——会永不返回、把 chat 挂死**。需要持续维护 vault 用独立的 `x-basalt watch` / `scan --pipe`，不要走 chat。
- **能力边界**：当前做结构化任务（DQL/元数据/规范/正文全文检索）；语义向量检索仍未落地，默认用 FTS5 搜正文。

## 配置与基目录

- 配置文件：项目就近 `.x-basalt/config.{yaml,yml,json5,json}`（或扁平 `.x-basalt.*`），向上查找；全局 `~/.x-basalt/config.*` 兜底。键：`db` `vault` `skillPath` `format` `onChange`（仅字符串）。
- **`X_BASALT_DIR` 环境变量**：指定 `.x-basalt` 基目录（config 与 `index.db` 都落其下），把状态搬到任意位置。优先级：命令行 flag > `X_BASALT_DIR` > 就近 `.x-basalt/` > 默认。
- 取值统一 `flag ?? config ?? 默认`；出错统一打印 `✗` 并退出码 1。

## DQL 子集要点

`LIST | TABLE <字段,...> | TASK` · `FROM <#tag | "folder" | [[link]]>`（单一来源）· `WHERE`（`= != < > <= >=`、`AND/OR/NOT`、括号、`field = null`、日期 ISO 比较）· 字符串谓词 `contains/icontains/startswith/endswith/regexmatch` · `GROUP BY` · `FLATTEN` · `WITHOUT ID` · 多键 `SORT` · `LIMIT`。内置函数：`lower/upper/length/round`、`date(today)/date(now)`。隐式字段：`file.name/path/folder/extension/size/mtime/ctime/tags/inlinks/outlinks/tasks` 与 frontmatter 标量。范围外（CALENDAR、DataviewJS、多源 FROM、未知字段）会带位置报 `DqlSyntaxError`，不静默。

**计数 / 分页**：要"有多少"别全量 `LIST` 再数——读 query 结果的 `total`（命中总数），或 `TABLE count() FROM "" GROUP BY <字段>`（`count()`/`length(rows)` 仅作 GROUP BY 聚合列，单独 `TABLE count()` 不带 GROUP BY 无效）。大结果翻页用 `--offset/--size`（`query` 结果含 `total`/`hasMore`，翻页 `offset += size`）；**DQL 本身只有 `LIMIT`、无 `OFFSET`**，分页在 CLI/工具层做。

> **要精确语法 / 边界**：装好 x-basalt 后直接 `x-basalt skills get obsidian-base-spec`（取整篇），或 `x-basalt skills recall <关键字>`（如 `wikilink`/`dataview`/`callout`，模糊召回），返回带模式与示例的规范——本技能只给概览，细节以 `skills` 召回结果为准，避免漂移。

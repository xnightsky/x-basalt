# 调研：业界现成库逐模块普查（x-basalt · 2026-06-26）

> 目的：逐模块核实业界现成库，回答三问——**①语言 ②当前能不能用到 ③能用怎么用上**。
> 方法：5 个并行调研 agent 联网（npm registry / GitHub）+ 主线二次核实关键版本/许可证。
> 关联：依赖决策 [`../specs/2026-06-26-deps-build-vs-buy.md`](../specs/2026-06-26-deps-build-vs-buy.md)、覆盖矩阵 [`../specs/2026-06-26-coverage-matrix.md`](../specs/2026-06-26-coverage-matrix.md)
> ⚠️ 状态：registry 镜像本轮疑似返回部分**旧缓存**（版本/engines/license 与实测依赖对不上），凡受影响处标「待 `pnpm install` 复核」。落地选型以真实安装为准。

## 0. 总览（买 / 建 速读）

| 模块 | 现成库结论 | 建议 |
|---|---|---|
| 解析 parser | ✅ 纯 npm remark 插件覆盖 wikilink/embed/callout/highlight | **组装**：remark 插件 + 自建收敛到 tag/task/blockRef |
| 索引 indexer | 存储/监听已用；SQL 构建可引 kysely；全文检索用 FTS5 | **小幅买**：kysely + FTS5；存储/监听维持 |
| 查询 DQL | ⚠️ 无可依赖现成库（全绑 Obsidian 或非 DQL） | **自建做深**：peggy 重写文法 + 自建执行；dataview 仅作 AST 参考 |
| skill 召回 | ✅ 轻量模糊匹配库 | **买**：Fuse.js 替手写匹配 |
| CLI/config | CLI 维持 commander；YAML/config 有成熟库 | **买**：`yaml` 包 + cosmiconfig/c12 |

> 关键认知（承接复盘）：**「零依赖 Obsidian 运行时」≠「全部手撸」**。除 DQL 执行层外，多数模块有不碰 Obsidian 的纯 npm 方案。

## 1. 解析层 parser

语言基本都是 **JS/TS**（remark/unified 生态）；非 JS（Rust pulldown-cmark/comrak、Python mistune、Go goldmark）均**无可用 npm 结构化 AST 出口**，需子进程/WASM，性价比低 → ❌不采用。

| 库 | 语言 | 能用? | 怎么用 |
|---|---|---|---|
| **remark-obsidian-md** v1.1.0 | TS | ⚠️见许可证 | 主力候选：`.use(remarkObsidianMd)` 拿 wikilink/embed/callout/highlight 的 mdast，写 visitor 映射到 `ObsidianNode`。**但 manifest license 字段缺失（§6），落地前必须确认** |
| remark-obsidian v12.x | TS | ❌ | 功能最全但 **GPL-3.0**，MIT 项目不可引入（§6 确认） |
| @r4ai/remark-callout / remark-obsidian-callout | TS | ✅ | 轻量 callout 插件，若不用综合库则单点接入 |
| remark-flexible-markers | TS | ✅ | `==高亮==` → mark 节点 |
| @flowershow / @portaljs/remark-wiki-link | TS | ⚠️ | 仅 wikilink；@flowershow 拖 `@flowershow/core`，@portaljs 拖旧 `mdast-util-wiki-link@0.0.2` |
| unified / remark-parse | TS | ✅ | unified 管线宿主；选综合库后这两个**死依赖转为真正使用** |
| gray-matter | JS | ✅ | frontmatter，已在用，保留 |

- **#tag / task(自定义状态+due_date) / ^blockRef 无现成库精确覆盖** → 继续自建（现有正则已较完善）。
- **模块建议**：以 `remark-obsidian-md`（确认许可证后）为主力 + gray-matter，自建收敛到 tag/task/blockRef；可移除 @flowershow。

## 2. 索引层 indexer

| 库 | 语言 | 能用? | 怎么用 |
|---|---|---|---|
| better-sqlite3 | JS/C++ | ⚠️ Node 版本待核实(§6) | 已在用，存储主力 |
| node:sqlite（内置） | JS | ❌(Node18) | Node 22.5+ 才有、目前 RC；升 Node 后可替代 |
| **kysely** v0.29.x | TS | ✅ | **推荐**：类型安全 SQL 构建器，内置 better-sqlite3 dialect，替 DQL→SQL 手拼字符串，天然参数化 |
| drizzle-orm | TS | ✅ | 需 schema 声明，偏重；要迁移管理时再考虑 |
| chokidar | JS | ⚠️ Node 版本待核实(§6) | 已在用；Windows 痛点时可换 @parcel/watcher |
| @parcel/watcher | C++ | ✅ | chokidar 替代，Windows 更可靠（VSCode 同款） |
| **SQLite FTS5**（内置） | — | ✅ | **推荐**：零额外依赖，`CREATE VIRTUAL TABLE ... USING fts5`，trigram 支持中文子串 |
| flexsearch / minisearch / @orama/orama | JS/TS | ✅ | 内存全文检索；有 CJK 需求选 flexsearch；注意无 scope 的 `orama` 是废弃图表库 |
| graphology / ngraph | JS/TS | ⚠️ | 反链用 SQL JOIN 已够，图库属超前 |

- Vault 级现成方案 obsidiantools(Python)/obsidian-export(Rust) 均 ❌ 不可嵌入，仅作参考实现。
- **模块建议**：存储/监听维持；**引 kysely** 收编 SQL 生成；全文检索用 **FTS5**。

## 3. 查询层 query（DQL 引擎）—— 核心，唯一「必须自建做深」

跨语言（Rust Krafna/markbase 用 SQL 非 DQL、Python obsidianmd-parser、Go 确认无实现）全部 ❌；**确认无任何他语言忠实覆盖完整 DQL**。JS 候选：

| 库 | 语言 | 能用? | 怎么用 |
|---|---|---|---|
| obsidian-dataview 0.5.68 | TS | ⚠️仅参考 | 发布产物顶层无条件 `require('obsidian')`，Node CLI `import` **即崩**；Executor 绑 `app.metadataCache` 违规。**只能从 TS 源码单独编译 `src/query/parse.ts`（不经 index.ts）拿 parser**，工程成本/隐藏依赖待核实。建议：**读源码理解 AST，不 install** |
| @blacksmithgu/datacore 0.1.x | TS | ❌ | 架构级绑 Obsidian，npm 发布未完成，Alpha |
| @oomkapwn/enquire-mcp 3.10.1 | TS | ⚠️参考 | 是 MCP server 非可 import 库；自实现 DQL 子集（LIST/TABLE/FROM/WHERE(=,!=,contains,like,AND/OR)/SORT单键/LIMIT；无 GROUP BY/FLATTEN/TASK/CALENDAR）；思路可参考 |
| **peggy** 5.1.0 | JS | ✅ | **推荐**：写 `.peggy` 文法生成 TS parser（声明式文法即文档，易加 GROUP BY/FLATTEN），执行层仍自建 AST→SQL→better-sqlite3。库自身 ESM 加载待核实 |
| ohm-js 17.5 | JS | ✅ | 同 peggy 思路，原生双 ESM，语义规则更灵活，SQL 类示例较少 |
| chevrotain 12 | TS | ❌(Node18) | 最强纯 TS 方案，但 **engines node≥22**，与项目 Node 18 冲突；升 Node 22 后首选 |
| parsimmon 1.18 / nearley | JS | ❌ | parsimmon 官方放弃、无 ESM（dataview 用它是历史包袱）；nearley 停滞 5 年 |
| alasql / sql.js | JS | ❌ | 已有 better-sqlite3，无补充价值 |

- **模块建议**：**自建执行层 + peggy 重写 DQL 文法**——把现 ~70% 手写 tokenizer 升级为声明式完整文法；`obsidian-dataview` 的 `src/query/parse.ts` 仅作 AST 参考实现（**不 install**，合规）；chevrotain 留作 Node 22 升级后选项。
- **合规要点**：绝不把 `obsidian-dataview` 当 npm 依赖（顶层 `require('obsidian')` + Executor 违规）；只读源码学 AST 结构。

## 4. skill 召回

| 库 | 语言 | 能用? | 怎么用 |
|---|---|---|---|
| **fuse.js** v7.x | JS+types | ✅ | **推荐**：`new Fuse(skills,{keys:['name','triggers']}).search(kw)`，一行替手写子串匹配 |
| fuzzysort v3.x | JS | ⚠️ | 极轻(45KB)体验好，但无 `exports`，ESM 接入需 shim |
| match-sorter / leven / fastest-levenshtein | JS | ⚠️/✅ | leven 纯 ESM 可做底层距离工具 |
| string-similarity | JS | ❌ | **已废弃**，勿用 |
| minisearch / @orama/orama / flexsearch | TS/JS | ✅但过重 | skill 数量小(<100)，全文索引性价比低 |
| json5 | JS | ✅ | 已在用；如只需注释可换 jsonc-parser |

- **模块建议**：用 **Fuse.js** 替换手写召回；JSON5 维持现状。

## 5. CLI / config / YAML

| 库 | 语言 | 能用? | 怎么用 |
|---|---|---|---|
| commander v15 | JS/TS | ✅ | 已在用，原生 ESM，**维持** |
| yargs/oclif/cac/citty/clipanion | JS/TS | ✅/⚠️ | 对五子命令无额外收益；clipanion 仅 RC |
| **yaml**(eemeli) v2.x | JS/TS | ✅ | **强烈推荐**：`parse()/stringify()` **一包同治两个 bug**（gray-matter 解析 hack + 手写序列化） |
| js-yaml | JS | ✅ | 备选；让 confbox 内部用即可 |
| **cosmiconfig** v9 | JS/TS | ✅ | 向上查找最成熟：`cosmiconfig('x-basalt').search()`，YAML 需挂 loader，JSON5 需自注册 |
| c12 v3.3.x（勿用 latest=beta） | TS | ⚠️ | confbox 内置 YAML+JSON5+defu 合并，但**不内置向上递归查找** |
| rc / conf | JS/TS | ❌ | rc 仅 CJS；conf 需 Node20 且定位偏 |

- **模块建议**：CLI 维持 commander；**引 `yaml` 包**消除两个序列化 bug；config 用 **cosmiconfig**（向上查找）或 **c12@^3.3.4**（多格式合并），可删自建 config.ts 大半。

## 6. 主线二次核实（关键事实 + 矛盾）

| 项 | 结果 | 备注 |
|---|---|---|
| remark-obsidian-md 许可证 | ⚠️ **manifest license 字段缺失** | 与「MIT」说法矛盾；**选型前查 repo LICENSE 确认**，否则法律风险 |
| remark-obsidian 许可证 | ❌ **GPL-3.0** | 确认警示成立，MIT 项目不可用（传染机制与选库清单见 [`../guides/dependency-license-policy.md`](../guides/dependency-license-policy.md)） |
| better-sqlite3 Node 版本 | 待核实 | mirror 返回旧版(12.4.1，无 engines)；实测依赖 12.11.1，**v12 可能已弃 Node 18** → `pnpm install`(Node18) 验证 |
| chokidar Node 版本 | 待核实 | mirror 返回 4.0.3(node≥14)；实测依赖 5.x，**5.x 可能需 Node 20.19+** → 与 `engines.node>=18` 潜在冲突 |
| chevrotain Node 版本 | ✅ engines node≥22 | 与项目 Node 18 冲突，故 DQL 文法构件改选 peggy/ohm |
| node:sqlite stable | 待核实 | 目前 RC，Node 18 无此模块 |

> **潜在发现**：`package.json` 声明 `engines.node>=18`，但实际依赖 better-sqlite3 12.x / chokidar 5.x 可能均要求 Node 20+。若属实则 engines 声明与依赖不自洽——「做深内核」前应一并校正（或决定升 Node 基线到 20/22，这也会解锁 chevrotain、node:sqlite）。

## 7. 跨模块结论与待核实清单

**结论**：除 **DQL 执行层**（§3，唯一无现成纯 npm 方案、必须自建做深）外，**parser / indexer-SQL / skill / config-YAML 四处都有成熟纯 npm 库可组装**。这与「做深内核冲代表作」一致：解析与周边组装、内核(DQL)自研做深。

**落地前必须复核（不得当事实采用）**：
1. remark-obsidian-md 真实许可证（repo LICENSE）+ callout `+/-`、embed 字段是否满足映射。
2. better-sqlite3 12.x / chokidar 5.x 在 Node 18 下能否安装；据此校正 `engines.node`（或升 Node 基线）。
3. kysely 的 better-sqlite3 dialect 在 ESM/NodeNext 下接线。
4. cosmiconfig/c12、`yaml`、Fuse.js 在 NodeNext 下的 ESM import 行为。
5. DQL：peggy 5.1.0 库自身 ESM 加载方式；从 obsidian-dataview 源码提取 parser 的实际成本（`src/query/parse.ts` 依赖树是否藏 Obsidian 类型）；chevrotain 旧版(v10/v11) 是否支持 Node 18。

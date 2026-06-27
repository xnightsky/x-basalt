# 阶段 1/3/4 下钻：解析组装 · 索引 · skill/CLI · 原子子步

> 日期：2026-06-26 · 父计划：[`2026-06-26-execution-roadmap.md`](2026-06-26-execution-roadmap.md) 阶段 1/3/4
> 真相源：parser→`skills-def/biz-obsidian-spec/SKILL.md`；DQL→另见 [`2026-06-26-dql-kernel-steps.md`](2026-06-26-dql-kernel-steps.md)
> 依据：体检 [`../testing/2026-06-26-audit.md`](../testing/2026-06-26-audit.md)（编号 P*/I*/C*/L*）、库普查 [`../research/2026-06-26-libraries-survey.md`](../research/2026-06-26-libraries-survey.md)

## 子步格式

每步：目标 / 动作 / 验收标准 / 证据命令 / 前置。功能步 **TDD：先写测试(red)→实现(green)**。证据命令以实际输出判定。

---

## 阶段 1 · 解析层改为组装

> 真相源 8 类语法（frontmatter/wikilink/embed/tag/callout/task/highlight/blockRef）+ 边界清单为验收基准。库覆盖 wikilink/embed/callout/highlight，自建收敛 tag/task/blockRef。

- [ ] **M1.1 复核 remark-obsidian-md 许可证 + 能力 spike（卡点）**
  - 动作：查 repo `LICENSE`（manifest 字段缺失）；spike 解析样例确认 wikilink/embed/callout(`+/-`)/highlight 的 AST 字段够映射。
  - 验收：许可证为宽松证 **且** 四类字段满足；否则切单点插件组合（@r4ai/remark-callout + remark-flexible-markers + wiki-link 插件）或保留自建。
  - 证据：贴 LICENSE 结论 + spike AST 输出。前置：阶段 0。

- [ ] **M1.2 unified 管线 + frontmatter + 适配层骨架（red→green）**
  - 动作：先写/保留 `tests/parser.test.ts` 期望（red）；建 `unified().use(remarkParse).use(remarkObsidianMd)`；frontmatter 保留 gray-matter 先剥离（或 remark-frontmatter）；搭 visitor→`ObsidianNode` 骨架。
  - 验收：管线跑通，frontmatter 透传正确；现有 frontmatter 用例绿。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.1。

- [ ] **M1.3 wikilink / embed 映射（red→green）**
  - 动作：映射 `{target,alias?,heading?,blockId?,embed}`；basename 大小写不敏感；同 target 不同 alias 去重（research §3.3）；embed `!` 标 `embed:true`（含资源）。
  - 验收：真相源 §2/§3 全形态用例绿；**P1（wikilink 代码块掩码）由库消除**。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.2。

- [ ] **M1.4 callout 映射 + 修折叠态（P4，含契约决策）**
  - 动作：映射 `{calloutType,title,content}`；**决策并实现 `+`(默认展开)/`-`(默认折叠) 的保留**——把 `foldable:boolean` 改为可表达默认态（如 `fold:"open"|"closed"|null`），同步 `ObsidianNode` 类型 + indexer 消费方。
  - 验收：真相源 §5 + 边界"折叠标记映射"用例绿；`+`/`-`/无 三态可区分。
  - 证据：`pnpm test tests/parser.test.ts`；`pnpm run typecheck`（契约改动）。前置：M1.2。

- [ ] **M1.5 highlight 映射（red→green）**
  - 动作：映射 `{content}`；代码块/行内代码排除（沿用 maskCode）。
  - 验收：真相源 §7 用例绿；代码块内 `==..==` 不提取。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.2。

- [ ] **M1.6 tag 自建收敛（red→green）**
  - 动作：保留自建正则；嵌套全名、排除 `#123`、`#` 前非 word 字符；统一代码块掩码。
  - 验收：真相源 §4 + 边界用例绿；frontmatter tags 不混入行内 tag。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.2。

- [ ] **M1.7 task 自建 + 补 due_date（P3，red→green）**
  - 动作：自定义状态字符保留；**新增 `due_date` 提取 `YYYY-MM-DD`（无则 null）**；代码块掩码统一。
  - 验收：真相源 §6 用例绿；due_date 有/无两用例通过；schema `due_date` 列从此真实填充。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.2。

- [ ] **M1.8 blockRef 自建（red→green）**
  - 动作：行尾 `^id` 定义；区分 `[[#^id]]` 引用；代码块掩码统一（P2）。
  - 验收：真相源 §8 用例绿；定义 vs 引用区分正确。
  - 证据：`pnpm test tests/parser.test.ts`。前置：M1.2。

- [ ] **M1.9 端到端收口 + 清死依赖 + 同步契约**
  - 动作：5 个 fixture 端到端断言全绿；移除被库取代的 `@flowershow/remark-wiki-link`；更新设计 §3.1 偏差标注与覆盖矩阵 parser 行。
  - 验收：`typecheck`/parser 测试全绿；设计文档与代码一致。
  - 证据：`pnpm run typecheck`；`pnpm test tests/parser.test.ts`。前置：M1.3–M1.8。

---

## 阶段 3 · 索引层健壮性 + 现成库收编

- [ ] **M3.1 监听健壮性（I1/I2，red→green）**
  - 动作：补 `watcher.on("error")`；onUnlink 加 `.catch`；加 watch 增量测试（add/change/unlink）。
  - 验收：watcher error 不崩进程；增量测试通过。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：阶段 0。

- [ ] **M3.2 basename 反链歧义修正（I5，red→green）**
  - 动作：加同名异目录 fixture；链接解析改路径感知（优先全路径、回退 basename），修 inlinks JOIN。
  - 验收：`[[A/Note]]` 与 `[[B/Note]]` 不串味；测试通过。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.1。

- [ ] **M3.3 大库稳健性（I3）**
  - 动作：rebuild 改分批/流式写事务（不全量驻留内存）；文件读取加并发上限。
  - 验收：生成数千文件临时 vault rebuild 不 OOM；行数正确。
  - 证据：脚本造临时大 vault → `pnpm cli -- index <tmp>`；行数断言。前置：M3.2。

- [ ] **M3.4 ctime 跨平台口径（I6）**
  - 动作：明确 `file.ctime` 语义（birthtime 优先、回退说明）并在 schema 注释与覆盖矩阵注明跨平台差异。
  - 验收：口径文档化；测试对当前平台行为有断言。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.1。

- [ ] **M3.5 schema 完整性（I8）**
  - 动作：决策并实现——开 `PRAGMA foreign_keys` + 外键约束，或文档化"应用层保证"；统一 INSERT 风格（I9）。
  - 验收：孤儿行策略明确且有测试或文档依据。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.1。

- [ ] **M3.6 引入 kysely 收编 SQL（依赖 DQL 完成）**
  - 动作：DQL→SQL 构造改 kysely（参数化、类型安全），保留 better-sqlite3 执行。
  - 验收：query 全测试不回归；SQL 仍全参数化。
  - 证据：`pnpm test tests/query.test.ts`。前置：DQL S2.24。

- [ ] **M3.7 FTS5 全文检索（可选）**
  - 动作：建 `fts5` 虚拟表；暴露最小检索（CLI 或 DQL 内）。
  - 验收：全文检索命中正确，不破坏现有索引。
  - 证据：`pnpm test tests/indexer.test.ts`。前置：M3.3。

---

## 阶段 4 · skill 召回 + CLI/config 收编

- [x] **M4.1 skill 召回换 Fuse.js（red→green）** ✅ 2026-06-28
  - 动作：补召回质量测试（拼写容错/前缀/相关性排序/垃圾串不放水）；Fuse.js 对 `name`(权重2)+`triggers`(权重1) 建索引替朴素子串，`ignoreLocation` + 阈值 0.4；构造期建一次索引；loader 兜底不变。
  - 验收：拼写近似（wikilnk/callot/frontmater）模糊命中；垃圾串仍空；空目录兜底、现有 skill 测试不回归。
  - 证据：`tests/skill.test.ts`（11 例，新增 4）；全量 144 测试 / typecheck / lint / build 全绿。前置：阶段 0。

- [x] **M4.2 YAML 用 `yaml` 包（C4/C5，red→green）** ✅ 2026-06-28
  - 动作：config 解析改 `yaml.parse`（修 `---` 吞掉 C4）；输出格式化抽到 `src/format.ts` 用 `yaml.stringify`（修键未转义 C5），删 cli.ts 手写 toYaml/yamlScalar/isContainer。gray-matter 仅 parser 仍用，保留依赖。
  - 验收：以 `---` 开头的 config 不丢键；含 `:`/空格/`#` 的键值往返一致；CLI parse --format yaml 冒烟 OK。
  - 证据：`tests/config.test.ts`（+2 C4）、`tests/format.test.ts`（+4 C5/往返）；全量 150 测试全绿。前置：阶段 0。

- [x] **M4.3 config 换 cosmiconfig（L4，red→green）** ✅ 2026-06-28
  - 动作：用 cosmiconfig（`searchStrategy:'project'` + 自定义 searchPlaces/loaders）替自建上溯搜索（删 firstExisting/configAtLevel/findProjectConfig/readConfigFile/parseByExt）；保留项目>全局合并 + 键白名单 + 解析失败降级；loadConfig 加可注入 globalHome 参数便于测全局链。
  - 验收：上溯查找、同目录多格式优先、隐藏目录优先、全局回退+项目覆盖、畸形降级用例全通过。
  - 证据：`tests/config.test.ts`（+2 全局链，共 11 例）；全量 152 测试全绿。前置：M4.2。

- [x] **M4.4 新建 CLI 端到端测试（C1，red→green）** ✅ 2026-06-28
  - 动作：新建 `tests/cli.test.ts`（subprocess 跑 `node --import <tsx绝对URL> src/cli.ts`，避子进程 cwd 找不到 tsx）覆盖 parse/index/query/skill/watch 主路径 + 退出码（非法 DQL/缺 vault/无命中→1）+ flag↔config 优先级链（config format 生效、flag 覆盖、config 提供 vault+db 无参跑通）。watch 用 spawn+killTree 跨平台收尾。
  - 验收：端到端 11 例全绿。
  - 证据：`tests/cli.test.ts`；全量 163 测试 / typecheck / lint / build 全绿。前置：M4.2、M4.3。

- [ ] **M4.5 `--format` 推广 + 非法值处理（C2/C6）**
  - 动作：`--format` 接到 query/skill（不再恒 JSON）；非法 format 报错并退出码 1。
  - 验收：query/skill 的 yaml 输出用例通过；非法 format 退出 1。
  - 证据：`pnpm test tests/cli.test.ts`。前置：M4.4。

- [ ] **M4.6 on-change 防注入（C3）**
  - 动作：`--on-change` 改 `execFile` 参数化或对 `{file}` 做 shell 转义。
  - 验收：含空格/`$`/`;` 的文件名不断词、不注入；触发命令测试通过。
  - 证据：`pnpm test tests/cli.test.ts`。前置：M4.4。

- [ ] **M4.7 错误处理 + 脱敏收尾（C7/C8）**
  - 动作：顶层 catch 用 `err instanceof Error ? ... : String(err)`；按需加最小日志脱敏或在文档登记为"无敏感数据，暂不实现"。
  - 验收：抛非 Error 时输出可读；脱敏决策有记录。
  - 证据：`pnpm test tests/cli.test.ts`。前置：M4.4。

---

## 与父计划衔接

- 本清单替代父路线图阶段 1/3/4 的概览步（更细）；父路线图对应阶段顶部链到本文件。
- M3.6（kysely）依赖 DQL [`2026-06-26-dql-kernel-steps.md`](2026-06-26-dql-kernel-steps.md) S2.24。
- M1.4 涉及 `ObsidianNode` 契约改动（foldable→fold 三态），动前确认 indexer/query 消费方一并改。

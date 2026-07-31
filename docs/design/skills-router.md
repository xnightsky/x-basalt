---
type: spec
title: skills-def 薄入口 + cli/dev 目录分组设计
description: 把外层 x-basalt 入口 skill 改薄为触发+指路（用法导向 skills get core），并将 skills-def 按受众分 cli/(消费侧,装宿主全局) 与 dev/(biz-* 开发侧,装本仓) 的设计与实施记录。
tags:
  - skills-def
  - refactor
  - architecture
  - skill-recall
timestamp: 2026-07-31T04:47:02Z
sha256: 5d638821e6b10f84ca851ee5be216e01c36e236a954ebef163a8b456a81e10d0
---
# skills-def 薄入口 + cli/dev 目录分组（对齐 x-kb 思路）· 设计

> 状态：已实现（分支 `refactor/skills-def-cli-dev-thin-router`，待评审合并） · 日期：2026-07-15 · 参考：`/data/code/public/x-kb`

## 背景与现状

x-basalt 的 skill 分两套（AGENTS.md「Skills 真相源」已述）：

- **产品运行时** `skills-data/*.json5`：`SkillRecall` 加载，`x-basalt skills get/recall/list` 消费。其中 `core.json5`（`name:"core"`）是本 CLI 的**自我说明书**——命令全集、DQL 子集、meta 改写、`run` 管道、chat、配置、限制**已完整覆盖**。`skills-data/x-basalt.json5 → core.json5` 的改名**早已完成**（`loader.ts` 的 `ALWAYS_AVAILABLE = ["obsidian-base-spec","core"]`）。
- **开发侧** `skills-def/<name>/SKILL.md`：由 `install-skills.mjs` 装成 `.claude/skills/` 与 `.agents/skills/` 产物（gitignore）供 AI 运行时发现。当前含：外层入口 `x-basalt`（`scope:global`）+ 三个 `biz-*`（默认 `scope:project`）。

**问题**：外层 `skills-def/x-basalt/SKILL.md` 是一份 **95 行的胖复制**——把命令速查表、`run` 管道、meta、chat、配置、DQL 全抄了一遍，而这些在运行时 `core` 里已是权威正文。这正是 x-kb 明令避免的「二次漂移」（两处各写一份、迟早不一致）。

**x-kb 约定**（`skills-def/cli/x-kb/SKILLS.md`）：外层入口 skill **保留 CLI 名**（`x-kb`）、极薄、只做「触发 + 指路 + `x-kb skills get core`」，并明文禁止把动词表抄进本文；权威正文一律现取 `skills get core`。目录上 x-kb 分 `cli/`（装宿主全局）与 `skills/`（就地消费）两组。

## 目标

1. 外层 `x-basalt` 入口 skill **改薄**为「触发 + 指路」，用法一律导向 `x-basalt skills get core`（**保留 name `x-basalt`**，对齐 x-kb 保留 `x-kb`）。
2. `skills-def/` **目录分组**为 `cli/`（消费侧入口，装宿主全局）与 `dev/`（`biz-*` 开发侧，装本仓）。**刻意不照抄 x-kb 的 `skills/` 名**：x-kb 的 `skills/` 是消费侧领域知识（跨仓消费），而 x-basalt 的三个 `biz-*` 全是「开发本仓自身代码」时召回的开发侧 skill——按受众/去向取名 `cli/`+`dev/` 比 `skills/` 更诚实，也与仓里「开发侧业务 skill」的一贯措辞一致。
3. 修陈旧引用：`docs/guides/ai-and-skills.md` 的 `skills get x-basalt` → `skills get core`。
4. 改薄不丢信息：外层唯一未进 `core` 的 `X_BASALT_DIR` 环境变量，折进 `core.json5` 配置规则。

**非目标**：不动运行时 `skills-data/`（`core` 已改好）；不改 `core.json5` 内容组织（仅补 `X_BASALT_DIR`）；不采用 x-kb 的 `SKILLS.md` 源名约定（x-basalt 一直用 `SKILL.md`，保持不变）；不动历史 spec `docs/specs/2026-06-30-chat-skill-grounding-design.md`（它**记录**了这次改名迁移，是历史真相）。

## 方案

### 1. 目录分组

```
skills-def/
  cli/                         ← 消费侧入口（装宿主全局）
    x-basalt/SKILL.md          ← 由 skills-def/x-basalt/ 移入并改薄
  dev/                         ← 开发侧（写/审 x-basalt 自身代码时召回，装本仓）
    biz-obsidian-spec/SKILL.md ← 由 skills-def/biz-obsidian-spec/ 移入
    biz-dql-subset/SKILL.md
    biz-code-comments/SKILL.md
  README.md · INSTALL.md        ← 更新布局与安装说明
```

用 `git mv` 保留历史。

### 2. install-skills.mjs 改为按目录路由（保留现有两命令 UX）

现状：单层遍历 `skills-def/`，按 frontmatter `scope` 分流（`--global` 装 global、默认装 project）。x-basalt 与 x-kb 的关键差异：**x-kb 的 `skills/` 组不装宿主**（经 kb-routing 就地消费），而 **x-basalt 的 `biz-*` 必须装进本仓 `.claude/skills/`**（否则 Claude Code 发现不到）。故两组都要装，只是改由**目录**而非 `scope` 决定去向：

- `--global`（`skills:install:global`）：源 `skills-def/cli/` → 宿主 `~/.claude/skills/` + `~/.agents/skills/`。
- 默认（`skills:install`）：源 `skills-def/dev/` → 本仓 `.claude/skills/` + `.agents/skills/`。

两组仍各装到 `.claude` 与 `.agents` 两根。`skillScope()` 正则可删（不再靠 frontmatter 分流）；`SKILL.md` 源名不变（无 x-kb 的 SKILLS→SKILL 改名步骤）。`package.json` 的 `skills:install` / `skills:install:global` 两脚本不变，语义映射保持 1:1。

### 3. 薄化后的 `skills-def/cli/x-basalt/SKILL.md`（目标全文）

```markdown
---
name: x-basalt
description: <保留现有触发描述逐字不变>
scope: global
---

# x-basalt：无头 Obsidian vault 工具（CLI）

本文只做「触发 + 指路」——用法真相源不在本文，一律以 `x-basalt skills get core` 现打印为准（随 CLI 版本走，不在此重抄）。

## 怎么用

1. 确认已装：`x-basalt --version`（装不上则按常规方式干活，别强用本 skill）。
2. 动手前先 `x-basalt skills get core`，按它说的做——这是「怎么用 x-basalt」的权威正文：命令全集（parse/index/scan/query/skills/meta/watch/run/chat）、变更编排管道、DQL 子集、可选 AI 的 chat、项目配置。
3. 要精确 Obsidian/DQL 语法与边界：`x-basalt skills get obsidian-base-spec`（取整篇）或 `x-basalt skills recall <关键字>`（如 wikilink/dataview/callout，模糊召回）。

**不要**在本文（或调用方 prompt 里）复制命令表、DQL 细节或选项——一律以 `x-basalt skills get core` 现打印为准，避免二次漂移。
```

`description` frontmatter 逐字保留（它是召回判据，且已含触发语「当任务涉及从命令行读取/查询/改写 Obsidian markdown vault 时使用」）。`scope: global` 保留（虽然新脚本按目录路由，留着无害且语义自证）。

### 4. 陈旧引用与 core 补漏

- `docs/guides/ai-and-skills.md` 第 42 行 `x-basalt skills get x-basalt` → `x-basalt skills get core`。
- `core.json5` 的「项目配置」规则补一句 `X_BASALT_DIR`（指定 `.x-basalt` 基目录，config 与 index.db 都落其下；优先级 flag > `X_BASALT_DIR` > 就近 `.x-basalt/` > 默认）——这是外层胖文本里唯一不在 `core` 的信息，改薄前先补齐。

### 5. 文档登记

- `skills-def/README.md`、`skills-def/INSTALL.md`：更新为 `cli/` + `dev/` 两组布局与「按目录路由」安装说明。
- `AGENTS.md`：§文件树（`skills-def/` 行）与「Skills 真相源」段路径由 `skills-def/<name>/` 改为 `skills-def/{cli,dev}/<name>/`，并登记 `cli/x-basalt` 入口 skill。
- `CHANGELOG.md`：加一条「skills-def 入口薄化 + cli/dev 目录分组」。

## 影响文件清单

| 文件 | 动作 |
| --- | --- |
| `skills-def/x-basalt/` → `skills-def/cli/x-basalt/` | git mv + 改薄 SKILL.md |
| `skills-def/biz-*/` → `skills-def/dev/biz-*/` | git mv（3 个） |
| `scripts/install-skills.mjs` | 改按目录路由 |
| `skills-data/core.json5` | 配置规则补 `X_BASALT_DIR` |
| `docs/guides/ai-and-skills.md` | 修 `skills get x-basalt`→`core` |
| `skills-def/README.md` · `skills-def/INSTALL.md` | 更新布局/安装说明 |
| `AGENTS.md` | 更新 skills-def 路径与登记 |
| `CHANGELOG.md` | 加一条 |

## 验收

- `pnpm run skills:install` 从 `skills-def/dev/` 装出 3 个 `biz-*` 到本仓 `.claude/skills/` 与 `.agents/skills/`。
- `pnpm run skills:install:global` 从 `skills-def/cli/` 装出 `x-basalt` 到 `~/.claude/skills/` 与 `~/.agents/skills/`。
- 薄化后 `cli/x-basalt/SKILL.md` 不含任何命令表/DQL 细节；`x-basalt skills get core` 输出仍是完整用法（含 `X_BASALT_DIR`）。
- `pnpm run test`（547 通过）、`pnpm run lint`、`pnpm run typecheck` 全绿（无测试引用 skills-def，符合预期）。`format:check` 有**预存的仓库级漂移**（16 .ts + 52 .md，与本次无关；pre-push 门禁不含 format:check）——本次所改的 `install-skills.mjs` 已确认 oxfmt-clean。
- 仓库全局 grep 无残留 `skills get x-basalt`（历史 spec 与本设计文档的元引用除外）。
```


---

# 第二轮（2026-07-31）：运行时拆「摘要 + 三篇正文」

> 状态：已实现 · 上一轮解决 **skills-def 侧**（外层入口 skill 的胖复制）；这一轮解决 **skills-data 侧**（运行时说明书只有「全有或全无」两档）。**本轮零代码改动**——`src/` 逐字节不变。

## 问题

上一轮把外层入口改薄成「触发 + 指路 → `skills get core`」后，消费链变成：

```text
20 行触发器  →  ???  →  ~21KB core 全文
```

中间那一格是空的。实测三处症状：

1. **入口即全量**：想改个 frontmatter（真正需要的约 3KB）也得吞 21KB。
2. **`recall` 的返回单位是「整篇」不是「命中段落」**：`skills recall meta` 输出 **30KB**，比 `skills get core` 的 21KB 还多 40%——它把 `core` 与 `obsidian-base-spec` 两篇一起吐了。名字听着精准，实际比直接取全文更贵。
3. **召回的前提是「知道有什么可召回」**（最致命）：不知道 `run --pipe` 存在的 AI 永远不会去 `recall pipeline`，只会逐个文件调 `meta set`。这一条 `recall` 再怎么改都治不好。

对照发现的**可见度不对称**：走 chat 的模型知道有批量能力（`pipeline_run` 的 schema 直接在上下文里，`src/chat/tools.ts`），CLI 直调的 AI 不知道（`run` 排在 core 第 12 条、埋在中间）。同一能力，两条路径可见度差一个数量级——缺的从来不是功能，是**让 CLI 那边也看得见**。

## 决策

### D1 · 摘要独立成篇，且**只有三条 rule**

`summary`（~1.8KB，英文）三条 rule 一一对齐三篇正文：`core` / `pipe` / `chat`。**硬约束是不重抄参数、选项、文法**——任何具体用法一律 `skills get <name>` 现取；一旦超过 ~2KB 就是抄多了，砍回去。

> **失败的第一版留档**：先做过一个 5.5KB 的 `playbook`——按任务组织的路由表，11 条玩法、每条带 examples。它把「常见走错提示」「参数要点」都抄了进去，实质是个**小 core**，而不是摘要。判据很简单：摘要该跟 `AGENTS.local.md` 里手写那段一个量级（十几行），5.5KB 差了三倍以上。已删除。

### D2 · 英文

摘要读者主要是 AI，而命令名 / 算子名 / 字段名本就是英文，中英混排会为同一概念产生两个 token 形态。**正文三篇仍是中文**，人读入口在 `docs/use/`。

### D3 · has-chat / no-chat 不拆两份清单

每条 rule 末尾一句 `chat:` 标明该组在 chat 侧的三态（有同名工具 / 没有 / 明令禁止），两类消费者读同一份各取所需。拆两份 = 同一份能力清单抄两遍，正是这两轮一直在消除的东西。

### D4 · `pipe` 分出，`chat` 分出，`core` 只留指路

- **`pipe` 分**：`run --pipe` 原为单条 2139B，是 `core` 里最大的一条（比第二名多 70%）。「批量改一批文件」与「查」「改单篇」是并列的独立玩法，消费者要么用不到、要么需要完整参数面，没有中间态。
- **`chat` 分**：它讲的是**另一条路径**（工具名、JSON 参数、`AI_GATEWAY`、REPL），CLI 直调场景一个字用不上。
- 两处在 `core` 各留一行指路，不重抄。`core` 由此 21.4KB → **17.0KB**。

### D5 · 召回粒度靠 triggers 分层，不改 Fuse、不切条目

五篇 triggers **刻意不重叠**：总览词→`summary`、管道词→`pipe`、AI 词→`chat`、说明书词→`core`、语法词→`obsidian-base-spec`。`recall` 的返回单位仍是「整篇」，但**那一篇足够小**。为此从 `core` 摘走了 AI 词与管道词。

（`frontmatter` 仍会同时命中 `core` 与 `obsidian-base-spec`——它确实既是 meta 命令话题也是语法话题，两篇都相关，不视为串台。）

### D6 · 摘要是**数据**，不得为它改代码

本轮最重要的自我修正。第一版为了让 `playbook` 好看，加了 `SkillRule.task` 字段、`render.ts` 紧凑渲染分支、`ALWAYS_AVAILABLE` 登记、无参 `skills` 改门面（还是个 breaking）——**全部回滚**。

- `loadDir` 本就读目录下全部 `*.json5`，**新增篇不需要任何登记即可 `get` / `recall`**；`ALWAYS_AVAILABLE` 只管「外部 skillPath shadow 内置」这一个边缘场景，仍保持 `["obsidian-base-spec", "core"]` 两篇。
- 排版靠**数据写法**适配既有渲染：`renderSkill` 的形态是「description 作三级标题、pattern 作副行」，故摘要的 description **首行写短标题、清单跟在其后**（markdown 里只有首行进标题，其余落正文）。
- 无参 `x-basalt skills` 保持 `list` 不变，不引入 breaking。摘要的发现入口就是 `list`（它的 description 自述用途）。

> JSON5 是数据格式：无模板字符串、也不能用 `+` 拼接，多行一律写成单行加 `\n`。第一版两次踩到，`loadDir` 的降级机制（warn + 跳过该文件）正常生效。

## 实测数据

| | 改前 | 改后 |
| --- | --- | --- |
| 入口 | `get core` 21.4KB | `get summary` **1.8KB** |
| `recall 批量` | 落 `core` 全文 | **4.9KB**（只 `pipe`） |
| `recall 配 key` | 落 `core` 全文 | **4.4KB**（只 `chat`） |
| `recall 摘要` | 无此概念 | **1.8KB**（只 `summary`） |
| `skills get core` | 21.4KB | **17.0KB** |
| `src/` 改动 | — | **零** |

## 验收

- `pnpm run typecheck` / `pnpm run lint` 绿；全量 `pnpm test` **1114 通过 / 0 失败**。
- `git diff src/` 相对本轮开始时**无输出**——契约由测试而非代码承载。
- 新增用例 4 条（`tests/skill.test.ts`）：内置五篇齐备、总览词只召回 `summary`、管道/AI/说明书词各归其篇互不串台、`summary` 显著小于任一正文篇（且 < `core`/4）、`summary` 不含具体选项文法（`--refresh-derived` / `GROUP BY` / `if-exists` / `concurrency` / `debounce`）且指向三篇。最后一条是「摘要不许变成第二个 core」的可执行判据。
- 消费侧文档同批更新：`skills-def/cli/x-basalt/SKILL.md`、`docs/use/commands.md`、`docs/use/ai-and-skills.md`、`AGENTS.md`、`CHANGELOG.md`。

## 补充决策（同轮，第二批）

### D7 · 条级召回：`skills get <name> <id>...`

D1–D6 只解决了「篇」的粒度，没解决「篇内」。想要 `core` 里 meta 那一条，仍得吞 17KB 全篇。

给 `SkillRule` 加可选 `id`（kebab-case），`get` 追加变长位置参按 id 取；`skills list <name>` 列出条目 id 供挑选。实测 `get core meta` **2.6KB vs 整篇 17KB**。

**这比拆篇更根本**——有了条级寻址，大篇不必再为了「便宜」而被切碎；`pipe`/`chat` 的分离理由回归到它们本来的样子（语义纯度、另一条路径），而不是「太大」。

两处刻意的设计：

- **未知 id 报错并列出全部可用 id，不静默少给**。静默少给会让调用方以为已经取全——这类错误只会在下游表现为「按不存在的用法行事」，追起来极贵。
- **条目按传入顺序输出**，不按定义顺序重排。调用方写 `get summary chat core` 就是想先看 chat。

这与 D6「摘要是数据不该改代码」不冲突：D6 反对的是**为排版**改渲染器，D7 是**新增一种召回能力**——功能归代码，内容归数据，边界没动。

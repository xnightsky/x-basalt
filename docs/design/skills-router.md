---
type: spec
title: skills-def 薄入口 + cli/dev 目录分组设计
description: 当前 cli/dev 薄入口安装路由、运行时摘要与专项分工、触发分层及条级召回规则；早期目录、失败方案和体积读数另留归档。
tags:
  - skills-def
  - refactor
  - architecture
  - skill-recall
timestamp: 2026-10-02T12:16:54Z
sha256: 9e4a4c3ec7eb47d397e63606f6b7de1ea3461d6d9c4a9fecd86950c66b3e02f0
---
# skills-def 薄入口 + cli/dev 目录分组（对齐 x-kb 思路）· 设计

> 状态：已实现并进入当前仓库；依据为 `scripts/install-skills.mjs`、`skills-def/{cli,dev}/`、`src/skill/` 与 `tests/skill.test.ts`。早期方案、体积读数与实施记录已归档；参考为 x-kb 项目的相应路由约定。

## 背景与现状

开发期源码唯一维护在 `skills-def/{cli,dev}/<name>/SKILL.md`：`cli` 消费入口装宿主全局，`dev` 的 biz-* 装本仓；安装产物不手改。消费入口只触发/指路，先取 summary 挑 core/pipe，用户明确委托才取 chat；正文以产品运行时 `skills-data/*.json5` 为准。目录路由保留两宿主安装及两条既有命令，详情由 `skills-def/README.md` / `INSTALL.md` 维护。旧目录、胖入口与实施过程见[归档](../archive/decisions/2026-07-15-skills-router-record.md#背景与现状)。

## 决策

### D1 · 摘要独立成篇，且**只有三条 rule**

`summary`（英文）三条 rule 一一对齐三篇正文：`core` / `pipe` / `chat`。**硬约束是不重抄参数、选项、文法**——任何具体用法一律 `skills get <name>` 现取；保持显著小于正文，不把旧体积读数当永久大小契约。

### 失败 playbook 记录

本节历史内容已归档，见[原章节](../archive/decisions/2026-07-15-skills-router-record.md#失败-playbook-记录)。当前规则与剩余边界见本文有效章节。

### D2 · 英文

摘要读者主要是 AI，而命令名 / 算子名 / 字段名本就是英文，中英混排会为同一概念产生两个 token 形态。**正文三篇仍是中文**，人读入口在 `docs/use/`。

### D3 · has-chat / no-chat 不拆两份清单

每条 rule 末尾一句 `chat:` 标明该组在 chat 侧的三态（经 cli 可达 / 没有 / 明令禁止），两类消费者读同一份各取所需。拆两份 = 同一份能力清单抄两遍，正是这两轮一直在消除的东西。

### D4 · `pipe` 分出，`chat` 分出，`core` 只留指路

- **`pipe` 分**：`run --pipe` 原为单条 2139B，是 `core` 里最大的一条（比第二名多 70%）。「批量改一批文件」与「查」「改单篇」是并列的独立玩法，消费者要么用不到、要么需要完整参数面，没有中间态。
- **`chat` 分**：它讲的是**另一条路径**（工具名、JSON 参数、`AI_GATEWAY`、REPL），CLI 直调场景一个字用不上。
- 两处在 `core` 各留一行指路，不重抄；2026-07 的体积变化是历史读数，不是当前包大小。

### D5 · 召回粒度靠 triggers 分层，不改 Fuse、不切条目

按话题分层的 triggers 避免一次召回退化为全文堆叠；篇目与分工以 `skills list`、`skills get summary` 和数据为准，不在设计文档复制另一张全量词表。`recall` 的返回单位仍是整篇；条级取用走 D7。

（`frontmatter` 仍会同时命中 `core` 与 `obsidian-base-spec`——它确实既是 meta 命令话题也是语法话题，两篇都相关，不视为串台。）

### D6 · 摘要是**数据**，不得为它改代码

本轮最重要的自我修正。第一版为了让 `playbook` 好看，加了 `SkillRule.task` 字段、`render.ts` 紧凑渲染分支、`ALWAYS_AVAILABLE` 登记、无参 `skills` 改门面（还是个 breaking）——**全部回滚**。

- `loadDir` 本就读目录下全部 `*.json5`，**新增篇不需要任何登记即可 `get` / `recall`**；`ALWAYS_AVAILABLE` 只管「外部 skillPath shadow 内置」这一个边缘场景，仍保持 `["obsidian-base-spec", "core"]` 两篇。
- 排版靠**数据写法**适配既有渲染：`renderSkill` 的形态是「description 作三级标题、pattern 作副行」，故摘要的 description **首行写短标题、清单跟在其后**（markdown 里只有首行进标题，其余落正文）。
- 无参 `x-basalt skills` 保持 `list` 不变，不引入 breaking。摘要的发现入口就是 `list`（它的 description 自述用途）。

> JSON5 是数据格式：无模板字符串、也不能用 `+` 拼接，多行一律写成单行加 `\n`。第一版两次踩到，`loadDir` 的降级机制（warn + 跳过该文件）正常生效。

## 实测数据

本节历史内容已归档，见[原章节](../archive/decisions/2026-07-15-skills-router-record.md#实测数据)。当前规则与剩余边界见本文有效章节。

## 补充决策（同轮，第二批）

### D7 · 条级召回：`skills get <name> <id>...`

D1–D6 只解决了「篇」的粒度，没解决「篇内」。只要某一条却必须取全篇，会产生无关上下文成本（旧体积读数按归档日期阅读）。

给 `SkillRule` 加可选 `id`（kebab-case），`get` 追加变长位置参按 id 取；`skills list <name>` 列出条目 id 供挑选。旧 `get core meta` 体积对照来自 2026-07，条级取用的收益不作为所有模型的质量保证。

**这比拆篇更根本**——有了条级寻址，大篇不必再为了「便宜」而被切碎；`pipe`/`chat` 的分离理由回归到它们本来的样子（语义纯度、另一条路径），而不是「太大」。

两处刻意的设计：

- **未知 id 报错并列出全部可用 id，不静默少给**。静默少给会让调用方以为已经取全——这类错误只会在下游表现为「按不存在的用法行事」，追起来极贵。
- **条目按传入顺序输出**，不按定义顺序重排。调用方写 `get summary chat core` 就是想先看 chat。

这与 D6「摘要是数据不该改代码」不冲突：D6 反对的是**为排版**改渲染器，D7 是**新增一种召回能力**——功能归代码，内容归数据，边界没动。

### D8 · `query --json`（接口一致性）

当前 `query` 已接受 `--json`，与裸调用输出逐字节相同；旧“唯独不接受”是改动动机，不是现状。输出本来就恒为 JSON，接受这个 flag 不改变语义。理由是**可类推性**：消费者（人与 AI）按「其它命令都有它」推断是完全合理的，让每个调用方各撞一次再退回裸调，成本远高于接受一个无副作用的 flag。

回归用例断言 `--json` 与裸调的输出**逐字节相等**，锁住「只对齐接口、不改语义」这条。

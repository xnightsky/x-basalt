# 与 AI 协作：技能召回与全局使用技能

> 本章说明 x-basalt 围绕"技能"的两条功能路径（CLI 自助召回 · 全局使用技能）及其互补，外加可选 AI 的 `chat` 命令（自然语言驱动 vault，见第四节）。
> 索引：[使用指南](usage.md) ｜ 相关章节：[命令参考](commands.md) · [配置](configuration.md) · [故障排查](troubleshooting.md)

---

## 概念速查：三者不要混淆

x-basalt 里有三类带"skill"字样的东西，服务不同消费者：

| 类别 | 文件位置 | 格式 | 消费者 | 安装方式 |
|---|---|---|---|---|
| **CLI 自助召回数据** | `skill-data/*.json5` | JSON5（随包发布） | `x-basalt skills` 命令（get / recall / list / path） | 无需安装，随 CLI 带入 |
| **项目开发技能**（`biz-*`） | `skills-def/biz-*/SKILL.md` | SKILL.md + frontmatter | 在本仓库改代码的 AI 会话 | `pnpm skills:install` → `.claude/skills/` |
| **全局使用技能**（`x-basalt`） | `skills-def/x-basalt/SKILL.md` | SKILL.md + frontmatter，`scope: global` | 任意 AI 会话驱动 x-basalt CLI | `pnpm skills:install:global` → `~/.claude/skills/` |

**关键区别**：`skill-data/*.json5` 是 CLI **运行时读取的规范知识库**，不是 Claude 技能文件；后两者是 Claude Code 技能（SKILL.md），与 CLI 运行无关。CLI 自助（路径①）与全局技能（路径③）功能互补：前者让 CLI **自己能回答规范问题**，后者让 **AI 学会驱动这个 CLI**。

---

## 一、CLI 自助召回（`skills recall` / `skills list`）

### 它是什么

x-basalt 随包内置一个 JSON5 规范知识库（`skill-data/*.json5`），通过 `skills get <name>`（按名取整篇）或 `skills recall <关键字>`（模糊召回）子命令查询。AI 或使用者在不打开任何文档的情况下，直接向 CLI 询问 Obsidian 语法或 DQL 规范的精确细节。

```bash
x-basalt skills get obsidian-base-spec   # 按名取整篇 Obsidian/DQL 规范（最常用）
x-basalt skills get x-basalt        # 取本 CLI 完整用法
x-basalt skills recall wikilink           # 模糊召回（不确定 skill 名时按关键字找）
x-basalt skills recall dataview           # 召回 DQL 子集说明
x-basalt skills list                      # 列出全部 skill（name — description）
x-basalt skills path                      # 打印数据目录
```

完整命令签名见 [commands.md](commands.md)。

### 召回引擎：Fuse.js 模糊匹配

召回不是子串匹配，而是 **Fuse.js 编辑距离模糊匹配**，结果按**相关性降序**排列：

| 参数 | 值 | 作用 |
|---|---|---|
| 匹配字段 | `name`（权重 2）、`triggers`（权重 1） | 名字命中比触发器命中优先 |
| `threshold` | `0.4` | 容许少量拼写偏差，但不放水召回无关规范 |
| `ignoreLocation` | `true` | 关键字落在 triggers 任意位置均可命中 |
| `minMatchCharLength` | `2` | 单字符输入不触发匹配 |

**实际效果**：

```bash
x-basalt skills recall wiklink      # 拼写错一个字母，仍命中 wikilink 规范
x-basalt skills recall xyz123       # 与任何 name/trigger 不沾边 → 返回空，退出码 1
x-basalt skills recall ""           # 空关键字 → 空数组，不报错
```

### 目录解析优先级

CLI 按以下顺序确定从哪个目录加载 JSON5 文件（取第一个命中）：

1. `SkillRecall` 构造参数 `skillPath`（库级 API，命令行未暴露）
2. 环境变量 `OBSIDIAN_SKILL_PATH`
3. `~/.obsidian-core/skills`（目录存在时）
4. 随包内置 `skill-data/`（兜底）

用环境变量指向自定义规范目录：

```bash
OBSIDIAN_SKILL_PATH=./team-skills x-basalt skills recall wikilink
```

也可写进配置文件（`skillPath` 键），免去每次传参，见 [configuration.md](configuration.md)。

### 内置兜底：始终可召回的两条规范

无论外部目录是否存在或为空，以下两条规范**始终可召回**：

| 内置 skill | 触发关键字（示例） | 内容 |
|---|---|---|
| `obsidian-base-spec` | `wikilink` · `tag` · `callout` · `task` · `frontmatter` | Obsidian Markdown 专有语法精确规范 |
| `x-basalt` | `usage` · `help` · `manual` · `说明书` · `parse` · `index` · `query` | 本 CLI 自我说明书（五命令速查 + DQL 要点） |

外部目录若自带同名 skill，优先使用外部版本（允许 shadow 覆盖内置）；外部目录为空/无效时，这两条从内置补回。

### JSON5 文件结构（供自定义扩展参考）

```json5
{
  name: "obsidian-base-spec",          // 唯一标识符（也用于兜底判断）
  triggers: ["wikilink", "tag", "[["], // 模糊匹配的触发词数组
  patterns: ["[[...]]", "#tag"],       // 语法模式速记（展示用）
  rules: [
    {
      pattern: "[[target|alias]]",
      description: "带别名的 wikilink",
      examples: ["[[Note|显示文字]]"]
    }
    // ...
  ],
  metadata: { /* 任意扩展字段 */ }
}
```

最小合法结构：必须有 `name`（字符串）和 `rules`（数组），缺少者被跳过并打印 warn，不中断其余文件加载。

---

## 二、全局使用技能：让任意 AI 会话学会驱动 x-basalt

### 它是什么

`skills-def/x-basalt/SKILL.md` 是一个**标准 Claude Code 技能文件**（frontmatter `scope: global`），内容是"如何用 x-basalt CLI"——命令速查、DQL 子集要点、配置方式、技能召回入口。安装后，任意 AI 会话无需预先了解这个工具，即可正确驱动它。

这与上面的 CLI 自助召回是**互补**关系：
- CLI 自助（`skills recall`）→ AI **在运行时向 CLI 本身询问**精确规范细节
- 全局使用技能 → **AI 自身先具备**驱动 CLI 的基础知识，知道该跑什么命令

### 安装

```bash
# 把 skills-def/x-basalt/ 安装到 ~/.claude/skills/x-basalt/ 和 ~/.agents/skills/x-basalt/（全局，影响所有 AI 会话）
pnpm skills:install:global
```

安装脚本（`scripts/install-skills.mjs`）读取每个 `skills-def/<name>/SKILL.md` 的 frontmatter `scope` 字段分流，并同时装到 `.claude` 与 `.agents` 两个根（兼容不同 AI 运行时的 skill 发现路径）：

| 命令 | 筛选条件 | 安装目标 |
|---|---|---|
| `pnpm skills:install` | `scope != global`（项目开发技能，`biz-*`） | `<仓库根>/.claude/skills/` + `<仓库根>/.agents/skills/` |
| `pnpm skills:install:global` | `scope: global`（全局使用技能） | `~/.claude/skills/` + `~/.agents/skills/` |

这样 `biz-*` 开发技能（改 x-basalt 源码专用）不会污染用户全局 AI 会话；全局使用技能也不会因本仓库开发活动频繁更新而干扰。

### 验证安装

```bash
# 安装后，在任意目录的 AI 会话里确认技能已注册
ls ~/.claude/skills/x-basalt/   # 应包含 SKILL.md
```

安装完成后，Claude 在 AI 会话中识别到 x-basalt 相关任务时，会自动加载该技能（`scope: global` 技能全局可用，无需在项目根目录）。

### 技能内容概览

全局使用技能涵盖：

- **何时用**：从终端 / 脚本 / AI 流程查询 Obsidian vault，不打开 App
- **典型流程**：`index` → `query` → `scan`（按需增量）
- **命令速查表**：`parse` / `index` / `scan` / `query` / `skills recall` / `watch`
- **配置与基目录**：`X_BASALT_DIR`、`skillPath`、配置文件层级
- **DQL 子集要点**：`LIST/TABLE/TASK · FROM · WHERE · SORT · LIMIT` + 隐式字段
- **自引导**：AI 拿到概览后，遇到精确语法/边界问题被指引运行 `x-basalt skills recall <关键字>`，从 CLI 实时获取权威细节，而非依赖可能漂移的静态文档

---

## 三、完整使用示例

### 场景 A：CLI 直接召回规范（无需 AI）

```bash
# 查询所有可用规范
x-basalt skills list

# 召回 wikilink 完整规范（含 patterns + rules + examples）
x-basalt skills recall wikilink

# 拼写容错（编辑距离内仍命中）
x-basalt skills recall callout      # 精确
x-basalt skills recall calout       # 少写一个 l，仍命中

# 召回 DQL 语法（触发器 "dataview"/"dql"/"query" 均命中）
x-basalt skills recall dql

# 让 CLI 解释自己（自我说明书）
x-basalt skills recall usage
```

### 场景 B：AI 会话驱动 x-basalt（需先装全局技能）

```bash
# 一次性安装（只需执行一次，全局生效）
pnpm skills:install:global

# 之后在任意 AI 会话里，直接指示 AI 操作 vault，无需额外说明
# AI 会根据全局技能自动知道该调用哪些 x-basalt 命令
```

### 场景 C：自定义规范目录

```bash
# 团队共享的规范知识库，覆盖内置（同名 skill 优先用外部版本）
export OBSIDIAN_SKILL_PATH=./team-skills
x-basalt skills list

# 或写进配置文件（见 configuration.md），免去环境变量
```

---

## 四、CLI chat：自然语言驱动 vault（可选 AI · 默认关）

### 它是什么

`x-basalt chat` 用自然语言驱动**既有原语**（query/parse/scan/meta/skills + 写动作 + 编排器批量）：一圈薄 LLM 循环（plan→act→observe），把你的话翻成命令、执行、把结果喂回、续推。两形态：

```bash
x-basalt chat "把 projects/ 下 status 为空的笔记列出来"   # 单发：翻译→执行→输出→退出
x-basalt chat "给 2024 年的周报都补上 tag weekly"          # 含写动作（直接落盘，见下）
x-basalt chat                                              # 进 REPL，连续提问，quit/exit/q 退出
```

> **最小可选 AI（不可协商）**：chat 是唯一触达 LLM 的命令，隔离在 `src/chat/`、依赖懒加载（`ai`/`@ai-sdk/*` 列 `optionalDependencies`）。**内核（parse/index/scan/query/meta/skill）永远零 AI、纯离线**。没配 key = chat 不可用，但**其余命令全功能照常**。

### 配置 provider（兼容 agent-browser 的 `AI_GATEWAY_*`）

```bash
export AI_GATEWAY_API_KEY=gw_xxx                            # 必填：配了才启用 chat；不配 = 命令禁用
export AI_GATEWAY_MODEL=anthropic/claude-sonnet-4.6         # 可选，默认值（网关 provider/model slug）
export AI_GATEWAY_URL=https://ai-gateway.vercel.sh          # 可选，默认 Vercel AI Gateway
x-basalt chat --model anthropic/claude-opus-4.8 "..."       # --model 覆盖默认模型
```

- **没配 `AI_GATEWAY_API_KEY`** → chat 打印「未配置 AI」+ 本文指引后退出（码非 0），**绝不崩、绝不影响其他命令**。
- **离线/本地模型**：把 `AI_GATEWAY_URL` 指向本地 OpenAI 兼容端点（Ollama / llama.cpp），可让可选 AI 也全程不出本地、不联网——与项目离线身份对齐。

### 写动作：直接执行 + Ctrl+C 兜底

chat 既能读也能改 vault。**写动作直接落盘，没有逐个确认弹窗**（你主动开 chat 即视为知情）。安全靠四道兜底：

1. **流式可观测**：模型推理与每一步动作实时回显——看到要改的不对，立刻按 **Ctrl+C** 中断。
2. **原子写**：所有写经 `src/meta` 原子写（临时文件 + rename），中途 kill 不会留下半写损坏的文件。
3. **批量先看报告**：`pipeline_run` 批量写会回显「N 文件 / M 改动」报告，面太大就刹车。
4. **git 兜底**：vault 在 git 下时，误改可回滚。

> 想要"只看不改"，目前用读命令（`query`/`meta get`）或直接对模型说"只列出来、先别改"。

### 工具面（chat 能调的既有能力）

| 类 | 工具 | 对应命令 |
|---|---|---|
| 读 | query / parse / scan / meta_get / skills_recall | `query` / `parse` / `scan` / `meta get` / `skills recall` |
| 写·单文件 | meta_set / meta_unset / meta_rename / meta_normalize / meta_apply | `meta set/unset/rename/normalize/apply` |
| 写·批量 | pipeline_run | `run --pipe` / `scan --pipe`（一次性，不含常驻 watch） |

> **能力边界**：当前 chat 做**结构化**任务（DQL/元数据/规范）。"按笔记**正文内容**找"依赖全文检索（FTS5，规划中），尚未落地——让它"找讲 X 的笔记"时它只能靠结构化字段，不能搜正文。

---

## 关系总结

```
skill-data/*.json5          ← CLI 自助召回数据（随包，运行时读）
        ↑
  x-basalt skills recall <kw>   ← 使用者 / AI 在终端询问
  x-basalt skills list

skills-def/x-basalt/    ← 全局 Claude 技能（教 AI 用这个 CLI）
        ↓
  pnpm skills:install:global → ~/.claude/skills/x-basalt/ + ~/.agents/skills/x-basalt/
        ↓
  AI 会话自动加载 → 知道跑什么命令，遇细节再 skills recall

skills-def/biz-*/       ← 项目开发技能（改 x-basalt 源码专用）
        ↓
  pnpm skills:install → .claude/skills/ + .agents/skills/（仅仓库内会话）
```

---

> 本章节对应的"CLI 自助召回"完整命令签名见 [commands.md](commands.md)；与配置文件结合使用（`skillPath`）见 [configuration.md](configuration.md)；Obsidian 语法规范细节以 `x-basalt skills recall <关键字>` 结果为准（精确，随 CLI 版本更新），也可参阅 [obsidian-syntax.md](obsidian-syntax.md)。

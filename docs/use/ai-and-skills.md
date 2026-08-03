---
timestamp: 2026-07-31T04:18:48Z
sha256: 9b2d245a3ddfd9965578c572a5273e5efeee288b1826d419f74fdd0185ad569d
type: guide
title: 与 AI 协作：技能召回与全局使用技能
description: x-basalt 技能召回两条路径（CLI 自助 recall 与全局 SKILL.md）及可选 chat 命令说明
tags:
  - guide
  - ai
  - skills
  - x-basalt
---
# 与 AI 协作：技能召回与全局使用技能

> 本章说明 x-basalt 围绕"技能"的两条功能路径（CLI 自助召回 · 全局使用技能）及其互补，外加可选 AI 的 `chat` 命令（自然语言驱动 vault，见第四节）。
> 索引：[使用指南](README.md) ｜ 相关章节：[命令参考](commands.md) · [配置](config.md) · [故障排查](troubleshooting.md)

---

## 概念速查：三者不要混淆

x-basalt 里有三类带"skill"字样的东西，服务不同消费者：

| 类别                           | 文件位置                       | 格式                                    | 消费者                                               | 安装方式                                           |
| ------------------------------ | ------------------------------ | --------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| **CLI 自助召回数据**           | `skills-data/*.json5`           | JSON5（随包发布）                       | `x-basalt skills` 命令（get / recall / list / path） | 无需安装，随 CLI 带入                              |
| **项目开发技能**（`biz-*`）    | `skills-def/dev/biz-*/SKILL.md`    | SKILL.md + frontmatter                  | 在本仓库改代码的 AI 会话                             | `pnpm skills:install` → `.claude/skills/`          |
| **全局使用技能**（`x-basalt`） | `skills-def/cli/x-basalt/SKILL.md` | SKILL.md + frontmatter，`scope: global` | 任意 AI 会话驱动 x-basalt CLI                        | `pnpm skills:install:global` → `~/.claude/skills/` |

**关键区别**：`skills-data/*.json5` 是 CLI **运行时读取的规范知识库**，不是 Claude 技能文件；后两者是 Claude Code 技能（SKILL.md），与 CLI 运行无关。CLI 自助（路径①）与全局技能（路径③）功能互补：前者让 CLI **自己能回答规范问题**，后者让 **AI 学会驱动这个 CLI**。

---

## 一、CLI 自助召回（`skills recall` / `skills list`）

### 它是什么

x-basalt 随包内置一个 JSON5 规范知识库（`skills-data/*.json5`），通过 `skills get <name>`（按名取整篇）或 `skills recall <关键字>`（模糊召回）子命令查询。AI 或使用者在不打开任何文档的情况下，直接向 CLI 询问 Obsidian 语法或 DQL 规范的精确细节。

```bash
x-basalt skills get summary              # 第一步：能干什么、该看哪篇（~1.8KB，英文）
x-basalt skills get core                 # 查与改：命令全集、DQL、meta 写侧、配置
x-basalt skills get pipe                 # 批量：--pipe 参数面、三种源、算子链
x-basalt skills get chat                 # 自然语言路径：工具清单、配 key、chat 侧禁止项
x-basalt skills get obsidian-base-spec   # 按名取整篇 Obsidian/DQL 规范
x-basalt skills recall wikilink          # 模糊召回（不确定 skill 名时按关键字找）
x-basalt skills recall 批量              # 管道词只召回 pipe，不带出 core 全文
x-basalt skills list                     # 列出全部 skill（name — description）
x-basalt skills path                     # 打印数据目录
```

**先 `get summary` 再按需深入**：摘要回答「能干什么、这件事去哪篇看」（约 1.8KB），正文回答「怎么用」。一上来取 `core` 等于为选一个方向付十倍代价——最典型的漏项是批量：改动超过一个文件应走 `run --pipe`（`skills get pipe`），而不是循环调 `meta set`。

完整命令签名见 [commands.md](commands.md)。

### 召回引擎：Fuse.js 模糊匹配

召回不是子串匹配，而是 **Fuse.js 编辑距离模糊匹配**，结果按**相关性降序**排列：

| 参数                 | 值                                     | 作用                                   |
| -------------------- | -------------------------------------- | -------------------------------------- |
| 匹配字段             | `name`（权重 2）、`triggers`（权重 1） | 名字命中比触发器命中优先               |
| `threshold`          | `0.4`                                  | 容许少量拼写偏差，但不放水召回无关规范 |
| `ignoreLocation`     | `true`                                 | 关键字落在 triggers 任意位置均可命中   |
| `minMatchCharLength` | `2`                                    | 单字符输入不触发匹配                   |

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
4. 随包内置 `skills-data/`（兜底）

用环境变量指向自定义规范目录：

```bash
OBSIDIAN_SKILL_PATH=./team-skills x-basalt skills recall wikilink
```

也可写进配置文件（`skillPath` 键），免去每次传参，见 [configuration.md](config.md)。

### 内置五篇与 triggers 分层

内置目录随包发布五篇，触发关键字**刻意不重叠**——一个关键字只召回对应那一篇，不会一次吐出多篇全文：

| 内置 skill           | 回答什么               | 触发关键字（示例）                                                  | 体量    |
| -------------------- | ---------------------- | ------------------------------------------------------------------- | ------- |
| `summary`            | **能干什么、该看哪篇** | `摘要` · `总览` · `能干什么` · `overview` · `capabilities`          | ~1.8 KB |
| `core`               | 查与改**怎么用**       | `usage` · `help` · `manual` · `说明书` · `用法` · `parse` · `query` | ~17 KB  |
| `pipe`               | 批量**怎么用**         | `批量` · `管道` · `算子` · `run` · `pipeline` · `step`              | ~5 KB   |
| `chat`               | 自然语言路径           | `chat` · `ai` · `自然语言` · `配 key` · `ollama` · `model`          | ~4 KB   |
| `obsidian-base-spec` | Obsidian/DQL 语法      | `wikilink` · `tag` · `callout` · `task` · `frontmatter`             | ~9 KB   |

这套分层是**召回粒度的实现方式**：`recall` 的返回单位是「整篇」而非「命中的段落」，所以让每篇足够小、且 triggers 各管一路，比切碎条目或改召回引擎都简单。总览词一律归 `summary`——1.8 KB 的入口，比一上来吞 `core` 便宜一个数量级。

**兜底**：外部目录若自带同名 skill，优先使用外部版本（允许 shadow 覆盖内置）；外部目录为空/无效时，`obsidian-base-spec` 与 `core` 这两篇从内置补回，保证基础召回与「CLI 会讲自己的用法」永远可用。其余三篇在内置目录下自动加载，但不进兜底名单——用外部目录 shadow 时需自行提供。

### JSON5 文件结构（供自定义扩展参考）

```json5
{
  name: "obsidian-base-spec", // 唯一标识符（也用于兜底判断）
  triggers: ["wikilink", "tag", "[["], // 模糊匹配的触发词数组
  patterns: ["[[...]]", "#tag"], // 语法模式速记（展示用）
  rules: [
    {
      pattern: "[[target|alias]]",
      description: "带别名的 wikilink",
      examples: ["[[Note|显示文字]]"],
    },
    // ...
  ],
  metadata: {
    /* 任意扩展字段 */
  },
}
```

最小合法结构：必须有 `name`（字符串）和 `rules`（数组），缺少者被跳过并打印 warn，不中断其余文件加载。

---

## 二、全局使用技能：让任意 AI 会话学会驱动 x-basalt

### 它是什么

`skills-def/cli/x-basalt/SKILL.md` 是一个**标准 Claude Code 技能文件**（frontmatter `scope: global`）。它**只做「触发 + 指路」**（约 20 行）——不含命令表、DQL 细节或选项说明，一律指向 `x-basalt skills` 系列现打印的内容。安装后，任意 AI 会话无需预先了解这个工具，即可知道「有这么个 CLI、该去哪问用法」。

> **为什么这么薄**：命令表若在 SKILL.md 里抄一份，CLI 升级后它不会跟着变，迟早与运行时说明书不一致（二次漂移）。决策见 [`docs/design/skills-router.md`](../design/skills-router.md)。

这与上面的 CLI 自助召回是**互补**关系：

- CLI 自助（`skills recall`）→ AI **在运行时向 CLI 本身询问**精确规范细节
- 全局使用技能 → **AI 自身先具备**驱动 CLI 的基础知识，知道该跑什么命令

### 安装

```bash
# 把 skills-def/cli/x-basalt/ 安装到 ~/.claude/skills/x-basalt/ 和 ~/.agents/skills/x-basalt/（全局，影响所有 AI 会话）
pnpm skills:install:global
```

安装脚本（`scripts/install-skills.mjs`）**按 `skills-def/` 下的目录分组分流**（`cli/` 与 `dev/`，目录即分流依据），并同时装到 `.claude` 与 `.agents` 两个根（兼容不同 AI 运行时的 skill 发现路径）：

| 命令                         | 装哪一组                                    | 安装目标                                                |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `pnpm skills:install`        | `skills-def/dev/`（项目开发技能，`biz-*`）  | `<仓库根>/.claude/skills/` + `<仓库根>/.agents/skills/` |
| `pnpm skills:install:global` | `skills-def/cli/`（消费侧入口，`x-basalt`） | `~/.claude/skills/` + `~/.agents/skills/`               |

这样 `biz-*` 开发技能（改 x-basalt 源码专用）不会污染用户全局 AI 会话；全局使用技能也不会因本仓库开发活动频繁更新而干扰。

### 验证安装

```bash
# 安装后，在任意目录的 AI 会话里确认技能已注册
ls ~/.claude/skills/x-basalt/   # 应包含 SKILL.md
```

安装完成后，Claude 在 AI 会话中识别到 x-basalt 相关任务时，会自动加载该技能（`scope: global` 技能全局可用，无需在项目根目录）。

### 技能内容概览

薄入口只有四件事，**没有命令表**：

- **何时用**：从终端 / 脚本 / AI 流程操作 Obsidian vault，不打开 App
- **先探测再用**：`x-basalt --version`，装不上就按常规方式干活，别强用
- **指路顺序**：`skills get summary` 挑一组（~1.8KB）→ `skills get core|pipe|chat` 取那一篇正文 → `skills get obsidian-base-spec` 要精确文法
- **免配直调**：`X_BASALT_DIR` 或就近配置已设 `vault` 时，站 repo 根直接跑即可，**不要去定位或 `cat` 配置文件，也不要手传 `--vault`/`--db`**

**自引导**才是重点：AI 拿到的不是一份静态速查表，而是「去问 CLI 本身」的指令——用法随 CLI 版本走，静态文档不会漂移，因为它压根不承载用法。

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

### 配置（`AI_GATEWAY_*` 环境变量 · 各平台设法与持久化）

三个环境变量，**完全兼容 agent-browser**（已为 agent-browser 配过的可直接复用同一份）：

| 变量                 | 必填 | 默认                              | 说明                                                                                                                                                                                                         |
| -------------------- | ---- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_GATEWAY_API_KEY` | 是   | —                                 | 网关 key；**不配 = chat 禁用**（其他命令照常）                                                                                                                                                               |
| `AI_GATEWAY_MODEL`   | 否   | `anthropic/claude-sonnet-4.6`     | provider/model slug；`--model <name>` 可覆盖                                                                                                                                                                 |
| `AI_GATEWAY_URL`     | 否   | `https://ai-gateway.vercel.sh/v1` | **OpenAI 兼容端点的 base**（底层 POST `<URL>/chat/completions`）。默认值只为零配置 + 兼容 agent-browser，不是要你用 Vercel——**可改指任意 OpenAI 兼容端点**：DeepSeek、本地 Ollama/llama.cpp、自建/第三方网关 |

没配 `AI_GATEWAY_API_KEY` → chat 打印「未配置 AI」+ 本文指引后退出（码非 0），**绝不崩、绝不影响其他命令**。

> ⚠️ **`AI_GATEWAY_URL` 与 `AI_GATEWAY_MODEL` 必须按 provider 配对**——改了端点就要把模型名换成该端点认的名字（默认 `anthropic/claude-sonnet-4.6` 是 Vercel 网关的 slug，DeepSeek/Ollama 不认）：

| 用谁                      | `AI_GATEWAY_URL`                         | `AI_GATEWAY_MODEL`（示例）                       |
| ------------------------- | ---------------------------------------- | ------------------------------------------------ |
| Vercel AI Gateway（默认） | 留空 / `https://ai-gateway.vercel.sh/v1` | `anthropic/claude-sonnet-4.6`、`openai/gpt-5.5`… |
| DeepSeek 官方             | `https://api.deepseek.com`（SDK 自动补 `/chat/completions`） | `deepseek-v4-flash` 等（**以 DeepSeek 官方模型列表为准**；旧 `deepseek-chat`/`deepseek-reasoner` 已更替） |
| 本地 Ollama               | `http://localhost:11434/v1`              | `llama3.1`、`qwen2.5`…（已 `ollama pull` 的）    |

> 之前若报 `404 .../language-model`，是旧实现错用了 Vercel 私有网关协议；现已改为标准 OpenAI 兼容协议（`/chat/completions`），DeepSeek/Ollama 等直连即可。

#### 示例：用 DeepSeek v4 flash 驱动 chat

三个环境变量脱敏后填自己的 key（Linux/macOS）：

```bash
export AI_GATEWAY_URL="https://api.deepseek.com"   # 底层 POST <URL>/chat/completions；SDK 只去尾部 / 、不动 /v1
export AI_GATEWAY_MODEL="deepseek-v4-flash"         # DeepSeek 端点的裸模型名，以官方模型列表为准（会随版本更新）
export AI_GATEWAY_API_KEY="sk-xxxx"                 # DeepSeek 平台申请的 key（脱敏，换成自己的）
x-basalt chat                                       # 进交互；一次性：x-basalt chat "有多少篇笔记没有 index？"
```

- **URL 别自己加 `/chat/completions`**——`@ai-sdk/openai-compatible@3.x` 会拼。它只 `withoutTrailingSlash`（去掉末尾 `/`）后接 `/chat/completions`，**不会吃掉 `/v1`**：写 `https://api.deepseek.com` → `…/chat/completions`，写 `https://api.deepseek.com/v1` → `…/v1/chat/completions`，DeepSeek 两者都认，推荐前者（更短）。
- **模型名是裸名**（`deepseek-v4-flash`），无 `provider/` 前缀——这跟 Vercel 网关的 `anthropic/claude-sonnet-4.6` slug 不同；改端点必换模型名，否则报错。`x-basalt chat --model deepseek-v4-flash` 可临时覆盖 `AI_GATEWAY_MODEL`。
- 没配 `AI_GATEWAY_API_KEY` → chat 打印「未配置 AI」后退出（码非 0），其他命令照常。
- Windows 的临时设 / 持久化写法见下两节（把示例里的 `AI_GATEWAY_API_KEY` 三个变量一并配上即可）。

#### 当前会话临时设（先验证能跑通）

| 平台 / shell              | 设置                               |
| ------------------------- | ---------------------------------- |
| Linux / macOS（bash/zsh） | `export AI_GATEWAY_API_KEY=gw_xxx` |
| Windows PowerShell        | `$env:AI_GATEWAY_API_KEY="gw_xxx"` |
| Windows cmd               | `set AI_GATEWAY_API_KEY=gw_xxx`    |

#### 持久化（每次开终端都生效）

- **Linux / macOS**：写进 shell 启动文件——bash 用 `~/.bashrc`、zsh 用 `~/.zshrc`（登录级可用 `~/.profile` / zsh 的 `~/.zshenv`）：
  ```bash
  echo 'export AI_GATEWAY_API_KEY=gw_xxx' >> ~/.bashrc   # zsh 改 ~/.zshrc；重开终端或 source 后生效
  ```
- **Windows**，三选一：
  1. **PowerShell profile**（≈ `.bashrc`，每次开 PowerShell 会话自动跑）。文件路径就是内置变量 `$PROFILE`（PowerShell 7 通常是用户主目录下 `Documents\PowerShell\Microsoft.PowerShell_profile.ps1`；用 `echo $PROFILE` 查看实际路径，不存在就新建）。追加一行：
     ```powershell
     Add-Content -Path $PROFILE -Value '$env:AI_GATEWAY_API_KEY = "gw_xxx"'   # 新开 PowerShell 即生效
     ```
  2. **`setx`**（持久到「用户环境变量」，对**所有新进程**生效，不限 PowerShell；写入注册表 `HKCU\Environment`）：
     ```powershell
     setx AI_GATEWAY_API_KEY gw_xxx     # 注意：只对之后新开的终端/进程生效，当前会话不变
     ```
  3. **系统 GUI**：`Win+R` 运行 `rundll32 sysdm.cpl,EditEnvironmentVariables` → 在「用户变量」新建 `AI_GATEWAY_API_KEY`。

> **离线/本地模型**：把 `AI_GATEWAY_URL` 指向本地 OpenAI 兼容端点（如 Ollama 的 `http://localhost:11434/v1`），让可选 AI 也全程不出本地、不联网——与项目离线身份对齐。
> **安全**：key 是密钥，别提交进 git、别写入入仓文件；运行期日志会脱敏。

### 写动作：直接执行 + Ctrl+C 兜底

chat 既能读也能改 vault。**写动作直接落盘，没有逐个确认弹窗**（你主动开 chat 即视为知情）。安全靠四道兜底：

1. **流式可观测**：模型推理与每一步动作实时回显——看到要改的不对，立刻按 **Ctrl+C** 中断。
2. **原子写**：所有写经 `src/meta` 原子写（临时文件 + rename），中途 kill 不会留下半写损坏的文件。
3. **批量先看报告**：`cli run` 批量写会回显「N 文件 / M 改动」报告，面太大就刹车。
4. **git 兜底**：vault 在 git 下时，误改可回滚。

> 想要"只看不改"，目前用读命令（`query`/`meta get`）或直接对模型说"只列出来、先别改"。

### 工具面（chat 能调的既有能力）

切 C 后（2026-08-03）chat 工具面收编为**单一 `cli` 工具** + 两个规范召回元工具：

| 工具 | 形态 | 说明 |
| ---- | ---- | ---- |
| `cli` | `{args: string[], source?}` | 唯一执行口：argv 数组直传 CLI 子命令（parse/index/scan/query/search/base/skills/meta/run/links/lint；watch/chat 禁止） |
| `skills_recall` | `{keyword}` | 模糊召回规范 |
| `skills_get` | `{name}` | 按名取规范全文 |

> **不支持常驻 watch / 监听**：`cli` 的 allowlist 结构性排除 `watch` / `chat`（常驻进程永不返回会挂死循环；chat 是 AI 递归入口）。要持续监听维护 vault，请用独立的 `x-basalt watch` 或 `x-basalt scan --pipe`（见 [indexing-and-sync.md](indexing.md)），不要走 chat。

> **能力边界**：chat 做**结构化**任务（DQL/元数据/规范）**与正文全文检索**。「按笔记正文内容找」走 `search`（FTS5 + trigram，**已落地**），所以「找讲 X 的笔记」是可以的；但它是**字面子串**匹配、**非语义/向量检索**，不理解同义词与概念相关性。含中文的查询走 trigram 并集 OR 宽松召回，`total` 是召回数而非「确实含这一串的篇数」——口径详见 [命令参考 `search`](commands.md#search--全文检索正文)。

---

## 关系总结

```
skills-data/*.json5          ← CLI 自助召回数据（随包，运行时读）
        ↑
  x-basalt skills recall <kw>   ← 使用者 / AI 在终端询问
  x-basalt skills list

skills-def/cli/x-basalt/  ← 全局 Claude 技能（教 AI 用这个 CLI）
        ↓
  pnpm skills:install:global → ~/.claude/skills/x-basalt/ + ~/.agents/skills/x-basalt/
        ↓
  AI 会话自动加载 → 知道跑什么命令，遇细节再 skills recall

skills-def/dev/biz-*/     ← 项目开发技能（改 x-basalt 源码专用）
        ↓
  pnpm skills:install → .claude/skills/ + .agents/skills/（仅仓库内会话）
```

---

> 本章节对应的"CLI 自助召回"完整命令签名见 [commands.md](commands.md)；与配置文件结合使用（`skillPath`）见 [configuration.md](config.md)；Obsidian 语法规范细节以 `x-basalt skills recall <关键字>` 结果为准（精确，随 CLI 版本更新），也可参阅 [obsidian-syntax.md](obsidian-syntax.md)。

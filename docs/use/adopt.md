---
type: guide
title: 在你自己的仓库里接入 x-basalt
description: 在自己项目的 AI 提示词里该写什么：一句话点名 skills get summary，不重抄命令表与配置路径
tags:
  - guide
  - adoption
  - ai
  - x-basalt
timestamp: 2026-07-31T07:58:32Z
sha256: be90c21bf3b115a2fff70aba35d5c49247a98c0700debb181b56b60409393cdc
---
# 在你自己的仓库里接入

← [使用指南索引](README.md)

你有一个项目，里面有一批 markdown（`docs/`、`notes/`、wiki 之类），想让 AI 助手用 x-basalt 去维护它们。
问题是：**该在项目的 AI 提示词里写什么？**

答案很短——**一句话，点名一条命令**：

```markdown
维护本仓 `docs/`（Obsidian 知识库）的索引 / 查询 / frontmatter 元数据时，
用全局已装的 **x-basalt**——**动手前先跑 `x-basalt skills get summary`**，
它会讲清能干什么、该看哪篇。本文不重抄任何用法。
```

放进 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` 等你的助手会读的文件即可。三个要素：

1. **场景**——什么时候该想起这个工具（维护哪个目录的什么东西）
2. **命令**——`x-basalt skills get summary`，一条，写死
3. **目的**——它会讲清能干什么、该看哪篇

## 为什么必须点名命令

**只描述不点名是无效的。** 实测中，写成这样的提示词不会被执行：

```markdown
用法不在本文——x-basalt 会讲自己的用法，动手前先问它。   ❌
```

助手读到了，但不会把「问它」翻译成 `skills get summary`；它会转头跑 `--help`，看到一张命令表，
然后**一个文件一个文件地改**——本该一条 `run --pipe` 解决的批量任务，跑了六次 `meta set`。

换成点名命令的版本，同一个助手同一个任务：先取摘要 → 按摘要选中批量 → 一条命令改完。

**指路必须落到具体命令上，「它会讲自己的用法」这种话等于没说。**

## 不要写什么

### ❌ 命令表

```markdown
- 建/更新索引：`x-basalt index`；增量重扫：`x-basalt scan`
- 查询：`x-basalt query 'LIST FROM "" WHERE type = "research"'`
- frontmatter：`x-basalt meta get <file>` / `meta set <file> <k> <v>`
- 查看自身功能说明：`x-basalt skills get x-basalt`
```

抄一份，就多一处会漂移的副本。上面最后那条是真实案例——它在某个项目的规则文件里躺了一段时间，
而那个 skill 早已改名，实际跑起来是 `✗ 未找到名为 "x-basalt" 的 skill`。
**规则文件不会因为 CLI 升级而自动更新，但 `skills get` 打印的内容会。**

### ❌ 配置路径与参数

```markdown
- 配置：`.tmp/.x-basalt/config.yaml`，由 `X_BASALT_DIR` 重定向
- vault：`./docs`
```

不只是会漂——它还是**反向引导**。配好之后站在仓库根直接跑就行，CLI 自己解析 vault 与索引库；
把配置路径写进提示词，等于暗示助手「你需要关心这个」，于是它真的会去 `cat` 配置文件、
再手动拼 `--vault` / `--db`，全是白做的步骤。

### ❌ 使用要点与常见坑

「改动超过一个文件要走批量」「`query` 查不了正文」这类**确实重要**的提醒，也不要写在你的提示词里——
它们已经在 `summary` 与各篇正文里，且随版本更新。你写一遍，就得自己负责维护一遍。

## 只保留机器讲不出来的

一句话概括：**凡是 `x-basalt skills get summary` 会讲的，都别写；它讲不了的，才写。**

它讲不了的通常只有两类：

- **本仓的选择**——用哪个目录当知识库、哪批文档归它管、什么时候该想起它
- **你的边界**——比如「这是个人工具，不要写进业务代码」这种只有你知道的约束

## 装不装全局 skill 都行

如果你的助手支持 skill 机制（如 Claude Code），可以装一份全局入口：

```bash
pnpm run skills:install:global   # → ~/.claude/skills/ 与 ~/.agents/skills/
```

它同样只做「触发 + 指路」，不含命令表。**装了之后仓内提示词仍然建议保留那一句**——
两者不冲突，且仓内那句还承载「本仓用它管哪个目录」这个只有你知道的信息。

反过来，**不装也够用**：实测中只靠仓内一句点名命令的提示词、完全不借全局 skill，助手同样能正确取到摘要、
选对命令、完成批量任务。全局 skill 是便利，不是前提。

> 这条「不装也够用」的证据强度有限：只在**一个模型**上验证过。原因是要摘掉宿主全局 skill 需要助手支持
> 对应开关，而并非每家 CLI 都有。「点名命令有效、只描述无效」这条则在多个模型上一致复现。

## 怎么确认接对了

```bash
cd 你的仓库根
x-basalt query 'LIST FROM ""' --size 0     # 零参数能出 total，说明 vault 与索引配置已就位
x-basalt skills get summary                 # 能打印摘要，说明助手照着提示词跑得通
```

第一条如果报错，是配置问题 → [配置](config.md)；
第二条正常但助手仍然不去调用，检查提示词里是不是**没点名命令**。

---

配置本身怎么弄 → [配置](config.md)｜助手接入 x-basalt 的机制细节 → [与 AI 协作](ai-and-skills.md)｜按任务选命令 → [玩法](playbooks.md)

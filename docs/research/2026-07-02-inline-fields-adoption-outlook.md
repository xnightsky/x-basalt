---
type: research
title: "inline fields（key:: value）采用度与前景调研——定位定案"
description: 多源对抗验证调研（22 来源/25 论断三票裁决）：inline fields 真实存在但生态转向 frontmatter/Properties（Bases 不支持、Datacore 弃用、Dataview 收尾）；定案 v1 读侧保留、backlog 扩展项一律降级、方向押 frontmatter 与 Bases
tags:
  - research
  - inline-fields
  - dataview
  - datacore
  - bases
  - x-basalt
timestamp: 2026-07-02T06:23:57Z
sha256: fff456d77a11bfe7e7730b4c2a7234f2d2ddfb2a714d715d501e91cc70967e87
---
# inline fields（`key:: value`）采用度与前景调研——定位定案

> 日期：2026-07-02 · 类型：调研（多源对抗验证）
> 方法：deep-research 流水线——问题拆 6 个搜索角度并行检索 → 抓取 22 个来源、提取 99 条可证伪论断 → 取 25 条做 3 票对抗性验证（≥2/3 反驳判伪）：**15 条存活、10 条被毙**。
> 触发：#28 inline fields 落地后，用户质疑该玩法的真实价值；本结论直接决定 [`../specs/2026-07-02-inline-fields-design.md`](../specs/2026-07-02-inline-fields-design.md) §5 backlog 的取舍。

## 一句话结论

inline fields 是**真实、官方文档化**的 Dataview 语法，存在真实用户工作流；但生态（Obsidian 官方 + Dataview 一系）正**结构性转向 frontmatter/Properties**。对 x-basalt：v1 读侧支持保留（兼容存量 vault），**扩展项一律降级**；战略方向押 frontmatter（meta 写侧既有路线），下一个值得关注的是官方 Bases。

## 已证实的事实（置信度 · 对抗验证票型 · 来源）

1. **真实性成立**（高 · 3-0/3-0/2-1）：Dataview 官方文档 verbatim 定义三形态（整行 / `[k:: v]` / `(k:: v)`）；一个真实的 242 本书读书 vault 整套 Templater 工作流靠 `[status:: ]`/`[rating:: ]` 驱动（frontmatter 几乎不用）。
   - <https://blacksmithgu.github.io/obsidian-dataview/annotation/add-metadata/>
   - <https://joschua.io/posts/2023/04/30/obsidian-book-templates/>
2. **规模只能证到插件级**（中 · 2-1）：Dataview 4,441,246 下载、全插件第 3（与 Obsidian 官方 stats 文件交叉核实）——但**没有任何数据能拆出 inline fields 的使用占比**；两条「下载量证明 inline 广泛使用」的推断在对抗验证中被明确毙掉（0-3、1-2）。
   - <https://www.obsidianstats.com/most-downloaded> · <https://www.obsidianstats.com/plugins/dataview>
3. **官方不接**（高 · 3-0×3）：官方 Bases 只读三类属性（frontmatter/file/formula），语法文档全文零次出现 inline field；官方团队原话「no plans to support inline properties at the moment」；存在专门把 inline fields 同步进 frontmatter 的第三方插件（迁移压力的实证）。
   - <https://help.obsidian.md/bases/syntax> · <https://github.com/Mara-Li/obsidian-dataview-properties> · <https://robcoles.net/posts/dataview-and-inline-to-datacore-bases-and-yaml/>
4. **后继者弃用**（高 · 3-0/2-1/3-0）：Dataview 作者的后继项目 Datacore，其 ROADMAP verbatim 记载 Obsidian 官方建议其「move away from inline fields（much more bespoke）」，inline 仅保留为 opt-in 遗留选项，非默认。
   - <https://github.com/blacksmithgu/datacore/blob/master/ROADMAP.md> · <https://github.com/blacksmithgu/obsidian-dataview/issues/1825>
5. **Dataview 本身在收尾**（高 · 2-1/2-1/3-0）：2025-03 移交社区维护者（holroy）；发版 13 次/年（2023）降到 2 次/年（2025）；最新 0.5.70（2025-04）仍标 Beta 且挂未修 bug；原作者精力在 Datacore（2026-06 仍活跃提交）。
   - <https://github.com/blacksmithgu/obsidian-dataview/releases>

## 被对抗验证毙掉的推断（防止复读）

- 「444 万下载 = inline fields 大规模采用」（0-3）——插件安装量 ≠ 某语法使用量。
- 「Datacore 对 Dataview 查询全兼容」（0-3）。
- 关于既有 CLI 工具（obsidian-cli）如何处理 inline fields 的两条论断均被毙（0-3×2）——**现有 CLI 工具对 inline 的态度没有可靠证据**，本调研第 (4) 问的这部分靠趋势推断而非实测普查。

## 未能回答（诚实边界）

- 没有 2023 年 Properties 上线前后 inline 使用量的直接曲线——「衰退」是从工具链与官方表态**间接推出**的，不是使用统计。
- task emoji 字段（Tasks 插件 📅/🔁 语法）、官方 Bases `.base` 文件格式作为替代投入方向，本轮**未验证**，列为开放问题。
- 真实工作流证据 = 1 个详细案例 + 官方文档示例，非抽样调查。
- 时效：Datacore/Bases 演进快，本结论以 2026-07-02 为准。

## 对 x-basalt 的定案

1. **v1 读侧支持（#28）保留不拆**：定位为「兼容存量 vault」的能力，成本已付清（实现与 502 用例全绿）。
2. **spec §5 backlog 各项默认不做**（值类型化 / 多值列表化 / 带空格 key / `file.inlineFields` / meta 写回 inline）——除非 dogfood 出现真实刚需再逐项立案。
3. **方向押 frontmatter/Properties**：meta 写侧既有路线正确；下一个调研对象是官方 Bases `.base` 格式与 task emoji 字段。
4. 面向使用者的口径已同步进教程：[`../guides/tutorial-rating-inline-fields.md`](../guides/tutorial-rating-inline-fields.md) §5「该不该用」。

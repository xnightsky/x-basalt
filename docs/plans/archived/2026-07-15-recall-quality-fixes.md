---
type: plan
title: 召回质量四修计划（chat 短路 / skills 中文召回 / DQL LIKE 引导 / search 中文相关性）
description: 修复首跑（cc-sonnet + pi-deepseek）稳定复发的四条召回失真：chat 自判"不涉及 vault"绕过召回、skills recall 中文查询召回率为零、DQL LIKE 裸报错无引导、search 中文分词/相关性差。
tags:
  - plan
  - chat
  - skill
  - query
  - search
  - x-basalt
timestamp: 2026-07-15T03:50:11Z
sha256: 365160d2194647b458ebf94ff49ec0fa584f50631b36c77c58a6686eea6fa252
---

# 计划：召回质量四修

> 2026-07-15 · 来源：首跑（cc-sonnet + pi-deepseek）稳定复发的召回问题（用户确认非偶发，逐字命令附各分节）。
> 状态：四修均已落地（P1–P4）。隔离工作区 `.worktrees/recall-quality`（分支 `fix/recall-quality`）。
> 验证：`pnpm run typecheck`、`pnpm test`（563 全绿，含新增 P1×4 / P2×4 / P3×3 / P4×6 用例）、触碰文件 `oxfmt --check` + `oxlint` 均通过；P2/P3/P4 逐字命令端到端复跑通过（见文末「验证结论」）。P1 机制经 mock 模型单测锁定，真实 LLM 行为待用户批次复跑确认（未验证项）。

## 背景与总目标

四条问题都指向同一后果——**召回失真**：调用方（模型）把 chat/skills/search 的输出当作"已从 vault/规范召回"上报给 flow，而实际并未真正召回。目标是让每条通路要么真正召回，要么**如实标注未召回**，并显著提升中文查询的召回率与相关性。

四修互相独立，可分阶段验证，无共享状态。

## 非目标（防止范围蔓延）

- **不**为 DQL 新增 `LIKE` 原生算子。DQL 子集严格对标官方 Dataview（`biz-dql-subset`：「暂不实现 = 报错，而非语义偏离」），官方无 `LIKE`、用 `contains()`。故 P3 只改**错误引导**，不扩文法。
- **不**引入中文分词词典 / 语义向量检索（超出当前 FTS5 trigram 能力边界；search 改造只在**查询构造**层做，索引 tokenizer 与库结构不变、无需重建索引）。
- **不**改 chat 的确认闸 / 写动作语义；P1 只加"如实标注 + 提示纪律"。
- **不**改 DQL 的其它子句语义。

## 分阶段切口

### P1 · chat 别短路成通用问答（如实标注未用 vault）

- **现象（逐字）**：`x-basalt chat "前端单元测试的注意事项、规范、踩坑记录和最佳实践"` → 自判"这不涉及 Obsidian vault 操作，直接基于我的知识回答"，绕过 vault。调用方误当已召回。
- **根因**：纯 prompt 纪律，模型可自行短路；无任何机制层兜底标注。
- **改法（两层）**：
  1. **代码层兜底（可测）**：`runLoop` 追踪本轮是否调用过任一 vault 检索/读写工具（`query/search/read_note/list/parse/meta_get/scan` + 写 `meta_*/pipeline_run`；`skills_*` 是取本 CLI 规范、**不算** vault 召回）。若模型产出了实质文本答复却**零** vault 工具调用，循环收尾追加一条**如实标注**事件（如 `⚠ 本次未调用任何 vault 检索工具，以上为模型通用知识、非 vault 召回内容`）。vault 工具名集合与标注文案由 chat 层（index.ts）注入，runLoop 只做机械检测，保持通用。
  2. **prompt 层纪律**：系统提示补一句——遇到"看起来通用"的问题也**先用 search/query 试召回**再判断；若确要用通用知识作答，必须显式声明未从 vault 召回。
- **测试**：loop.test.ts 用 `MockLanguageModelV4`：①仅产文本、零工具 → 断言出现标注事件；②调用 `search`/`query` 后产文本 → 断言**无**标注；③极短寒暄（阈值内）→ 无标注（降噪）。

### P2 · skills recall 中文召回率

- **现象（逐字）**：`x-basalt skills recall "前端单元测试 unittest 注意事项 规范"` → ✗ 未召回。且 `skills recall "标签"`/`"双链语法"` 亦零召回。
- **根因**：`obsidian-base-spec` 触发词全为英文/拼音（无中文别名）；且 Fuse 检索键仅 `name`+`triggers`，**中文 `description` 与 `rules[].description` 根本不参与匹配**。
- **改法（两层）**：
  1. **代码层**：Fuse keys 增补 `description`（较高权重）与 `rules.description`（较低权重），使中文规范正文可被召回；阈值/降噪保持不放水召回无关 skill。
  2. **数据层**：给 `skills-data/obsidian-base-spec.json5` 补中文触发词别名（标签/双链/双向链接/嵌入/内嵌/别名/标题/块引用/前置元数据/元数据/标注/任务/待办/高亮/内联字段/查询 等）。
- **口径澄清**：`"前端单元测试"` 无对应 skill，**返回空是正确的**（不放水）；本修目标是让"确有覆盖的中文概念"从零召回变可召回，用 `标签/双链/任务/嵌入` 作回归证据。
- **测试**：skill.test.ts 增中文召回用例（覆盖概念中文名命中 obsidian-base-spec；无关中文串仍空）。

### P3 · DQL LIKE 报错引导到 contains()

- **现象（逐字）**：`x-basalt query 'LIST FROM "" WHERE type="research" AND name LIKE "%test%"'` → `✗ DQL 语法错误 (位置 44): Redundant input, expecting EOF but found: LIKE`（裸 chevrotain 文案，不指方向）。
- **根因**：`LIKE` 落在 Identifier 词法后成为多余输入；parseDql 透传裸报错。
- **改法**：parseDql 捕获 parser 错误后，若越界 token 是 `LIKE`（大小写不敏感），改抛**定向** `DqlSyntaxError`：说明 DQL 无 LIKE（对标官方 Dataview），指向 `contains(field,"子串")` / `icontains`（大小写不敏感）/ `startswith` / `endswith`，附例 `contains(name,"test")`。位置沿用越界 token 偏移。
- **测试**：query-parser.test.ts 断言 `... name LIKE "%x%"` 抛的 `DqlSyntaxError` 文案含 `contains` 与正确位置；`contains(name,"test")` 正常解析。

### P4 · search 中文相关性 / 分词

- **现象（逐字复现）**：534 篇 vault，`search "前端单元测试"` 只回 1 条且欠相关；且 `search "前端 单元测试"`（带空格）→ **0 条**（整串含空格被转义成单一字面短语）；`search "测试"`（2 字）→ 报"至少 3 字符"。
- **根因**：`escapeFtsPhrase` 把**整条查询**转成**一个** FTS5 字面短语，trigram 下等价于"要求原文含该连续子串"——多词、异序、异措辞一律落空。
- **改法（仅查询构造层，索引不变、无需重建）**：
  1. **按空白切词**：每词各转一个字面短语，默认 `AND` 组合（精确子串、修掉"空格→0 条"，提升精度）。
  2. **宽松兜底**：严格串命中 0 时，把各词拆成**重叠 trigram** 后 `OR` 合并，bm25 排序——异措辞但字面 trigram 有交集的相关笔记得以浮现（召回）。
  3. **2 字 CJK**（可选、低成本）：查询有效 trigram 为空（如 `测试`）时，回退 `files.content/name LIKE %term%`（trigram 表对 LIKE 有加速）扫描，放宽最短长度到 2。
- **已知边界（如实记录，不过度工程）**：跨概念（如查"前端单元测试"命中"前端…测试"但措辞完全不含目标 trigram）在无分词词典下仍可能漏；不纳入本轮。
- **测试**：query.test.ts 增中文 search 用例（带空格多词命中；异措辞经宽松兜底浮现；2 字 CJK 命中；英文多词仍 AND 命中；FTS5 语法注入仍被字面化，不抛裸错）。

## 验证口径（完成定义）

- `pnpm run typecheck`、`pnpm test`（547+ 全绿、新增用例可追溯）、触碰文件定向 `oxfmt --check` + `oxlint`。
- 四条逐字命令端到端复跑：P2/P3 直接命中，P4 用中文 fixture vault 证明召回改善，P1 用 mock 模型证明标注（真实 LLM 行为属未验证项，如实说明）。
- 落盘前对改动文件自查 AGENTS.md 硬约束（无 `obsidian` import、无常驻命令、写侧只动既有边界、隐式字段 JOIN 不变）。

## 验证结论（2026-07-15）

四条逐字命令在中文 fixture vault 上端到端复跑：

- **P3**：`... name LIKE "%test%"` → 抛定向错误「DQL 不支持 LIKE（对标官方 Dataview）…改用 contains(name, "test")」；`contains(file.name,"测试")` 正常返回。
- **P2**：`skills recall "标签"` / `"双向链接 语法"` → 均召回 `obsidian-base-spec`；reporter 逐字 `"前端单元测试 unittest 注意事项 规范"` → 仍空（无对应 skill，正确不放水）。
- **P4**：`search "前端 单元测试"` → 1（此前 0）；`search "测试"`（2 字）→ 2（此前报错拒查）；`search "前端单元测试"` → 命中。fixture 单测另证异措辞笔记经 trigram-OR 兜底浮现、完整子串 bm25 排首。
- **P1**：mock 模型单测锁定「零 vault 工具 + 实质答复 → finish 带标注」「调过 recall 工具 → 不标注」「短寒暄不标注」「未配置不标注」；渲染层收尾打印标注；prompt 补「别擅自短路」纪律。真实 LLM 是否照做属未验证项。

## eval 库验证（2026-07-15，兄弟仓 `../x-basalt-evals`）

初次只用了 scratchpad 手搭小 fixture、**未过 eval 库**（缺口，已补）。用 worktree 构建（`X_BASALT_CLI` 指向 `.worktrees/recall-quality/dist/cli.js`）过 eval 库：

- **回归**：`runner/run.mjs`（dry）跑全部现有场景（grounding/messy/pkm/scale），结构校验 + 建索引全过，我的改动不破坏真实 vault 索引。
- **真实规模 head-to-head**（`messy/no-index-count` 的 **64 篇中文库**，index 不变、OLD/NEW 共用同库）：
  - `search "测试"` / `"重构"`（2 字）：OLD **报错拒查** → NEW **各 6 命中**；
  - `search "缓存 失效"`（空格多词）：OLD **0** → NEW **3**；
  - `search "失败的测试"`（完整子串）：OLD/NEW 均 3（**无回归**）；
  - `search "拆小任务"`（词序打乱、无共有 trigram）：OLD/NEW 均 0（**已知边界，如实**）。
- **新增 `recall/` 域 2 场景**（补首跑复发的四条召回失真，5 个 task）：`recall/cjk-search-grounding`（P4 中文检索 + P1 别短路 + P2 skills 中文）、`recall/dql-like-guidance`（P3 LIKE→contains）。dry 结构校验通过；判据以确定性原语在场景 vault 上兑现——`search "前端单元测试"` 同时召回「单元测试注意事项」与异措辞的「组件测试实践」、`search "缓存 失效"` 命中、`skills recall 标签/双链` → obsidian-base-spec、`LIKE` → 定向引导、`contains(file.name,"test")` → 命中 test-plan/unit-test-guide 且排除 note 类 test-scratch。
- **未验证**：`--judge` 全链路（需 `AI_GATEWAY_API_KEY`，含 P1 真实 LLM 是否照做）；**scale 级中文检索场景**（数百篇）未单列（现借 messy 64 篇做 head-to-head）——留作后续 eval 补强项。

## 风险与停点

- P4 宽松兜底可能引入噪声召回：以"严格优先、命中 0 才宽松"的两趟策略把噪声限定在"否则零结果"的场景；bm25 排序保相关性优先。
- P1 兜底标注的降噪阈值是启发式；过窄会漏标、过宽会给寒暄也贴标。取小阈值并在注释/计划记明取舍。
- 若 P4 需要动 tokenizer / 重建索引则超出非目标 —— 触发即先停并更新计划。

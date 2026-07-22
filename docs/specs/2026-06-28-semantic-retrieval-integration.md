---
type: design
status: partial
title: 语义/全文检索融入设计评估（FTS5 + 可选 embedding）
description: 评估把 qmd 式检索融入 x-basalt：FTS5 全文（core、无 AI、中文 trigram）为主，embedding 向量为最小可选 AI；含借鉴取舍
tags:
  - spec
  - semantic
  - retrieval
  - x-basalt
timestamp: 2026-06-29T23:59:11Z
sha256: c30eba5c37da36d9c7b33fab9dc9dc9bf29070772228503b2a132571bddfb448
---

# 设计评估：语义/全文检索融入（qmd 调研）—— FTS5 为核、embedding 为可选 AI

> 日期：2026-06-28 · 类型：设计评估（**非开工**，只论"将来若做，怎么做才立得住"）
> 触发：用户问 `tobi/qmd` 借鉴价值。qmd = 本地优先的 markdown 语义检索引擎（BM25 + 向量 + LLM rerank）。
> 关联：前端 chat 见 [`2026-06-28-cli-chat-design.md`](2026-06-28-cli-chat-design.md)；本项承接 [`../../TODO.md`](../../TODO.md)「可选增强 · S3.5 FTS5 全文检索」；索引现状见 `src/indexer/schema.ts`、`src/indexer/index.ts`。
> 外部对标：`tobi/qmd`（TypeScript，SQLite FTS5 + `sqlite-vec` + 本地 GGUF 模型）。

## 0. 这份文档要回答的问题

> 「x-basalt 现在只能按 frontmatter/tag/link 做结构化 DQL 查询，**查不了正文内容**。qmd 那套语义检索能融入吗？哪些该抄、哪些会破坏离线身份？」

**结论先行（TL;DR）**

1. **拆成两层，结论相反**：
   - **FTS5 全文检索**（纯 SQLite、零模型、纯离线）——**该做**，它补的是 x-basalt 最大的能力空洞「查正文」，与项目身份完全一致。承接 TODO 既有的 S3.5。
   - **embedding 向量语义**（真·"按意思找"）——**只能做成最小可选 AI**：接口后、默认关、用户自配、FTS5 兜底。语义必须有模型来源，无法绕开（见 §6）。
2. **现在都不做**——本文是可落地性评估，不是开工计划。
3. **qmd 的向量/GGUF/LLM-rerank/chunking 整套不照搬**——那会把 x-basalt 从"纯逻辑 CLI"变成"拖模型 + 推理运行时的东西"。只取 FTS5 这条离线线，加一个可拔的 embedding 接口（见 §7）。

## 1. 设计脊梁：FTS5 是核、embedding 是最小可选 AI

与 chat spec 共用同一条脊梁（[cli-chat §1](2026-06-28-cli-chat-design.md)）：

- **FTS5 属于 core**：SQLite 自带 FTS5，better-sqlite3 预编译二进制即含，**零新依赖、零模型、纯离线**。它和结构化 DQL 一样是确定性能力，可无条件进核心。
- **embedding 属于可选 AI**：向量化需要一个 embedding 模型（神经网络），这是"AI"。故它必须隔离在接口后、默认关、用户显式配置；**没配 = 退化成纯 FTS5，不报错、不要求装任何东西**。
- **能力可独立交付**：FTS5 可单独落地并长期作为最终形态；embedding 层是"哪天真有'按意思找'需求再插"的可选增强，不是 FTS5 的前提。

## 2. 分层架构

```
检索能力
├─ core（无 AI、纯离线、无条件）
│   ├─ 结构化查询：DQL（已有）
│   └─ 全文检索：FTS5 over 正文（本文 §4，承接 S3.5）
│         ↑ chat 的 LLM 在此之上做 query expansion / HyDE / rerank（外包给调用方，§6①）
│
└─ optional（接口后、默认关、FTS5 兜底）
    └─ embedding provider（§5）：向量召回"零词面重叠的概念相关"（§6②）
          └─ 存储：sqlite-vec 扩展，仅配置后才加载
```

## 3. 现状对接（基于实查 `src/indexer/`）

- `files` 表已存 `content`（原始正文）、`frontmatter`（JSON）、`mtime`/`size`，并有 `path/name/path_key/...`。FTS5 虚表可直接 over `content`（+ `name`/`path` 便于命中文件名）。
- 索引器写入边界单一（`insertPayload` / `deleteByPath`，均在事务内），**FTS 同步可挂在同一事务**，无需额外触发器即可强一致（也可用 SQLite 触发器，二选一，§4）。
- 增量已成熟：`scanIter` 分批 + 断点续 + `rehash` 内容对比。FTS 重建天然搭车增量（改一个文件 → 先删后插，FTS 行随之更新）。
- `llm-wiki` profile 已有 `sha256-body` derive（正文 sha256，检测内容漂移）——这个哈希**正好可复用**为 embedding 的"是否需重算"键（§5、§7）。

## 4. FTS5 设计（core，无 AI）

### 4.1 schema 与同步

- 新增 FTS5 虚表（示意）：`CREATE VIRTUAL TABLE files_fts USING fts5(path, name, body, content='files', content_rowid='id', tokenize='trigram')`（分词见 §4.2）。
- 用 `content=` 外部内容表模式（不重复存正文，省空间），`body` 映射 `files.content`。
- **同步二选一**：(a) 在 `insertPayload`/`deleteByPath` 内顺手写 FTS（与现有"唯一写边界"一致，推荐）；(b) SQLite 触发器自动同步（解耦但多一层隐式逻辑）。推荐 (a)，符合 AGENTS「indexer 是唯一写边界」。

### 4.2 中文分词（决定成败的一点）

**FTS5 默认 `unicode61` 分词器不切 CJK**（中文无空格分隔，整段会被当一个 token，几乎搜不出）。这是中文 vault 的硬坎。评估：

| 方案                             | 依赖                  | 中文效果              | 离线                             |
| -------------------------------- | --------------------- | --------------------- | -------------------------------- |
| `unicode61`（默认）              | 无                    | ❌ 几乎不可用         | ✅                               |
| **`trigram`（FTS5 内置三元组）** | **无**（SQLite 自带） | ✅ 子串匹配，中文可用 | ✅                               |
| `icu` 分词器                     | 需 ICU 构建           | ✅ 好                 | ⚠️ better-sqlite3 预编译不含 ICU |
| 外部分词（jieba 等）预切再存     | 加 npm/原生依赖       | ✅ 最好               | ✅ 但加依赖                      |

**推荐 `trigram`**：FTS5 内置、零依赖、纯离线，对中文做三元组子串匹配即可用，完美贴合 x-basalt"零重依赖"身份。代价是索引体积变大、不支持词级 BM25 精排（但作为"按内容找候选 + 交给 chat/用户筛"足够）。

**借鉴 qmd**：qmd 在 `store_config` 里存 `fts_cjk_normalized_version` 跟踪 CJK 归一化版本——这个**版本号迁移模式**值得抄：分词策略/归一化规则一旦变，靠版本号判定"需重建 FTS"，避免新旧索引混用出错。

### 4.3 命令面

- 设想 `x-basalt query` 扩展一个全文谓词，或新增 `x-basalt search <词>`（待 §8 与 chat 的接口一并定）。本文不冻结命令形态，只确认底座可行。

## 5. 可选 embedding 层（接口后、默认关）

仅当用户显式配置 embedding provider 时启用：

- **provider 接口**：定义一个 `EmbeddingProvider`（`embed(texts) -> vectors`），实现可为 OpenAI 兼容 embeddings 端点（含本地 Ollama）。配置风格与 chat 一致（env / 配置文件），**默认空 = 不加载**。
- **存储**：`sqlite-vec` 作为**可选加载**的 SQLite 扩展，仅在 provider 配好时 `loadExtension`；未配则连扩展都不加载，零影响。
- **内容寻址避免重算**（借鉴 qmd 的核心工程点）：以正文哈希（复用 `sha256-body`，§3）为键存向量；文件内容未变 → 哈希不变 → **跳过重新 embedding**。这是 embedding 层唯一真正"贵"的步骤，content-hash 门控是必要优化（也是 §7 里"content-hash 该抄"的落点）。
- **FTS5 兜底**：provider 缺失/调用失败 → 自动退回 FTS5，语义命令降级而非报错。

## 6. agent-in-the-loop 召回模型与诚实边界

这是把"语义"做轻的关键认知（与 chat spec 配合）：

- **① 大半"AI 检索步骤"可外包给 chat 的 LLM**，x-basalt 自己不跑模型：
  - _query expansion_：让 chat 的 LLM 把"分布式一致性"扩成 `CAP / 强一致 / quorum` 等词丢给 FTS5。
  - _HyDE_：LLM 先写假想答案，再抽词查 FTS5。
  - _rerank_：LLM 读 FTS5 候选自己重排。
    → qmd 用本地 LLM 干的这三件，在 x-basalt 这边由调用方（Claude Code / chat 的 provider）顺手做，**无需在引擎内嵌模型**。
- **② 唯一不可外包 = embedding**：它是对全库的批处理，不是对话里能顺手做的事。这正是 §5 可选层存在的理由。
- **诚实边界（FTS5 召回上限）**：agent 只能重排"FTS5 捞得到"的东西。一篇笔记若与所有查询词**零词面重叠**，FTS5 永不吐出，agent 也无从重排——**这种"概念相关但用词不沾边"的召回，只有 ② 向量能救**。所以：日常找笔记 ① 足够；要"穷尽概念相关"才需要 ②。

## 7. qmd 借鉴点取舍（哪些抄、哪些不抄）

| qmd 能力                                         | 取舍                                     | 理由                                              |
| ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------- |
| FTS5 全文检索                                    | ✅ **抄**（core）                        | 补"查正文"空洞，纯离线零模型                      |
| CJK 归一化版本号（`fts_cjk_normalized_version`） | ✅ **抄**（迁移安全）                    | 分词策略变更时安全重建                            |
| content-hash 内容寻址（避免重算）                | 🟡 **仅 embedding 层抄**                 | 对"贵"的 embedding 才划算；FTS 重算便宜不需要     |
| `sqlite-vec` 向量存储                            | 🟡 **可选层用**                          | 接口后、默认关                                    |
| 本地 GGUF 模型 + `node-llama-cpp`                | ❌ **不抄**                              | 拖模型 + 推理运行时，破坏离线轻量身份             |
| HyDE / query expansion / LLM rerank              | ❌ **不内嵌**（外包给 chat 的 LLM，§6①） | 引擎内嵌模型违背身份；调用方天然是 LLM            |
| AST-aware / smart chunking                       | ❌ **不抄**                              | 纯为 embedding 切块服务，不切块用不上             |
| 软删除 + 内容寻址去重                            | ❌ **不抄**                              | 解决"避免重复 embedding"成本，x-basalt 硬删更简单 |
| docid（6 位内容哈希做 ID）                       | ❌ **不抄**                              | Obsidian 原生身份（path+wikilink+block-id）已覆盖 |

## 8. 与 chat spec 的接口

- chat（[cli-chat spec](2026-06-28-cli-chat-design.md)）把"按内容找"作为一个**工具动作**调本文的检索：默认走 FTS5；若用户配了 embedding 且场景需要"穷尽概念相关"，再走向量。
- 两份文档组合：**chat = 前端对话；本文 = 它最重要的后端检索动作**。但各自独立可落地——FTS5 不依赖 chat 也能作为 `query`/`search` 给人和外部 agent 用；chat 不依赖 embedding 也能跑结构化任务。

## 9. 工作量分级 / 风险 / 不做

**工作量**

| 部件                        | 现状                             | 工作量                                               |
| --------------------------- | -------------------------------- | ---------------------------------------------------- |
| FTS5 虚表 + 同步            | `files.content` 已存、写边界单一 | 小：建虚表 + 在 insert/delete 挂同步                 |
| trigram 中文分词            | 无                               | 极小：建表参数 + 版本号                              |
| 全文查询命令面              | `query` 已有骨架                 | 小-中：加谓词或 `search` 子命令                      |
| embedding 接口 + sqlite-vec | 无                               | 中：provider 接口 + 可选扩展加载 + 哈希门控          |
| 向量召回/融合               | 无                               | 中：检索 + 与 FTS 结果融合（可简单加权，不必上 RRF） |

**风险**

- **中文分词**：trigram 索引膨胀 + 无词级精排；若日后要更好中文 BM25，再评估外部分词（届时靠 §4.2 版本号安全迁移）。
- **embedding 漂移/成本**：靠 content-hash 门控（§5）；失败须优雅退回 FTS5。
- **身份拉伸**：embedding 层是"可选 AI"，纪律同 [cli-chat §1](2026-06-28-cli-chat-design.md)——默认关、接口隔离、无配置全功能。

**不做**

- 不内嵌本地推理运行时；不照搬 qmd 的 GGUF/chunking/rerank；不默认开向量；不为向量改动核心索引的删除语义。

## 10. 结论与触发条件

- **FTS5（core）可落地性**：高。底座（FTS5 + content 列 + 单一写边界 + trigram）全部就绪，增量集中在"建虚表 + 挂同步 + 加查询面"。**它本就是 TODO 的 S3.5，建议优先级高于 embedding 层。**
- **embedding（可选 AI）可落地性**：中。需 provider 接口 + sqlite-vec + 哈希门控；价值集中在"零词面重叠的概念召回"，触发条件比 FTS5 严。
- **何时做**（触发条件）：
  1. **FTS5**：dogfood 中出现"想按正文内容找笔记"的真实需求即可立计划（与 migrate/lint 同级 backlog，但更基础）。
  2. **embedding**：仅当 FTS5 + chat 外包（§6①）仍不够、确有"穷尽概念相关"刚需时，再评估这一可选层。
- **现在的动作**：仅存档本评估，并把 S3.5 从"可选增强"提升为"有评估背书的 backlog"，注明"embedding = 需引入可选模型/端点，最小可选形态"。**不写实现代码。**

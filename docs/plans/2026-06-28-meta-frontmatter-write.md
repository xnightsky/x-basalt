# 元数据写侧：frontmatter 改造（meta 命令）

> 日期：2026-06-28 · 主题：给 x-basalt 增加「写侧」——对笔记 frontmatter（Obsidian Properties / 元数据头）做改造类操作
> 调研真相源：deep-research 报告（见本计划「调研结论」节，原始记录 run `wf_fb274cf7-cfd`）
> 触发：用户明确「元数据的改造，能做的特别多，调研后直接开发」，并授权跳过设计审批 gate、由 AI 自主定切口、里程碑汇报。

## 背景与边界变化

x-basalt 至今是**纯读侧**：parse / index / scan / query / skill 全部不写回 `.md`。本计划首次引入**写侧**能力，专注「元数据头（frontmatter）的改造」。

硬约束不变（AGENTS.md §项目硬约束）：不引入 `obsidian` 包 / 不调 `obsidian://` / 不用浏览器自动化 / 文件操作仅经 `fs`。写回是新增的 fs 写操作（此前只有 indexer 写 SQLite，从不写 `.md`），但仍只经 `fs`，不违反硬约束。

**模块边界**：写侧独立为 `src/meta/`，与读侧 `src/parser/`（gray-matter 只读）解耦——parser 不动。纯字符串变换核心（split/serialize/CRUD）与 fs I/O 分层，前者可纯函数测试。

## 调研结论（约束本设计的硬事实）

来自 deep-research（已对抗式核验，confirmed）：

1. **写回内核用 `yaml`(eemeli) 的 Document API**（`parseDocument` → 原位改 → `toString()`）：保留键顺序（`sortMapEntries` 默认 false）、保留注释（节点带 comment/commentBefore）、对需要引号的值（如 `[[X]]`）自动加引号产出合法 YAML。**不要用 gray-matter 写回**——它从 JS 对象重新序列化，丢注释、平铺类型。`yaml` 已是本仓依赖，无需新增。
2. **注释保真只能「尽力」非「保证」**：`yaml` 的 trailing-comment 有已知未修复 bug（issue #602），且 key 排序可能副作用删空行。→ 文档明示「注释/空行尽力保留，排序类操作可能改动空白」。
3. **不能依赖 `.obsidian/types.json` 拿完整类型**：它只记录用户手动指定过类型的属性，其余属性 Obsidian 靠「猜测」。→ 类型相关处理必须保守 / 可配置，不假设 vault 配置存在（呼应硬约束 6）。
4. **date/datetime 精确存储格式不确定**（调研中「ISO 8601 固定格式」声明被 0-3 驳斥）。→ 日期归一化目标格式**不写死**，留到 normalize 阶段再做、且可配置。
5. **YAML 1.1 vs 1.2 陷阱（Norway 问题）**：`yes/no/on/off/y/n` 在 1.1 被当布尔。→ `set` 的类型推断默认**保守**（只认严格 number / `true`|`false` / `null`），不做 YAML 隐式猜测，避免静默改语义。
6. **Obsidian 特例（留待 normalize 阶段，本期仅识别不强改）**：`tags/aliases/cssclasses` 均 List 类型；单数键 `tag/alias/cssclass` 已于 1.9 弃用但存量多；frontmatter 的 `tags` 写 `#x` 会失效（YAML `#` 起注释）；text 属性里 wikilink 必须加引号（本期由 `yaml` 序列化自动保证）。

被**驳斥**、本设计**不采纳**的说法：属性「恰好 6 种类型」、类型按属性名 vault 级统一注册、date 固定 `YYYY-MM-DD`、JSON frontmatter 会被自动改写为 YAML、Linter 用正则解析 YAML。

## 操作全景（范围切分）

| 类别 | 操作 | 阶段 |
|---|---|---|
| **CRUD（单文件、扁平键）** | get / set / unset / rename | **Phase 1（本期）** |
| 归一 normalize | tags 标量→列表、去 `#` 前缀、单数键→复数键、键排序、类型强制、空值处理、日期格式统一 | Phase 2 |
| 派生 derive | 从文件名/路径/mtime/出入链/标签推导写入属性 | Phase 3 |
| 校验 lint | 按用户 schema 校验存在性/类型/取值，报告或修复 | Phase 4 |
| 迁移 migrate | vault 级重命名/改类型/合并拆分属性（批量） | Phase 5 |

后续阶段都建立在 Phase 1 的「安全往返内核」之上。本计划只**实现 Phase 1**，其余记录为 roadmap，落地前各自再开计划/spec。

---

## Phase 1 设计

### 文件与职责

```
src/meta/document.ts    往返内核：content ⇄ {bom, hasFrontmatter, doc(yaml.Document), body, eol, closeEol}
                        split 检测顶部 ---YAML---；serialize 重组（body 逐字节不动，frontmatter 用 yaml 序列化 + 还原 EOL）。纯函数，不碰 fs。
src/meta/operations.ts  在 yaml.Document 上的 CRUD：get / set / unset / rename。纯函数。
src/meta/index.ts       编排 + fs：readMeta(file) / editMeta(file, mutate, {dryRun})；原子写（临时文件 + rename）。唯一碰 fs 的层。也作模块 barrel 再导出 operations/document 类型。
```

> 类型就近放各文件（`FrontmatterParts` 在 document、`MetaScalarType` 在 operations、`EditResult` 在 index），未单列 `types.ts`。

CLI 加 `meta` 命令组（仿 `skill` group），4 个子命令。

### 往返内核语义（document.ts）

- **检测 frontmatter**：当且仅当文件（去 BOM 后）首行为 `---`，且其后存在单独成行的 `---` 闭合。否则视为「无 frontmatter」，整文件为 body。
- **正文逐字节保真（硬要求）**：body = 闭合 `---` 行之后的原始切片，重组时原样拼回，绝不经过 YAML 解析。代码块/分隔线里的 `---` 不会被误判（只认首行起的块）。
- **EOL 还原**：探测文件 EOL（含 `\r\n` → CRLF 否则 LF），frontmatter 块用该 EOL；body 不动（其内 EOL 天然保留）。
- **BOM 保真**：开头 BOM 原样保留在最前。
- **无 frontmatter 时 set**：新建 Document，在最顶部插入 `---\n…\n---\n` + 原文（原文整体作 body），BOM 仍在最前。
- **非法 YAML 防护**：`parseDocument` 有 `errors` 时，**写操作拒绝执行并报错**（绝不在无法解析的 frontmatter 上写、防止毁文件）；读操作尽力降级。

### CRUD 语义（operations.ts，本期仅顶层扁平键）

- `get(doc, key?)`：无 key 返回整个 frontmatter（`toJS()`）；有 key 返回该键值（不存在 → undefined）。
- `set(doc, key, value, type)`：存在则原位改值（保留键位置与键上注释），不存在则末尾追加。`type ∈ string|number|boolean|null|list|auto`（默认 auto，保守推断见上 §调研结论 5）；`list` 按逗号分隔去空白。
- `unset(doc, key)`：删除该键（含其注释）。键不存在 → 无操作、changed=false。
- `rename(doc, oldKey, newKey)`：改 Pair 的 key 节点，保留位置/值/值上注释。`oldKey` 不存在 → 报错；`newKey` 已存在 → 报错（不静默覆盖）。

### 安全与幂等

- **原子写**：写同目录临时文件 → `renameSync` 覆盖，避免半写损坏。
- **幂等**：同一 set/rename 连跑两次，第二次输出与第一次逐字节一致（解析→序列化稳定）。
- **`--dry-run`**：算出结果但不落盘，打印将写入的 frontmatter（供触发前预览）。

### CLI

```
x-basalt meta get   <file> [key]                      # 读，输出 JSON（--format 可 yaml）
x-basalt meta set   <file> <key> <value> [--type t] [--dry-run]
x-basalt meta unset <file> <key> [--dry-run]
x-basalt meta rename <file> <oldKey> <newKey> [--dry-run]
```

CLI 只做参数装配 + 调 `src/meta`，不内联逻辑（同既有约定）。

### 明确不做（本期 YAGNI）

嵌套键路径（`a.b`）、inline Dataview 字段（`key:: v`）、批量/跨 vault、normalize 各规则、schema 校验、派生、读取 `.obsidian/types.json`。

---

## 原子子步（TDD：先 red 后 green）

- [x] **MW1.1 往返内核 split/serialize（red→green）**
  - 动作：`document.ts` 的 split + serialize；先写 `tests/meta-document.test.ts` 期望（red）。
  - 验收：有/无 frontmatter、空 frontmatter（`---\n---`）、CRLF/LF、BOM、末行无换行、body 含 `---`/代码块、闭合缺失 等用例：**body 逐字节不变**；无变换时往返稳定。
  - 证据：`pnpm test tests/meta-document.test.ts`。前置：无。

- [x] **MW1.2 CRUD 操作（red→green）**
  - 动作：`operations.ts` get/set/unset/rename；`tests/meta-ops.test.ts`。
  - 验收：增删改 + 键序保留 + 注释尽力保留 + rename 保位置/值 + 类型推断（保守）+ list + wikilink 自动加引号且往返合法 + 已存在/不存在的报错口径。
  - 证据：`pnpm test tests/meta-ops.test.ts`。前置：MW1.1。

- [x] **MW1.3 编排 + 原子写 + dry-run（red→green）**
  - 动作：`index.ts` readMeta/editMeta + 原子写 + dry-run；`tests/meta.test.ts`（临时文件）。
  - 验收：真改文件、幂等（连跑两次同字节）、dry-run 不落盘、非法 YAML 写操作被拒、原子写不留半文件。
  - 证据：`pnpm test tests/meta.test.ts`。前置：MW1.2。

- [x] **MW1.4 对抗与边界（重测试硬要求）**
  - 动作：补安全/对抗用例（路径、超大 / 深嵌套 anchor 别名炸弹、恶意值不能越权造键、`#`/`:`/引号注入由序列化兜住）。
  - 验收：恶意输入不崩、不越权、不毁文件；YAML 解析有上限（依赖 `yaml` 默认防护，断言行为）。
  - 证据：相应测试文件。前置：MW1.3。

- [x] **MW1.5 CLI 接线 + 端到端（red→green）**
  - 动作：cli.ts 加 `meta` 组；扩 `tests/cli.test.ts`（subprocess）覆盖 get/set/unset/rename + dry-run + 退出码。
  - 验收：端到端各子命令主路径 + 错误退出码（缺键/非法 YAML/重名）；`--format` 对 get 生效。
  - 证据：`pnpm test tests/cli.test.ts`。前置：MW1.3。

- [x] **MW1.6 收口：质量门 + 文档同步**
  - 动作：`typecheck`/`lint`/`build`/相关测试；更新 `docs/guides/commands.md` + `usage.md` 加 `meta`，并在 `docs/specs/` 冻结「meta 子集」最小 spec；自我说明书 skill（`skills/x-basalt-usage.json5`）同步。
  - 验收：全绿；命令签名/语义在代码、文档、spec、skill 互相一致。
  - 证据：`pnpm run typecheck && pnpm test && pnpm run lint`。前置：MW1.1–MW1.5。

## 风险与剩余不确定

- `yaml` trailing-comment bug → 注释保真不保证；以文档明示 + 测试只断言「尽力」。
- 日期/类型语义不与 Obsidian 100% 一致（无 types.json）→ 本期不碰类型归一，set 保守推断。
- 后续 normalize 才是「标准化」主体，本期只交付地基；不把 Phase 1 当「标准化完成」。

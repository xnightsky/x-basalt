---
name: biz-code-comments
description: Use when writing, editing, or reviewing code comments, JSDoc, module headers, or cross-boundary invariant annotations in this repository
---

# 代码注释规范

## 简介

本仓库默认使用**中文注释**。注释的核心价值是解释“为什么 / 边界 / 副作用”，而不是复述代码字面含义。规范真相源见 `AGENTS.md`「代码与规范」一节；本 skill 是其可召回的展开版。

## 触发场景

- 新增或修改 `export function` / `export interface` / `export type` / `export const` / `export class`
- 文件是模块入口（`cli.ts`、各层 `index.ts`）、超过约 300 行、或承载跨模块接缝
- 代码涉及平台分支、非直觉常量、异步编排、事务边界、解析/查询的降级策略
- 修改共享类型 / schema / SQL / 公共契约后同步更新注释
- 审查 diff 时发现注释缺失、与代码不符、或只是复述代码

## 强制注释类型

### 1. 导出符号 JSDoc

所有导出符号必须有 JSDoc，解释做什么、为什么、边界与副作用。

```typescript
/**
 * 从去掉 frontmatter 的正文中提取全部 wikilink / embed 节点。
 *
 * @param text - 已剥离 frontmatter 的正文
 * @returns 规范化后的 wikilink 节点；同一文件内 target+anchor+embed 相同的链接只保留一次
 */
export function extractWikilinks(text: string): ObsidianNode[] {
```

### 2. 模块头注释

以下文件顶部必须补 3~5 行模块头，说明**本文件职责 / 上游谁调用 / 下游依赖谁**：

- 模块入口文件（`src/cli.ts`、`src/parser/index.ts`、`src/indexer/index.ts`、`src/query/index.ts` 等）
- 超过约 300 行的源文件
- 跨模块接缝文件（parser→indexer 的 AST 契约、indexer→DB 的写边界、query→DB 的只读边界）

```typescript
/**
 * Vault 索引器：唯一写 SQLite 的边界。
 *
 * 上游：cli 的 index/watch 子命令；watcher 的增量回调。
 * 下游：调用 src/parser 的 VaultParser 拿 AST，写入 files/links/tags/tasks/blocks 五表。
 *       不内联任何 DQL（查询是 src/query 的职责）。
 */
```

### 3. 跨模块不变量注释

跨模块接缝处必须写明“谁保证什么、谁假设什么”。

```typescript
// 不变量：parser 产出的 ObsidianNode 是 indexer/query 的唯一输入，二者不感知原始 Markdown；
// 隐式字段（inlinks/outlinks）无物化视图，由查询期 JOIN 实时计算，禁止假设任何外部缓存。
```

### 4. Obsidian 规范来源 vs 自建实现分界（本项目硬要求）

解析 Obsidian 专有语法的代码必须标注分界，这是本项目可追溯性的硬约束（见 `AGENTS.md`「代码与规范」）：

```typescript
// === Obsidian 规范来源: <规范点，如 wikilink 锚点解析顺序> ===
// === 自建实现 ===
```

### 5. 关键行注释

单行或少量几行具备以下特征时，必须在关键行就近注释：

- 平台分支（Windows / macOS / Linux，路径分隔符归一化等）
- 非直觉常量（魔法字符串、特殊标志位、正则边界条件）
- 异步编排（必须先/后执行、必须串行、事务内/外）
- 边界（文件系统、DB 事务回滚、只读连接、参数化绑定防注入）
- 解析/查询降级策略（非法 frontmatter 降级、未知字段报错路径）

```typescript
// 去重键纳入 embed 标记：否则 [[X]] 与 ![[X]] 会被合并而丢失 outlinks 的 is_embed 语义。
const key = `${embed ? "!" : ""}${linkKey(fields.target)}${anchor.toLowerCase()}`;
```

## @behavior 行为注释（BDD）

用 BDD 的 `Given / When / Then` 描述**行为契约**而非实现细节：标签关键字用英文，正文用中文。这是「为什么/边界」在行为层面的固化。

### 何时写

- 导出函数/方法的行为非平凡：有**前置条件**、**状态转移**、**边界**或**降级/错误路径**。
- 跨模块副作用有顺序约束（必须先 X 后 Y、必须在事务内、必须落库后再回调）。
- 同一函数有多条值得固定的场景（成功 / 边界 / 失败各一条）。
- 平凡的纯 getter / 一行映射**不必**写，避免噪声。

### 结构与放置

- **JSDoc 形态**：导出符号上用 `@behavior` 块，每条场景独立。多步可用 `And` / `But` 续接：

```typescript
/**
 * @behavior
 * Given DQL 含未在子集内的字段或语法
 * When 编译该查询
 * Then 抛出带位置的 DqlSyntaxError，而非静默返回空结果
 *
 * @behavior
 * Given 合法的 LIST 查询且 FROM #a
 * When 编译并执行
 * Then 命中 #a 与嵌套 #a/b（前缀匹配）
 * And 结果列至少含 file.name / file.path
 */
```

- **内联形态**：关键分支就近写，不带 `@behavior` 前缀，直接 `// Given … When … Then …`：

```typescript
// Given add/change 事件 When 已 update 落库 Then 才触发 onEvent 回调（保证回调看到的索引最新）
void this.update(p).then(() => onEvent?.(event, p));
```

- **测试形态**：`node:test` 用例名即可映射场景，使「契约 ↔ 测试」一一对应：

```typescript
test("Given 同源多次链接 When 取 inlinks Then 去重只列一次", () => { /* ... */ });
```

### 规则

- 用**业务/行为语言**，不复述代码（错：`When 调用 update()`；对：`When 文件被修改`）。
- 一条场景对应**一个明确结果**；错误与边界路径也要有 `Then`（写明抛什么/降级成什么）。
- 状态转移写清前后态（`Given 已索引 5 文件 … Then 删除后为 4`）。
- 改了行为必须同步改对应 `@behavior` 与测试名，三者不得互相矛盾。

## 铁律

- 默认中文；除非文件已形成稳定英文注释体系或外部协议必须保留英文
- 禁止用注释掩盖糟糕命名 —— 优先重命名
- 禁止提交注释掉的旧代码
- 修改共享类型 / schema / SQL / 公共契约时必须同步更新注释与对应文档/计划
- 注释收口覆盖单位是**整个相关模块或边界**，不能只挑核心文件
- 入仓注释禁止出现仓库根目录之外的绝对路径（脱敏，见 `AGENTS.md`「脱敏」）

## 常见反模式

| 反模式                         | 修正                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `// 把 tag 转成小写`           | `// 归一化为小写以做大小写不敏感匹配，DB 内统一存不带 # 的小写文本` |
| 只写 `@param text 参数`        | 说明参数的业务含义与约束（如“已剥离 frontmatter 的正文”）           |
| 模块头只写“工具函数”           | 明确职责、上游调用方、下游依赖                                      |
| 跨模块协议假设只存在于一侧     | 在接缝处写明不变量与责任方（parser↔indexer↔query）                  |
| 解析 Obsidian 语法处无来源标注 | 补 `// === Obsidian 规范来源 ===` / `// === 自建实现 ===` 分界      |
| `@behavior` 的 Given/When/Then 复述代码（`When 调用 foo()`） | 改写为行为语言（`When 文件被修改`），`Then` 写明结果/抛错/降级 |

## 快速自审

补完注释后对照以下清单：

- [ ] 所有导出符号都有 JSDoc？
- [ ] JSDoc 解释了“为什么”而不只是“做什么”？
- [ ] entry / 超长 / 跨模块接缝文件有模块头？
- [ ] 跨模块接缝写明了不变量？
- [ ] 解析 Obsidian 专有语法处标注了规范来源 vs 自建实现分界？
- [ ] 行为契约使用了 `@behavior` + `Given/When/Then`？
- [ ] 关键行（平台/常量/异步/边界/降级）有近距注释？
- [ ] 没有注释掉的旧代码？没有仓库外绝对路径？

---
type: research
title: Obsidian Bases 无头执行引擎调研
description: 基于 Obsidian 官方 Bases、Properties、CLI 机制与社区故障报告，评估 x-basalt 构建无 GUI .base 查询内核的价值、兼容边界和自建方案
tags:
  - research
  - obsidian
  - bases
  - headless
  - query-engine
timestamp: 2026-07-22T11:00:19Z
sha256: 899fd5afecce1dfab7508f4265afe1de134f0867e49dd812b2b06f2c3912f634
---

# Obsidian Bases 无头执行引擎调研

> 日期：2026-07-22
> 口径：官方公开文档以本日快照为准；社区实现只作可行性与风险线索。
> 关联场景：[`../testing/2026-07-22-bases-scenario-matrix.md`](../testing/2026-07-22-bases-scenario-matrix.md)
> 目标规范：[`../specs/2026-07-22-bases-headless-engine-design.md`](../specs/2026-07-22-bases-headless-engine-design.md)

## 1. 结论

x-basalt 应把下一条核心能力线定为：**直接读取文件系统与 SQLite 索引、无需 Obsidian App 的 `.base` 查询内核**。它不是“再加一个 CLI 命令”，而是新的可复用库层；CLI、未来 MCP 和测试只应是薄出口。

首期不能宣称完整 Bases 兼容。最合理的承诺是 **Bases Markdown conformance**：执行 `.base` 文件中的 table view，只把 Markdown 笔记作为记录；支持全局/视图过滤、属性读取、常用 file 方法、投影、稳定多键排序和 limit；对附件数据集、动态 `this`、插件 view/function、完整公式与汇总明确报不支持，不返回误导性空结果。

理由：

1. **官方方向已从 Dataview 插件语法转向 Properties + Bases。** Bases 是核心插件，数据仍存于本地 Markdown/YAML，查询定义存为可版本控制的 `.base` YAML。[S1：Bases 介绍](https://obsidian.md/help/bases)
2. **官方已证明程序化查询是正式需求。** Obsidian CLI 提供 `base:query`，但 CLI 要求桌面 App 正在运行；未运行时第一条命令会启动 App。[S1：Obsidian CLI](https://obsidian.md/help/cli)
3. **x-basalt 的差异化正是官方缺口。** 本项目在 Node 进程中直接读文件、建 SQLite 索引和执行查询，不依赖 GUI、Electron、Obsidian API 或 metadata cache，适合服务器、CI、容器和 agent 沙箱。
4. **现有底座复用度高。** frontmatter JSON、file 元数据、tags、links、路径感知 JOIN、YAML、Chevrotain、统一诊断与参数化 SQLite 已存在；但 Bases 的表达式类型系统不能直接等同于现有 DQL AST。

## 2. 本地实证

### 2.1 已有能力

- `files.frontmatter` 保存完整 JSON，可承载字符串、数字、布尔、列表和对象。
- `links` / `tags` 查询期计算，可支撑 `file.hasLink()` / `file.hasTag()`。
- `files` 已有 path/name/folder/extension/size/mtime/ctime。
- query 层已有 Chevrotain 解析、参数化 SQL、安全错误定位和分页结果契约。
- `BasaltDiagnostic` 已提供稳定的 file/line/column/rule/severity/message 形状。

### 2.2 明确缺口

- `src/` 与 `tests/` 当前没有 `.base` schema、parser、expression evaluator 或 view executor。
- indexer 只收 `.md`；官方 Bases 默认数据集是 vault 中所有文件，file properties 也适用于附件。
- 当前 DQL 仅支持标量 frontmatter 路径；没有 Bases 的 Link/File/Date/Duration/List/Object 运行时值。
- 当前 parser 对非法 frontmatter 降级为空对象；作为数据库视图执行时，这种静默降级需要转成可观察诊断。
- Obsidian 的显式属性类型是 vault-wide；官方文档确认“同名属性全 vault 共用一种类型”，但存储位置并非公开稳定 API。[S1：Properties](https://obsidian.md/help/properties)

### 2.3 社区口径校准：GUI 拉起是机制，不是已确认的通用 Bug

“官方 CLI 的 GUI 拉起路径存在并发崩溃问题”这一表述不准确，应拆成机制与特定故障报告两层：

- **机制事实**：Obsidian CLI 是桌面 App 的伴随控制端，不是独立的无头执行器；App 未运行时，首条命令会启动 App。官方帮助明确记录了该行为，官方论坛维护者也直接确认“这就是当前工作方式，不是 Bug”。[S1：Obsidian CLI](https://obsidian.md/help/cli)、[S2：维护者答复](https://forum.obsidian.md/t/cli-behaviour-is-inconsistent/111948)
- **实现机制线索**：维护者说明桌面端使用 Electron `requestSingleInstanceLock()` 协调多次启动，依赖进程间通信把后续调用交给已有实例。因此，冷启动、App 就绪和 CLI 请求转发属于同一个桌面应用生命周期，而不是多个彼此独立的无头命令进程。[S2：单实例机制答复](https://forum.obsidian.md/t/cli-each-obsidian-move-cli-command-spawns-a-new-full-electron-obsidian-app-instance/111063)
- **故障报告不能外推为通用并发崩溃**：社区确有重复实例、沙箱内第二实例崩溃和突发并发 `move` 丢命令的报告，但触发条件分别涉及旧安装器/旧 CLI 注册、沙箱无法访问本地 IPC，以及命令到达速度超过 App 处理速度。前两类案例经更新注册方式后恢复；`move` 的负载报告则明确把队列/确认机制列为推测。它们证明自动化调用需要版本、就绪与速率控制，不足以证明“GUI 拉起路径本身存在普遍并发崩溃 Bug”。[S2：沙箱与 CLI 注册排查](https://forum.obsidian.md/t/openai-codex-sandboxed-cli-invocation-can-launch-a-second-obsidian-process-that-crashes-even-when-the-main-app-is-already-running/113099)、[S3：并发 move 社区复现](https://forum.obsidian.md/t/cli-concurrent-obsidian-move-commands-silently-dropped-exit-0-no-move-in-large-vaults-the-move-handler-wedges-into-a-no-op-until-reload-windows-1-12-7/115164)

因此，本调研撤回“并发崩溃问题”的事实判断。官方 CLI 仍只适合作为受控 oracle，是因为它依赖 GUI/App 状态且官方未声明并发与就绪契约；串行、限速和预先启动 App 是为了获得可重复的对照结果，不是对一个已确认通用 Bug 的规避。

## 3. 官方语义事实

### 3.1 文件与视图模型

`.base` 是合法 YAML。顶层语义包含：

- `filters`：全局过滤；
- `formulas`：派生属性；
- `properties`：显示配置；
- `summaries`：自定义汇总；
- `views`：一个或多个视图，含 type/name/filters/order/sort/groupBy/limit/summaries 等 view 配置。

全局 filter 与 view filter 在执行目标 view 时以 `AND` 合并。filter 可以是表达式字符串，也可以是递归 `and` / `or` / `not` 对象。[S1：Bases syntax](https://obsidian.md/help/bases/syntax)

首个 view 是默认 view；官方当前支持 table、cards、list，并允许插件增加额外布局。查询内核不应渲染布局，view type 只决定是否属于已知可查询配置。[S1：Views](https://obsidian.md/help/bases/views)

### 3.2 数据集语义

没有 filter 的 Base 默认包含 vault 中所有文件，而不是只含 Markdown。Note properties 仅对 Markdown 有意义；file properties 对所有受支持文件有效。[S1：Views](https://obsidian.md/help/bases/views)、[S1：Bases syntax](https://obsidian.md/help/bases/syntax)

这与 x-basalt 当前 `.md`-only 索引形成硬冲突：首期必须把兼容级别写进结果与诊断；后续若做 all-files，应新增独立的 vault entry 模型，不能直接让附件混入现有 DQL `files` 表而改变旧查询结果。

### 3.3 属性与类型

Bases 有三类属性：

1. note property：Markdown frontmatter，`note.price` 或简写 `price`；
2. file property：`file.path`、`file.name`、`file.folder`、`file.ext`、`file.size`、`file.ctime`、`file.mtime`、`file.tags`、`file.links`、`file.properties` 等；
3. formula property：`.base` 内定义，使用 `formula.name`。

Properties 支持 Text、List、Number、Checkbox、Date、Date & time、Tags；同名属性的显式类型在 vault 级统一。[S1：Properties](https://obsidian.md/help/properties)

`.obsidian/types.json` 是当前 App 使用的实现载体，但官方 Help 没把该路径声明为稳定协议；社区资料与实际 vault 均可观察到它。x-basalt 可以**可选只读**它来提高兼容性，但必须：

- 文件缺失时从 YAML 值保守推断；
- 格式未知或非法时给 warning 并回退；
- 不把该文件当唯一真相源；
- 不在首期写入它。

### 3.4 表达式语言

Bases 表达式不是 DQL：

- 比较使用 `== != > < >= <=`；
- 布尔使用 `! && ||`；
- 支持算术、方法链、列表/对象索引；
- 方法按运行时类型分派；
- list 的 `filter/map/reduce` 使用隐式 `value/index/acc`，不是 JavaScript lambda；
- Link/File/Date/Duration 是一等运行时值。

官方说明函数整体遵循 JavaScript 行为，但又定义了 Obsidian 特有值与方法，因此不能用 SQLite 或 JavaScript 原生求值直接冒充兼容实现。[S1：Functions](https://obsidian.md/help/bases/functions)

首期高价值函数是：

- any：`isTruthy()` / `isType()` / `toString()`；
- string：`contains()` / `startsWith()` / `endsWith()` / `lower()` / `trim()`；
- list：`contains()` / `containsAll()` / `containsAny()`；
- file：`hasTag()` / `inFolder()` / `hasLink()` / `hasProperty()`；
- global：`if()` / `list()` / `number()`；
- time：`today()` / `now()`，但测试必须注入 clock。

`random()`、HTML/image/icon 渲染值、正则与高阶列表函数应后置。

### 3.5 动态上下文 `this`

`this` 随 UI 宿主变化：单独打开时指向 Base 文件，嵌入 note/Canvas 时指向嵌入者，放在 sidebar 时指向当前活动文件。[S1：Bases syntax](https://obsidian.md/help/bases/syntax)

无头执行没有“当前活动文件”。因此：

- 首期遇到 `this` 必须报 `base/dynamic-context-required`；
- 后续可用显式 `contextFile` 参数实现可重复语义；
- 禁止猜当前文件或默认为 base 文件后仍声称兼容所有宿主场景。

### 3.6 `.base` 与嵌入 code block

官方既支持独立 `.base`，也支持 Markdown 中的 `base` fenced code block。[S1：Create a base](https://obsidian.md/help/bases/create-base)

首期只支持独立 `.base`。code block 需要 parser 新节点、宿主文件上下文和位置契约，应作为单独阶段，不混进最小执行内核。

## 4. 演进与版本风险

Bases 在 1.9 early access 期间发生过多次破坏性变更：函数从 snake_case 改 camelCase、表达式改为方法链、属性引用改为 `note["Property Name"]`、文件格式新增 `properties`。后续又增加 `file.backlinks`、`file()`、`hasProperty()`、list map/filter 等。[S1：1.9.1](https://obsidian.md/changelog/2025-05-22-desktop-v1.9.1/)、[S1：1.9.2](https://obsidian.md/changelog/2025-06-05-desktop-v1.9.2/)、[S1：1.9.5](https://obsidian.md/changelog/2025-07-17-desktop-v1.9.5/)、[S1：1.9.8](https://obsidian.md/changelog/2025-08-14-desktop-v1.9.8/)

`.base` 本身没有 schema version 字段。x-basalt 不能自动判断文件来自哪一代语法，因此规范必须：

- 以“官方文档快照日期 + x-basalt conformance id”标版本；
- 未知函数/字段/顶层结构报诊断，不静默忽略；
- 测试保留历史破坏性语法作为明确拒绝用例；
- 函数表数据驱动，新增实现只扩表与用例，不放宽任意调用。

## 5. 官方 CLI 与 Headless 的边界

官方 CLI 已提供 `bases`、`base:views`、`base:create`、`base:query`；`base:query` 可输出 JSON/CSV/TSV/Markdown/paths。但该 CLI 控制桌面 App，官方明确要求 App 运行。[S1：Obsidian CLI](https://obsidian.md/help/cli)

官方 Obsidian Headless 是独立进程，但当前定位是 Sync/Publish 服务客户端，不是 Bases 查询引擎。[S1：Obsidian Headless](https://obsidian.md/help/headless)

因此官方 CLI 的正确角色是：

- 使用当前安装器与正确注册的 CLI，预先启动 App 并确认其就绪；
- 以串行调用、受控速率生成少量 oracle 快照；
- 验证争议语义；
- 不进入运行时依赖、CI 必需链或并发基准；该限制来自 GUI/App 生命周期依赖与未公开的并发契约，而非已确认的通用崩溃 Bug。

## 6. 外部实现扫描

### 6.1 `@type32/obsidian-bases-parser`（S1 元数据 / S2 包体）

npm 0.3.4（2026-03）声称包含 schema、lexer、parser、evaluator 与 reactive query。包体审计结果：

- MIT；
- 强依赖 Vue 与 js-yaml；
- package 未声明公开 repository；
- `test` 脚本固定失败并显示没有测试；
- 0 dependents，发布时间短；
- 同时打包 parser、builder、Vue reactive 层，边界远大于 x-basalt 所需。

结论：可作为 AST/函数枚举线索，不收编、不 fork、不作为语义 oracle。[npm 元数据](https://www.npmjs.com/package/@type32/obsidian-bases-parser)

### 6.2 `obsbase`（S1 PyPI 元数据）

Python 包 `obsbase` 于 2026-06 发布，可读取 `.base` 并返回 Python object / pandas DataFrame，证明独立查询需求存在。但它体量与版本仍早期、语言栈不符，也没有资格替代本项目的 Node/SQLite/安全测试要求。[PyPI](https://pypi.org/project/obsbase/)

### 6.3 mdbase（S3 生态线索）

mdbase 不是 Obsidian `.base` 的兼容实现，而是更广的“typed Markdown collections”规范，覆盖 schema、validation、query、link、CRUD，并采用分级 conformance 与测试套件。值得借鉴的是**分级声明与 conformance fixtures**，不应把它的类型系统或配置格式引入 x-basalt。[项目站](https://mdbase.dev/)

## 7. Build vs buy

| 能力                    | 决策                                      | 理由                                                                |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `.base` YAML/CST        | 复用现有 `yaml`                           | 已依赖，可得 Document/CST 与错误位置                                |
| expression lexer/parser | 复用 Chevrotain，自建 grammar/AST         | 已依赖；Bases 与 DQL token/AST 不同，不能强行共用                   |
| expression evaluator    | 自建白名单解释器                          | 禁 `eval` / `new Function`；需 Link/File/Date/List 类型与复杂度预算 |
| 数据读取                | 复用 SQLite 索引与实时 JOIN               | 不读 Obsidian cache；现有 tags/links/frontmatter 足够首期           |
| property types          | 可选读 `.obsidian/types.json` + YAML 推断 | 当前兼容信息，不承诺其为稳定公开协议                                |
| 外部 parser 整包        | 不采用                                    | 年轻、无测试、边界/依赖不合适                                       |
| 官方 CLI                | 只作受控 oracle                           | 依赖 GUI/App 状态，且没有公开并发与就绪契约，不能成为无头运行时     |

## 8. 推荐架构

```text
.base YAML
  -> BaseDocument（结构校验 + source span）
  -> BaseExpr AST（独立于 DQL）
  -> BasePlan（选 view、合并 filters、依赖排序）
  -> BaseRowSource（SQLite：md rows + tags/links/file metadata）
  -> typed evaluator（纯解释、预算限制）
  -> project/sort/limit
  -> BaseQueryResult + BasaltDiagnostic[]
```

首期优先用安全 JS evaluator 处理语义，不把复杂表达式翻译成 SQL。未来仅对可证明等价的 `file.inFolder`、`file.hasTag`、简单比较做 SQL 下推；优化不得改变 AST/evaluator 作为语义真相源的地位。

## 9. 风险与杀死条件

| 风险                          | 控制                                               |
| ----------------------------- | -------------------------------------------------- |
| 官方语义闭源且持续变化        | 版本化 conformance + 串行 oracle 快照 + 未知即报错 |
| all-files 与当前 md-only 冲突 | 首期显式 Markdown conformance；另立 schema 决策    |
| 类型由 App 隐式管理           | optional types.json + YAML 推断 + mismatch 诊断    |
| 表达式注入/ReDoS/超深 AST     | 不执行 JS；节点/深度/列表迭代/正则预算             |
| 复用 DQL 导致两套语义串味     | 共享值工具与 SQL 原语，不共享 grammar/AST          |
| “兼容”口号无法验证            | 每项能力绑定 `BASE-*` 场景编号                     |

杀死条件：如果 P1 场景中超过三分之一必须依赖附件数据集、动态 UI `this` 或无法稳定观测的闭源语义，停止“官方兼容”承诺，退回只做 `.base` lint/inspect；不得用猜测补齐。

## 10. 未决问题

1. 首期是否要求输入 filter 显式含 `file.ext == "md"`，还是允许隐式 Markdown conformance 并在结果中附 warning？规范当前选择后者，但 CLI 默认应显著显示 warning。
2. property type 名称大小写与 `.obsidian/types.json` 的未知字段如何兼容，需要真实 vault 样本与官方串行对照。
3. `null`、缺失、空字符串、空列表的精确 truthiness 与排序位置，需要 oracle fixture 冻结。
4. Link 相等在同名歧义、heading/block 引用和不存在目标下的精确行为，需要路径专项对照。
5. 官方 `base:query` JSON 输出未被官方文档定义为稳定 schema；x-basalt 应冻结自己的结果契约，不逐字复制。

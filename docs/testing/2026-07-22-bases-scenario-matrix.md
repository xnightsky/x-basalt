---
type: testing
title: Obsidian Bases 无头执行场景矩阵
description: 为 .base Markdown conformance 定义确定性 fixtures、官方串行 oracle、场景编号、安全对抗与阶段验收门
tags:
  - testing
  - obsidian
  - bases
  - conformance
  - fixtures
timestamp: 2026-07-22T10:50:29Z
sha256: 31c64ecc3ec841452da6f3505a2fa2afd9dac15fd1b1864ea08dfb1ee23db753
---

# Obsidian Bases 无头执行场景矩阵

> 日期：2026-07-22
> 调研依据：[`../research/2026-07-22-obsidian-bases-headless-engine-research.md`](../research/2026-07-22-obsidian-bases-headless-engine-research.md)
> 设计契约：[`../specs/2026-07-22-bases-headless-engine-design.md`](../specs/2026-07-22-bases-headless-engine-design.md)

## 1. 目标

本矩阵把“支持 Bases”拆成可追溯场景编号。未来任何实现 PR 声称支持一项能力时，必须引用对应 `BASE-*` 编号，并提供：

- 小型确定性 fixture；
- 直接 API 测试；
- 必要时的 CLI 薄出口测试；
- 争议语义的官方串行 oracle 快照；
- 边界、异常定位与安全对抗。

私有 `x-basalt-evals` 继续负责 chat/agent 行为；Bases 语义属于产品确定性契约，fixture 应进入本仓 `tests/fixtures/bases/`，不放进私有评估库。

## 2. 未来 fixture 结构

```text
tests/fixtures/bases/
  minimal/
    .obsidian/types.json       # 仅在类型场景需要时存在
    views/
      projects.base
    notes/
      Alpha.md
      Beta.md
    assets/
      cover.png                # all-files 阶段才进入结果集
    expected/
      default.json
      active.json
  invalid/
  links/
  types/
  security/
```

fixture 要求：

- 文件时间相关断言使用显式注入 clock 或测试建库时固定 epoch；
- 路径统一为 vault 相对 POSIX；
- 结果排序必须显式，不能依赖文件系统遍历顺序；
- oracle 快照记录 Obsidian 版本、平台、Base 文件 hash 与串行执行命令；
- 不保存 GUI 状态、绝对路径或用户 vault 内容。

## 3. P0：文档与 schema

| ID           | 场景                                  | 期望                                                |
| ------------ | ------------------------------------- | --------------------------------------------------- |
| BASE-DOC-001 | 最小合法 `.base`，只有一个 table view | 成功解析，首 view 成为默认 view                     |
| BASE-DOC-002 | 非法 YAML                             | 诊断含 `.base` 文件、完整文件 line/column，执行终止 |
| BASE-DOC-003 | `views` 缺失或为空                    | `base/view-required`，不猜空 view                   |
| BASE-DOC-004 | 两个同名 view                         | `base/duplicate-view-name`，按规范拒绝歧义选择      |
| BASE-DOC-005 | 指定不存在的 view                     | `base/view-not-found`，列出可用名称建议             |
| BASE-DOC-006 | 未知顶层 key                          | warning 并保留原值；不影响已知字段执行              |
| BASE-DOC-007 | 未知 view type / 插件 view            | `base/unsupported-view-type`，不按 table 猜测       |
| BASE-DOC-008 | 旧版 snake_case 函数                  | 带表达式位置的 unknown-function，不静默迁移         |
| BASE-DOC-009 | 超深递归 filter 对象                  | 在深度预算处拒绝，不能栈溢出                        |

## 4. P1：Markdown conformance 主路径

| ID              | 场景                                           | 期望                                                            |
| --------------- | ---------------------------------------------- | --------------------------------------------------------------- | ------------ | ------------------ |
| BASE-VIEW-001   | 未指定 view                                    | 选择 `views[0]`                                                 |
| BASE-VIEW-002   | 指定命名 view                                  | 只应用目标 view 配置                                            |
| BASE-VIEW-003   | global filter + view filter                    | 两者以 AND 合并                                                 |
| BASE-VIEW-004   | 递归 and/or/not                                | 嵌套逻辑结果正确                                                |
| BASE-DATA-001   | 无 filter 的 md-only 执行                      | 返回全部 Markdown，并附 Markdown conformance warning            |
| BASE-DATA-002   | vault 含 PNG/PDF/.base                         | 首期不把附件作为行；诊断明确存在 all-files 差异                 |
| BASE-DATA-003   | 空 vault                                       | total=0、rows=[]，不是错误                                      |
| BASE-DATA-004   | 多根 vault                                     | 使用既有命名空间 path，结果不泄露物理绝对路径                   |
| BASE-PROP-001   | `status` / `note.status`                       | 两种引用同义                                                    |
| BASE-PROP-002   | `note["Review Status"]`                        | 带空格属性可访问                                                |
| BASE-PROP-003   | Unicode 属性名                                 | 可解析、读取与排序                                              |
| BASE-PROP-004   | 缺失、显式 null、空字符串、0、false、空列表    | 值与 truthiness 分离，结果由 oracle 冻结                        |
| BASE-PROP-005   | `file.properties`                              | 返回 frontmatter 对象，不含 formula/file namespace              |
| BASE-PROP-006   | 非 Markdown 行访问 note property               | all-files 阶段为 null/缺失；P1 不产生该类行                     |
| BASE-FILE-001   | path/name/basename/folder/ext/size/ctime/mtime | 类型与值正确，时间可注入                                        |
| BASE-FILE-002   | `file.inFolder("Projects")`                    | 命中目录本身及其子目录，不命中前缀同名目录                      |
| BASE-FILE-003   | `file.hasTag("area")`                          | 命中 `#area` 与嵌套 `#area/x`，大小写口径固定                   |
| BASE-FILE-004   | `file.hasProperty("status")`                   | 只判键存在，不把 falsy 值当缺失                                 |
| BASE-FILE-005   | `file.hasLink("Target")`                       | 复用路径感知链接解析；qualified/bare 分支独立覆盖               |
| BASE-EXPR-001   | == != < > <= >=                                | 字符串/数字/日期的允许组合与类型错误明确                        |
| BASE-EXPR-002   | ! &&                                           |                                                                 | 与括号优先级 | AST 优先级符合规范 |
| BASE-EXPR-003   | string contains/startsWith/endsWith/lower/trim | 方法链与返回类型正确                                            |
| BASE-EXPR-004   | list contains/containsAll/containsAny          | 列表成员比较使用 typed equality                                 |
| BASE-EXPR-005   | `if()` / `list()` / `number()`                 | 参数数量、转换失败与分支语义可观察                              |
| BASE-RESULT-001 | `order` 投影                                   | columns 按 view order；缺失值仍保留列                           |
| BASE-RESULT-002 | 多键 sort                                      | 优先级、方向、null 位置与稳定 tie-break 固定                    |
| BASE-RESULT-003 | limit=0/1/N/超总量                             | 边界正确；负数拒绝                                              |
| BASE-RESULT-004 | 无显式 sort                                    | 最终以 file.path 稳定排序，避免遍历顺序漂移；标为 x-basalt 扩展 |

## 5. P2：类型、公式、汇总

| ID             | 场景                                 | 期望                                          |
| -------------- | ------------------------------------ | --------------------------------------------- |
| BASE-TYPE-001  | `.obsidian/types.json` 合法          | 显式 vault-wide 类型优先于 YAML 推断          |
| BASE-TYPE-002  | types 文件缺失                       | 按 YAML 值推断并给 compat info，不失败        |
| BASE-TYPE-003  | types 文件非法/未知类型              | warning + 保守推断，不写回配置                |
| BASE-TYPE-004  | 声明 number、值为 text               | type-mismatch 诊断；过滤/排序不偷偷字符串比较 |
| BASE-TYPE-005  | date vs datetime                     | 比较与格式化用固定时区场景验证                |
| BASE-TYPE-006  | frontmatter wikilink                 | 产生 Link value；路径感知相等                 |
| BASE-FORM-001  | 常量和简单算术公式                   | 输出类型正确                                  |
| BASE-FORM-002  | 公式引用 note/file 属性              | 依赖读取正确                                  |
| BASE-FORM-003  | 公式引用另一公式                     | 拓扑排序，不依赖 YAML 键顺序                  |
| BASE-FORM-004  | 公式循环                             | 报完整循环链，整个执行不挂死                  |
| BASE-FORM-005  | 公式运行时类型错误                   | 行级 diagnostic 与 null/error cell 口径固定   |
| BASE-FORM-006  | today/now                            | 注入 clock，重复运行完全一致                  |
| BASE-LIST-001  | filter/map/reduce 的 value/index/acc | 作用域隔离、嵌套预算、空列表行为正确          |
| BASE-GROUP-001 | groupBy 标量                         | 分组键和组内稳定顺序正确                      |
| BASE-GROUP-002 | groupBy 列表/tag                     | 一行多组语义按官方 oracle 冻结                |
| BASE-SUM-001   | Average/Min/Max/Sum/Count 类默认汇总 | 空值、混合类型和结果类型正确                  |
| BASE-SUM-002   | custom summary 的 values             | 只接收当前结果集目标列，不能越权访问任意状态  |

## 6. P3：完整宿主与 all-files

| ID              | 场景                         | 期望                                                 |
| --------------- | ---------------------------- | ---------------------------------------------------- |
| BASE-ALL-001    | 图片/PDF/Canvas/.base 作为行 | file fields 可用，note fields 缺失                   |
| BASE-ALL-002    | 附件 links/backlinks/embeds  | 与官方支持范围对照，未知格式不伪造内容链接           |
| BASE-CTX-001    | 独立 `.base` 使用 `this`     | 显式 context 指向 base 文件；无 context 时按契约处理 |
| BASE-CTX-002    | Markdown `base` code block   | parser 给出完整文件位置，this 指向宿主 note          |
| BASE-CTX-003    | `![[View.base#Name]]`        | 能解析 view 名与显式宿主 context                     |
| BASE-CTX-004    | sidebar/active-file 语义     | 无头接口必须显式传 contextFile，禁止环境隐式状态     |
| BASE-PLUGIN-001 | 插件 view/function           | 默认拒绝；只有显式注册的纯函数扩展可执行             |

## 7. 安全与资源预算

| ID           | 场景                                                | 期望                                                  |
| ------------ | --------------------------------------------------- | ----------------------------------------------------- |
| BASE-SEC-001 | 表达式含 `constructor` / `__proto__` / prototype 链 | 属性访问白名单拒绝                                    |
| BASE-SEC-002 | 尝试调用任意 JS/global/process                      | grammar 阶段拒绝；实现中无 `eval`/`new Function`      |
| BASE-SEC-003 | SQL 注入字符串                                      | 所有 SQL 输入参数化，结果集不扩大                     |
| BASE-SEC-004 | 灾难性正则                                          | P1 不支持正则；P2 若支持必须沿用 ReDoS 防护与长度预算 |
| BASE-SEC-005 | 巨大列表 + 嵌套 map/filter/reduce                   | 迭代预算耗尽后结构化错误，不阻塞进程                  |
| BASE-SEC-006 | 公式依赖图超大/超深                                 | 节点与深度上限，错误含依赖路径                        |
| BASE-SEC-007 | YAML 自定义 tag/alias bomb                          | 安全 schema + alias/文档大小预算                      |
| BASE-SEC-008 | `.base` 路径越出 vault                              | 在文件读取前拒绝 path traversal                       |
| BASE-SEC-009 | 恶意属性名进入 JSON path/SQL                        | 不拼接未验证路径；使用绑定或安全 JSON 访问器          |

## 8. 官方 oracle 协议

官方 CLI 依赖 GUI 且用户侧观察到并发拉起不稳定，因此 oracle 只能串行、人工触发：

1. 固定 Obsidian installer/app 版本并记录版本号。
2. 使用专门、无社区插件的 fixture vault。
3. 预先启动 App，确认索引完成。
4. 对每个争议 view 串行运行 `base:query`，不并发、不让命令负责拉起 GUI。
5. 保存原始 JSON、stderr、退出码、Base hash 与 note fixture hash。
6. 人工审查后转成 x-basalt 期望快照；原始 App 输出不是本项目公共 API。
7. oracle 无法稳定重放的场景标 `implementation-defined`，不得靠单次观察冻结强结论。

优先需要 oracle 的编号：`BASE-PROP-004`、`BASE-RESULT-002`、`BASE-TYPE-004/005/006`、`BASE-GROUP-002`、`BASE-CTX-*`。

## 9. 阶段验收门

### P0 schema/inspect

- `BASE-DOC-001..009` 全部通过；
- 每条错误带完整文件位置；
- 非法输入无崩溃、无文件写入。

### P1 Markdown query

- P1 表中每项独立测试；
- `BASE-SEC-001/002/003/007/008/009` 通过；
- 相同 DB + Base + clock 连续运行结果字节稳定；
- 1/100/10,000 篇 Markdown 的基准只记录，不提前承诺性能阈值；若 10,000 篇超出可用范围，再做 SQL 下推。

### P2 typed/formula

- 所有 P2 项有正常、边界、类型错误与预算错误分支；
- 官方争议语义有可审计 oracle；
- 公式循环和高阶列表无法造成无限执行。

### P3 all-files/context

- 先完成独立 schema 决策，证明不会改变既有 DQL 的 `.md` 数据集；
- 显式 context 可完全复现，不能依赖 GUI 活动状态。

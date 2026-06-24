# TODO · 执行中任务

> 本文件存在 = 有执行中任务；执行项全部结束即删除。每项链接其 `docs/plans/`。

## x-basalt-cli MVP

计划：[`docs/plans/2026-06-25-x-basalt-cli-mvp.md`](docs/plans/2026-06-25-x-basalt-cli-mvp.md)

- [x] 阶段 0 · 脚手架（agent 规则 / 配置 / docs / 目录骨架 / skills-def / 样例 vault）
- [x] 阶段 1 · parser（frontmatter / wikilink / tag / callout / task / highlight / blockRef + 去重 + 测试）
- [ ] 阶段 2 · indexer（schema 5 表 / rebuild·update·remove / chokidar 增量 + 测试）
- [ ] 阶段 3 · query（tokenizer→ast→sql + 隐式字段 JOIN + 端到端测试）
- [ ] 阶段 4 · skill + cli（json5 加载 + 模糊匹配 + commander 五子命令）
- [ ] 阶段 5 · 收口（README 校验 / 注释收口 / self-review / 全链路验证）

## 当前停点
阶段 1（parser）已落盘并**验证通过**（typecheck/lint/format:check/test 全绿，26 测试 24 pass + 2 todo 为后续阶段，见计划 Evidence）。下一步从阶段 2（indexer）开始：建 5 表 schema、rebuild/update/remove 事务、chokidar 增量。开发 indexer/query 时召回 `biz-dql-subset`。

---
label: unquoted
due: 2026-07-27
at: 2026-07-01T10:30:00
---
# Unquoted

日期属性**不加引号**——Obsidian 自己写日期属性就是这个形态，真实 vault 普遍如此。

回归点：读侧 YAML 引擎曾用 gray-matter 内置的 js-yaml（YAML 1.1，带 `!!timestamp`
隐式类型），把不加引号的日期解析为 JS `Date`，落库即 `2026-07-27T00:00:00.000Z`
（含毫秒），超出 `parseDateLike` 的严格 ISO 形态 → 退化为普通字符串 → 日期比较
静默失效（只给行级 warning + cell null，查询仍以退出码 0「成功」）。

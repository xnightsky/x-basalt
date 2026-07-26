---
status: active
type: schedule
priority: 5
due: "2026-07-27"
created: "2026-07-01T10:30:00"
related: "[[Alpha]]"
---
# Schedule

P2a formulas fixture：日期/datetime/wikilink frontmatter 全部**加引号**——
不加引号时 gray-matter(js-yaml) 会把 `2026-07-27` 解析为 Date，JSON 序列化带毫秒与 Z
后缀（`2026-07-27T00:00:00.000Z`），超出 parseDateLike 的严格 ISO 形态（语法 §5.1 第 3 条）。

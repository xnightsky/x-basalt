---
due: "2026-07-27"
created: "2026-07-01T10:30:00"
related: "[[CaseB]]"
label: "报告"
---
# CaseE（date/datetime 比较与 wikilink→Link 观察样本；日期加引号保持字符串形态）

正文出链样本（2026-07-29 加，供口径⑲⑳ 的 `file()` 解析与 `linksTo` 取证）：[[CaseB]]

<!--
为什么加在**已有笔记的正文**里，而不是新建一篇：
官方默认数据集把 `.base` 文件自身也算作行，所以 vault 里**每多一个文件**，
所有无 filter 的 view 行数就 +1，26 条既有观察记录当场全部作废、要整批重跑。
改正文只动内容不动文件数——既有行集不变，观察记录仍然有效。
（fixtureHashes 会变，那是**有意的**：提醒重跑时这批 fixture 已经不是上次那份。）
frontmatter 的 `related: "[[CaseB]]"` 不能替代它：linksTo/hasLink 读的是文件出链，
x-basalt 侧实测 frontmatter 里的 wikilink 不计入，恒 false，判不出两种入参语义的差别。
-->


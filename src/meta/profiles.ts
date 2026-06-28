import type { DeriveSource } from "./derive.js";

// === 自建实现: 元数据策略 profile（模板 + 规范 · Phase 3）===
//
// 设计：docs/plans/2026-06-28-meta-derive-profiles.md ；调研：docs/research/2026-06-28-metadata-profiles-research.md
// 一套 profile = 模板（字段及其角色/类型/含义）+ 规范文本。x-basalt 只负责把它「告知」给消费者读，
// 补不补 / 补什么 / AI 还是人，x-basalt 不介入、不调 LLM。机械字段（derive 非空）由 apply 顺手预填。

/** 字段在该约定中的角色。 */
export type FieldRole = "required" | "recommended" | "optional";

export interface ProfileField {
  key: string;
  role: FieldRole;
  /** 期望类型（描述性，供消费者参考）：string / list / datetime / url 等。 */
  type: string;
  /** 机械预填来源；undefined = 由消费者（AI/人）补（语义字段）。 */
  derive?: DeriveSource;
  /** 字段含义——规范的一部分，供消费者读懂该补什么。 */
  note: string;
}

export interface Profile {
  name: string;
  title: string;
  /** 约定来源与版本（含 Draft 锁定）。 */
  source: string;
  /** 这套约定是什么、设计目标（一段，供消费者读）。 */
  summary: string;
  fields: ProfileField[];
  /** 可额外补什么的指引（profile 不限制消费者加规范允许的额外字段）。 */
  extras: string;
}

// === Obsidian 规范来源: 官方 Properties 核心三属性 tags/aliases/cssclasses（均为 List）+ 社区惯例 created/modified/status ===
// pkm-note 是首选/第一推荐 profile —— x-basalt 本就是 Obsidian vault 工具。
const PKM_NOTE: Profile = {
  name: "pkm-note",
  title: "Obsidian 笔记（PKM）",
  source:
    "Obsidian 官方 Properties（tags/aliases/cssclasses 为核心 List 属性）+ 社区常见惯例（created/modified/status）",
  summary:
    "面向 Obsidian vault 的笔记元数据：官方核心三属性 tags/aliases/cssclasses（均为列表）" +
    "+ 常见的 created/modified 时间戳与 status 状态。created/modified 机械取自文件时间；其余按笔记内容由消费者补。",
  fields: [
    {
      key: "tags",
      role: "recommended",
      type: "list",
      note: "主题标签列表（不带 #）。Obsidian 核心属性；按笔记内容由消费者补。",
    },
    {
      key: "aliases",
      role: "optional",
      type: "list",
      note: "别名列表（可含空格）。Obsidian 核心属性。",
    },
    {
      key: "cssclasses",
      role: "optional",
      type: "list",
      note: "CSS 类名列表，控制该笔记渲染样式。Obsidian 核心属性。",
    },
    {
      key: "created",
      role: "recommended",
      type: "datetime",
      derive: "birthtime",
      note: "创建时间（ISO 8601 字符串）。机械取自文件 birthtime（不可靠时回退 mtime）。",
    },
    {
      key: "modified",
      role: "recommended",
      type: "datetime",
      derive: "mtime",
      note: "最后修改时间（ISO 8601 字符串）。机械取自文件 mtime。",
    },
    {
      key: "status",
      role: "optional",
      type: "string",
      note: "笔记状态（如 draft / active / done），按工作流由消费者定。",
    },
  ],
  extras:
    "Obsidian 允许任意自定义属性；消费者可按需补 up / related（MOC 链接）、source、author 等。" +
    "x-basalt 不限制也不强制。",
};

// === 外部规范来源: Google Open Knowledge Format (OKF) v0.1（Draft 2026-05），参考 Karpathy LLM Wiki 模式 ===
const LLM_WIKI: Profile = {
  name: "llm-wiki",
  title: "LLM Wiki（OKF 风格）",
  source: "Google Open Knowledge Format (OKF) v0.1（Draft, 2026-05）；参考 Karpathy LLM Wiki 模式",
  summary:
    "面向 LLM / agent 的极简知识库元数据：让 agent 不读全文即可判断一篇笔记的类型与相关性。" +
    "唯一必填 type；其余为推荐字段，缺失不影响被消费。description 是 agent 判相关性的入口、最重要的可选项。",
  fields: [
    {
      key: "type",
      role: "required",
      type: "string",
      note: "概念类型短字符串（如 note / person / project / source）。OKF 唯一必填，无法机械推断，由消费者按文档内容定。",
    },
    {
      key: "title",
      role: "recommended",
      type: "string",
      note: "人类可读标题。OKF 允许从文件名派生，但 AI 通常能给更准的标题，故不机械补。",
    },
    {
      key: "description",
      role: "recommended",
      type: "string",
      note: "单句摘要——agent 不读正文即可判断相关性的入口，最重要的可选字段。需理解正文，由消费者补。",
    },
    {
      key: "resource",
      role: "recommended",
      type: "url",
      note: "关联的外部资源 URL（如原始来源链接）。",
    },
    {
      key: "tags",
      role: "recommended",
      type: "list",
      note: "主题标签列表（不带 #）。",
    },
    {
      key: "timestamp",
      role: "recommended",
      type: "datetime",
      derive: "mtime",
      note: "最后修改时间（ISO 8601 字符串）。机械取自文件 mtime。",
    },
    {
      key: "sha256",
      role: "optional",
      type: "string",
      derive: "sha256-body",
      note: "正文 sha256（仅对 frontmatter 之后的正文计算），用于检测内容漂移。机械计算。",
    },
  ],
  extras:
    "规范允许按需补充额外字段（如 aliases、用于溯源的 source_url/ingested、status 等）。" +
    "消费者（AI 读规范+文档 / 人）觉得有必要即可加，x-basalt 不限制也不强制。",
};

// === 外部规范来源: Astro Content Collections 约定（title/description/pubDate 必填）；通用于 Hugo/Jekyll/Astro 等 SSG ===
const SSG_BLOG: Profile = {
  name: "ssg-blog",
  title: "静态站点博客（SSG）",
  source:
    "Astro Content Collections（title + description + pubDate 必填）；通用于 Hugo/Jekyll/Astro 等 SSG",
  summary:
    "面向静态站点生成器的博客文章元数据：title / description / pubDate 为发布锚点（必填）；" +
    "updatedDate / draft / tags / slug 可选。pubDate/updatedDate 机械取自文件时间，其余按内容由消费者补。",
  fields: [
    {
      key: "title",
      role: "required",
      type: "string",
      note: "文章标题（SSG 发布锚点）。可从文件名派生，但消费者通常给更准的。",
    },
    {
      key: "pubDate",
      role: "required",
      type: "date",
      derive: "birthtime",
      note: "发布日期（ISO 8601 字符串）。机械取自文件 birthtime（不可靠时回退 mtime）。",
    },
    {
      key: "description",
      role: "required",
      type: "string",
      note: "文章摘要，用于列表页 / SEO / 社交卡片。需理解正文，由消费者补。",
    },
    {
      key: "updatedDate",
      role: "optional",
      type: "date",
      derive: "mtime",
      note: "最后更新日期（ISO 8601 字符串）。机械取自文件 mtime。",
    },
    {
      key: "draft",
      role: "optional",
      type: "boolean",
      note: "草稿标记；true 则多数 SSG 不发布。缺省即视为已发布。",
    },
    {
      key: "tags",
      role: "optional",
      type: "list",
      note: "标签 / 分类列表。",
    },
    {
      key: "slug",
      role: "optional",
      type: "string",
      note: "URL slug；缺省时多数 SSG 按文件名生成。",
    },
  ],
  extras:
    "各 SSG 还有 author / categories / cover / layout / weight / series 等约定字段；消费者按所用 SSG 需要补。",
};

// 插入顺序即推荐顺序：pkm-note（Obsidian）为第一推荐。
const PROFILES: Record<string, Profile> = {
  [PKM_NOTE.name]: PKM_NOTE,
  [LLM_WIKI.name]: LLM_WIKI,
  [SSG_BLOG.name]: SSG_BLOG,
};

/** 列出全部内置 profile。 */
export function listProfiles(): Profile[] {
  return Object.values(PROFILES);
}

/** 取 profile，未知则报错并列出可用名。 */
export function getProfile(name: string): Profile {
  const p = PROFILES[name];
  if (!p) throw new Error(`未知 profile "${name}"，可用：${Object.keys(PROFILES).join(", ")}`);
  return p;
}

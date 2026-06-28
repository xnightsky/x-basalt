import type { DataviewEngine } from "../query/index.js";
import type { ChangeEvent, EventType } from "./types.js";

// === 自建实现: 路由（事件类型 + glob 入口过滤）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §6.4、§14.4 算子 match/glob。
// 自实现简易 glob（`**`=跨目录任意、`*`=同级任意、`?`=单个非 / 字符），不引第三方，守零依赖身份。
// where(dql) 语义路由见 selectByDql（复用 query 层，下个子步加）。

/** 路由过滤条件（取自 PipelineConfig 的 on/paths 子集）。 */
export interface RouteFilter {
  on?: EventType[];
  paths?: string[];
}

/**
 * 把 glob 编译为锚定的 RegExp：
 *   `**` → `.*`（跨目录）；`*` → `[^/]*`（不跨 /）；`?` → `[^/]`；其余字符字面（正则转义）。
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"; // ** 跨目录
        i++; // 跳过第二个 *
      } else {
        re += "[^/]*"; // * 不跨目录
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&"); // 转义正则元字符
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * 事件是否通过入口过滤：on（事件类型白名单）与 paths（glob 白名单）都满足才放行。
 * 缺省项视为不限制。这是「便宜过滤」，先于 where(dql) 跑、不查库。
 *
 * @behavior
 * Given on/paths 都缺省 When matchEvent Then 全放行
 *
 * @behavior
 * Given paths 指定 When 路径不匹配任一 glob Then 拒绝
 *
 * @behavior
 * Given on 与 paths 同时给 When 二者之一不满足 Then 拒绝
 */
export function matchEvent(ev: ChangeEvent, filter: RouteFilter): boolean {
  if (filter.on && !filter.on.includes(ev.type)) return false;
  if (filter.paths && filter.paths.length > 0) {
    if (!filter.paths.some((g) => globToRegExp(g).test(ev.path))) return false;
  }
  return true;
}

/**
 * DQL 语义路由：执行 DQL 取命中文件的相对路径集（供管道按语义条件筛选哪些文件跑写动作）。
 * 从结果行收集 `file.path`（LIST/TASK 固定含此列）与 `rows`（GROUP BY 的 path 数组）。
 *
 * 索引新鲜度纪律（spec §6.4）：DQL 读的是**索引**而非磁盘——watch/手动流必须先跑 `index`
 * 动作把本批变更落库，再用 selectByDql 路由，否则会按陈旧索引选错/漏选。这一顺序由 engine 保证。
 *
 * @throws DqlSyntaxError DQL 越界/字段不支持——不静默返回空集（避免误判为"无命中"）。
 *
 * @behavior
 * Given `LIST FROM #pkm` When selectByDql Then 返回带 #pkm 标签文件的相对路径集
 *
 * @behavior
 * Given 非法 DQL When selectByDql Then 抛错（不静默空选）
 */
export function selectByDql(engine: DataviewEngine, dql: string): Set<string> {
  const result = engine.query(dql);
  const paths = new Set<string>();
  for (const row of result.rows) {
    const p = row["file.path"];
    if (typeof p === "string") paths.add(p);
    // GROUP BY 查询：rows 列是该组的文件路径数组。
    const grouped = row.rows;
    if (Array.isArray(grouped)) {
      for (const r of grouped) if (typeof r === "string") paths.add(r);
    }
  }
  return paths;
}

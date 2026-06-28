import type { ChangeEvent, EventType } from "./types.js";

// === 自建实现: 事件去重折叠（L2 路径 LWW + L3 类型折叠）===
//
// 设计：docs/specs/2026-06-29-change-orchestration-design.md §6.3（折叠规则表）；§14.3 算子 `coalesce`/`foldEvents`。
// 借鉴：@parcel/watcher 在 C++ 层对同文件事件做折叠（add+delete 抵消）——此处用纯逻辑在 JS 层等价实现。
// 纯函数：一批事件 → 每文件最多一个折叠后事件；按 path 首次出现顺序输出；不碰 fs/DB。

/**
 * 类型折叠状态转移：给定该文件已折叠到的类型 prev 与新到事件类型 next，返回新折叠类型；
 * "cancel" 表示 add 后又 unlink（文件净未出现），应丢弃该文件不产出任何动作。
 *
 * 规则（spec §6.3）：
 *   add  + change → add        （新建后编辑仍是新建）
 *   add  + unlink → cancel     （建了又删 = 无）
 *   change + unlink → unlink
 *   change + change/add → change
 *   unlink + add/change → change（删了又出现 = 改）
 */
function fold(prev: EventType, next: EventType): EventType | "cancel" {
  if (prev === "add") return next === "unlink" ? "cancel" : "add";
  if (prev === "change") return next === "unlink" ? "unlink" : "change";
  // prev === "unlink"
  return next === "unlink" ? "unlink" : "change";
}

/**
 * 折叠一批变更事件：按 path 归并，类型按 {@link fold} 状态机折叠，mtime/size 取最后事件（LWW）。
 *
 * @param events - 按时间先后排列的事件批
 * @returns 每文件至多一个事件（add+unlink 抵消则不含该文件），按首次出现顺序
 *
 * @behavior
 * Given 同文件 add 后多次 change When fold Then 折叠为单个 add（LWW 取最新 mtime）
 *
 * @behavior
 * Given 同文件 add 后 unlink When fold Then 抵消，输出不含该文件
 *
 * @behavior
 * Given 已折叠批 When 再次 fold Then 结果逐元素不变（幂等）
 */
export function foldEvents(events: ChangeEvent[]): ChangeEvent[] {
  // Map 保持插入顺序：首次出现即定序；对已存在 key 的 set 不改顺序（JS 语义）。
  const map = new Map<string, ChangeEvent>();
  for (const e of events) {
    const prev = map.get(e.path);
    if (!prev) {
      map.set(e.path, { ...e });
      continue;
    }
    const next = fold(prev.type, e.type);
    if (next === "cancel") {
      map.delete(e.path);
      continue;
    }
    // 取最新事件的 mtime/size（LWW），类型用折叠结果；结构与输入事件一致（幂等友好）。
    map.set(e.path, { ...e, type: next });
  }
  return [...map.values()];
}

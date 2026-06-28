import { stringify as stringifyYaml } from "yaml";

// === 自建实现: CLI 输出格式化（json / yaml）===
//
// 上游：cli.ts 各子命令；下游：stdout。
// yaml 用 `yaml` 包序列化（M4.2）：正确转义特殊键/值（含 `:`、空格、Date→timestamp），
// 替代旧手写 toYaml（键直接拼 `${k}:` 不转义，特殊键产出非法 YAML，C5）。

/**
 * 序列化为 YAML 文本（`yaml` 包，键值合法转义）。
 *
 * @param data - 任意 JSON 形态（解析/查询输出的对象/数组/标量）
 * @returns YAML 文本（去尾换行，便于 console.log 不产生多余空行）
 */
export function toYaml(data: unknown): string {
  return stringifyYaml(data).trimEnd();
}

/**
 * 按 format 输出到 stdout：json（默认，缩进 2）或 yaml。
 *
 * @param data - 待输出数据
 * @param format - "json"（默认）| "yaml"
 */
export function emit(data: unknown, format = "json"): void {
  if (format === "yaml") console.log(toYaml(data));
  else console.log(JSON.stringify(data, null, 2)); // 未知 format 静默降级为 JSON（不抛错）；实践中仅 "json" | "yaml" 两值合法
}

import type { Op } from "./types.js";

// === 自建实现: 算子注册表（设计：docs/design/pipeline-op-model.md §3.3）===
//
// 集中注册表，供 CLI 子命令与管道步骤统一取算子。
// 注册表初始为空，由外部调用 register 填充。
// 允许重复 register 同名算子以覆盖（便于测试替身注入）。

type OpFactory = (params: string) => Op;

const registry = new Map<string, OpFactory>();

/**
 * 注册一个算子工厂。
 * 允许同名重复注册以覆盖，便于测试替身注入。
 */
export function register(name: string, factory: OpFactory): void {
  registry.set(name, factory);
}

/**
 * 解析 spec 字符串为 Op 实例。
 *
 * spec 格式：第一个空格前为算子名，空格后为参数原样传给 factory。
 * 无参数时 params 为空字符串。
 * 未注册的算子名抛出清晰的中文错误，信息包含当前所有已注册的算子名。
 */
export function resolve(spec: string): Op {
  const trimmed = spec.trim();
  const spaceIndex = trimmed.indexOf(" ");
  const name = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const params = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

  const factory = registry.get(name);
  if (!factory) {
    const registered = [...registry.keys()];
    throw new Error(
      `未知操作 "${name}"，已注册：${registered.length > 0 ? registered.join(", ") : "（无）"}`,
    );
  }

  return factory(params);
}

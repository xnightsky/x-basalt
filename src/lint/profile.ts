import { getProfile, listProfiles } from "../meta/index.js";

// === 自建实现: 自定义 config profile 解析（extends 合并；KB compiler P3b）===
//
// 设计真相源：docs/specs/2026-07-09-kb-compiler-lint-links-design.md §8.2。
// 分层：`ProfileConfig` 是 `.x-basalt/config` 的 `profiles.<name>` 原始解析形状（由 src/config.ts
// 的 parseProfiles 宽容挑键产出，不解 extends、不校验父）；`resolveLintProfile` 再把它按 extends
// 合并成可直接校验的 `LintProfile`。config.ts import type 本文件，避免反向依赖实现。
// 内置基线只读取：`getProfile(name)` 取 role==='required' 字段（内置无 enum），不改写侧。

/** `profiles.<name>` 的原始配置形状（未解析 extends）。全部可选，宽容解析。 */
export interface ProfileConfig {
  /** 单父继承（内置 profile 名或另一个 config profile 名）；解析期做合并与环检测。 */
  extends?: string;
  /** 追加的必填字段（与父级 required 取并集）。 */
  required?: string[];
  /** 字段 → 允许值集（enum 校验；与父级按字段合并，只加不减）。 */
  enums?: Record<string, string[]>;
  /** 只校验匹配该 glob 的文件（可选；缺省 = 全 vault + lint.ignore）。 */
  include?: string;
}

/** extends 合并后的可校验 profile：required 清单 + enum 允许集 + 可选 include glob。 */
export interface LintProfile {
  name: string;
  required: string[];
  enums: Record<string, string[]>;
  include?: string;
}

/** 内置 profile 名清单（供报错提示与 extends 父存在性判断）。 */
function builtinNames(): string[] {
  return listProfiles().map((p) => p.name);
}

/** 追加去重并集：保留 base 顺序，再追加 add 中的新项。 */
function unionPush(base: readonly string[], add: readonly string[]): string[] {
  const out = [...base];
  for (const x of add) if (!out.includes(x)) out.push(x);
  return out;
}

/** 按字段合并 enum 允许集：同字段值取并集去重（只加不减）。 */
function mergeEnums(
  base: Record<string, string[]>,
  add: Record<string, string[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(base)) out[k] = [...v];
  for (const [k, v] of Object.entries(add)) out[k] = unionPush(out[k] ?? [], v);
  return out;
}

/**
 * 递归解析单个 profile：config profile 先解析父（extends）再合并，内置则读 role==='required'。
 * seen 记录 extends 链上已访问的 config profile 名，用于环检测。
 */
function resolveInternal(
  name: string,
  configProfiles: Record<string, ProfileConfig>,
  seen: Set<string>,
): LintProfile {
  if (seen.has(name)) {
    throw new Error(`profile extends 存在环：${[...seen, name].join(" → ")}`);
  }
  const cfg = configProfiles[name];
  if (cfg !== undefined) {
    seen.add(name);
    let base: LintProfile = { name, required: [], enums: {} };
    if (cfg.extends !== undefined) {
      const parent = cfg.extends;
      if (configProfiles[parent] === undefined && !builtinNames().includes(parent)) {
        throw new Error(
          `profile "${name}" 的 extends 指向未知父 "${parent}"（既非自定义 profile 也非内置：${builtinNames().join(", ")}）`,
        );
      }
      base = resolveInternal(parent, configProfiles, seen);
    }
    return {
      name,
      required: unionPush(base.required, cfg.required ?? []),
      enums: mergeEnums(base.enums, cfg.enums ?? {}),
      include: cfg.include ?? base.include,
    };
  }
  // 非 config profile → 回退内置：只读 required 基线（getProfile 未知则定向报错列可用名）。
  const builtin = getProfile(name);
  return {
    name,
    required: builtin.fields.filter((f) => f.role === "required").map((f) => f.key),
    enums: {},
  };
}

/**
 * 把 `--profile <name>` 解析成可校验的 LintProfile。
 * name 是 config profile 就用之（**同名覆盖内置**），否则回退内置；两者都不是则定向报错。
 * extends 合并语义（design §8.2）：单父、子覆盖父、required 并集、enums 按字段并集（只加不减）、
 * include 子覆盖父、环检测、未知父定向报错。
 */
export function resolveLintProfile(
  name: string,
  configProfiles: Record<string, ProfileConfig>,
): LintProfile {
  if (configProfiles[name] === undefined && !builtinNames().includes(name)) {
    const custom = Object.keys(configProfiles);
    throw new Error(
      `未知 profile "${name}"（自定义：${custom.length > 0 ? custom.join(", ") : "无"}；内置：${builtinNames().join(", ")}）`,
    );
  }
  return resolveInternal(name, configProfiles, new Set());
}

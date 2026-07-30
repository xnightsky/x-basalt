/**
 * base 模块 P2b 片二：`.obsidian/types.json` 可选只读显式类型表（BASE-TYPE-001..003，语法 §5.1 第 1 条）。
 *
 * 为什么独立成文件而非并入 source.ts：source.ts 是「SQLite 索引 → BaseRow」的纯 DB 读取边界
 * （固定 SQL、不碰 vault 文件系统）；types.json 是 vault 内的 fs 只读，与 document.ts 读 .base
 * 同属一类但又不属于 .base 文档层 schema——单独模块让两类只读边界各自单一职责。
 *
 * 行为契约（P2b 计划「关键取舍」#5-#7）：
 * - 逐根尝试读 `<root>/.obsidian/types.json`（readFileSync 只读，**永不写回**；不存在不报错）；
 * - 期望形状 `{ "types": { <prop>: <type> } }`——调研「未决问题」#2 已声明该形状非稳定协议，
 *   解析一律防御：JSON 非法 / 顶层无 types map → warning + 该根全量回退 YAML 推断（BASE-TYPE-003）；
 * - 类型名识别 text|number|checkbox|date|datetime|multitext|tags|aliases（大小写不敏感收纳为
 *   小写；未知类型名 → 该条目忽略 + warning，不崩）；
 * - 多根逐根合并；同名冲突 → warning + **先根优先**（暂定，待 oracle 校正）；
 * - 全部根缺失文件 → 一条 compat info（BASE-TYPE-002：按 YAML 值推断，不失败），每次调用至多一条；
 *   部分根缺失（其余根有文件）静默跳过——多根下 .obsidian 按根自治是常态，不刷屏。
 *
 * 诊断 rule 复用 base/invalid-schema（不新增 rule）：types.json 的解析/形状问题与 .base 的
 * schema 校验同属「配置形状不合法」；base/property-type-mismatch 保留给行级「声明类型 vs
 * 实际值」冲突（TYPE-004，见 evaluator.ts applyDeclaredType），两层语义不混。
 *
 * 不变量：本模块只读 `<root>/.obsidian/types.json` 一个路径，不读 vault 其他配置、不写任何文件。
 * 设计真相源：docs/design/bases-engine.md §8.2 / §14（不写 types.json）。
 */

import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { BasaltDiagnostic } from "../diagnostic.js";
import { BASE_RULES, baseDiagnostic } from "./errors.js";

// === 自建实现 ===

/** types.json 可识别的显式类型名全集（小写收纳后比较，语法 §5.1 / 计划「关键取舍」#5）。 */
const KNOWN_TYPE_NAMES: ReadonlySet<string> = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "multitext",
  "tags",
  "aliases",
]);

/** 文件级诊断定位：types.json 问题不做行级 span（JSON.parse 错误位置口径不稳定），恒指 1:1。 */
const FILE_SPAN = { line: 1, column: 1 } as const;

/** 类型表读取结果：合并后的 prop → type（小写）+ 本次读取全部诊断（顺序确定，字节稳定前提）。 */
export interface BaseTypeSchema {
  table: Record<string, string>;
  diagnostics: BasaltDiagnostic[];
}

/**
 * 诊断 file 字段用的 vault 相对显示路径：单根恒 `.obsidian/types.json`；多根加 `<根目录名>/`
 * 前缀，与 indexer 多根命名空间键（`<根目录名>/<相对>`，见 source.ts 模块头）口径一致。
 */
function displayPath(resolvedRoot: string, multiRoot: boolean): string {
  return multiRoot ? `${basename(resolvedRoot)}/.obsidian/types.json` : ".obsidian/types.json";
}

/**
 * 读取并合并各 vault 根的 `.obsidian/types.json`（不 throw：一切问题以诊断表达并回退推断）。
 *
 * @param vaultRoots - vault 根绝对/相对路径列表（与 BaseQueryOptions.vaultRoots 同参）
 */
export function loadBaseTypeSchema(vaultRoots: string[]): BaseTypeSchema {
  // null 原型表：类型表 key 来自用户文件，恶意属性名（__proto__/constructor）不得触原型链
  // （与 BASE-SEC-009 同源防御；Object.hasOwn 判定冲突同理避开原型键）。
  const table: Record<string, string> = Object.create(null) as Record<string, string>;
  const diagnostics: BasaltDiagnostic[] = [];
  const multiRoot = vaultRoots.length > 1;
  let missingRoots = 0;

  for (const root of vaultRoots) {
    const resolvedRoot = resolve(root);
    const file = displayPath(resolvedRoot, multiRoot);
    const abs = join(resolvedRoot, ".obsidian", "types.json");

    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        // 缺失不报错：逐根计数，全部缺失时在循环后统一补一条 compat info（BASE-TYPE-002）。
        missingRoots += 1;
        continue;
      }
      // 其余 IO 错误（权限等）：warning + 该根回退推断，不阻断查询。
      diagnostics.push(
        baseDiagnostic(
          file,
          FILE_SPAN,
          BASE_RULES.invalidSchema,
          "warning",
          `.obsidian/types.json 读取失败，该根按 YAML 值推断属性类型：${(e as Error).message}`,
          { target: file, reason: "types_json_unreadable" },
        ),
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // JSON 非法 → warning + 该根全量回退推断（BASE-TYPE-003；绝不尝试修复/写回）。
      diagnostics.push(
        baseDiagnostic(
          file,
          FILE_SPAN,
          BASE_RULES.invalidSchema,
          "warning",
          `.obsidian/types.json 不是合法 JSON，该根按 YAML 值推断属性类型（BASE-TYPE-003）：${(e as Error).message}`,
          { target: file, reason: "types_json_invalid" },
        ),
      );
      continue;
    }

    // 防御形状（调研「未决问题」#2：非稳定协议）：顶层必须是含 types 普通对象的普通对象。
    const typesValue =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).types
        : undefined;
    if (typeof typesValue !== "object" || typesValue === null || Array.isArray(typesValue)) {
      diagnostics.push(
        baseDiagnostic(
          file,
          FILE_SPAN,
          BASE_RULES.invalidSchema,
          "warning",
          '.obsidian/types.json 顶层缺少 types 属性映射（期望 { "types": { <prop>: <type> } }），' +
            "该根按 YAML 值推断属性类型（BASE-TYPE-003）",
          { target: file, reason: "types_json_no_types_map" },
        ),
      );
      continue;
    }

    for (const [prop, typeName] of Object.entries(typesValue as Record<string, unknown>)) {
      // 类型名大小写不敏感收纳为小写；非字符串值按不可识别处理（防御，不猜）。
      const lower = typeof typeName === "string" ? typeName.toLowerCase() : "";
      if (!KNOWN_TYPE_NAMES.has(lower)) {
        diagnostics.push(
          baseDiagnostic(
            file,
            FILE_SPAN,
            BASE_RULES.invalidSchema,
            "warning",
            `.obsidian/types.json 中属性 "${prop}" 的类型名 ${JSON.stringify(typeName)} 不可识别，` +
              `该条目已忽略（可识别：${[...KNOWN_TYPE_NAMES].join("/")}）`,
            { target: prop, reason: "types_json_unknown_type" },
          ),
        );
        continue;
      }
      if (Object.hasOwn(table, prop)) {
        // 多根同名冲突 → warning + 先根优先（暂定，待 oracle 校正；计划「关键取舍」#5）。
        diagnostics.push(
          baseDiagnostic(
            file,
            FILE_SPAN,
            BASE_RULES.invalidSchema,
            "warning",
            `属性 "${prop}" 在多个 vault 根的 types.json 中重复声明（已生效 "${table[prop]}" / ` +
              `本根声明 "${lower}"）：按先根优先采用 "${table[prop]}"（暂定，待 oracle）`,
            { target: prop, reason: "types_json_conflict" },
          ),
        );
        continue;
      }
      table[prop] = lower;
    }
  }

  // 全部根缺失文件 → 恰好一条 compat info（BASE-TYPE-002：按 YAML 值推断是兼容行为，不失败）。
  if (vaultRoots.length > 0 && missingRoots === vaultRoots.length) {
    diagnostics.push(
      baseDiagnostic(
        displayPath(resolve(vaultRoots[0] as string), multiRoot),
        FILE_SPAN,
        BASE_RULES.invalidSchema,
        "info",
        "未找到任何 vault 根的 .obsidian/types.json：按 YAML 值与严格日期格式推断属性类型" +
          "（BASE-TYPE-002 兼容行为，非错误）",
        { reason: "types_json_missing" },
      ),
    );
  }

  return { table, diagnostics };
}

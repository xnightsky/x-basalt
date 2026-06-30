import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

// === 自建实现: 路径归一化与连接键工具 ===
//
// 本文件是 parser / indexer / query 三层共用的「连接键真相源」。
// 上游：parser 提取 wikilink target 后调 linkKey/pathKey 生成 ObsidianNode 的匹配键；
//       indexer 写入 links 表时以 pathKey 存储 source/target；
//       query 做 bare/qualified 链接 JOIN 匹配时以 linkKey/pathKey 查索引。
// 不变量：indexer 写入侧与 query 查询侧必须调用同一套 linkKey/pathKey 函数生成键；
//         任一侧自行实现等价逻辑会导致 bare/qualified 链接匹配漏命中。

/**
 * 把任意平台的路径分隔符归一化为 POSIX 正斜杠。
 *
 * 索引内的 `files.path` / `links.source` 等一律以 POSIX 形式存储，
 * 使 Windows（反斜杠）与 *nix 产出的索引可移植、且 DQL `FROM "folder"` 的前缀匹配跨平台一致。
 *
 * @param p - 原始路径（可能含反斜杠）
 */
export function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

// === Obsidian 规范来源: 支持 embed 的媒体资源格式（图片/视频/音频/PDF）===
// 非此列表的 embed target（如 .md）视为笔记嵌入，由 linkKey/pathKey 处理。
/** Obsidian 资源型 embed 的扩展名（非笔记，按资源处理）。 */
const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
]);

/**
 * 由 wikilink target 推导用于匹配的规范化 key：去扩展名 + 小写 basename。
 * bare 链接（`[[Note]]`）与同名歧义回退时使用（大小写不敏感）。
 *
 * Obsidian 链接规范：`[[Note]]` 与 `[[Note.md]]` 等价（target 可省略扩展名），
 * 且链接解析大小写不敏感——故 key 去 extname、basename 全小写。
 *
 * @param target - wikilink 的 target 段，如 `Folder/Note` 或 `image.png`
 */
export function linkKey(target: string): string {
  return basename(target, extname(target)).toLowerCase();
}

/**
 * 由 path-qualified wikilink target（或文件相对路径）推导路径键：去扩展名 + POSIX + 小写。
 *
 * 仅当 target 含 `/`（指定了目录）时有区分意义——用于 inlinks/outlinks 的精确匹配，
 * 消除同名异目录串味（S3.2）：`Projects/Alpha` 与 `Archive/Alpha` 得到不同 key。
 * 对无目录的 bare 名退化为与 {@link linkKey} 相同的小写 basename。
 *
 * @param target - wikilink target（如 `Projects/Alpha`）或文件相对路径（如 `Projects/Alpha.md`）
 * @returns 形如 `projects/alpha`
 */
export function pathKey(target: string): string {
  const noExt = target.slice(0, target.length - extname(target).length);
  return toPosix(noExt).toLowerCase();
}

/**
 * 判断 embed 目标是否为资源文件（图片/媒体/PDF）而非笔记嵌入。
 *
 * @param target - embed 的 target 段
 */
export function isAssetEmbed(target: string): boolean {
  return ASSET_EXTENSIONS.has(extname(target).toLowerCase());
}

// === 自建实现: vault 多根解析（按根命名空间 keying，无公共祖先 base）===
//
// 上游：indexer / orchestrator 构造时把 `vault`（单串或多串）解析成 VaultLayout；
// 下游：indexer 遍历 roots 收集 .md、以 toKey 算 files.path 主键；编排器动作以 toAbs 还原 .md 绝对路径。
// 设计要点（刻意不取公共祖先 base，避免其在「多根相距很远」时膨胀到接近文件系统根 `/`，
// 进而把主键拉成又长又近乎绝对的路径、并泄露绝对前缀）：
//   - 单根：主键 = 相对该根的 POSIX 路径（与历史单根行为字节级一致，向后兼容）。
//   - 多根：主键 = `<根目录名>/<相对该根>`，根目录名作命名空间——keys 永远短且根内相对，
//     不随根之间的物理距离变长、不泄露绝对前缀；watch 始终只盯 roots，base 概念被彻底移除。
//   - 根目录名（basename）冲突即报错（多根需各自目录名互异；显式命名留作后续）。
// 不变量：写侧 toKey 与读侧 toAbs 互逆；编排器经同一 VaultLayout（实为同一 indexer）解析，保证一致。

/** vault 物理布局：实际遍历/监听的根集合 + 主键↔绝对路径互转。 */
export interface VaultLayout {
  /** 实际遍历/监听的根（已 resolve / 去重 / 剔子根）。 */
  roots: string[];
  /** 绝对路径 → 索引主键（POSIX）。 */
  toKey(abs: string): string;
  /** 索引主键（或绝对 / cwd 相对路径）→ 绝对路径。 */
  toAbs(input: string): string;
}

/** p 是否严格位于 q 之下（同分隔符前缀；q 自身不算其子）。 */
function isStrictlyUnder(p: string, q: string): boolean {
  return p !== q && p.startsWith(q.endsWith(sep) ? q : q + sep);
}

/**
 * 解析 vault 输入为 {@link VaultLayout}：resolve + 去重 + 剔除被包含的子根（保留更上层根 = 两者并集，
 * 避免同一文件经父子两根重复入库）。
 *
 * @param input - 单目录字符串或多目录字符串数组
 * @throws 多根目录名（basename）冲突时报错（命名空间需唯一）
 *
 * @behavior
 * Given 单个根目录
 * When resolveVaultLayout
 * Then toKey 返回相对该根的 POSIX 路径（无命名空间前缀，与历史单根行为字节级一致）
 *
 * @behavior
 * Given 多个根目录、目录名互不相同
 * When resolveVaultLayout
 * Then toKey 返回 `<根目录名>/<相对该根>`，各根以目录名作命名空间、互不撞键
 *
 * @behavior
 * Given 两根相距很远（公共祖先会退到 /tmp 甚至 /）
 * When resolveVaultLayout
 * Then 主键仍为 `<根目录名>/<相对>`，不随物理距离变长、不泄露绝对前缀（不取公共祖先 base）
 *
 * @behavior
 * Given 多根中存在被另一根包含的子根（或重复根）
 * When resolveVaultLayout
 * Then 去重并剔除子根，只保留更上层的根（= 两者并集），避免同一文件重复入库
 *
 * @behavior
 * Given 多根中两根目录名（basename）相同
 * When resolveVaultLayout
 * Then 抛错（命名空间需唯一，提示改用互不同名的目录）
 */
export function resolveVaultLayout(input: string | string[]): VaultLayout {
  const resolved = (Array.isArray(input) ? input : [input]).map((p) => resolve(p));
  const uniq = [...new Set(resolved)];
  if (uniq.length === 0) throw new Error("vault 不能为空");
  const roots = uniq.filter((p) => !uniq.some((q) => isStrictlyUnder(p, q)));

  // 单根：与历史单根行为字节级一致（无命名空间前缀），向后兼容。
  if (roots.length === 1) {
    const root = roots[0] as string;
    return {
      roots,
      toKey: (abs) => toPosix(relative(root, abs)),
      toAbs: (p) => {
        if (isAbsolute(p)) return p;
        const fromCwd = resolve(p);
        return fromCwd === root || fromCwd.startsWith(root + sep) ? fromCwd : join(root, p);
      },
    };
  }

  // 多根：目录名作命名空间；冲突即报错。
  const labelToRoot = new Map<string, string>();
  for (const root of roots) {
    const label = basename(root);
    const prev = labelToRoot.get(label);
    if (prev !== undefined) {
      throw new Error(
        `vault 多根目录名冲突：'${prev}' 与 '${root}' 同名 '${label}'；多根以目录名作命名空间，请改用互不同名的目录`,
      );
    }
    labelToRoot.set(label, root);
  }
  const rootToLabel = new Map([...labelToRoot].map(([l, r]) => [r, l] as [string, string]));
  // longest-prefix 找 owning root（按路径长度降序，先匹配更深的根）。
  const byLen = roots.toSorted((a, b) => b.length - a.length);
  const ownerOf = (abs: string): string | undefined =>
    byLen.find((r) => abs === r || abs.startsWith(r + sep));

  return {
    roots,
    toKey: (abs) => {
      const root = ownerOf(abs);
      if (root === undefined) return toPosix(abs); // 兜底：理论上不属于任何根
      return `${rootToLabel.get(root)}/${toPosix(relative(root, abs))}`;
    },
    toAbs: (p) => {
      if (isAbsolute(p)) return p;
      const fromCwd = resolve(p);
      if (ownerOf(fromCwd) !== undefined) return fromCwd; // cwd 相对且落在某根内
      const slash = p.indexOf("/");
      const label = slash === -1 ? p : p.slice(0, slash);
      const root = labelToRoot.get(label);
      if (root !== undefined) return join(root, slash === -1 ? "" : p.slice(slash + 1));
      return join(roots[0] as string, p); // 无已知命名空间前缀：保守退回首个根
    },
  };
}

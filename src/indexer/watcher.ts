import chokidar from "chokidar";
import { basename } from "node:path";

// === 自建实现: chokidar 监听封装。跳过 .obsidian/ 与隐藏文件，仅关心 .md ===
//
// 上游：VaultIndexer.watch()；下游：把 add/change/unlink 投影成增量索引调用。
// 跳过策略放在 ignored（隐藏路径）+ 回调内 .md 过滤两道：ignored 拦目录/隐藏项，
// 回调过滤确保只有 Markdown 触发索引（chokidar 的 ignored 难以可靠区分目录与文件）。

/** 文件事件回调集合。 */
export interface WatchHandlers {
  /** 新 `.md` 文件出现时调用；`filePath` 为 chokidar 提供的绝对路径（已通过 isMarkdown 过滤）。 */
  onAdd(filePath: string): void;
  /** `.md` 文件内容变更时调用；`filePath` 为绝对路径；awaitWriteFinish 保证文件已稳定写完。 */
  onChange(filePath: string): void;
  /** `.md` 文件被删除时调用；`filePath` 为绝对路径；此时文件已不在 FS 上，不可再读。 */
  onUnlink(filePath: string): void;
  /** 监听器错误（句柄耗尽/权限等）。不提供则仅吞掉，避免未处理 error 事件崩进程（I1）。 */
  onError?(err: unknown): void;
  /** 初始扫描完成（chokidar ready）：此后的文件变更才是真正的增量。 */
  onReady?(): void;
}

/** 任意路径段以 `.` 开头即视为隐藏（含 `.obsidian/`、`.git/`、`.DS_Store` 等）。 */
function isHidden(p: string): boolean {
  // 同时兼容正反斜杠分隔，命中任一隐藏段即忽略。
  return /(^|[\\/])\.[^\\/]+/.test(p);
}

/** 仅 `.md` 文件参与索引。 */
function isMarkdown(p: string): boolean {
  return basename(p).toLowerCase().endsWith(".md");
}

/**
 * 启动对 Vault 目录的监听，返回停止函数。
 * 仅就 `.md` 触发回调，忽略 `.obsidian/` 与隐藏文件；`ignoreInitial` 避免启动时把存量文件当新增。
 *
 * @param vaultPath - Vault 根目录
 * @param handlers - add/change/unlink 回调
 * @returns 调用以停止监听
 *
 * @behavior
 * Given Vault 目录内已有 .md 文件
 * When startWatch 启动
 * Then 存量文件不触发 onAdd（ignoreInitial=true），仅后续新增才触发，避免重启时重复全量触发
 *
 * @behavior
 * Given 同一文件被连续写入（编辑器多次 flush）
 * When 100ms 稳定窗口内仍有写操作
 * Then 仅在最后一次写操作稳定后触发一次 onChange，避免索引读到半写文件
 */
export function startWatch(vaultPath: string, handlers: WatchHandlers): () => void {
  const watcher = chokidar.watch(vaultPath, {
    ignored: (p: string) => isHidden(p),
    ignoreInitial: true,
    // stabilityThreshold 100ms：覆盖主流编辑器保存节奏，防止半写触发；pollInterval 20ms 平衡检测延迟与 CPU 开销。
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
  });

  watcher.on("add", (p) => {
    if (isMarkdown(p)) handlers.onAdd(p);
  });
  watcher.on("change", (p) => {
    if (isMarkdown(p)) handlers.onChange(p);
  });
  watcher.on("unlink", (p) => {
    if (isMarkdown(p)) handlers.onUnlink(p);
  });
  // I1：chokidar 的 error 事件若无监听器，Node 会作为未处理错误抛出并可能崩进程。
  watcher.on("error", (err) => handlers.onError?.(err));
  watcher.on("ready", () => handlers.onReady?.());

  return () => {
    void watcher.close();
  };
}

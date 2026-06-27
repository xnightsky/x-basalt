import chokidar from "chokidar";
import { basename } from "node:path";

// === 自建实现: chokidar 监听封装。跳过 .obsidian/ 与隐藏文件，仅关心 .md ===
//
// 上游：VaultIndexer.watch()；下游：把 add/change/unlink 投影成增量索引调用。
// 跳过策略放在 ignored（隐藏路径）+ 回调内 .md 过滤两道：ignored 拦目录/隐藏项，
// 回调过滤确保只有 Markdown 触发索引（chokidar 的 ignored 难以可靠区分目录与文件）。

/** 文件事件回调集合。 */
export interface WatchHandlers {
  onAdd(filePath: string): void;
  onChange(filePath: string): void;
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
 */
export function startWatch(vaultPath: string, handlers: WatchHandlers): () => void {
  const watcher = chokidar.watch(vaultPath, {
    ignored: (p: string) => isHidden(p),
    ignoreInitial: true,
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

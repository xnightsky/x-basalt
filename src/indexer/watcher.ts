// === 自建实现: chokidar 监听封装。跳过 .obsidian/ 与隐藏文件 ===

/** 文件事件回调集合。 */
export interface WatchHandlers {
  onAdd(filePath: string): void;
  onChange(filePath: string): void;
  onUnlink(filePath: string): void;
}

/**
 * 启动对 Vault 目录的监听，返回停止函数。
 * 仅监听 `.md`，忽略 `.obsidian/` 与隐藏文件。
 *
 * @param vaultPath - Vault 根目录
 * @param handlers - add/change/unlink 回调
 * @returns 调用以停止监听
 */
export function startWatch(vaultPath: string, handlers: WatchHandlers): () => void {
  void vaultPath;
  void handlers;
  throw new Error("not implemented: startWatch（阶段 2）");
}

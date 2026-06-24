// === 自建实现: Vault 索引器，唯一写 SQLite 的边界，不内联 DQL ===

/** 索引器构造选项。 */
export interface IndexerOptions {
  /** Vault 根目录 */
  vaultPath: string;
  /** SQLite 索引文件路径 */
  dbPath: string;
}

/**
 * Vault 索引器：调 VaultParser 解析 `.md`，写入 SQLite，chokidar 负责增量。
 * 阶段 2 实现。
 */
export class VaultIndexer {
  constructor(opts: IndexerOptions) {
    void opts;
  }

  /** 全量扫描 Vault 下所有 `.md` 重建索引。 */
  async rebuild(): Promise<void> {
    throw new Error("not implemented: VaultIndexer.rebuild（阶段 2）");
  }

  /**
   * 增量更新单个文件的索引。
   *
   * @param filePath - 相对 Vault 的文件路径
   */
  async update(filePath: string): Promise<void> {
    void filePath;
    throw new Error("not implemented: VaultIndexer.update（阶段 2）");
  }

  /**
   * 删除单个文件的索引记录。
   *
   * @param filePath - 相对 Vault 的文件路径
   */
  remove(filePath: string): void {
    void filePath;
    throw new Error("not implemented: VaultIndexer.remove（阶段 2）");
  }

  /** 启动 chokidar 监听，增量维护索引。 */
  watch(): void {
    throw new Error("not implemented: VaultIndexer.watch（阶段 2）");
  }

  /** 关闭数据库连接与监听。 */
  close(): void {
    throw new Error("not implemented: VaultIndexer.close（阶段 2）");
  }
}

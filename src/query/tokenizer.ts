// === 自建实现: DQL 词法分析（手写 tokenizer，阶段 3）===

/** 词法单元。 */
export interface Token {
  kind: string;
  value: string;
  /** 在源串中的起始偏移，用于报错定位 */
  pos: number;
}

/**
 * 将 DQL 字符串切分为 token 流。
 *
 * @param dql - 原始 DQL 查询语句
 */
export function tokenize(dql: string): Token[] {
  void dql;
  throw new Error("not implemented: tokenize（阶段 3）");
}

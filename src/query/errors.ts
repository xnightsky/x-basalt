// === 自建实现: DQL 词法/语法错误（携带源串位置以便定位，设计 §5）===

/** DQL 词法/语法错误，`pos` 为源串字符偏移，便于调用方高亮定位。 */
export class DqlSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`DQL 语法错误 (位置 ${pos}): ${message}`);
    this.name = "DqlSyntaxError";
    this.pos = pos;
  }
}

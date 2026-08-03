/**
 * 动态 base 第一步：stdin 读取（DB-3a，计划 2026-08-03-bases-dynamic-stdin.md）。
 *
 * 为什么读完再解析：`x-basalt base -` / `--stdin` 的语义是「一份 .base 定义整体来自管道」，
 * 边读边解析会让 YAML 解析器拿到残缺文档（与 orchestrator readPathList 的「读完再解析」
 * 同因——上游产出完整批次后才执行）。流经参数注入（不直接摸 process.stdin）以便测试用
 * Readable.from 灌分片；CLI 传 process.stdin。
 */

/** 读一个流到 EOF，返回 utf8 解码后的完整文本（空输入返回空串）。 */
export async function readStdinText(stream: AsyncIterable<string | Buffer>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  return chunks.join("");
}

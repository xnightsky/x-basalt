// === 自建实现: chat trace 落盘器 ===
//
// 把 LoopEvent 按 JSONL 追加到指定文件，首行为会话元信息。写入失败只警告一次并自动停用，
// 不抛错、不影响主流程。仅依赖 node 内置 fs。

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { LoopEvent } from "./loop.js";

export interface TracerOptions {
  /** trace 文件完整路径（含文件名）。 */
  path: string;
  /** 模型名（可选）。 */
  model?: string;
  /** agentic 最大步数。 */
  maxSteps: number;
  /** 索引库路径（可选）。 */
  db?: string;
  /** vault 路径（单根或多根，可选）。 */
  vault?: string | string[];
  /** CLI 版本（可选）。 */
  version?: string;
  /** 会话时间戳（省略则用当前 ISO 时间）。 */
  ts?: string;
}

export interface Tracer {
  /** trace 文件路径。 */
  path: string;
  /** 消费一个事件并落盘；turn 标识当前 REPL 轮次或单发会话。 */
  sink(event: LoopEvent, turn: number): void;
  /** 关闭文件描述符；可重复调用。 */
  close(): void;
  /** tracer 是否仍处于启用状态（未因写入失败自动停用）。 */
  isActive(): boolean;
}

/**
 * 创建 chat trace 落盘器。
 *
 * @behavior 自动递归创建父目录
 * @behavior 首行写入 session 元信息（ts/model/maxSteps/db/vault/version）
 * @behavior 后续每行写入 { ...event, turn } 的完整 JSON，input/output 不截断
 * @behavior 任何写入失败只 console.warn 一次并自动停用，后续 sink 静默忽略
 */
export function createTracer(opts: TracerOptions): Tracer {
  const { path } = opts;
  let fd: number | undefined;
  let warned = false;
  /** 连续 text 事件的累积缓冲。 */
  let buffer: { turn: number; text: string; ts: string } | undefined;

  /** 记录一次警告并关闭 fd，之后所有写入静默跳过。 */
  function warnOnce(error: unknown): void {
    if (!warned) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠ trace 落盘失败（${path}）：${msg}；已自动停用，不影响主流程。`);
      warned = true;
    }
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // 关闭失败也视为已停用，不再尝试。
      }
      fd = undefined;
    }
  }

  /** 把已累积的 text 缓冲以单条行写出；空缓冲或 fd 关闭时无操作。 */
  function flushText(): void {
    if (fd === undefined || buffer === undefined) return;
    const record = {
      type: "text" as const,
      text: buffer.text,
      turn: buffer.turn,
      ts: buffer.ts,
    };
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`);
    } catch (e) {
      warnOnce(e);
      return;
    }
    buffer = undefined;
  }

  // 建目录并打开文件；任一失败即停用。
  try {
    mkdirSync(dirname(path), { recursive: true });
    fd = openSync(path, "a");
  } catch (e) {
    warnOnce(e);
  }

  // 首行：session 元信息。undefined 字段会被 JSON.stringify 省略。
  if (fd !== undefined) {
    const meta = {
      type: "session" as const,
      ts: opts.ts ?? new Date().toISOString(),
      model: opts.model,
      maxSteps: opts.maxSteps,
      db: opts.db,
      vault: opts.vault,
      version: opts.version,
    };
    try {
      writeSync(fd, `${JSON.stringify(meta)}\n`);
    } catch (e) {
      warnOnce(e);
    }
  }

  return {
    path,
    sink(event, turn) {
      if (fd === undefined) return;
      if (event.type === "text") {
        const piece = event.text ?? "";
        if (buffer === undefined) {
          // 开启新缓冲：ts 取首个分片时刻。
          buffer = { turn, text: piece, ts: new Date().toISOString() };
        } else if (turn === buffer.turn) {
          // 同 turn 连续 text：追加拼接。
          buffer.text += piece;
        } else {
          // turn 变化：先冲刷新 turn 的旧缓冲，再开新缓冲。
          flushText();
          buffer = { turn, text: piece, ts: new Date().toISOString() };
        }
      } else {
        // 非 text 事件前必须先写出已累积文本，保持事件顺序。
        flushText();
        const record = { ...event, turn };
        try {
          writeSync(fd, `${JSON.stringify(record)}\n`);
        } catch (e) {
          warnOnce(e);
        }
      }
    },
    close() {
      // 关闭前冲刷剩余 text，避免末尾文本丢失。
      flushText();
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // 忽略关闭错误；进程退出时 OS 会回收。
        }
        fd = undefined;
      }
    },
    isActive() {
      return !warned;
    },
  };
}

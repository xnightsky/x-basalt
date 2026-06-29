// === 自建实现: chat provider 适配——解析 AI_GATEWAY_* 配置 + 懒加载 AI SDK 造 model ===
//
// 上游：src/chat/index.ts；下游：动态 import @ai-sdk/gateway（optionalDependency）。
// 纪律：本文件是 chat 与 AI SDK 的边界；无 key / 未装依赖一律友好退出，绝不抛栈污染其他命令。

/** 默认模型：沿用 agent-browser 默认（Vercel 网关的 provider/model slug 格式）。 */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * 默认端点：Vercel AI Gateway 的 OpenAI 兼容端点。
 * 缺省走它（配 Vercel 网关 key 即用）；`AI_GATEWAY_URL` 可改指任意 OpenAI 兼容端点
 * （DeepSeek `https://api.deepseek.com`、Ollama `http://localhost:11434/v1`、自建网关…）。
 */
export const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** 解析成功的 provider 配置。 */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/** resolveProvider 产物：可用配置，或显式 no-key（消费者据此友好退出）。 */
export type ProviderResolution = ProviderConfig | { error: "no-key" };

/** 无 key 友好提示（指向文档，含离线方案）。 */
export const NO_KEY_MESSAGE =
  "✗ chat 未配置 AI。设置 AI_GATEWAY_API_KEY 启用 chat（离线可把 AI_GATEWAY_URL 指向本地 Ollama 的 OpenAI 兼容端点）。\n  详见 docs/guides/ai-and-skills.md。";

/**
 * 从环境变量 + --model 解析 provider 配置。
 *
 * @behavior Given 未设 AI_GATEWAY_API_KEY When 解析 Then 返回 { error: "no-key" }（不抛错）
 * @behavior Given 设了 key When 解析 Then model = modelFlag ?? AI_GATEWAY_MODEL ?? DEFAULT_MODEL；baseURL = AI_GATEWAY_URL
 */
export function resolveProvider(env: NodeJS.ProcessEnv, modelFlag?: string): ProviderResolution {
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) return { error: "no-key" };
  return { apiKey, model: modelFlag ?? env.AI_GATEWAY_MODEL ?? DEFAULT_MODEL, baseURL: env.AI_GATEWAY_URL };
}

/**
 * 懒加载 AI SDK，按配置造 LanguageModel。返回 unknown（避免顶层耦合 SDK 运行时类型）。
 * 动态 import 失败（未装 optionalDependency）→ 抛带指引 Error，由消费者捕获友好退出。
 *
 * spec §7：**底层用 OpenAI 兼容客户端**（POST `<baseURL>/chat/completions`），适配任意
 * OpenAI 兼容端点（Vercel 网关 / DeepSeek / Ollama / 自建）——而非 Vercel 私有网关协议
 * （后者 POST `<baseURL>/language-model`，指向非 Vercel 端点会 404）。
 *
 * @behavior Given baseURL 未设 When 造 model Then 用 DEFAULT_BASE_URL（Vercel 网关 OpenAI 端点）
 * @behavior Given baseURL 已设（如 DeepSeek/Ollama）When 造 model Then 用该端点的 /chat/completions
 */
export async function createModel(cfg: ProviderConfig): Promise<unknown> {
  let mod: typeof import("@ai-sdk/openai-compatible");
  try {
    mod = await import("@ai-sdk/openai-compatible");
  } catch {
    throw new Error("chat 需要 AI SDK：pnpm add -O ai @ai-sdk/openai-compatible 安装。");
  }
  const provider = mod.createOpenAICompatible({
    name: "ai-gateway",
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE_URL, // baseURL 必填，缺省走 Vercel 网关 OpenAI 端点
  });
  return provider.chatModel(cfg.model);
}

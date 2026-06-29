// === 自建实现: chat provider 适配——解析 AI_GATEWAY_* 配置 + 懒加载 AI SDK 造 model ===
//
// 上游：src/chat/index.ts；下游：动态 import @ai-sdk/gateway（optionalDependency）。
// 纪律：本文件是 chat 与 AI SDK 的边界；无 key / 未装依赖一律友好退出，绝不抛栈污染其他命令。

/** 默认模型：沿用 agent-browser 默认（网关 provider/model slug 格式）。 */
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

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
 * @behavior Given baseURL 未设 When 造 model Then createGateway({ apiKey })（默认 Vercel AI Gateway）
 * @behavior Given baseURL 已设 When 造 model Then createGateway({ apiKey, baseURL })（指向自定义/本地端点）
 */
export async function createModel(cfg: ProviderConfig): Promise<unknown> {
  let mod: typeof import("@ai-sdk/gateway");
  try {
    mod = await import("@ai-sdk/gateway");
  } catch {
    throw new Error("chat 需要 AI SDK：pnpm add -O ai @ai-sdk/gateway @ai-sdk/openai-compatible 安装。");
  }
  const gateway = mod.createGateway({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
  // 注：v5 gateway provider 可直接以 model id 调用得到 LanguageModel。若安装版本签名不同，
  // 用 gateway.languageModel(cfg.model)；Step 4 typecheck 暴露后按实际签名修正。
  return gateway(cfg.model);
}

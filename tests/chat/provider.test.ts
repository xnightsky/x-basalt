import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, DEFAULT_MODEL, resolveProvider } from "../../src/chat/provider.js";

test("resolveProvider：无 key → no-key", () => {
  const r = resolveProvider({} as NodeJS.ProcessEnv);
  assert.deepEqual(r, { error: "no-key" });
});

test("resolveProvider：有 key，model 取默认", () => {
  const r = resolveProvider({ AI_GATEWAY_API_KEY: "gw_x" } as NodeJS.ProcessEnv);
  assert.deepEqual(r, { apiKey: "gw_x", model: DEFAULT_MODEL, baseURL: undefined });
});

test("resolveProvider：modelFlag > AI_GATEWAY_MODEL > 默认", () => {
  const env = { AI_GATEWAY_API_KEY: "gw_x", AI_GATEWAY_MODEL: "m/env" } as NodeJS.ProcessEnv;
  assert.equal(resolveProvider(env).model, "m/env");
  assert.equal(resolveProvider(env, "m/flag").model, "m/flag");
});

test("resolveProvider：AI_GATEWAY_URL → baseURL", () => {
  const r = resolveProvider({
    AI_GATEWAY_API_KEY: "gw_x",
    AI_GATEWAY_URL: "http://localhost:11434/v1",
  } as NodeJS.ProcessEnv);
  assert.equal((r as { baseURL?: string }).baseURL, "http://localhost:11434/v1");
});

// 守门：createModel 用 OpenAI 兼容客户端构造 model（不发网络）。构造期就会暴露
// SDK API 形状错误（如之前误用 @ai-sdk/gateway 的私有协议）。
test("createModel：用 openai-compatible 构造出 model（含自定义 baseURL，不发网络）", async () => {
  const model = await createModel({
    apiKey: "x",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
  });
  assert.ok(model && typeof model === "object");
});

test("createModel：缺 baseURL 时退默认（仍构造成功，不发网络）", async () => {
  const model = await createModel({ apiKey: "x", model: DEFAULT_MODEL });
  assert.ok(model && typeof model === "object");
});

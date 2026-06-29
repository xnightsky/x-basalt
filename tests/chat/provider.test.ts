import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODEL, resolveProvider } from "../../src/chat/provider.js";

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
  const r = resolveProvider({ AI_GATEWAY_API_KEY: "gw_x", AI_GATEWAY_URL: "http://localhost:11434/v1" } as NodeJS.ProcessEnv);
  assert.equal((r as { baseURL?: string }).baseURL, "http://localhost:11434/v1");
});

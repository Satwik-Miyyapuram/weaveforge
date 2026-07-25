import assert from "node:assert/strict";
import { test } from "node:test";
import { AiModelRouter, type AiModelAdapter } from "../src/index.js";

function adapter(provider: AiModelAdapter["provider"], available: boolean): AiModelAdapter {
  return {
    provider,
    available,
    async complete() {
      return { text: provider, model: `${provider}-model`, provider, sourceLinks: [] };
    },
  };
}

test("router selects Codex first and falls back to the next available provider", async () => {
  const router = new AiModelRouter([adapter("openai", true), adapter("codex", true)]);
  assert.equal(router.provider, "codex");
  assert.equal((await router.complete({ messages: [] })).text, "codex");

  const fallback = new AiModelRouter([adapter("codex", false), adapter("anthropic", true)]);
  assert.equal(fallback.provider, "anthropic");
});

test("router supports an explicit provider preference without changing core contracts", () => {
  const router = new AiModelRouter([adapter("codex", true), adapter("openai", true)], "openai");
  assert.equal(router.provider, "openai");
});

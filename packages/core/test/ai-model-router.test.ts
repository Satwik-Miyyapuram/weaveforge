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

test("the router uses the provider it was asked for", async () => {
  const router = new AiModelRouter(
    [adapter("openai", true), adapter("anthropic", true)],
    "anthropic",
  );

  assert.equal(router.provider, "anthropic");
  assert.equal((await router.complete({ messages: [] })).text, "anthropic");
});

test("no provider is preferred — selection is always explicit", () => {
  // The previous behaviour ranked Codex first and fell back down a list. A
  // silent fallback means the user believes one model is answering while
  // another is, which is worse than being told their choice is unavailable.
  const adapters = [adapter("openai", true), adapter("anthropic", true)];

  assert.equal(new AiModelRouter(adapters, "openai").provider, "openai");
  assert.equal(new AiModelRouter(adapters, "anthropic").provider, "anthropic");
});

test("an unavailable provider fails loudly and names what is configured", () => {
  assert.throws(
    () => new AiModelRouter([adapter("openai", true)], "anthropic"),
    /not available.*openai/s,
  );
});

test("a registered but unavailable adapter is not silently substituted", () => {
  assert.throws(
    () => new AiModelRouter([adapter("openai", false), adapter("anthropic", true)], "openai"),
    /openai.*not available/s,
  );
});

test("an empty selection points the user at settings", () => {
  assert.throws(() => new AiModelRouter([adapter("openai", true)], ""), /Settings/);
});

test("any endpoint id is valid, so a local or self-hosted provider works", () => {
  const router = new AiModelRouter([adapter("my-lab-gateway", true)], "my-lab-gateway");

  assert.equal(router.provider, "my-lab-gateway");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  ByokModelConversation,
  PROVIDER_PRESETS,
  type ProviderDescriptor,
} from "../infrastructure/byok-model-conversation";

function capture(responseBody: unknown, ok = true) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status: ok ? 200 : 429,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const descriptor = (over: Partial<ProviderDescriptor> = {}): ProviderDescriptor => ({
  id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com",
  api: "openai-chat", model: "gpt-x", ...over,
});

const messages = [
  { role: "system", content: "Be brief." },
  { role: "user", content: "Hello" },
];

test("OpenAI-compatible calls use bearer auth and read the choice", async () => {
  const { calls, fetchFn } = capture({ choices: [{ message: { content: " hi " } }] });
  const client = new ByokModelConversation(descriptor(), "sk-test", fetchFn);

  const result = await client.complete({ messages } as never);

  assert.match(calls[0]!.url, /\/v1\/chat\/completions$/);
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, "Bearer sk-test");
  assert.equal(result.text, "hi");
});

test("Anthropic gets its own header shape and a hoisted system prompt", async () => {
  const { calls, fetchFn } = capture({ content: [{ type: "text", text: "hello" }] });
  const client = new ByokModelConversation(
    descriptor({ id: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" }),
    "sk-ant",
    fetchFn,
  );

  const result = await client.complete({ messages } as never);
  const headers = calls[0]!.init.headers as Record<string, string>;
  const body = JSON.parse(String(calls[0]!.init.body));

  assert.equal(headers["x-api-key"], "sk-ant");
  // Without this header the browser call is refused outright.
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(body.system, "Be brief.", "system is a field, not a message");
  assert.ok(!body.messages.some((m: { role: string }) => m.role === "system"));
  assert.equal(result.text, "hello");
});

test("Ollama needs no key and is usable as-is", async () => {
  const { calls, fetchFn } = capture({ message: { content: "local reply" } });
  const client = new ByokModelConversation(
    descriptor({ id: "ollama", api: "ollama", baseUrl: "http://localhost:11434" }),
    "",
    fetchFn,
  );

  assert.equal(client.available, true, "a local model has nothing to authenticate");
  assert.equal((await client.complete({ messages } as never)).text, "local reply");
  assert.match(calls[0]!.url, /\/api\/chat$/);
});

test("a hosted provider without a key reports itself unavailable", () => {
  assert.equal(new ByokModelConversation(descriptor(), "   ").available, false);
});

test("the provider's own error text is surfaced, not swallowed", async () => {
  const { fetchFn } = capture({ error: { message: "insufficient quota" } }, false);
  const client = new ByokModelConversation(descriptor(), "sk-test", fetchFn);

  await assert.rejects(
    () => client.complete({ messages } as never),
    /429.*insufficient quota/s,
  );
});

test("a trailing slash in the base URL does not double up", async () => {
  const { calls, fetchFn } = capture({ choices: [{ message: { content: "x" } }] });
  const client = new ByokModelConversation(
    descriptor({ baseUrl: "https://api.example.com/" }),
    "k",
    fetchFn,
  );

  await client.complete({ messages } as never);
  assert.equal(calls[0]!.url, "https://api.example.com/v1/chat/completions");
});

test("the key is never sent anywhere but the provider's own host", async () => {
  const { calls, fetchFn } = capture({ choices: [{ message: { content: "x" } }] });
  await new ByokModelConversation(descriptor(), "sk-secret", fetchFn).complete({ messages } as never);

  // A proxy route would put the user's credential on our server; there is none.
  assert.ok(calls[0]!.url.startsWith("https://api.openai.com"));
  assert.ok(!calls[0]!.url.startsWith("/api/"));
});

test("presets cover hosted and local providers without ranking them", () => {
  const ids = PROVIDER_PRESETS.map((preset) => preset.id);

  assert.ok(ids.includes("anthropic"));
  assert.ok(ids.includes("openai"));
  assert.ok(ids.includes("ollama"), "a local option must be present");
  assert.equal(new Set(ids).size, ids.length);
});

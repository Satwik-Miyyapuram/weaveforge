import assert from "node:assert/strict";
import test from "node:test";
import {
  activeProviderLabel,
  clearActiveProvider,
  hasActiveProvider,
  modelExtractor,
  onProviderChange,
  setActiveProvider,
} from "@/features/ai-assistant/application/ai-provider-session";
import type { ProviderDescriptor } from "@/features/ai-assistant/infrastructure/byok-model-conversation";

const DESCRIPTOR: ProviderDescriptor = {
  id: "example",
  label: "Example",
  baseUrl: "https://api.example.com",
  api: "openai-chat",
  model: "example-model",
};

const SECRET = "sk-do-not-store-me";

test.afterEach(() => clearActiveProvider());

test("nothing is configured until a provider is set", () => {
  assert.equal(hasActiveProvider(), false);
  assert.equal(activeProviderLabel(), null);
  assert.equal(modelExtractor(), null, "callers can fall back to the lexical extractor");
});

test("a configured provider yields a model-backed extractor", () => {
  setActiveProvider(DESCRIPTOR, SECRET);
  assert.equal(hasActiveProvider(), true);
  assert.deepEqual(activeProviderLabel(), { label: "Example", model: "example-model" });
  assert.equal(modelExtractor()?.id, "model");
});

test("the key is never part of what the UI can render", () => {
  setActiveProvider(DESCRIPTOR, SECRET);
  const shown = activeProviderLabel();
  assert.ok(shown);
  assert.equal(
    JSON.stringify(shown).includes(SECRET),
    false,
    "the describing value carries no credential",
  );
});

test("the key is not written to any browser storage", () => {
  const writes: string[] = [];
  const storage = {
    setItem: (_key: string, value: string) => writes.push(value),
    getItem: () => null,
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  const globals = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  const previous = { local: globals.localStorage, session: globals.sessionStorage };
  globals.localStorage = storage;
  globals.sessionStorage = storage;

  try {
    setActiveProvider(DESCRIPTOR, SECRET);
    modelExtractor();
    assert.deepEqual(writes, [], "configuring a provider writes nothing to storage");
  } finally {
    globals.localStorage = previous.local;
    globals.sessionStorage = previous.session;
  }
});

test("clearing it takes effect immediately", () => {
  setActiveProvider(DESCRIPTOR, SECRET);
  clearActiveProvider();
  assert.equal(hasActiveProvider(), false);
  assert.equal(modelExtractor(), null);
});

test("listeners are told when the provider changes, and unsubscribe cleanly", () => {
  let notifications = 0;
  const stop = onProviderChange(() => {
    notifications += 1;
  });

  setActiveProvider(DESCRIPTOR, SECRET);
  clearActiveProvider();
  assert.equal(notifications, 2);

  stop();
  setActiveProvider(DESCRIPTOR, SECRET);
  assert.equal(notifications, 2, "an unsubscribed listener stops hearing about it");
});

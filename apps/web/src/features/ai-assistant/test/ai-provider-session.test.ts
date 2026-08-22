import assert from "node:assert/strict";
import test from "node:test";
import {
  activeProviderLabel,
  canRemember,
  clearActiveProvider,
  forgetStoredProvider,
  hasActiveProvider,
  modelExtractor,
  onProviderChange,
  rememberActiveProvider,
  restoreActiveProvider,
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

/**
 * The desktop keychain path.
 *
 * The bridge is faked because the real one is Electron's `safeStorage`, tested
 * in `apps/desktop`. What matters on this side is that none of it happens
 * without a bridge — a browser must behave exactly as it did before any of this
 * existed — and that a stored blob is believed only when it still has the shape
 * this module wrote.
 */

interface FakeWindow {
  weaveforge?: unknown;
}

async function withBridge(
  stored: { value: string | null },
  run: (writes: string[]) => Promise<void>,
): Promise<void> {
  const globals = globalThis as { window?: FakeWindow };
  const previous = globals.window;
  const writes: string[] = [];
  globals.window = {
    weaveforge: {
      version: "test",
      platform: "linux",
      fetchTitle: () => Promise.reject(new Error("not used")),
      fetchImage: () => Promise.reject(new Error("not used")),
      onSignIn: () => () => {},
      checkUpdate: () => Promise.resolve(null),
      readSecret: () => Promise.resolve(stored.value),
      writeSecret: (_name: string, value: string) => {
        writes.push(value);
        stored.value = value;
        return Promise.resolve();
      },
      clearSecret: () => {
        stored.value = null;
        return Promise.resolve();
      },
    },
  };
  try {
    // Awaited inside the try, not returned from it: a returned promise would
    // put the window back before the first `await` inside `run` resolved.
    await run(writes);
  } finally {
    globals.window = previous;
  }
}

test("a browser cannot remember, and asking it to is refused rather than ignored", async () => {
  assert.equal(canRemember(), false);
  assert.equal(await restoreActiveProvider(), false);
  setActiveProvider(DESCRIPTOR, SECRET);
  await assert.rejects(rememberActiveProvider());
  // Forgetting is a no-op rather than an error: the caller does it on every
  // save, and a browser has nothing to forget.
  await forgetStoredProvider();
});

test("a remembered provider comes back on the next load", async () => {
  const stored = { value: null as string | null };
  await withBridge(stored, async () => {
    assert.equal(canRemember(), true);
    setActiveProvider(DESCRIPTOR, SECRET);
    await rememberActiveProvider();

    clearActiveProvider();
    assert.equal(hasActiveProvider(), false);

    assert.equal(await restoreActiveProvider(), true);
    assert.deepEqual(activeProviderLabel(), { label: "Example", model: "example-model" });
    assert.equal(modelExtractor()?.id, "model");
  });
});

test("remembering nothing is refused, so an empty blob is never written", async () => {
  const stored = { value: null as string | null };
  await withBridge(stored, async (writes) => {
    await assert.rejects(rememberActiveProvider());
    assert.deepEqual(writes, []);
  });
});

test("forgetting removes what a later load would have found", async () => {
  const stored = { value: null as string | null };
  await withBridge(stored, async () => {
    setActiveProvider(DESCRIPTOR, SECRET);
    await rememberActiveProvider();
    await forgetStoredProvider();

    clearActiveProvider();
    assert.equal(await restoreActiveProvider(), false);
  });
});

test("a blob that is not what this module writes is ignored", async () => {
  for (const blob of [
    "not json at all",
    "null",
    JSON.stringify({ apiKey: SECRET }),
    JSON.stringify({ descriptor: DESCRIPTOR }),
    JSON.stringify({ descriptor: { ...DESCRIPTOR, api: "telepathy" }, apiKey: SECRET }),
    JSON.stringify({ descriptor: { ...DESCRIPTOR, model: 7 }, apiKey: SECRET }),
  ]) {
    await withBridge({ value: blob }, async () => {
      assert.equal(await restoreActiveProvider(), false, blob);
      assert.equal(hasActiveProvider(), false, blob);
    });
  }
});

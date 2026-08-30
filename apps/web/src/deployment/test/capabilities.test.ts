import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * The capability answers come from `localStorage`, which is also where local
 * mode is remembered, so the test provides the one thing `isLocalMode` reads.
 */
const store = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = fakeWindow;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

async function load() {
  // Fresh each time: the module is small and has no state, but importing it
  // after `window` exists keeps the two modes independent.
  return await import("../capabilities");
}

describe("capabilities", () => {
  it("grants everything to a copy with an account", async () => {
    const { can, hasAccount } = await load();
    assert.equal(hasAccount(), true);
    for (const capability of ["account", "org", "sharing", "sync", "apiTokens", "operatorDisclosure"] as const) {
      assert.equal(can(capability), true, capability);
    }
  });

  it("refuses the account-only capabilities in local mode", async () => {
    store.set("weaveforge.local-mode", "1");
    const { can, hasAccount } = await load();
    assert.equal(hasAccount(), false);
    for (const capability of ["account", "org", "sharing", "sync", "apiTokens", "operatorDisclosure"] as const) {
      assert.equal(can(capability), false, capability);
    }
  });

  it("answers yes on the server, where there is no window to ask", async () => {
    delete (globalThis as { window?: unknown }).window;
    const { can } = await load();
    // The server render cannot know, and the hook corrects it after mount.
    // Answering "no" here would render the offline shell for every visitor.
    assert.equal(can("org"), true);
  });
});

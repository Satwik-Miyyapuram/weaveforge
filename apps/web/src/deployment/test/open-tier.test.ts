import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * The mirrored tier lives in `localStorage`, so the test provides the one
 * storage object the module reads.
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
  return await import("../open-tier");
}

describe("open-tier", () => {
  it("reads null when nothing is stored", async () => {
    const { storedTier } = await load();
    assert.equal(storedTier(), null);
  });

  it("remembers a tier and forgets it", async () => {
    const { rememberTier, storedTier, forgetTier } = await load();
    rememberTier("local-web");
    assert.equal(storedTier(), "local-web");
    forgetTier();
    assert.equal(storedTier(), null);
  });

  it("reads a stored value that is not a tier as null", async () => {
    const { OPEN_TIER_KEY, storedTier } = await load();
    store.set(OPEN_TIER_KEY, "Local");
    assert.equal(storedTier(), null);
    store.set(OPEN_TIER_KEY, "server");
    assert.equal(storedTier(), null);
  });

  it("accepts the three tier names only", async () => {
    const { isTier } = await load();
    assert.equal(isTier("local"), true);
    assert.equal(isTier("local-web"), true);
    assert.equal(isTier("sharing"), true);
    assert.equal(isTier(""), false);
    assert.equal(isTier(1), false);
    assert.equal(isTier(null), false);
  });

  it("orders tiers local < local-web < sharing", async () => {
    const { tierRank } = await load();
    assert.ok(tierRank("local") < tierRank("local-web"));
    assert.ok(tierRank("local-web") < tierRank("sharing"));
  });
});

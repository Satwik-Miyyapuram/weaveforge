import { test } from "node:test";
import assert from "node:assert/strict";
import { clearCacheStorage } from "@/lib/cache-storage";

async function withCaches(stub: unknown, run: () => Promise<void>): Promise<void> {
  const g = globalThis as { caches?: unknown };
  const had = "caches" in g;
  const original = g.caches;
  if (stub === undefined) delete g.caches;
  else g.caches = stub;
  try {
    await run();
  } finally {
    if (had) g.caches = original;
    else delete g.caches;
  }
}

test("every Cache Storage entry is deleted (11-18)", async () => {
  const deleted: string[] = [];
  await withCaches(
    {
      keys: async () => ["serwist-precache", "runtime"],
      delete: async (key: string) => deleted.push(key) > 0,
    },
    async () => {
      await clearCacheStorage();
      assert.deepEqual(deleted.sort(), ["runtime", "serwist-precache"]);
    },
  );
});

test("no Cache Storage, or one that fails, is not an error", async () => {
  await withCaches(undefined, () => clearCacheStorage());
  await withCaches(
    {
      keys: async () => {
        throw new Error("SecurityError");
      },
    },
    () => clearCacheStorage(),
  );
  await withCaches(
    {
      keys: async () => ["a"],
      delete: async () => {
        throw new Error("blocked");
      },
    },
    () => clearCacheStorage(),
  );
});

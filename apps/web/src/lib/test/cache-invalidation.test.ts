import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheRepo } from "@/lib/cache/cache-repo";
import {
  invalidateAllRepoCaches,
  invalidateForWrite,
  registerRepoCacheEntry,
  setActiveProjectIdForCache,
} from "@/lib/cache/project-lww-invalidator";
import { getScreenCache, screenCacheKey, setScreenCache } from "@/lib/cache/screen-cache";

function makeRepo(name: string, resourceType?: string) {
  const cache = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  registerRepoCacheEntry({ resourceType: resourceType as never, cache, settled });
  return cacheRepo(
    {
      list: async () => [`${name}-row`],
      save: async (row: string) => row,
    },
    ["list"],
    ["save"],
    () => "proj-1",
    { resourceType: resourceType as never },
  );
}

test("scoped invalidation clears dependents but not unrelated repos", async () => {
  setActiveProjectIdForCache(() => "proj-1");
  const paper = makeRepo("paper", "paper");
  const log = makeRepo("log", "log_entry");

  await paper.list();
  await log.list();
  assert.equal((await paper.list())[0], "paper-row");
  assert.equal((await log.list())[0], "log-row");

  setScreenCache(screenCacheKey("proj-1", "papers"), { ok: true });
  setScreenCache(screenCacheKey("proj-1", "logbook"), { ok: true });

  invalidateForWrite("paper");

  assert.equal(getScreenCache(screenCacheKey("proj-1", "papers")), undefined);
  assert.equal(getScreenCache<{ ok: boolean }>(screenCacheKey("proj-1", "logbook"))?.ok, true);
});

test("unknown resource type falls back to clear-all", async () => {
  setActiveProjectIdForCache(() => "proj-1");
  const paper = makeRepo("paper", "paper");
  const log = makeRepo("log", "log_entry");
  await paper.list();
  await log.list();
  setScreenCache(screenCacheKey("proj-1", "logbook"), { ok: true });

  invalidateForWrite("unknown-type");

  assert.equal(getScreenCache(screenCacheKey("proj-1", "logbook")), undefined);
  invalidateAllRepoCaches();
});

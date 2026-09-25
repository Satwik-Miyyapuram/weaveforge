import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheRepo } from "@/lib/cache/cache-repo";
import {
  cacheWriteNotify,
  clearProjectCacheHooks,
  configureProjectCacheHooks,
  invalidateAllRepoCaches,
  invalidateForWrite,
  registerRepoCacheEntry,
  setActiveProjectIdForCache,
} from "@/lib/cache/project-lww-invalidator";
import { clearSessionCaches, registerSessionReset } from "@/lib/cache/clear-session-caches";
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

  setScreenCache(screenCacheKey("proj-1", "papers"), { ok: true }, Date.now());
  setScreenCache(screenCacheKey("proj-1", "logbook"), { ok: true }, Date.now());

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
  setScreenCache(screenCacheKey("proj-1", "logbook"), { ok: true }, Date.now());

  invalidateForWrite("unknown-type");

  assert.equal(getScreenCache(screenCacheKey("proj-1", "logbook")), undefined);
  invalidateAllRepoCaches();
});

// --- what a container takes back when it goes -------------------------------
//
// `createAppContainer` registers 24 repository caches, one session-reset hook
// and a realtime channel, and `bootstrap.ts` builds a new container whenever the
// backend or storage provider changes. Everything registered was permanent:
// the entries accumulated per rebuild, every generation's reset hook ran on one
// sign-out, and each container left a joined private channel behind.

test("disposing a repository cache stops the invalidator reaching it", async () => {
  // The disposer reaches its owner through the register hook, which is the one
  // channel every registration already passes through.
  const disposers: Array<() => void> = [];
  configureProjectCacheHooks({ register: (_cache, dispose) => disposers.push(dispose) });

  const cache = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  let reads = 0;
  const repo = cacheRepo(
    {
      list: async () => {
        reads += 1;
        return ["row"];
      },
    },
    ["list"],
    [],
    () => "proj-1",
    { resourceType: "paper", sharedCache: cache, sharedSettled: settled },
  );

  await repo.list();
  invalidateForWrite("paper");
  await repo.list();
  assert.equal(reads, 2, "a registered cache is cleared by a write, so it refetches");

  // The container is replaced: every registration it made goes with it.
  for (const dispose of disposers) dispose();

  await repo.list();
  invalidateForWrite("paper");
  await repo.list();
  assert.equal(reads, 3, "a disposed entry is not reached by invalidation at all");
  clearProjectCacheHooks();
});

test("disposing a session hook removes that hook and no other", () => {
  const called: string[] = [];
  const disposeFirst = registerSessionReset(() => called.push("first"));
  registerSessionReset(() => called.push("second"));

  disposeFirst();
  clearSessionCaches();

  assert.deepEqual(called, ["second"], "an earlier hook's removal must not take a later one with it");
});

test("a disposed hook is not run, even after another is registered", () => {
  const called: string[] = [];
  const dispose = registerSessionReset(() => called.push("gone"));
  dispose();
  registerSessionReset(() => called.push("kept"));

  clearSessionCaches();

  assert.deepEqual(called, ["kept"]);
});

test("clearing the container hooks stops writes reaching a disposed container", () => {
  // The hooks are module-level single slots. Without clearing them, the next
  // container's repository writes are reported to the previous one's
  // invalidator — a realtime channel nobody is subscribed to any more.
  const seen: string[] = [];
  configureProjectCacheHooks({
    onWrite: (resourceType) => seen.push(String(resourceType)),
  });
  cacheWriteNotify("paper");
  assert.deepEqual(seen, ["paper"]);

  clearProjectCacheHooks();
  cacheWriteNotify("paper");

  assert.deepEqual(seen, ["paper"], "and no further write is reported");
});

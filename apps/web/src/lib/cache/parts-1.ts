import { isLocalMode } from "@/backend/providers/local/local-identity";
import { getRealtimeClient } from "@/backend/providers/postgrest/parts-1";
import type { AppContainer } from "@/container/facades/index";
import { clearAllScreenCaches, clearScreenCachesForScreens } from "@/lib/cache/parts-2";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import type { ScreenId } from "@/lib/parts";
import { readyCore } from "@/lib/rust-core";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ResourceType } from "@weaveforge/wasm";

// --- app-idb ---
/**
 * Shared IndexedDB handle for local caches.
 *
 * Both the screen cache and the search index live in this database. They must
 * open it at the same version and declare every store in one upgrade handler —
 * two modules opening the same database at different versions makes whichever
 * asks for the lower one fail with a VersionError, taking its cache with it.
 *
 * One connection, opened on first use and kept. It used to be opened per
 * operation, by five modules across sixteen call sites, so a screen load with a
 * cache miss and a search warm-up opened the same database a dozen times over.
 */
const APP_DB_NAME = "thesis-screen-cache";
export const SCREEN_STORE = "screens";
export const SEARCH_STORE = "search";
export const PDF_TEXT_STORE = "pdftext";
export const VECTOR_STORE = "vectors";
/** Reference-lookup results per document text fingerprint; see reference-lookup-cache.ts. */
export const REFERENCE_STORE = "references";

/** v1: screens. v2: search index. v3: PDF page text. v4: passage vectors. */
const APP_DB_VERSION = 5;

let opening: Promise<IDBDatabase> | null = null;

export function openAppDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  // The handlers below compare against this promise, not against the database:
  // the memo holds the *promise*, and a handler belonging to a previous
  // connection must not clear a newer one's.
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Guarded per store: a fresh profile has neither, a v1 upgrade has screens.
      if (!db.objectStoreNames.contains(SCREEN_STORE)) db.createObjectStore(SCREEN_STORE);
      if (!db.objectStoreNames.contains(SEARCH_STORE)) db.createObjectStore(SEARCH_STORE);
      if (!db.objectStoreNames.contains(PDF_TEXT_STORE)) db.createObjectStore(PDF_TEXT_STORE);
      if (!db.objectStoreNames.contains(VECTOR_STORE)) db.createObjectStore(VECTOR_STORE);
      if (!db.objectStoreNames.contains(REFERENCE_STORE)) db.createObjectStore(REFERENCE_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      /**
       * These two handlers are why a memoised handle is safe.
       *
       * Another tab opening the database at a newer version fires
       * `versionchange` here, and the browser then refuses to let this
       * connection do anything. Without the handlers below, this module would
       * keep handing out that dead connection, every transaction would throw,
       * and every caller swallows the failure — so all five caches would stop
       * working silently, which is precisely what the version comment above
       * exists to prevent.
       */
      db.onversionchange = () => {
        db.close();
        if (opening === pending) opening = null;
      };
      db.onclose = () => {
        if (opening === pending) opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  opening = pending;
  return pending;
}

/**
 * Drop the shared connection.
 *
 * Called at the *end* of a device wipe, never in the middle: the clears
 * themselves open transactions through this same handle, so closing first
 * reopens the connection on the next clear and leaves a live handle behind
 * anyway.
 */
export function closeAppDb(): void {
  const pending = opening;
  opening = null;
  if (!pending) return;
  void pending.then((db) => db.close()).catch(() => {
    /* the open failed; there is nothing to close */
  });
}

// --- blob-fetch-cache ---
/** Cross-hook in-flight + settled cache for blob fetches. */
const settled = new Map<string, Blob>();
const inflight = new Map<string, Promise<Blob | null>>();

/** Forget every fetched blob; sign-out calls this so the next user refetches. */
export function clearBlobFetchCache(): void {
  settled.clear();
}

function cacheKey(bucket: string, path: string): string {
  return `${bucket}\0${path}`;
}

function fetchBlobCached(
  bucket: string,
  path: string,
  fetcher: (path: string) => Promise<Blob>,
): Promise<Blob | null> {
  const key = cacheKey(bucket, path);
  const hit = settled.get(key);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetcher(path)
    .then((blob) => {
      settled.set(key, blob);
      return blob;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function fetchBlobsCached(
  bucket: string,
  paths: readonly string[],
  fetchOne: (path: string) => Promise<Blob>,
  fetchBatch?: (paths: string[]) => Promise<Map<string, Blob>>,
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  const missing: string[] = [];

  for (const path of paths) {
    const hit = settled.get(cacheKey(bucket, path));
    if (hit) out.set(path, hit);
    else missing.push(path);
  }

  if (missing.length === 0) return out;

  if (fetchBatch && missing.length > 1) {
    const batch = await fetchBatch(missing);
    for (const [path, blob] of batch) {
      settled.set(cacheKey(bucket, path), blob);
      out.set(path, blob);
    }
    return out;
  }

  await Promise.all(
    missing.map(async (path) => {
      const blob = await fetchBlobCached(bucket, path, fetchOne);
      if (blob) out.set(path, blob);
    }),
  );
  return out;
}

// --- project-lww-invalidator ---
/**
 * LWW cache invalidation over Realtime `proj:{projectId}` (plan §7.4).
 */
type RepoCache = Map<string, Promise<unknown>>;
type RepoSettled = Map<string, unknown>;

/**
 * Releases one repository cache's registration.
 *
 * Idempotent, because a container may be disposed and a session reset may run in
 * either order.
 */
export type RepoCacheDisposer = () => void;

type RepoCacheEntry = {
  resourceType?: ResourceType;
  cache: RepoCache;
  settled: RepoSettled;
};

/**
 * Every live repository cache.
 *
 * Module-level, and it only ever grew: a container registers one entry per
 * repository, the entries were never removed, and `invalidateAllRepoCaches`
 * cleared each entry's *contents* while keeping the entry — and its two Map
 * objects — alive for the life of the tab. Rebuilding the container (which
 * happens whenever the backend or storage provider changes) added two dozen more
 * every time, and every write then walked all of them.
 */
const allRepoCaches: RepoCacheEntry[] = [];

let onWriteHook: ((resourceType?: ResourceType) => void) | undefined;
let registerHook: ((cache: RepoCache, dispose: RepoCacheDisposer) => void) | undefined;
let activeProjectId: () => string | null = () => null;

function logInvalidation(resourceType: string | undefined, repos: string[], screens: string[]): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug(
    `[cache] invalidate write(${resourceType ?? "all"}) → repos[${repos.join(",")}] screens[${screens.join(",")}]`,
  );
}

/** `SCOPED_CACHE_INVALIDATION=0` turns scoped invalidation off, falling back to clearing everything. */
function isScopedCacheInvalidationEnabled(): boolean {
  return !(typeof process !== "undefined" && process.env.SCOPED_CACHE_INVALIDATION === "0");
}

export function setActiveProjectIdForCache(pid: () => string | null): void {
  activeProjectId = pid;
}

/**
 * Register a repository cache, and hand back the way to unregister it.
 *
 * The disposer travels to the caller through the register hook rather than
 * being threaded back through `cacheRepo` → `wireBackend` → twenty-four call
 * sites: the hook is already invoked once per registration, so it is the one
 * channel that costs nothing to widen.
 */
export function registerRepoCacheEntry(entry: RepoCacheEntry): RepoCacheDisposer {
  allRepoCaches.push(entry);
  const dispose: RepoCacheDisposer = () => {
    const index = allRepoCaches.indexOf(entry);
    if (index >= 0) allRepoCaches.splice(index, 1);
    entry.cache.clear();
    entry.settled.clear();
  };
  registerHook?.(entry.cache, dispose);
  return dispose;
}

/** Forget every repository read memo, without touching the screen caches. */
export function clearRepoCaches(): void {
  for (const { cache, settled } of allRepoCaches) {
    cache.clear();
    settled.clear();
  }
}

export function invalidateAllRepoCaches(): void {
  clearRepoCaches();
  clearAllScreenCaches();
  logInvalidation(undefined, ["*"], ["*"]);
}

/**
 * Clear what a write of `resourceType` makes stale. Screens are cleared for
 * `projectId`, the project the write happened in; it defaults to the open one.
 */
export function invalidateForWrite(resourceType?: string, projectId: string | null = activeProjectId()): void {
  const scope =
    isScopedCacheInvalidationEnabled() && resourceType ? readyCore().writeScope(resourceType) : null;
  if (!resourceType || !scope) {
    invalidateAllRepoCaches();
    return;
  }

  const repoTypes = new Set<string>(scope.repoTypes);
  for (const entry of allRepoCaches) {
    if (!entry.resourceType || !repoTypes.has(entry.resourceType)) continue;
    entry.cache.clear();
    entry.settled.clear();
  }

  clearScreenCachesForScreens(projectId, scope.screens);
  logInvalidation(resourceType, [...repoTypes], [...scope.screens]);
}

export function configureProjectCacheHooks(opts: {
  onWrite?: (resourceType?: ResourceType) => void;
  register?: (cache: RepoCache, dispose: RepoCacheDisposer) => void;
}): void {
  onWriteHook = opts.onWrite;
  registerHook = opts.register;
}

/**
 * Forget the hooks a container installed.
 *
 * They are module-level slots rather than per-container state, so a container
 * that is disposed has to take its own hooks with it — otherwise the *next*
 * container's repository writes are reported to the previous one's invalidator,
 * which is a realtime channel nobody is listening to any more.
 */
export function clearProjectCacheHooks(): void {
  onWriteHook = undefined;
  registerHook = undefined;
}

export function cacheWriteNotify(resourceType?: ResourceType): void {
  invalidateForWrite(resourceType);
  onWriteHook?.(resourceType);
}

export class ProjectLwwInvalidator {
  private channel: RealtimeChannel | null = null;

  clearLocal(resourceType?: ResourceType, projectId?: string | null) {
    invalidateForWrite(resourceType, projectId ?? undefined);
  }

  watch(db: SupabaseClient, projectId: string | null) {
    if (this.channel) void this.channel.unsubscribe();
    this.channel = null;
    if (!projectId) return;
    // Nobody else is looking at this project.
    //
    // A copy working on the computer has no account, no peers, and no promise
    // to keep but one: nothing leaves the machine. `getRealtimeClient` builds
    // its socket from the compiled-in config rather than from the database it
    // is handed, so without this a local-mode write reached the hosted realtime
    // endpoint over HTTP — the project's id and the anon key, sent from a copy
    // whose whole point is that it sends nothing.
    if (isLocalMode()) return;
    // Same socket split as co-editing — see `getRealtimeClient`.
    const realtime = getRealtimeClient(db);
    this.channel = realtime.channel(`proj:${projectId}`, {
      config: { broadcast: { self: false }, private: true },
    });
    this.channel.on("broadcast", { event: "lww" }, ({ payload }) => {
      const resourceType =
        payload && typeof payload === "object" && "resourceType" in payload
          ? String((payload as { resourceType?: string }).resourceType)
          : undefined;
      const target = readyCore().lwwClearTarget(resourceType);
      if (target) {
        this.clearLocal(target as ResourceType, projectId);
      } else {
        invalidateAllRepoCaches();
      }
    });
    // Token first, then join. A private channel is authorized against the
    // caller's identity, and a join that goes out before the socket has a token
    // is an anonymous one — refused, then retried on a loop.
    // Nothing awaits the token, so a refusal is logged here. A channel replaced
    // or disposed while the token was on its way must not join.
    const channel = this.channel;
    void realtime.realtime
      .setAuth()
      .then(() => {
        if (this.channel === channel) channel.subscribe();
      })
      .catch((err: unknown) =>
        logToApp({ level: "warn", source: "realtime", message: "Realtime auth failed", detail: formatError(err) }),
      );
  }

  /**
   * Leave the project's channel.
   *
   * `watch(null)` does this too, but only when something remembers to call it:
   * the session reset nulls the project id without touching this, and a
   * container rebuilt for a new provider dropped its invalidator with the
   * channel still joined. A private channel per rebuild, held open for the life
   * of the tab.
   */
  dispose(): void {
    if (this.channel) void this.channel.unsubscribe();
    this.channel = null;
  }

  notifyPeers(resourceType?: ResourceType) {
    if (!this.channel) return;
    const resource = readyCore().lwwNotifyResource(resourceType);
    // A broadcast that fails costs peers a fresh read later; log it, don't throw.
    void this.channel
      .send({ type: "broadcast", event: "lww", payload: resource ? { resourceType: resource } : {} })
      .catch((err: unknown) =>
        logToApp({ level: "warn", source: "realtime", message: "Realtime broadcast failed", detail: formatError(err) }),
      );
  }
}

// --- cache-repo ---
/**
 * In-memory caching decorator for repositories.
 *
 * Wraps a repository so read methods are memoized per active project, and any
 * write clears the cache. This makes switching tabs instant — screens that call
 * `list()`/`getTree()` on mount hit the cache instead of refetching from
 * the database every time — while writes keep the cache correct (no stale data).
 *
 * The cache lives for the lifetime of the page (the container is a singleton),
 * so it survives client-side tab navigation but not a full reload. Reads are
 * keyed by (projectId, method, args); concurrent identical reads share one
 * in-flight promise (deduped). Settled reads are returned without re-fetching
 * for the core's `revalidateAfterMs` (screen cache policy), the same window the screen cache
 * trusts, so a screen's revalidation reaches the store. Past it the read is
 * refetched; if that fails (offline), the older answer is served instead.
 * A failed read is not cached, and a read in flight when the cache is cleared
 * is not cached either: it started before the write that cleared it.
 */
export type CacheRepoOpts = {
  resourceType?: ResourceType;
  sharedCache?: Map<string, Promise<unknown>>;
  sharedSettled?: Map<string, unknown>;
};

function normalizeOpts(
  opts?: CacheRepoOpts | Map<string, Promise<unknown>>,
  legacySettled?: Map<string, unknown>,
): CacheRepoOpts {
  if (opts instanceof Map) {
    return { sharedCache: opts, sharedSettled: legacySettled };
  }
  return opts ?? {};
}

/** When each settled key was stored, per settled map (shared maps share it). */
const settledTimes = new WeakMap<Map<string, unknown>, Map<string, number>>();

function timesFor(settled: Map<string, unknown>): Map<string, number> {
  let times = settledTimes.get(settled);
  if (!times) {
    times = new Map();
    settledTimes.set(settled, times);
  }
  return times;
}

export function cacheRepo<R extends object>(
  inner: R,
  reads: readonly string[],
  writes: readonly string[],
  pid: () => string | null,
  opts?: CacheRepoOpts | Map<string, Promise<unknown>>,
  legacySettled?: Map<string, unknown>,
): R {
  const { resourceType, sharedCache, sharedSettled } = normalizeOpts(opts, legacySettled);
  const cache = sharedCache ?? new Map<string, Promise<unknown>>();
  const settled = sharedSettled ?? new Map<string, unknown>();
  const settledAt = timesFor(settled);
  registerRepoCacheEntry({ resourceType, cache, settled });
  let lastPid: string | null | undefined;
  return new Proxy(inner, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      const name = String(prop);

      if (reads.includes(name)) {
        return (...args: unknown[]) => {
          const cur = pid();
          if (cur !== lastPid) {
            cache.clear();
            settled.clear();
            lastPid = cur;
          }
          const key = `${cur ?? "-"}|${name}|${JSON.stringify(args)}`;
          if (settled.has(key) && Date.now() - (settledAt.get(key) ?? 0) < readyCore().screenCachePolicy().revalidateAfterMs) {
            return Promise.resolve(settled.get(key));
          }
          // `cache` holds reads in flight only. A clear removes `p`, and a read
          // that finds itself gone was overtaken by a write: answer, don't keep.
          const hit = cache.get(key);
          if (hit) return hit;
          const p: Promise<unknown> = Promise.resolve(fn.apply(target, args)).then(
            (v) => {
              if (cache.get(key) === p) {
                cache.delete(key);
                settled.set(key, v);
                settledAt.set(key, Date.now());
              }
              return v;
            },
            (err) => {
              if (cache.get(key) !== p) throw err;
              cache.delete(key);
              if (settled.has(key)) return settled.get(key);
              throw err;
            },
          );
          cache.set(key, p);
          return p;
        };
      }

      if (writes.includes(name)) {
        return async (...args: unknown[]) => {
          const result = await fn.apply(target, args);
          cache.clear();
          settled.clear();
          cacheWriteNotify(resourceType);
          return result;
        };
      }

      return fn.bind(target);
    },
  }) as R;
}

// --- prefetch-screen ---
/**
 * Warm screen data on tab hover (Phase 3).
 *
 * Prefetch is a best-effort guess, so a failed warm-up stays silent: the
 * screen reports its own failure when it is opened.
 */
export function prefetchScreenForPath(pathname: string): void {
  const screen = readyCore().screenForPath(pathname) as ScreenId | null;
  if (!screen) return;

  void import("@/bootstrap")
    .then(({ ensureContainer }) => ensureContainer())
    .then((c) => warmScreen(c, screen))
    .catch(() => {});
}

/**
 * Start the loads a screen renders from and return them, so the caller owns
 * any failure.
 *
 * The switch is exhaustive over {@link ScreenId}: a screen added to the registry
 * without a case here falls through to the `never` assertion and stops
 * compiling, which is the one thing the three hand-kept lists could not do.
 * Whether a screen *should* prefetch is a decision — one with nothing worth
 * warming belongs in the `no-prefetch` group below, not in a missing case.
 */
export function warmScreen(c: AppContainer, screen: ScreenId): Promise<unknown> {
  switch (screen) {
    case "papers":
      return c.papers.loadScreenData();
    case "vault":
      return c.vault.loadScreenData();
    case "graph":
      return c.graph.loadScreenData();
    case "lists":
      return c.readingLists.loadScreenData();
    case "experiments":
      return c.experiments.loadScreenData();
    case "plan":
      return c.plan.loadScreenData();
    case "logbook":
      return c.logbook.loadEntries();
    case "report":
      return c.report.loadScreenData();
    case "report-overleaf":
      // The Overleaf tab renders the report screen's data under its own cache
      // key, plus the full paper rows its export needs. Warming one key does
      // not warm the other, so both loads are started.
      return Promise.all([c.report.loadScreenData(), c.papers.listPapers()]);
    case "shared-with-me":
      return c.sharing.loadSharedWithMeScreen();
    default:
      // Every ScreenId is handled above; this only type-checks while that
      // stays true.
      screen satisfies never;
      return Promise.resolve();
  }
}

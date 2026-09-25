/**
 * LWW cache invalidation over Realtime `proj:{projectId}` (plan §7.4).
 */

import { isLocalMode } from "@/backend/providers/local/local-identity";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/backend/providers/supabase/client";

import {
  isKnownResourceType,
  isScopedCacheInvalidationEnabled,
  WRITE_INVALIDATION_MAP,
  type ResourceType,
} from "@/lib/cache/cache-invalidation-map";
import {
  clearAllScreenCaches,
  clearScreenCachesForScreens,
} from "@/lib/cache/screen-cache";

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

export function invalidateAllRepoCaches(): void {
  for (const { cache, settled } of allRepoCaches) {
    cache.clear();
    settled.clear();
  }
  clearAllScreenCaches();
  logInvalidation(undefined, ["*"], ["*"]);
}

export function invalidateForWrite(resourceType?: string): void {
  if (!isScopedCacheInvalidationEnabled() || !resourceType || !isKnownResourceType(resourceType)) {
    invalidateAllRepoCaches();
    return;
  }

  const plan = WRITE_INVALIDATION_MAP[resourceType];
  const repoTypes = new Set<ResourceType>([resourceType, ...plan.repos]);
  for (const entry of allRepoCaches) {
    if (!entry.resourceType || !repoTypes.has(entry.resourceType)) continue;
    entry.cache.clear();
    entry.settled.clear();
  }

  clearScreenCachesForScreens(activeProjectId(), plan.screens);
  logInvalidation(resourceType, [...repoTypes], [...plan.screens]);
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

  clearLocal(resourceType?: ResourceType) {
    invalidateForWrite(resourceType);
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
      if (resourceType && isKnownResourceType(resourceType)) {
        this.clearLocal(resourceType);
      } else {
        invalidateAllRepoCaches();
      }
    });
    // Token first, then join. A private channel is authorized against the
    // caller's identity, and a join that goes out before the socket has a token
    // is an anonymous one — refused, then retried on a loop.
    const channel = this.channel;
    void realtime.realtime.setAuth().then(() => channel.subscribe());
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
    void this.channel?.send({
      type: "broadcast",
      event: "lww",
      payload: resourceType ? { resourceType } : {},
    });
  }
}

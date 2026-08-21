/**
 * LWW cache invalidation over Realtime `proj:{projectId}` (plan §7.4).
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getRealtimeClient } from "@/backend/providers/supabase/client";

import {
  isKnownResourceType,
  isScopedCacheInvalidationEnabled,
  WRITE_INVALIDATION_MAP,
  type ResourceType,
} from "./cache-invalidation-map.js";
import {
  clearAllScreenCaches,
  clearScreenCachesForScreens,
} from "./screen-cache.js";

type RepoCache = Map<string, Promise<unknown>>;
type RepoSettled = Map<string, unknown>;

type RepoCacheEntry = {
  resourceType?: ResourceType;
  cache: RepoCache;
  settled: RepoSettled;
};

const allRepoCaches: RepoCacheEntry[] = [];

let onWriteHook: ((resourceType?: ResourceType) => void) | undefined;
let registerHook: ((cache: RepoCache) => void) | undefined;
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

export function registerRepoCacheEntry(entry: RepoCacheEntry): void {
  allRepoCaches.push(entry);
  registerHook?.(entry.cache);
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
  register?: (cache: RepoCache) => void;
}): void {
  onWriteHook = opts.onWrite;
  registerHook = opts.register;
}

export function cacheWriteNotify(resourceType?: ResourceType): void {
  invalidateForWrite(resourceType);
  onWriteHook?.(resourceType);
}

export class ProjectLwwInvalidator {
  private readonly caches = new Set<RepoCache>();
  private channel: RealtimeChannel | null = null;

  registerCache(cache: RepoCache) {
    this.caches.add(cache);
  }

  clearLocal(resourceType?: ResourceType) {
    invalidateForWrite(resourceType);
  }

  watch(db: SupabaseClient, projectId: string | null) {
    if (this.channel) void this.channel.unsubscribe();
    this.channel = null;
    if (!projectId) return;
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

  notifyPeers(resourceType?: ResourceType) {
    void this.channel?.send({
      type: "broadcast",
      event: "lww",
      payload: resourceType ? { resourceType } : {},
    });
  }
}

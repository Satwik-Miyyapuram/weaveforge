/**
 * In-memory cache for fully-loaded screen payloads (keyed by project + screen).
 * Survives client-side tab navigation; cleared on project switch or LWW invalidation.
 *
 * A payload carries the moment it was *fetched*, not the moment this process
 * learned about it. The difference matters when a payload comes back from
 * IndexedDB after a reload: stamping it with the time it was read would make a
 * week-old screen look freshly loaded and suppress the revalidation that would
 * have corrected it. The number is required at every call site rather than
 * defaulted, so a caller has to say which of those two moments it means.
 *
 * The value and its timestamp are one entry rather than two maps keyed the same
 * way. Two maps had to be walked in step by every reader and every deleter, and
 * a desync — a value with no timestamp — is not a loud failure: the entry reads
 * as never fresh, and the screen revalidates on every mount.
 */

import { SCREEN_REVALIDATE_AFTER_MS } from "./cache-policy";

export function screenCacheKey(projectId: string | null, screen: string): string {
  return `${projectId ?? "-"}|${screen}`;
}

interface Entry<T> {
  value: T;
  /** When the payload came back from the server. */
  fetchedAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function getScreenCache<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

/** Skip background revalidation when the payload was fetched this recently. */
export function isScreenCacheFresh(key: string, maxAgeMs = SCREEN_REVALIDATE_AFTER_MS): boolean {
  const entry = store.get(key);
  return entry != null && Date.now() - entry.fetchedAt < maxAgeMs;
}

/** True when any payload exists (stale-while-revalidate — skip nav overlay). */
export function hasScreenCacheData(key: string): boolean {
  return store.has(key);
}

export function setScreenCache<T>(key: string, value: T, fetchedAt: number): void {
  store.set(key, { value, fetchedAt });
}

export function clearScreenCachesForScreens(
  projectId: string | null,
  screens: readonly string[],
): void {
  const prefix = `${projectId ?? "-"}|`;
  for (const screen of screens) {
    store.delete(`${prefix}${screen}`);
  }
  void import("@/lib/cache/screen-cache-idb").then((m) =>
    m.idbClearScreenCachesForScreens(projectId, screens),
  );
}

export function clearAllScreenCaches(): void {
  store.clear();
  void import("@/lib/cache/screen-cache-idb").then((m) => m.idbClearScreenCaches());
}

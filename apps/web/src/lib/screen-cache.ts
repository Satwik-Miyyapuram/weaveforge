/**
 * In-memory cache for fully-loaded screen payloads (keyed by project + screen).
 * Survives client-side tab navigation; cleared on project switch or LWW invalidation.
 */

export function screenCacheKey(projectId: string | null, screen: string): string {
  return `${projectId ?? "-"}|${screen}`;
}

const store = new Map<string, unknown>();
const loadedAt = new Map<string, number>();

/** Skip background revalidation when screen cache is newer than this. */
export const SCREEN_CACHE_FRESH_MS = 120_000;

export function getScreenCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function getScreenCacheAge(key: string): number | null {
  return loadedAt.get(key) ?? null;
}

export function isScreenCacheFresh(key: string, maxAgeMs = SCREEN_CACHE_FRESH_MS): boolean {
  const at = loadedAt.get(key);
  return at != null && Date.now() - at < maxAgeMs;
}

/** True when any payload exists (stale-while-revalidate — skip nav overlay). */
export function hasScreenCacheData(key: string): boolean {
  return store.has(key);
}

export function setScreenCache<T>(key: string, value: T): void {
  store.set(key, value);
  loadedAt.set(key, Date.now());
}

export function clearScreenCaches(projectId?: string | null): void {
  if (projectId === undefined) {
    store.clear();
    loadedAt.clear();
    void import("./screen-cache-idb").then((m) => m.idbClearScreenCaches());
    return;
  }
  const prefix = `${projectId ?? "-"}|`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      loadedAt.delete(key);
    }
  }
  void import("./screen-cache-idb").then((m) => m.idbClearScreenCaches(projectId));
}

export function clearScreenCachesForScreens(
  projectId: string | null,
  screens: readonly string[],
): void {
  const prefix = `${projectId ?? "-"}|`;
  for (const screen of screens) {
    const key = `${prefix}${screen}`;
    store.delete(key);
    loadedAt.delete(key);
  }
  void import("./screen-cache-idb").then((m) =>
    m.idbClearScreenCachesForScreens(projectId, screens),
  );
}

export function clearAllScreenCaches(): void {
  store.clear();
  loadedAt.clear();
  void import("./screen-cache-idb").then((m) => m.idbClearScreenCaches());
}

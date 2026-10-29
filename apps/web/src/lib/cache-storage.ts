/**
 * Drops every Cache Storage entry for this origin (the service worker's
 * precache and runtime caches). Best-effort: a browser without Cache Storage,
 * or one that refuses, is left as it is.
 *
 * A leaf on purpose: the crash-recovery path imports it, and must not pull in
 * the feature modules the device wipe needs.
 */
export async function clearCacheStorage(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* best-effort */
  }
}

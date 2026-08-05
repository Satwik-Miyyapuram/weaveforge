/**
 * Shared IndexedDB handle for local caches.
 *
 * Both the screen cache and the search index live in this database. They must
 * open it at the same version and declare every store in one upgrade handler —
 * two modules opening the same database at different versions makes whichever
 * asks for the lower one fail with a VersionError, taking its cache with it.
 */

export const APP_DB_NAME = "thesis-screen-cache";
export const SCREEN_STORE = "screens";
export const SEARCH_STORE = "search";

/** v1: screens only. v2: adds the search index store. */
export const APP_DB_VERSION = 2;

export function openAppDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Guarded per store: a fresh profile has neither, a v1 upgrade has screens.
      if (!db.objectStoreNames.contains(SCREEN_STORE)) db.createObjectStore(SCREEN_STORE);
      if (!db.objectStoreNames.contains(SEARCH_STORE)) db.createObjectStore(SEARCH_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

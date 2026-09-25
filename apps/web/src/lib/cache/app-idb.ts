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

/**
 * Persistence for the serialized search index.
 *
 * A second store in the screen-cache database rather than a new dependency:
 * the existing raw-IndexedDB helper is ~100 lines and already handles the
 * open/upgrade dance, so Dexie would buy nothing here.
 *
 * Every operation is best-effort. A failed read costs one rebuild; a thrown
 * error would cost the user their search box.
 */

import { SEARCH_STORE, openAppDb as openDb } from "@/lib/cache/app-idb";

export function searchCacheKey(projectId: string | null): string {
  return `${projectId ?? "-"}|index`;
}

export async function idbGetSearchIndex(projectId: string | null): Promise<string | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readonly");
      const req = tx.objectStore(SEARCH_STORE).get(searchCacheKey(projectId));
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSetSearchIndex(projectId: string | null, serialized: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readwrite");
      tx.objectStore(SEARCH_STORE).put(serialized, searchCacheKey(projectId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort persistence */
  }
}

/**
 * Drop cached indexes. Called on logout: the index holds note bodies and paper
 * abstracts in full, so leaving it behind would keep workspace content readable
 * on a shared device after sign-out.
 */
export async function idbClearSearchIndexes(projectId?: string | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, "readwrite");
      const store = tx.objectStore(SEARCH_STORE);
      if (projectId === undefined) {
        store.clear();
      } else {
        store.delete(searchCacheKey(projectId ?? null));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

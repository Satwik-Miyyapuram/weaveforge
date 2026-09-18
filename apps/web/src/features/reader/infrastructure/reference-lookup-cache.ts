/**
 * IndexedDB backing for `ReferenceLookupService`: a resolved bibliography entry
 * survives a reload, so reopening a paper paints "in library" and Scholar-like
 * records without a second round of Crossref and Semantic Scholar calls.
 *
 * Every operation is best-effort. A profile with no IndexedDB (private window,
 * quota exhausted) degrades to the service's in-memory map — slower, never
 * broken.
 */

import { REFERENCE_STORE, openAppDb } from "@/lib/cache/app-idb";
import type { ReferenceLookupCache, ResolvedReference } from "../application/reference-lookup";

export class IdbReferenceLookupCache implements ReferenceLookupCache {
  async get(key: string): Promise<ResolvedReference | undefined> {
    if (typeof indexedDB === "undefined") return undefined;
    try {
      const db = await openAppDb();
      return await new Promise<ResolvedReference | undefined>((resolve, reject) => {
        const tx = db.transaction(REFERENCE_STORE, "readonly");
        const req = tx.objectStore(REFERENCE_STORE).get(key);
        req.onsuccess = () => resolve((req.result as ResolvedReference | undefined) ?? undefined);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ResolvedReference): Promise<void> {
    if (typeof indexedDB === "undefined" || value.status === "pending") return;
    try {
      const db = await openAppDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(REFERENCE_STORE, "readwrite");
        // `inLibrary` is a live fact about this workspace, not about the
        // reference; it is re-checked on read, so only the metadata is kept.
        const stored: ResolvedReference = value.status === "resolved" ? { ...value, inLibrary: undefined } : value;
        tx.objectStore(REFERENCE_STORE).put(stored, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* best-effort */
    }
  }
}

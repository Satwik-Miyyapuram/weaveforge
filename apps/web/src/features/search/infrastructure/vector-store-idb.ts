import { VECTOR_STORE, openAppDb } from "@/lib/app-idb";

/**
 * Persisted passage vectors.
 *
 * Worth storing because they are expensive to produce: a corpus that takes
 * minutes to embed should not be re-embedded because a tab was closed. Written
 * as one record per project holding a single `ArrayBuffer` — thousands of small
 * rows would make the read slower than the arithmetic it saves.
 */

export interface StoredVectors {
  model: string;
  dimensions: number;
  ids: string[];
  vectors: ArrayBuffer;
  /** Corpus fingerprint at build time; a mismatch means re-embed. */
  revision: string;
}

const key = (projectId: string | null) => projectId ?? "-";

export async function idbGetVectors(projectId: string | null): Promise<StoredVectors | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openAppDb();
    return await new Promise<StoredVectors | null>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readonly");
      const req = tx.objectStore(VECTOR_STORE).get(key(projectId));
      req.onsuccess = () => resolve((req.result as StoredVectors | undefined) ?? null);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

export async function idbSetVectors(
  projectId: string | null,
  value: StoredVectors,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readwrite");
      tx.objectStore(VECTOR_STORE).put(value, key(projectId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort: losing this costs a re-embed, never a result */
  }
}

/** Cleared on sign-out: vectors encode the content they were built from. */
export async function idbClearVectors(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(VECTOR_STORE, "readwrite");
      tx.objectStore(VECTOR_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

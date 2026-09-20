import { SCREEN_STORE as STORE, openAppDb as openDb } from "@/lib/cache/app-idb";
import { SCREEN_SHOW_MAX_AGE_MS } from "./cache-policy";

/**
 * Cached screen payloads — cleared on logout so no data persists after sign-out.
 *
 * Stored in an envelope rather than raw, because a payload with no age is a
 * payload that can be shown forever without anyone noticing. The envelope
 * carries when it was fetched and which shape it is, and the reader enforces
 * both: too old is a miss, an unrecognised shape is a miss. A miss costs one
 * fetch; showing a stale screen as though it were current costs trust.
 *
 * "Too old" is `SCREEN_SHOW_MAX_AGE_MS` from `cache-policy.ts`, beside the much
 * shorter window the memory layer uses to decide whether to revalidate — the two
 * were separate unexported constants in separate files, answering two different
 * questions without saying so.
 */

/**
 * The envelope's shape. Bump when a payload's meaning changes in a way that a
 * cached copy from the previous build would get wrong — an entry from another
 * version is dropped rather than reinterpreted.
 */
const ENVELOPE_VERSION = 1;

interface Envelope<T> {
  version: number;
  /** When the payload came back from the server, not when it was written. */
  fetchedAt: number;
  value: T;
}

export interface CachedScreen<T> {
  value: T;
  fetchedAt: number;
}

function unwrap<T>(stored: unknown, now: number): CachedScreen<T> | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const envelope = stored as Partial<Envelope<T>>;
  if (envelope.version !== ENVELOPE_VERSION) return undefined;
  if (typeof envelope.fetchedAt !== "number") return undefined;
  // A clock that moved backwards leaves a future timestamp behind. Treating it
  // as a miss is the honest reading: its age is unknown, not zero.
  const age = now - envelope.fetchedAt;
  if (age < 0 || age > SCREEN_SHOW_MAX_AGE_MS) return undefined;
  return { value: envelope.value as T, fetchedAt: envelope.fetchedAt };
}

/** Exported for the tests; the rules above are the part worth checking. */
export const __test = { unwrap, ENVELOPE_VERSION, MAX_AGE_MS: SCREEN_SHOW_MAX_AGE_MS };

export async function idbGetScreenCache<T>(key: string): Promise<CachedScreen<T> | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  try {
    const db = await openDb();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return unwrap<T>(stored, Date.now());
  } catch {
    return undefined;
  }
}

export async function idbSetScreenCache<T>(key: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const envelope: Envelope<T> = { version: ENVELOPE_VERSION, fetchedAt: Date.now(), value };
      tx.objectStore(STORE).put(envelope, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best-effort persistence */
  }
}

export async function idbClearScreenCaches(projectId?: string | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    if (projectId === undefined) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    }
    const prefix = `${projectId ?? "-"}|`;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Remove only the named decrypted screens for one project. Used by scoped LWW invalidation. */
export async function idbClearScreenCachesForScreens(
  projectId: string | null,
  screens: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined" || screens.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const prefix = `${projectId ?? "-"}|`;
      for (const screen of screens) store.delete(`${prefix}${screen}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

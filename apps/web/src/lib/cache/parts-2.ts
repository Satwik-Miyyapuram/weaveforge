import { openAppDb as openDb, SCREEN_STORE as STORE } from "@/lib/cache/parts-1";
import { readyCore } from "@/lib/rust-core";

// --- screen-cache-idb ---
/**
 * Cached screen payloads — cleared on logout so no data persists after sign-out.
 *
 * Stored in an envelope rather than raw, because a payload with no age is a
 * payload that can be shown forever without anyone noticing. The envelope
 * carries when it was fetched and which shape it is, and the reader enforces
 * both: too old is a miss, an unrecognised shape is a miss. A miss costs one
 * fetch; showing a stale screen as though it were current costs trust.
 *
 * "Too old" is `showMaxAgeMs` from the wf-core screen cache policy, beside the much
 * shorter `revalidateAfterMs` window the memory layer uses to decide whether to
 * revalidate. Both are read from the core at call time, so one policy governs both.
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
  if (age < 0 || age > readyCore().screenCachePolicy().showMaxAgeMs) return undefined;
  return { value: envelope.value as T, fetchedAt: envelope.fetchedAt };
}

/** Exported for the tests; the rules above are the part worth checking. */
export const __test = {
  unwrap,
  ENVELOPE_VERSION,
  get MAX_AGE_MS() {
    return readyCore().screenCachePolicy().showMaxAgeMs;
  },
};

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

// --- screen-cache ---
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
export function isScreenCacheFresh(key: string, maxAgeMs = readyCore().screenCachePolicy().revalidateAfterMs): boolean {
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
  const keys = screens.map((screen) => `${prefix}${screen}`);
  trackIdbClear(keys, idbClearScreenCachesForScreens(projectId, screens));
}

export function clearAllScreenCaches(): void {
  store.clear();
  trackIdbClear(null, idbClearScreenCaches());
}

/**
 * The stored-payload deletes finish after the in-memory ones. A restore that
 * overlaps a delete of its key (or of every key) reads nothing, so it never
 * paints a payload a write just made stale; the network load fills the screen.
 */
const clearingKeys = new Map<string, number>();
let clearingAll = 0;
const activeReads = new Set<{ key: string; stale: boolean }>();

function trackIdbClear(keys: readonly string[] | null, done: Promise<unknown>): void {
  for (const read of activeReads) {
    if (keys == null || keys.includes(read.key)) read.stale = true;
  }
  if (keys == null) clearingAll += 1;
  else for (const key of keys) clearingKeys.set(key, (clearingKeys.get(key) ?? 0) + 1);
  void done
    .catch(() => undefined)
    .finally(() => {
      if (keys == null) {
        clearingAll -= 1;
        return;
      }
      for (const key of keys) {
        const left = (clearingKeys.get(key) ?? 1) - 1;
        if (left > 0) clearingKeys.set(key, left);
        else clearingKeys.delete(key);
      }
    });
}

/** The stored payload for `key`, or undefined when there is none or a delete of it overlaps the read. */
export async function readPersistedScreen<T>(key: string): Promise<CachedScreen<T> | undefined> {
  if (clearingAll > 0 || clearingKeys.has(key)) return undefined;
  const read = { key, stale: false };
  activeReads.add(read);
  try {
    const hit = await idbGetScreenCache<T>(key);
    return read.stale ? undefined : hit;
  } finally {
    activeReads.delete(read);
  }
}

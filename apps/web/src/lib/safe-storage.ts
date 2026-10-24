/**
 * Best-effort browser storage. Blocked or missing storage (a private window, a
 * locked-down profile, a full quota, the server) is not an error: a read gives
 * null and a write is dropped, so the setting lasts for this session only.
 *
 * The first real failure is logged once, so a broken store is visible without
 * flooding the console. No window (server render) is expected and stays quiet.
 */

export type StorageArea = "local" | "session";

let warned = false;

/** Test hook: let the next failure log again. */
export function resetStorageWarning(): void {
  warned = false;
}

function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("Browser storage is unavailable; settings last for this session only.", error);
}

function withStore<T>(area: StorageArea, fallback: T, run: (store: Storage) => T): T {
  try {
    // `window` in the browser; the bare global elsewhere (workers, tests).
    const host = (typeof window === "undefined" ? globalThis : window) as {
      localStorage?: Storage;
      sessionStorage?: Storage;
    };
    const store = area === "session" ? host.sessionStorage : host.localStorage;
    if (!store) return fallback;
    return run(store);
  } catch (error) {
    warnOnce(error);
    return fallback;
  }
}

export function readStored(key: string, area: StorageArea = "local"): string | null {
  return withStore(area, null, (store) => store.getItem(key));
}

export function writeStored(key: string, value: string, area: StorageArea = "local"): void {
  withStore(area, undefined, (store) => store.setItem(key, value));
}

export function removeStored(key: string, area: StorageArea = "local"): void {
  withStore(area, undefined, (store) => store.removeItem(key));
}

/** The parsed value, or `fallback` when nothing is stored or it is not JSON. */
export function readStoredJson<T>(key: string, fallback: T, area: StorageArea = "local"): T {
  const raw = readStored(key, area);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStoredJson(key: string, value: unknown, area: StorageArea = "local"): void {
  writeStored(key, JSON.stringify(value), area);
}

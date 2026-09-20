/**
 * Minimal IndexedDB stand-in for the `node:test` runner.
 *
 * The cache layer opens one database and then does `get`/`put`/`delete`/`clear`
 * against a named store; that is the whole surface this implements. Nothing
 * here emulates transactions, versioning or cursors, because nothing under test
 * depends on them.
 *
 * The one deliberate design choice: callbacks are **queued, not run**. Opening
 * the database and reading a key are separate steps, and each resolves only
 * when the test drains it. That is what makes the race between an IndexedDB
 * restore and a network load reproducible instead of timing-dependent — the
 * order the two actually resolve in is the thing being asserted, so the test
 * has to own it.
 */

type Rows = Map<string, unknown>;

interface Request<T> {
  result: T;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

export interface FakeIndexedDb {
  /** Run every queued callback, oldest first. */
  drain: () => void;
  /**
   * Drain until nothing is queued, letting the promises each step resolves
   * settle in between — an IndexedDB read is open-then-get, so one drain only
   * gets through the first step.
   */
  settle: (flush: () => Promise<void>) => Promise<void>;
  /** Callbacks waiting to run; zero means every operation has been let through. */
  readonly pending: number;
  /** How many times the database has been opened — the connection-count check. */
  readonly opens: number;
  /** Put a value straight into a store, as an earlier session would have. */
  seed: (store: string, key: string, value: unknown) => void;
  /** Make this the global `indexedDB`. */
  install: () => void;
  uninstall: () => void;
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const stores = new Map<string, Rows>();
  const queued: (() => void)[] = [];
  let opens = 0;

  const rowsFor = (store: string): Rows => {
    const existing = stores.get(store);
    if (existing) return existing;
    const created: Rows = new Map();
    stores.set(store, created);
    return created;
  };

  const open = (): Request<unknown> => {
    opens += 1;
    const request: Request<unknown> = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queued.push(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  };

  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      rowsFor(name);
      return {};
    },
    transaction(name: string) {
      const rows = rowsFor(name);
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string): Request<unknown> => {
            const request: Request<unknown> = {
              result: undefined,
              error: null,
              onsuccess: null,
              onerror: null,
              onupgradeneeded: null,
            };
            queued.push(() => {
              request.result = rows.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          put: (value: unknown, key: string) => {
            queued.push(() => {
              rows.set(key, value);
              tx.oncomplete?.();
            });
            return {};
          },
          delete: (key: string) => {
            queued.push(() => {
              rows.delete(key);
              tx.oncomplete?.();
            });
            return {};
          },
          clear: () => {
            queued.push(() => {
              rows.clear();
              tx.oncomplete?.();
            });
            return {};
          },
        }),
      };
      return tx;
    },
  };

  return {
    drain: () => {
      // A callback may queue another (open, then get); take them in order until
      // this round is empty rather than looping forever.
      const round = queued.splice(0, queued.length);
      for (const run of round) run();
    },
    settle: async (flush) => {
      for (let step = 0; step < 8 && queued.length > 0; step += 1) {
        const round = queued.splice(0, queued.length);
        for (const run of round) run();
        await flush();
      }
    },
    get pending() {
      return queued.length;
    },
    get opens() {
      return opens;
    },
    seed: (store, key, value) => {
      rowsFor(store).set(key, value);
    },
    install: () => {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: { open },
      });
    },
    uninstall: () => {
      Reflect.deleteProperty(globalThis, "indexedDB");
    },
  };
}

/**
 * `set()` keeps the cache under its cap without reading every PDF (22-04).
 *
 * The old `set()` called `getAll()` after each put, loading every cached PDF's
 * bytes into memory just to read their ages. Now it counts first and walks a
 * cursor only when the count is over the cap. The schema and version are
 * unchanged, so entries written by an earlier build are kept.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { IndexedDbPdfByteCache } from "../infrastructure/indexeddb-pdf-byte-cache";

interface Row {
  key: string;
  bytes: ArrayBuffer;
  updatedAt: number;
}

/**
 * A keyPath store with the requests the cache uses. Each request answers on a
 * later task, and the transaction completes once a task passes with nothing
 * pending, as IndexedDB auto-commits.
 */
function fakeIndexedDb() {
  const rows = new Map<string, Row>();
  const calls = { getAll: 0, cursors: 0, valueReads: 0, gets: 0 };
  const versions: number[] = [];
  let storeCreated = false;

  const later = (run: () => void) => setImmediate(run);

  const transaction = () => {
    let pending = 0;
    let done = false;
    const tx = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null,
      objectStore: () => store,
    };
    const checkDone = () =>
      later(() => {
        if (pending === 0 && !done) {
          done = true;
          tx.oncomplete?.();
        }
      });
    const request = <T>(answer: () => T) => {
      const req = { result: undefined as T | undefined, error: null, onsuccess: null as (() => void) | null, onerror: null };
      pending += 1;
      later(() => {
        req.result = answer();
        pending -= 1;
        req.onsuccess?.();
        checkDone();
      });
      return req;
    };
    const store = {
      get: (key: string) => {
        calls.gets += 1;
        return request(() => rows.get(key));
      },
      getKey: (key: string) => request(() => (rows.has(key) ? key : undefined)),
      put: (row: Row) => request(() => void rows.set(row.key, row)),
      delete: (key: string) => request(() => void rows.delete(key)),
      clear: () => request(() => rows.clear()),
      count: () => request(() => rows.size),
      getAll: () => {
        calls.getAll += 1;
        return request(() => [...rows.values()]);
      },
      openCursor: () => {
        calls.cursors += 1;
        const req = { result: null as unknown, error: null, onsuccess: null as (() => void) | null, onerror: null };
        const keys = () => [...rows.keys()].sort();
        const step = (after: string | null) => {
          pending += 1;
          later(() => {
            const key = keys().find((k) => after === null || k > after);
            req.result =
              key === undefined
                ? null
                : {
                    key,
                    primaryKey: key,
                    get value() {
                      calls.valueReads += 1;
                      return rows.get(key);
                    },
                    continue: () => step(key),
                  };
            pending -= 1;
            req.onsuccess?.();
            checkDone();
          });
        };
        step(null);
        return req;
      },
    };
    return tx;
  };

  const db = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => {
      storeCreated = true;
    },
    transaction,
    close: () => {},
  };

  return {
    rows,
    calls,
    versions,
    seed(key: string, updatedAt: number) {
      storeCreated = true;
      rows.set(key, { key, bytes: new ArrayBuffer(1), updatedAt });
    },
    install() {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: {
          open: (_name: string, version: number) => {
            versions.push(version);
            const req = {
              result: db,
              error: null,
              onsuccess: null as (() => void) | null,
              onerror: null,
              onupgradeneeded: null as (() => void) | null,
            };
            later(() => {
              if (!storeCreated) req.onupgradeneeded?.();
              req.onsuccess?.();
            });
            return req;
          },
        },
      });
    },
  };
}

let idb: ReturnType<typeof fakeIndexedDb>;
beforeEach(() => {
  idb = fakeIndexedDb();
  idb.install();
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "indexedDB");
});

test("under the cap, set() loads no other entry", async () => {
  idb.seed("a", 1);
  idb.seed("b", 2);
  await new IndexedDbPdfByteCache(3).set("c", new ArrayBuffer(4));
  assert.deepEqual([...idb.rows.keys()].sort(), ["a", "b", "c"]);
  assert.equal(idb.calls.getAll, 0);
  assert.equal(idb.calls.cursors, 0);
});

test("at the cap exactly, nothing is walked or evicted", async () => {
  idb.seed("a", 1);
  await new IndexedDbPdfByteCache(2).set("b", new ArrayBuffer(4));
  assert.deepEqual([...idb.rows.keys()].sort(), ["a", "b"]);
  assert.equal(idb.calls.cursors, 0);
});

test("over the cap, the oldest entries go and getAll is never used", async () => {
  // Key order differs from age order, so the walk must sort by updatedAt.
  idb.seed("a", 30);
  idb.seed("b", 10);
  idb.seed("c", 20);
  await new IndexedDbPdfByteCache(2).set("d", new ArrayBuffer(4));
  assert.deepEqual([...idb.rows.keys()].sort(), ["a", "d"]);
  assert.equal(idb.calls.getAll, 0);
  assert.equal(idb.calls.cursors, 1);
});

test("replacing a key already cached does not evict", async () => {
  idb.seed("a", 1);
  idb.seed("b", 2);
  await new IndexedDbPdfByteCache(2).set("a", new ArrayBuffer(4));
  assert.deepEqual([...idb.rows.keys()].sort(), ["a", "b"]);
  assert.equal(idb.calls.cursors, 0);
});

test("the database version is unchanged, so earlier entries are kept", async () => {
  idb.seed("old", 1);
  const cache = new IndexedDbPdfByteCache(5);
  await cache.set("new", new ArrayBuffer(4));
  assert.deepEqual(idb.versions, [1]);
  assert.ok((await cache.get("old")) instanceof ArrayBuffer);
  assert.equal(await cache.size(), 2);
});

test("a fresh database still creates its store", async () => {
  await new IndexedDbPdfByteCache(1).set("a", new ArrayBuffer(4));
  assert.deepEqual([...idb.rows.keys()], ["a"]);
});

test("has finds a cached key without reading its bytes", async () => {
  idb.seed("a", 1);
  const cache = new IndexedDbPdfByteCache(4);
  assert.equal(await cache.has("a"), true);
  assert.equal(await cache.has("absent"), false);
  assert.equal(idb.calls.gets, 0);
  assert.equal(idb.calls.getAll, 0);
});

test("has on a fresh database is false", async () => {
  assert.equal(await new IndexedDbPdfByteCache(1).has("a"), false);
});

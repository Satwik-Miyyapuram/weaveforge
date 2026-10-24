import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { clearPdfTexts, loadPdfTexts } from "../infrastructure/pdf-text-store";
import { closeAppDb } from "@/lib/cache/app-idb";

interface Range {
  lower: string;
  upper: string;
}

/**
 * An IndexedDB with just enough cursor support for the pdf text store, counting
 * every row a cursor steps onto. The count is what 27-06 is about: a project's
 * load must not walk other projects' documents.
 */
function installCursorDb(keys: string[]) {
  const rows = new Map<string, unknown>(keys.map((k) => [k, { paperId: k.split("|")[1], pages: [] }]));
  let visited = 0;
  const later = (fn: () => void) => setTimeout(fn, 0);

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    onversionchange: null,
    onclose: null,
    transaction() {
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: null,
        objectStore: () => store,
      };
      const store = {
        openCursor(range?: Range) {
          const inRange = [...rows.keys()]
            .sort()
            .filter((k) => !range || (k >= range.lower && k <= range.upper));
          const req = { result: null as unknown, onsuccess: null as (() => void) | null };
          let i = 0;
          const step = () =>
            later(() => {
              const k = inRange[i];
              if (k === undefined) {
                req.result = null;
                req.onsuccess?.();
                later(() => tx.oncomplete?.());
                return;
              }
              visited += 1;
              req.result = {
                key: k,
                value: rows.get(k),
                continue: () => {
                  i += 1;
                  step();
                },
                delete: () => rows.delete(k),
              };
              req.onsuccess?.();
            });
          step();
          return req;
        },
        clear() {
          rows.clear();
          later(() => tx.oncomplete?.());
        },
      };
      return tx;
    },
  };

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const req = { result: db, onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null };
        later(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    },
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    configurable: true,
    value: { bound: (lower: string, upper: string): Range => ({ lower, upper }) },
  });
  return { rows, visited: () => visited };
}

afterEach(() => {
  closeAppDb();
  Reflect.deleteProperty(globalThis, "indexedDB");
  Reflect.deleteProperty(globalThis, "IDBKeyRange");
});

const KEYS = ["p1|a", "p1|b", "p10|c", "p2|d", "p2|e", "p2|f", "-|g"];

test("loadPdfTexts reads only the project's own rows (27-06)", async () => {
  const fake = installCursorDb(KEYS);
  const out = await loadPdfTexts("p1");
  assert.deepEqual(out.map((s) => s.paperId).sort(), ["a", "b"]);
  assert.equal(fake.visited(), 2);
});

test("loadPdfTexts with no project reads only the '-' rows (27-06)", async () => {
  const fake = installCursorDb(KEYS);
  const out = await loadPdfTexts(null);
  assert.deepEqual(out.map((s) => s.paperId), ["g"]);
  assert.equal(fake.visited(), 1);
});

test("clearPdfTexts deletes only the project's rows and walks no others (27-06)", async () => {
  const fake = installCursorDb(KEYS);
  await clearPdfTexts("p2");
  assert.deepEqual([...fake.rows.keys()].sort(), ["-|g", "p10|c", "p1|a", "p1|b"]);
  assert.equal(fake.visited(), 3);
});

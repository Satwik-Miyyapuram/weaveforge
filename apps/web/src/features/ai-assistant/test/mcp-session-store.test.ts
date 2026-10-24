/**
 * A stored MCP session is dropped only when it can never be read again (32-13).
 *
 * The wrapped blob lives in sessionStorage and its key in IndexedDB. A key
 * store that fails to open this time says nothing about the blob, so the blob
 * stays for the next load. A missing key or a blob that will not parse is gone
 * for good, so that one is cleared.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { loadPersistedMcpSessions } from "@/features/ai-assistant/infrastructure/mcp-session-store";

const KEY = "tt:mcp:sessions-wrapped";
const BLOB = JSON.stringify({ iv: "AAAAAAAAAAAAAAAA", ct: "AAAA" });

type Req = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };

/** An IndexedDB whose open either fails, or succeeds with a store holding `stored`. */
function fakeIndexedDb(mode: "open-fails" | "read-fails" | { stored: unknown }) {
  return {
    open: () => {
      const req: Req = {};
      setTimeout(() => {
        if (mode === "open-fails") {
          req.error = new Error("IDB busy");
          req.onerror?.();
          return;
        }
        req.result = {
          close: () => {},
          transaction: () => ({
            objectStore: () => ({
              get: () => {
                const get: Req = {};
                setTimeout(() => {
                  if (mode === "read-fails") {
                    get.error = new Error("read aborted");
                    get.onerror?.();
                  } else {
                    get.result = mode.stored;
                    get.onsuccess?.();
                  }
                }, 0);
                return get;
              },
            }),
          }),
        };
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

async function load(idb: unknown, stored: string | null = BLOB) {
  const store = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, sessionStorage: g.sessionStorage, indexedDB: g.indexedDB };
  g.window = {};
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.indexedDB = idb;
  try {
    const list = await loadPersistedMcpSessions();
    return { list, blob: store.get(KEY) ?? null };
  } finally {
    Object.assign(g, saved);
  }
}

test("a key store that fails to open keeps the blob for the next load", async () => {
  const { list, blob } = await load(fakeIndexedDb("open-fails"));
  assert.deepEqual(list, []);
  assert.equal(blob, BLOB);
});

test("a key read that fails keeps the blob", async () => {
  const { list, blob } = await load(fakeIndexedDb("read-fails"));
  assert.deepEqual(list, []);
  assert.equal(blob, BLOB);
});

test("no IndexedDB at all keeps the blob", async () => {
  const { list, blob } = await load(undefined);
  assert.deepEqual(list, []);
  assert.equal(blob, BLOB);
});

test("a key that is gone clears the blob: it can never be read again", async () => {
  const { list, blob } = await load(fakeIndexedDb({ stored: undefined }));
  assert.deepEqual(list, []);
  assert.equal(blob, null);
});

test("a blob that does not parse is cleared", async () => {
  const { list, blob } = await load(fakeIndexedDb("open-fails"), "{not json");
  assert.deepEqual(list, []);
  assert.equal(blob, null);
});

test("nothing stored loads nothing", async () => {
  const { list, blob } = await load(fakeIndexedDb("open-fails"), null);
  assert.deepEqual(list, []);
  assert.equal(blob, null);
});

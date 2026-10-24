/**
 * What a write clears, and for which project (B55).
 *
 * - xapi-04: deleting a paper cascades to its citation alert tracks in the
 *   database, so a paper write clears that cache too.
 * - xapi-09: a failed peer broadcast is logged, not left unhandled.
 * - xapi-10: a peer's write clears the screens of the project it was written
 *   in, not whichever project happens to be open.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  invalidateForWrite,
  ProjectLwwInvalidator,
  registerRepoCacheEntry,
  setActiveProjectIdForCache,
} from "@/lib/cache/project-lww-invalidator";
import { clearAllScreenCaches, getScreenCache, screenCacheKey, setScreenCache } from "@/lib/cache/screen-cache";

type Log = { level: string; source: string; message: string; detail?: string };
type Handler = (msg: { payload: unknown }) => void;

function harness(send: () => Promise<unknown> = async () => "ok") {
  const handlers: Handler[] = [];
  const db = {
    channel: () => {
      const channel = {
        on: (_type: string, _filter: unknown, handler: Handler) => {
          handlers.push(handler);
          return channel;
        },
        subscribe: () => channel,
        unsubscribe: async () => "ok",
        send,
      };
      return channel;
    },
    realtime: { setAuth: async () => {} },
  };
  return { db: db as never, broadcast: (payload: unknown) => handlers.forEach((h) => h({ payload })) };
}

async function withDesktopLog(run: (logs: Log[]) => Promise<void>): Promise<unknown[]> {
  const logs: Log[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: () => null },
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (entry: Log) => void logs.push(entry) },
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run(logs);
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    (globalThis as { window?: unknown }).window = original;
  }
  return unhandled;
}

function seedPapers(...projects: string[]) {
  for (const p of projects) setScreenCache(screenCacheKey(p, "papers"), { p }, Date.now());
}

const papersOf = (p: string) => getScreenCache(screenCacheKey(p, "papers"));

test("a paper write clears the citation alert track cache (xapi-04)", () => {
  const cache = new Map<string, Promise<unknown>>([["k", Promise.resolve(1)]]);
  const settled = new Map<string, unknown>([["k", 1]]);
  const dispose = registerRepoCacheEntry({ resourceType: "citation_alert_track", cache, settled });
  try {
    invalidateForWrite("paper");
    assert.equal(cache.size, 0);
    assert.equal(settled.size, 0);
  } finally {
    dispose();
  }
});

test("a citation alert write does not clear the paper cache", () => {
  const cache = new Map<string, Promise<unknown>>([["k", Promise.resolve(1)]]);
  const settled = new Map<string, unknown>([["k", 1]]);
  const dispose = registerRepoCacheEntry({ resourceType: "paper", cache, settled });
  try {
    invalidateForWrite("citation_alert_track");
    assert.equal(cache.size, 1);
  } finally {
    dispose();
  }
});

test("a failed peer broadcast is logged, not left unhandled (xapi-09)", async () => {
  const h = harness(() => Promise.reject(new Error("socket closed")));
  let logs: Log[] = [];
  const unhandled = await withDesktopLog(async (captured) => {
    logs = captured;
    const inv = new ProjectLwwInvalidator();
    inv.watch(h.db, "p1");
    inv.notifyPeers("paper");
  });
  assert.deepEqual(unhandled, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "realtime");
  assert.match(logs[0]!.detail ?? "", /socket closed/);
});

test("notifyPeers before any watch sends nothing and logs nothing", async () => {
  let logs: Log[] = [];
  const unhandled = await withDesktopLog(async (captured) => {
    logs = captured;
    new ProjectLwwInvalidator().notifyPeers("paper");
  });
  assert.deepEqual(unhandled, []);
  assert.deepEqual(logs, []);
});

test("a write clears the screens of the project it names (xapi-10)", () => {
  clearAllScreenCaches();
  setActiveProjectIdForCache(() => "B");
  seedPapers("A", "B");
  invalidateForWrite("paper", "A");
  assert.equal(papersOf("A"), undefined);
  assert.deepEqual(papersOf("B"), { p: "B" });
  clearAllScreenCaches();
});

test("a write that names no project still clears the open one", () => {
  clearAllScreenCaches();
  setActiveProjectIdForCache(() => "B");
  seedPapers("A", "B");
  invalidateForWrite("paper");
  assert.deepEqual(papersOf("A"), { p: "A" });
  assert.equal(papersOf("B"), undefined);
  clearAllScreenCaches();
});

test("a peer's broadcast clears the watched project, not the open one", async () => {
  clearAllScreenCaches();
  setActiveProjectIdForCache(() => "B");
  seedPapers("A", "B");
  const h = harness();
  await withDesktopLog(async () => {
    const inv = new ProjectLwwInvalidator();
    inv.watch(h.db, "A");
    h.broadcast({ resourceType: "paper" });
    inv.dispose();
  });
  assert.equal(papersOf("A"), undefined);
  assert.deepEqual(papersOf("B"), { p: "B" });
  clearAllScreenCaches();
});

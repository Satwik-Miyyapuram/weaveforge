import assert from "node:assert/strict";
import test from "node:test";

import { ProjectLwwInvalidator } from "@/lib/cache/project-lww-invalidator";

/**
 * The project channel joins after the socket has a token, and nothing awaits
 * that. A refused token used to be an unhandled rejection; it is logged now
 * (xapi-08). A join that resolves after the channel was replaced or disposed
 * must not subscribe the old channel again — the same race as 33-05.
 */

type Log = { level: string; source: string; message: string; detail?: string };

function harness(setAuth: () => Promise<void>) {
  const joined: string[] = [];
  const left: string[] = [];
  const db = {
    channel: (topic: string) => {
      const channel = {
        topic,
        on: () => channel,
        subscribe: () => {
          joined.push(topic);
          return channel;
        },
        unsubscribe: async () => {
          left.push(topic);
          return "ok";
        },
        send: async () => "ok",
      };
      return channel;
    },
    realtime: { setAuth },
  };
  return { db: db as never, joined, left };
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

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

test("a refused realtime token is logged, not left unhandled", async () => {
  const h = harness(() => Promise.reject(new Error("token refresh failed")));
  let logs: Log[] = [];
  const unhandled = await withDesktopLog(async (captured) => {
    logs = captured;
    new ProjectLwwInvalidator().watch(h.db, "p1");
    await settle();
  });
  assert.deepEqual(unhandled, []);
  assert.deepEqual(h.joined, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.match(logs[0]!.detail ?? "", /token refresh failed/);
});

test("a channel replaced before its token arrives does not join", async () => {
  const releases: (() => void)[] = [];
  const h = harness(() => new Promise<void>((resolve) => releases.push(resolve)));
  await withDesktopLog(async () => {
    const invalidator = new ProjectLwwInvalidator();
    invalidator.watch(h.db, "p1");
    invalidator.watch(h.db, "p2");
    for (const release of releases) release();
    await settle();
  });
  assert.deepEqual(h.joined, ["proj:p2"]);
});

test("a channel disposed before its token arrives does not join", async () => {
  const releases: (() => void)[] = [];
  const h = harness(() => new Promise<void>((resolve) => releases.push(resolve)));
  await withDesktopLog(async () => {
    const invalidator = new ProjectLwwInvalidator();
    invalidator.watch(h.db, "p1");
    invalidator.dispose();
    for (const release of releases) release();
    await settle();
  });
  assert.deepEqual(h.joined, []);
  assert.deepEqual(h.left, ["proj:p1"]);
});

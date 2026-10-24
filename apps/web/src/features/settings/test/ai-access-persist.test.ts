/**
 * A failed save of the running AI sessions is logged, not left unhandled
 * (31-07), and only sessions with a running relay are saved.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { persistActiveSessions } from "../ui/ai-access-panel";

type Log = { level: string; source: string; message: string; detail?: string };

function fakeAi(save: (list: unknown[]) => Promise<void>) {
  return {
    listActiveSessions: () => [{ grant: { id: "g1" } }, { grant: { id: "g2" } }],
    runningRelays: () => [{ sessionId: "g1", secret: "s1", settings: { enabled: true } }],
    savePersistedSessions: save,
  } as never;
}

async function withLog(run: () => void) {
  const logs: Log[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);
  const g = globalThis as { window?: unknown };
  const original = g.window;
  g.window = {
    localStorage: { getItem: () => null },
    weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) },
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    run();
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    g.window = original;
  }
  return { logs, unhandled };
}

test("only sessions with a running relay are saved", async () => {
  let saved: unknown[] = [];
  const { logs, unhandled } = await withLog(() =>
    persistActiveSessions(fakeAi(async (list) => void (saved = list))),
  );
  assert.deepEqual(saved, [{ session: { grant: { id: "g1" } }, secret: "s1", settings: { enabled: true } }]);
  assert.deepEqual(logs, []);
  assert.deepEqual(unhandled, []);
});

test("a failed save is logged as a warning, not left unhandled", async () => {
  const { logs, unhandled } = await withLog(() =>
    persistActiveSessions(fakeAi(() => Promise.reject(new Error("quota exceeded")))),
  );
  assert.deepEqual(unhandled, []);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "ai-access");
  assert.match(logs[0]!.detail ?? "", /quota exceeded/);
});

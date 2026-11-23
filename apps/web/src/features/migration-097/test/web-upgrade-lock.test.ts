import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runWebUpgrade,
  UpgradeFinishedInOtherTabError,
  UpgradeInOtherTabError,
  WEB_UPGRADE_LOCK,
  type UpgradeLocks,
  type WebUpgradeOptions,
} from "../application/run-web-upgrade";
import type { FileCodec, Row } from "../domain/ports";
import { MemorySink } from "../infrastructure/memory-sink";

const codec: FileCodec = {
  supports: (kind) => kind === "logEntries",
  toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
  toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
};

/** PostgREST stand-in with empty tables; records every request so a refused run can prove it sent none. */
function fakePostgrest(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${String(input)}`);
    if (method === "HEAD") return new Response(null, { status: 200, headers: { "content-range": "0-0/0" } });
    return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
  }) as unknown as typeof fetch;
}

function options(calls: string[], sink = new MemorySink()): WebUpgradeOptions {
  return {
    server: { baseUrl: "https://api.example.test", userId: "u1", headers: {}, fetch: fakePostgrest(calls), pendingOutbox: async () => 0 },
    kinds: ["logEntries"],
    codec,
    sink,
    now: "2026-11-23T00:00:00.000Z",
    runDeviceId: "web-me-0001",
  };
}

/** The navigator.locks contract for `ifAvailable`: one holder per name; a busy name calls back with null. */
function lockManager(): UpgradeLocks & { requests: { name: string; ifAvailable: boolean }[] } {
  const held = new Set<string>();
  const requests: { name: string; ifAvailable: boolean }[] = [];
  return {
    requests,
    async request(name, opts, callback) {
      requests.push({ name, ifAvailable: opts.ifAvailable });
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

test("with the lock free, the upgrade runs inside the named lock, asked for with ifAvailable", async () => {
  const calls: string[] = [];
  const locks = lockManager();
  const result = await runWebUpgrade(options(calls), undefined, locks);
  assert.notEqual(result.state, undefined);
  assert.deepEqual(locks.requests, [{ name: WEB_UPGRADE_LOCK, ifAvailable: true }]);
  assert.ok(calls.length > 0, "the export ran");
});

test("a second tab gets the other-tab error and exports nothing while the first run holds the lock", async () => {
  const calls: string[] = [];
  const locks = lockManager();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = locks.request(WEB_UPGRADE_LOCK, { ifAvailable: true }, async () => gate);
  const secondSink = new MemorySink();
  await assert.rejects(
    runWebUpgrade(options(calls, secondSink), undefined, locks),
    (err: unknown) => err instanceof UpgradeInOtherTabError && /another tab/.test(err.message),
  );
  assert.deepEqual(calls, [], "the second tab sent no request");
  assert.deepEqual(await secondSink.list(), [], "the second tab wrote no file");
  release();
  await first;
});

test("two runs started together: one exports, the other is refused with the other-tab error", async () => {
  const calls: string[] = [];
  const locks = lockManager();
  const outcomes = await Promise.allSettled([
    runWebUpgrade(options(calls), undefined, locks),
    runWebUpgrade(options(calls), undefined, locks),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
  assert.equal(refused.length, 1);
  assert.ok(refused[0]?.reason instanceof UpgradeInOtherTabError);
});

test("a run started after another tab verified is refused inside the lock and exports nothing", async () => {
  const calls: string[] = [];
  const sink = new MemorySink();
  const locks = lockManager();
  const done = { ...options(calls, sink), alreadyDone: () => true };
  await assert.rejects(runWebUpgrade(done, undefined, locks), (err: unknown) => err instanceof UpgradeFinishedInOtherTabError);
  assert.deepEqual(locks.requests, [{ name: WEB_UPGRADE_LOCK, ifAvailable: true }], "the marker is read under the lock");
  assert.deepEqual(calls, [], "no request");
  assert.deepEqual(await sink.list(), [], "no file");
  await assert.rejects(runWebUpgrade(done, undefined, null), (err: unknown) => err instanceof UpgradeFinishedInOtherTabError);
  assert.deepEqual(calls, [], "no request without locks either");
});

test("the browser's LockManager fits UpgradeLocks without a cast", () => {
  const real: LockManager | undefined = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  const fits: UpgradeLocks | undefined = real;
  assert.ok(fits === real);
});

test("without navigator.locks the upgrade runs as before, with no lock", async () => {
  const calls: string[] = [];
  const result = await runWebUpgrade(options(calls), undefined, null);
  assert.notEqual(result.state, undefined);
  assert.ok(calls.length > 0, "the export ran");
});

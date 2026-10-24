/**
 * What the sync loop says, and logs, when a cycle does not get through
 * (34-03, 34-04, 34-05, 34-06).
 *
 * An offline push is not "idle", a failed cycle or boot leaves a line in the
 * app log, a failed conflicts read does not show zero conflicts, and a boot
 * that fails (offline at sign-in) is tried again rather than waiting for the
 * next sign-in.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { AppLogInput } from "@/lib/error-report/app-log";
import type { CycleResult } from "@/features/offline-sync/domain/sync-engine";
import type { LiveSyncState } from "@/features/offline-sync/domain/live-sync";
import {
  countOpenConflicts,
  createBootQueue,
  syncOnce,
} from "@/features/offline-sync/ui/sync-loop";
import { remoteProjectNames } from "@/features/offline-sync/ui/enable-sync";

function result(stoppedBecause: "offline" | null, applied = 0): CycleResult {
  return {
    pushed: { sent: 0, conflicts: [], stoppedBecause },
    pulled: { applied, watermark: 7, more: false },
  };
}

function harness(cycle: () => Promise<CycleResult>, online = true) {
  const states: Partial<LiveSyncState>[] = [];
  const logs: AppLogInput[] = [];
  const settled: CycleResult[] = [];
  const run = () =>
    syncOnce({
      cycle,
      settle: (r) => void settled.push(r),
      setState: (patch) => void states.push(patch),
      online: () => online,
      log: (entry) => void logs.push(entry),
    });
  const last = () => Object.assign({}, ...states) as Partial<LiveSyncState>;
  return { run, states, logs, settled, last };
}

test("a cycle whose push stopped offline is shown as offline, not idle (34-03)", async () => {
  const h = harness(async () => result("offline"));
  await h.run();
  assert.equal(h.last().phase, "offline");
  assert.equal(h.last().isOnline, false);
  // Nothing reached the server, so this is not a sync.
  assert.equal(h.states.some((s) => s.lastSyncAt !== undefined), false);
});

test("a cycle that got through is idle and stamped", async () => {
  const h = harness(async () => result(null, 2));
  await h.run();
  assert.equal(h.last().phase, "idle");
  assert.equal(h.last().isOnline, true);
  assert.equal(typeof h.last().lastSyncAt, "number");
  assert.equal(h.settled.length, 1);
  assert.equal(h.logs.length, 0);
});

test("a cycle that throws is logged and shown as an error (34-04)", async () => {
  const h = harness(async () => {
    throw new Error("PostgREST 503");
  });
  await h.run();
  assert.equal(h.last().phase, "error");
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0]!.source, "sync");
  assert.match(h.logs[0]!.detail ?? "", /PostgREST 503/);
  assert.equal(h.settled.length, 0);
});

test("a cycle that throws while the browser is offline is shown as offline", async () => {
  const h = harness(async () => {
    throw new TypeError("Failed to fetch");
  }, false);
  await h.run();
  assert.equal(h.last().phase, "offline");
  assert.equal(h.last().isOnline, false);
  assert.equal(h.logs.length, 1);
});

test("a conflicts read that fails is logged and is not zero (34-05)", async () => {
  const logs: AppLogInput[] = [];
  const count = await countOpenConflicts(
    { openConflicts: async () => Promise.reject(new Error("no such table: sync_conflicts")) },
    (e) => void logs.push(e),
  );
  assert.equal(count, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!.detail ?? "", /sync_conflicts/);
});

test("only conflicts that need a person are counted", async () => {
  const count = await countOpenConflicts(
    {
      openConflicts: async () =>
        [
          { kind: "edit", fields: ["title"] },
          { kind: "edit", fields: [] },
          { kind: "delete", fields: [] },
        ] as never,
    },
    () => assert.fail("nothing to log"),
  );
  assert.equal(count, 2);
});

/** Resolves once `n` boots have run, or fails the test after a while. */
function waitFor(check: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("timed out"));
      setTimeout(tick, 2);
    };
    tick();
  });
}

test("a boot that fails is retried until it succeeds, and each failure logged (34-06)", async () => {
  const calls: (string | null)[] = [];
  const failures: unknown[] = [];
  let failuresLeft = 2;
  const q = createBootQueue<string>(
    async (user) => {
      calls.push(user);
      if (failuresLeft-- > 0) throw new Error("offline at sign-in");
    },
    { retryMs: 5, onFailure: (err) => void failures.push(err) },
  );
  q.queue("u1");
  await waitFor(() => calls.length === 3);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls, ["u1", "u1", "u1"]);
  assert.equal(failures.length, 2);
  q.cancel();
});

test("signing out does not retry a failed boot", async () => {
  const calls: (string | null)[] = [];
  const q = createBootQueue<string>(
    async (user) => {
      calls.push(user);
      throw new Error("fails");
    },
    { retryMs: 5, onFailure: () => {} },
  );
  q.queue(null);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls, [null]);
  q.cancel();
});

test("a newer session replaces the pending retry", async () => {
  const calls: (string | null)[] = [];
  const q = createBootQueue<string>(
    async (user) => {
      calls.push(user);
      if (user === "u1") throw new Error("fails");
    },
    { retryMs: 20, onFailure: () => {} },
  );
  q.queue("u1");
  await waitFor(() => calls.length === 1);
  q.queue(null);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, ["u1", null]);
  q.cancel();
});

test("cancel stops further retries", async () => {
  const calls: (string | null)[] = [];
  const q = createBootQueue<string>(
    async (user) => {
      calls.push(user);
      throw new Error("fails");
    },
    { retryMs: 5, onFailure: () => {} },
  );
  q.queue("u1");
  await waitFor(() => calls.length === 1);
  q.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls.length, 1);
});

test("boots run one after another, in order", async () => {
  const events: string[] = [];
  const q = createBootQueue<string>(
    async (user) => {
      events.push(`start ${user}`);
      await new Promise((r) => setTimeout(r, 10));
      events.push(`end ${user}`);
    },
    { retryMs: 5, onFailure: () => {} },
  );
  q.queue("a");
  q.queue("b");
  await waitFor(() => events.length === 4);
  assert.deepEqual(events, ["start a", "end a", "start b", "end b"]);
  q.cancel();
});

test("the account's project names are read, and a failed read rejects (34-06)", async () => {
  const client = (answer: { data: { name: string }[] | null; error: { message: string } | null }) => ({
    from: (table: string) => {
      assert.equal(table, "projects");
      return { select: async (cols: string) => (assert.equal(cols, "name"), answer) };
    },
  });
  assert.deepEqual(await remoteProjectNames(client({ data: [{ name: "A" }, { name: "B" }], error: null })), ["A", "B"]);
  assert.deepEqual(await remoteProjectNames(client({ data: null, error: null })), []);
  await assert.rejects(
    remoteProjectNames(client({ data: null, error: { message: "JWT expired" } })),
    /JWT expired/,
  );
});

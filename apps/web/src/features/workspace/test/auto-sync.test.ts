import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import type { DesktopVaultSync } from "@/lib/desktop/desktop-bridge";

import {
  AUTO_SYNC_TIMING,
  autoSyncView,
  createAutoSync,
  onAutoSyncView,
  retryAutoSync,
  showAutoSync,
  wireAutoSync,
  type AutoSyncDeps,
} from "../application/auto-sync";

const { afterCommitMs, intervalMs, backoffMs } = AUTO_SYNC_TIMING;

/** Let every settled promise run its callbacks; `setImmediate` is not faked. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function advance(ms: number) {
  mock.timers.tick(ms);
  await flush();
}

type Outcome = Awaited<ReturnType<AutoSyncDeps["sync"]>>;

const ok = (pull: DesktopVaultSync["pull"] = { kind: "up-to-date" }): Outcome => ({
  pulled: { url: "u", hasToken: true, pull },
  pushed: { url: "u", hasToken: true, push: { kind: "pushed" } },
});

/** A remote that answers each sync with the next queued outcome, recording each call. */
function fakeRemote(options: { url?: string | null; hasToken?: boolean } = {}) {
  const outcomes: (() => Promise<Outcome>)[] = [];
  let online = true;
  let syncs = 0;
  const deps: AutoSyncDeps = {
    remote: async () => ({ url: options.url === undefined ? "https://github.com/me/notes.git" : options.url, hasToken: options.hasToken ?? true }),
    sync: () => {
      syncs++;
      return (outcomes.shift() ?? (async () => ok()))();
    },
    isOnline: () => online,
    now: () => Date.now(),
  };
  return {
    deps,
    syncs: () => syncs,
    queue: (outcome: () => Promise<Outcome>) => outcomes.push(outcome),
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

/** A sync that does not settle until the test lets it. */
function held() {
  let release!: () => void;
  const done = new Promise<Outcome>((resolve) => {
    release = () => resolve(ok());
  });
  return { outcome: () => done, release };
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
});

afterEach(() => {
  mock.timers.reset();
});

test("starting syncs once at once, then every five minutes", async () => {
  const remote = fakeRemote();
  const sync = createAutoSync(remote.deps);
  sync.start();
  await flush();
  assert.equal(remote.syncs(), 1);
  assert.equal(sync.state().kind, "idle");
  await advance(intervalMs - 1);
  assert.equal(remote.syncs(), 1);
  await advance(1);
  assert.equal(remote.syncs(), 2);
  await advance(intervalMs);
  assert.equal(remote.syncs(), 3);
  sync.stop();
  await advance(intervalMs);
  assert.equal(remote.syncs(), 3);
});

test("starting twice keeps one interval", async () => {
  const remote = fakeRemote();
  const sync = createAutoSync(remote.deps);
  sync.start();
  sync.start();
  await flush();
  await advance(intervalMs);
  assert.equal(remote.syncs(), 2);
  sync.stop();
});

test("a burst of commits syncs once, ten seconds after the last", async () => {
  const remote = fakeRemote();
  const sync = createAutoSync(remote.deps);
  sync.afterCommit();
  await advance(afterCommitMs - 1_000);
  sync.afterCommit();
  await advance(afterCommitMs - 1);
  assert.equal(remote.syncs(), 0);
  await advance(1);
  assert.equal(remote.syncs(), 1);
  sync.stop();
});

test("no remote, or no token, is a quiet no-op", async () => {
  for (const options of [{ url: null }, { hasToken: false }]) {
    const remote = fakeRemote(options);
    const sync = createAutoSync(remote.deps);
    sync.start();
    await flush();
    sync.nudge();
    await flush();
    assert.equal(remote.syncs(), 0);
    assert.deepEqual(sync.state(), { kind: "off" });
    sync.stop();
  }
});

test("never two at once: requests during a run queue one follow-up", async () => {
  const remote = fakeRemote();
  const first = held();
  remote.queue(first.outcome);
  const sync = createAutoSync(remote.deps);
  sync.nudge();
  await flush();
  assert.equal(sync.state().kind, "syncing");
  sync.nudge();
  sync.nudge();
  sync.nudge();
  await flush();
  assert.equal(remote.syncs(), 1);
  first.release();
  await flush();
  await flush();
  assert.equal(remote.syncs(), 2, "one follow-up for the three requests");
  await flush();
  assert.equal(remote.syncs(), 2);
  assert.equal(sync.state().kind, "idle");
  sync.stop();
});

test("a success records when, and whether changes came in", async () => {
  const remote = fakeRemote();
  remote.queue(async () => ok({ kind: "fast-forward", oid: "abc" }));
  const sync = createAutoSync(remote.deps);
  sync.nudge();
  await flush();
  assert.deepEqual(sync.state(), { kind: "idle", syncedAt: 1_000_000, pulled: true });
  sync.nudge();
  await flush();
  assert.deepEqual(sync.state(), { kind: "idle", syncedAt: 1_000_000, pulled: false });
  sync.stop();
});

test("failures back off 30 s, 1 min, 5 min, 5 min, and a success resets it", async () => {
  const remote = fakeRemote();
  const fail = async (): Promise<Outcome> => {
    throw new Error("network down");
  };
  for (let i = 0; i < 4; i++) remote.queue(fail);
  const sync = createAutoSync(remote.deps);
  sync.nudge();
  await flush();
  assert.equal(remote.syncs(), 1);
  const state = sync.state();
  assert.equal(state.kind, "error");
  assert.equal(state.kind === "error" && state.message, "network down");
  assert.equal(state.kind === "error" && state.retryAt, 1_000_000 + backoffMs[0]!);

  const waits = [backoffMs[0]!, backoffMs[1]!, backoffMs[2]!, backoffMs[2]!];
  for (const [i, wait] of waits.entries()) {
    await advance(wait - 1);
    assert.equal(remote.syncs(), i + 1, `still waiting ${wait} ms`);
    await advance(1);
    assert.equal(remote.syncs(), i + 2);
  }
  assert.equal(sync.state().kind, "idle", "the fifth try succeeds");

  remote.queue(fail);
  sync.nudge();
  await flush();
  await advance(backoffMs[0]! - 1);
  assert.equal(remote.syncs(), 6);
  await advance(1);
  assert.equal(remote.syncs(), 7, "back to 30 s after a success");
  sync.stop();
});

test("while backing off, automatic triggers wait; retry runs at once", async () => {
  const remote = fakeRemote();
  remote.queue(async () => {
    throw new Error("nope");
  });
  const sync = createAutoSync(remote.deps);
  sync.start();
  await flush();
  assert.equal(sync.state().kind, "error");
  sync.nudge();
  sync.afterCommit();
  await advance(afterCommitMs);
  assert.equal(remote.syncs(), 1);
  sync.retry();
  await flush();
  assert.equal(remote.syncs(), 2);
  assert.equal(sync.state().kind, "idle");
  // The backoff timer was cancelled by the retry.
  await advance(backoffMs[0]!);
  assert.equal(remote.syncs(), 2);
  sync.stop();
});

test("a conflicted pull or a refused push is an error naming it", async () => {
  const remote = fakeRemote();
  remote.queue(async () => ({ pulled: { url: "u", hasToken: true, pull: { kind: "conflict", files: ["a.md", "b.md"] } }, pushed: null }));
  remote.queue(async () => ({
    ...ok(),
    pushed: { url: "u", hasToken: true, push: { kind: "rejected", reason: "Pull first." } },
  }));
  const sync = createAutoSync(remote.deps);
  sync.nudge();
  await flush();
  const conflict = sync.state();
  assert.equal(conflict.kind, "error");
  assert.match(conflict.kind === "error" ? conflict.message : "", /2 files changed on both sides/);
  sync.retry();
  await flush();
  const rejected = sync.state();
  assert.equal(rejected.kind === "error" && rejected.message, "Pull first.");
  sync.stop();
});

test("offline pauses: nothing runs, and coming back online syncs", async () => {
  const remote = fakeRemote();
  remote.setOnline(false);
  const sync = createAutoSync(remote.deps);
  sync.start();
  await flush();
  assert.equal(sync.state().kind, "offline");
  await advance(intervalMs);
  sync.afterCommit();
  await advance(afterCommitMs);
  assert.equal(remote.syncs(), 0);
  remote.setOnline(true);
  sync.setOnline(true);
  await flush();
  assert.equal(remote.syncs(), 1);
  assert.equal(sync.state().kind, "idle");
  remote.setOnline(false);
  sync.setOnline(false);
  assert.equal(sync.state().kind, "offline");
  sync.stop();
});

test("stopping cancels a waiting commit sync and the backoff", async () => {
  const remote = fakeRemote();
  remote.queue(async () => {
    throw new Error("x");
  });
  const sync = createAutoSync(remote.deps);
  sync.nudge();
  await flush();
  sync.afterCommit();
  sync.stop();
  await advance(intervalMs);
  assert.equal(remote.syncs(), 1);
});

test("wired up: starts, follows commits, focus and the network, and shows itself; unwiring stops it all", async () => {
  const remote = fakeRemote();
  const sync = createAutoSync(remote.deps);
  const target = new EventTarget();
  const commits = new Set<() => void>();
  const unwire = wireAutoSync(sync, {
    target,
    onCommit: (listener) => {
      commits.add(listener);
      return () => commits.delete(listener);
    },
  });
  await flush();
  assert.equal(remote.syncs(), 1, "starts at once");
  assert.equal(autoSyncView().kind, "idle", "and is shown");

  for (const commit of commits) commit();
  await advance(afterCommitMs);
  assert.equal(remote.syncs(), 2, "a commit syncs after the debounce");

  target.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(remote.syncs(), 3, "focus syncs");

  remote.setOnline(false);
  target.dispatchEvent(new Event("offline"));
  assert.equal(sync.state().kind, "offline");
  remote.setOnline(true);
  target.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(remote.syncs(), 4, "back online syncs");

  unwire();
  assert.equal(commits.size, 0);
  assert.deepEqual(autoSyncView(), { kind: "off" });
  target.dispatchEvent(new Event("focus"));
  await advance(intervalMs);
  assert.equal(remote.syncs(), 4, "nothing after unwiring");
});

test("the shared view follows the shown engine, and retry reaches it", async () => {
  const remote = fakeRemote();
  remote.queue(async () => {
    throw new Error("down");
  });
  const sync = createAutoSync(remote.deps);
  const seen: string[] = [];
  const off = onAutoSyncView(() => seen.push(autoSyncView().kind));
  const hide = showAutoSync(sync);
  sync.nudge();
  await flush();
  assert.equal(autoSyncView().kind, "error");
  retryAutoSync();
  await flush();
  assert.equal(autoSyncView().kind, "idle");
  hide();
  assert.deepEqual(autoSyncView(), { kind: "off" });
  assert.deepEqual(seen, ["off", "syncing", "error", "syncing", "idle", "off"]);
  off();
  sync.stop();
});

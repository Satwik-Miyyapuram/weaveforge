import assert from "node:assert/strict";
import test from "node:test";

import {
  createCycleRunner,
  mayDriveDevice,
  ownedRowCountSql,
} from "@/features/offline-sync/ui/sync-loop";

/**
 * The sync loop's concurrency guard.
 *
 * Three triggers can fire at once — open, `online`, and the interval — and two
 * overlapping cycles push the same outbox rows twice, which the conflict store
 * then reports as a conflict with itself. A dropped tick costs nothing.
 *
 * This is the part of the loop that can be tested without a DOM, a database or a
 * network. That the loop only runs on the desktop app and only once sync has been
 * adopted is structure, readable in one screen.
 */

/** A cycle that does not resolve until the test says so. */
function gate() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test("a second cycle does not start while one is running", async () => {
  const first = gate();
  let started = 0;
  const cycle = createCycleRunner(async () => {
    started += 1;
    if (started === 1) await first.promise;
  });

  const one = cycle();
  await cycle(); // the interval or the online event firing mid-cycle
  assert.equal(started, 1, "the second trigger must be dropped, not queued");

  first.release();
  await one;
  assert.equal(started, 1);
});

test("the runner is usable again once a cycle finishes", async () => {
  let started = 0;
  const cycle = createCycleRunner(async () => {
    started += 1;
  });

  await cycle();
  await cycle();
  assert.equal(started, 2, "the next tick is the retry");
});

test("a cycle that throws does not wedge the loop shut", async () => {
  // A transport failure must not leave `running` true forever, which would stop
  // every future tick — the loop would be a no-op for the rest of the session.
  let attempts = 0;
  const cycle = createCycleRunner(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });

  await assert.rejects(cycle(), /offline/);
  await cycle();
  assert.equal(attempts, 2);
});

test("concurrent callers each settle, even though only one ran", async () => {
  const first = gate();
  let started = 0;
  const cycle = createCycleRunner(async () => {
    started += 1;
    await first.promise;
  });

  const one = cycle();
  const two = cycle();
  first.release();
  await Promise.all([one, two]);
  assert.equal(started, 1, "and the dropped caller does not hang waiting for work it never did");
});

test("only the account that owns the device may drive it", () => {
  assert.equal(mayDriveDevice("a", "a"), true);
  // A window signed in as somebody else must not push this device's rows as its
  // own: every row carries the adopting account's user_id and would be refused.
  assert.equal(mayDriveDevice("b", "a"), false);
  // Signed out: a cycle could only fail row after row. The window stays on the
  // server and leaves the local copy alone.
  assert.equal(mayDriveDevice(null, "a"), false);
  // Never adopted: there is no account for the outbox to belong to.
  assert.equal(mayDriveDevice("a", null), false);
});

test("the adoption check counts every table adoption would move", () => {
  const sql = ownedRowCountSql(["vault_pages", "reading_lists"]);

  assert.ok(sql);
  assert.match(sql, /from "vault_pages" where user_id = \$1/);
  assert.match(sql, /from "reading_lists" where user_id = \$1/);
  // Nothing to count is also "nothing of its own".
  assert.equal(ownedRowCountSql([]), null);
  // A name that needs quoting cannot escape its identifier.
  assert.match(ownedRowCountSql(['we"ird'])!, /"we""ird"/);
});

test("signing in adopts a device no account owns yet", async () => {
  const { sessionAction } = await import("@/features/offline-sync/ui/sync-loop");
  assert.equal(sessionAction("a", null), "adopt");
  assert.equal(sessionAction("a", "a"), "drive");
  assert.equal(sessionAction("b", "a"), "foreign");
  assert.equal(sessionAction(null, "a"), "idle");
  assert.equal(sessionAction(null, null), "idle");
});

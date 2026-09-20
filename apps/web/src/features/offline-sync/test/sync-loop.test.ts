import assert from "node:assert/strict";
import test from "node:test";

import { createCycleRunner } from "@/features/offline-sync/ui/sync-loop";

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

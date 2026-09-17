import assert from "node:assert/strict";
import test from "node:test";

import { QUIT_TIMEOUT_MS, runBoundedQuit, type QuitTimers } from "../src/quit";

/**
 * The quit that is not allowed to hang.
 *
 * `will-quit` is the only place the local database is closed, and it used to
 * exit solely from the cleanup's `finally`. A close that never settles — a
 * statement still running, a data directory on a disconnected drive — left the
 * process alive with no window, invisible and holding the single-instance lock,
 * which is a machine that appears to have stopped running the app.
 *
 * The timers are injected, so the timeout can be tested without waiting for it:
 * the case that matters is "cleanup never finished", which by definition a test
 * cannot wait out.
 */

/** Timers that only fire when the test says so. */
function manualTimers(): QuitTimers & { armed: number[]; fire(): void; cancelled: number } {
  const pending = new Map<number, () => void>();
  let next = 1;
  const state = {
    armed: [] as number[],
    cancelled: 0,
    after(fn: () => void, ms: number) {
      state.armed.push(ms);
      const handle = next++;
      pending.set(handle, fn);
      return handle;
    },
    cancel(handle: unknown) {
      state.cancelled += 1;
      pending.delete(handle as number);
    },
    fire() {
      for (const fn of [...pending.values()]) fn();
      pending.clear();
    },
  };
  return state;
}

test("quit: cleanup that finishes exits at once, and the fallback is cancelled", async () => {
  const timers = manualTimers();
  let exits = 0;

  runBoundedQuit({
    cleanup: async () => {},
    exit: () => {
      exits += 1;
    },
    timers,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(exits, 1);
  assert.deepEqual(timers.armed, [QUIT_TIMEOUT_MS], "the bound is armed before the cleanup runs");
  assert.equal(timers.cancelled, 1, "a timer left armed could exit a process that already left");

  // The fallback arriving late must not exit twice.
  timers.fire();
  assert.equal(exits, 1);
});

test("quit: cleanup that never finishes is abandoned, and the process still leaves", () => {
  const timers = manualTimers();
  let exits = 0;

  runBoundedQuit({
    // The finding, exactly: this promise never settles.
    cleanup: () => new Promise(() => {}),
    exit: () => {
      exits += 1;
    },
    timeoutMs: 3_000,
    timers,
  });

  assert.equal(exits, 0, "the cleanup gets its chance before the force-exit");
  timers.fire();
  assert.equal(exits, 1);
});

test("quit: a cleanup that fails is over, and the process leaves", async () => {
  const timers = manualTimers();
  let exits = 0;

  runBoundedQuit({
    cleanup: async () => {
      throw new Error("the database was already gone");
    },
    exit: () => {
      exits += 1;
    },
    timers,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(exits, 1, "a failed close must not leave the app unquittable");
  timers.fire();
  assert.equal(exits, 1, "and must not exit twice when the fallback arrives");
});

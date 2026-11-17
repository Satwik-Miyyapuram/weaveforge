import assert from "node:assert/strict";
import { test } from "node:test";

import { createFolderLock } from "../application/folder-lock";

/** A promise and the hand that settles it. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("runs one holder at a time, in the order they asked", async () => {
  const lock = createFolderLock();
  const log: string[] = [];
  const first = gate();
  const a = lock.run(async () => {
    log.push("a start");
    await first.done;
    log.push("a end");
  });
  const b = lock.run(async () => {
    log.push("b start");
    log.push("b end");
  });
  await tick();
  assert.deepEqual(log, ["a start"]);
  first.open();
  await Promise.all([a, b]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
});

test("a holder that throws still lets the next one in, and its caller sees the error", async () => {
  const lock = createFolderLock();
  const failed = lock.run(async () => {
    throw new Error("disk full");
  });
  const next = lock.run(async () => "ran");
  await assert.rejects(failed, /disk full/);
  assert.equal(await next, "ran");
});

test("idle waits for every holder, including one queued while it waited", async () => {
  const lock = createFolderLock();
  const log: string[] = [];
  const first = gate();
  void lock.run(async () => {
    await first.done;
    log.push("a");
  });
  const idle = lock.idle().then(() => log.push("idle"));
  const second = gate();
  void lock.run(async () => {
    await second.done;
    log.push("b");
  });
  first.open();
  await tick();
  assert.deepEqual(log, ["a"]);
  second.open();
  await idle;
  assert.deepEqual(log, ["a", "b", "idle"]);
});

test("idle on a free lock answers at once", async () => {
  await createFolderLock().idle();
});

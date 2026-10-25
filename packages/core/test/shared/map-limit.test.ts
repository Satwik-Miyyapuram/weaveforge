import { test } from "node:test";
import assert from "node:assert/strict";

import { mapLimit } from "../../src/shared/map-limit.js";

/** A promise the test opens by hand, so the in-flight count is observable. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("mapLimit never runs more than the limit at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const gates = Array.from({ length: 10 }, gate);

  const done = mapLimit([...gates.keys()], 3, async (index) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await gates[index]!.promise;
    inFlight -= 1;
    return index;
  });

  // Three start; the rest wait for a slot.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inFlight, 3);
  for (const item of gates) item.open();
  assert.deepEqual(await done, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});

test("mapLimit preserves input order whatever the completion order", async () => {
  const slow = gate();
  const done = mapLimit([1, 2, 3], 3, async (value) => {
    if (value === 1) await slow.promise;
    return value * 10;
  });
  // The last item finishes first; the result must still be in input order.
  await new Promise((resolve) => setTimeout(resolve, 0));
  slow.open();
  assert.deepEqual(await done, [10, 20, 30]);
});

test("mapLimit over an empty list does no work and does not divide by zero", async () => {
  let calls = 0;
  assert.deepEqual(
    await mapLimit([], 3, async () => {
      calls += 1;
      return 0;
    }),
    [],
  );
  assert.equal(calls, 0);
});

test("mapLimit refuses a limit that would serialise nothing", async () => {
  await assert.rejects(() => mapLimit([1], 0, async (v) => v), RangeError);
});

test("mapLimit refuses a limit that is not a number (NaN would run nothing)", async () => {
  await assert.rejects(() => mapLimit([1], Number.NaN, async (v) => v), RangeError);
});

// 01-05: after one item fails, no new items start, and the call rejects once.
test("mapLimit stops starting work after a rejection and rejects with that error", async () => {
  const started: number[] = [];
  const boom = new Error("upload 3 failed");
  const done = mapLimit([0, 1, 2, 3, 4, 5, 6, 7], 2, async (value) => {
    started.push(value);
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (value === 1) throw boom;
    return value;
  });
  await assert.rejects(done, (error) => error === boom);
  // Let any runner that was still going settle, then check nothing new began.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, [0, 1, 2], "items after the failure were still started");
});

test("mapLimit with two failures in flight rejects with the first", async () => {
  const first = new Error("first");
  const done = mapLimit([0, 1], 2, async (value) => {
    if (value === 0) throw first;
    await new Promise((resolve) => setTimeout(resolve, 1));
    throw new Error("second");
  });
  await assert.rejects(done, (error) => error === first);
});

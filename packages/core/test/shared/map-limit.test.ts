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

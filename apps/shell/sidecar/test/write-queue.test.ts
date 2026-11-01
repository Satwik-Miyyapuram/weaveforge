import assert from "node:assert/strict";
import test from "node:test";
import { WriteQueue } from "../src/write-queue";

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("a rejected task rejects for its own caller", async () => {
  const queue = new WriteQueue();
  const failed = queue.run(async () => {
    throw new Error("disk full");
  });
  await assert.rejects(failed, { message: "disk full" });
});

test("a rejected task does not block the next task", async () => {
  const queue = new WriteQueue();
  const failed = queue.run(async () => {
    throw new Error("disk full");
  });
  const next = queue.run(async () => "saved");
  await assert.rejects(failed, { message: "disk full" });
  assert.equal(await next, "saved");
});

test("a burst of concurrent runs completes in submission order", async () => {
  const queue = new WriteQueue();
  const order: number[] = [];
  const runs = [30, 0, 15, 5, 0].map((delay, index) =>
    queue.run(async () => {
      // Earlier submissions are the slowest, so only the chain keeps them in order.
      await later(delay);
      order.push(index);
      return index;
    }),
  );
  const results = await Promise.all(runs);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

test("a task does not start until the one before it has settled", async () => {
  const queue = new WriteQueue();
  let inFlight = 0;
  let maxInFlight = 0;
  const task = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await later(5);
    inFlight -= 1;
  };
  await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
  assert.equal(maxInFlight, 1);
});

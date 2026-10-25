import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInOrder } from "../application/load-in-order";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("loads concurrently and keeps the input order (21-06)", async () => {
  let running = 0;
  let peak = 0;
  const out = await loadInOrder([30, 5, 15], async (ms) => {
    running++;
    peak = Math.max(peak, running);
    await delay(ms);
    running--;
    return `done ${ms}`;
  });
  assert.deepEqual(out, ["done 30", "done 5", "done 15"]);
  assert.equal(peak, 3, "all three were in flight at once");
});

test("a failed item is dropped; the rest keep their order", async () => {
  const out = await loadInOrder(["a", "missing", "c"], async (item) => {
    if (item === "missing") throw new Error("404");
    return item.toUpperCase();
  });
  assert.deepEqual(out, ["A", "C"]);
});

test("a synchronous throw is dropped too, and empty input is empty", async () => {
  const out = await loadInOrder([1, 2], (n) => {
    if (n === 1) throw new Error("sync");
    return Promise.resolve(n);
  });
  assert.deepEqual(out, [2]);
  assert.deepEqual(await loadInOrder([], async () => 1), []);
});

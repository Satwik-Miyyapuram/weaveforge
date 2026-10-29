import { test } from "node:test";
import assert from "node:assert/strict";
import { latestGate } from "../latest-gate";

test("only the most recent request is current", () => {
  const begin = latestGate();
  const first = begin();
  assert.equal(first(), true);
  const second = begin();
  assert.equal(first(), false, "an older request goes stale once a newer one starts");
  assert.equal(second(), true);
});

test("an answer that arrives out of order is dropped", async () => {
  const begin = latestGate();
  const applied: string[] = [];
  const load = async (label: string, delayMs: number) => {
    const isCurrent = begin();
    await new Promise((r) => setTimeout(r, delayMs));
    if (isCurrent()) applied.push(label);
  };
  await Promise.all([load("slow, older", 20), load("fast, newer", 1)]);
  assert.deepEqual(applied, ["fast, newer"]);
});

test("separate gates do not interfere", () => {
  const a = latestGate();
  const b = latestGate();
  const fromA = a();
  b();
  assert.equal(fromA(), true);
});

/**
 * The workspace shows its documents without waiting on the Overleaf list: it
 * takes the rows only if they are already in, and otherwise adds them later.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ifSettled, sectionOr } from "../application/parts";

test("a settled promise gives its value", async () => {
  assert.deepEqual(await ifSettled(Promise.resolve([1])), [1]);
});

test("a pending promise gives undefined at once", async () => {
  const pending = new Promise<number[]>(() => {});
  assert.equal(await ifSettled(pending), undefined);
});

test("falsy values count as settled", async () => {
  assert.equal(await ifSettled(Promise.resolve(0)), 0);
  assert.equal(await ifSettled(Promise.resolve(null)), null);
  assert.deepEqual(await ifSettled(Promise.resolve([])), []);
});

test("a section load settled before the check is taken, wrapper and all", async () => {
  // The load wraps the Overleaf rows in sectionOr; a cached list must still count.
  const wrapped = sectionOr(Promise.resolve(["row"]), "overleaf", []);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await ifSettled(wrapped), ["row"]);
});

test("a promise that settles later is not waited on", async () => {
  let done!: (rows: string[]) => void;
  const later = new Promise<string[]>((r) => (done = r));
  assert.equal(await ifSettled(later), undefined);
  done(["row"]);
  assert.deepEqual(await ifSettled(later), ["row"]);
});

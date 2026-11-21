/**
 * A deep link to a shared milestone fetches it once. Leaving or following
 * another link before the fetch lands must drop the late result, or the old
 * milestone is merged into the new screen (P2-194).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadLinkedMilestone } from "../plan-deep-link";

type M = { id: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

test("a fetch that lands after cancel is dropped", async () => {
  const d = deferred<M | null>();
  const loaded: M[] = [];
  const cancel = loadLinkedMilestone(() => d.promise, (m) => loaded.push(m), () => assert.fail("no error"));
  cancel();
  d.resolve({ id: "a" });
  await d.promise;
  await Promise.resolve();
  assert.deepEqual(loaded, []);
});

test("a fetch that lands in time is passed on", async () => {
  const d = deferred<M | null>();
  const loaded: M[] = [];
  loadLinkedMilestone(() => d.promise, (m) => loaded.push(m), () => assert.fail("no error"));
  d.resolve({ id: "a" });
  await d.promise;
  await Promise.resolve();
  assert.deepEqual(loaded, [{ id: "a" }]);
});

test("a missing milestone is not passed on", async () => {
  const loaded: M[] = [];
  loadLinkedMilestone<M>(() => Promise.resolve(null), (m) => loaded.push(m), () => assert.fail("no error"));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(loaded, []);
});

test("an error is reported only while still current", async () => {
  const late = deferred<M | null>();
  const errors: unknown[] = [];
  const cancel = loadLinkedMilestone(() => late.promise, () => undefined, (e) => errors.push(e));
  cancel();
  late.reject(new Error("gone"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(errors.length, 0);

  const live = deferred<M | null>();
  loadLinkedMilestone(() => live.promise, () => undefined, (e) => errors.push(e));
  live.reject(new Error("down"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(errors.length, 1);
});

test("the plan screen cancels the linked fetch in its effect cleanup", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const screen = readFileSync(fileURLToPath(new URL("../plan-screen.tsx", import.meta.url)), "utf8");
  assert.match(screen, /return loadLinkedMilestone\(/);
});
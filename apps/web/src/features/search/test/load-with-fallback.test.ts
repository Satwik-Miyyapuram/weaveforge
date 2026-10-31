/**
 * A native encoder that fails to load must hand over to the web worker, and
 * nothing else may change: a working primary stays, and no fallback rethrows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWithFallback, type Loadable } from "../infrastructure/load-with-fallback";

/** A loadable that records its loads and disposes, failing with `error` if given. */
function fake(name: string, log: string[], error?: Error): Loadable & { name: string } {
  return {
    name,
    load: async () => {
      log.push(`load ${name}`);
      if (error) throw error;
    },
    dispose: () => {
      log.push(`dispose ${name}`);
    },
  };
}

test("a primary that loads is returned and the fallback is never built", async () => {
  const log: string[] = [];
  const primary = fake("native", log);
  const got = await loadWithFallback(primary, () => fake("worker", log));
  assert.equal(got, primary);
  assert.deepEqual(log, ["load native"]);
});

test("a failed primary is disposed and the loaded fallback returned", async () => {
  const log: string[] = [];
  const seen: unknown[] = [];
  const failure = new Error("no runtime");
  const got = await loadWithFallback(
    fake("native", log, failure),
    () => fake("worker", log),
    (error) => seen.push(error),
  );
  assert.equal(got.name, "worker");
  assert.deepEqual(log, ["load native", "dispose native", "load worker"]);
  assert.deepEqual(seen, [failure]);
});

test("without a fallback the primary's failure is rethrown and it is not disposed", async () => {
  const log: string[] = [];
  await assert.rejects(loadWithFallback(fake("worker", log, new Error("offline")), null), {
    message: "offline",
  });
  assert.deepEqual(log, ["load worker"]);
});

test("a fallback that also fails is disposed and rejects with its own error", async () => {
  const log: string[] = [];
  await assert.rejects(
    loadWithFallback(fake("native", log, new Error("no runtime")), () =>
      fake("worker", log, new Error("offline")),
    ),
    { message: "offline" },
  );
  assert.deepEqual(log, ["load native", "dispose native", "load worker", "dispose worker"]);
});

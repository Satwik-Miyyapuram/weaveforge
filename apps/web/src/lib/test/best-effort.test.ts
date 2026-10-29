import { test } from "node:test";
import assert from "node:assert/strict";

import { bestEffort } from "../best-effort";
import type { AppLogInput } from "../error-report/app-log";

test("a failed best-effort task is logged as a warning, not thrown (13-12)", async () => {
  const logs: AppLogInput[] = [];
  await bestEffort("Service worker registration failed.", async () => { throw new Error("blocked"); }, (l) => logs.push(l));
  assert.deepEqual(logs, [{ level: "warn", source: "service-worker", message: "Service worker registration failed.", detail: "blocked" }]);
});

test("a task that succeeds logs nothing (13-12)", async () => {
  const logs: AppLogInput[] = [];
  let ran = false;
  await bestEffort("x", async () => { ran = true; }, (l) => logs.push(l));
  assert.equal(ran, true);
  assert.deepEqual(logs, []);
});

test("a synchronous throw and a non-Error rejection are logged too (13-12)", async () => {
  const logs: AppLogInput[] = [];
  await bestEffort("a", () => { throw new Error("sync"); }, (l) => logs.push(l));
  await bestEffort("b", () => Promise.reject("plain"), (l) => logs.push(l));
  assert.deepEqual(logs.map((l) => l.detail), ["sync", "plain"]);
});

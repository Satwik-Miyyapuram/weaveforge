import { test } from "node:test";
import assert from "node:assert/strict";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { runSyncAction } from "../ui/run-sync-action";

test("a decision that saves clears the last error and logs nothing (34-09)", async () => {
  await withAppLogs(async (logs) => {
    const errors: (string | null)[] = [];
    await runSyncAction(async () => {}, (e) => errors.push(e));
    assert.deepEqual(errors, [null]);
    assert.equal(logs.length, 0);
  });
});

test("a decision that fails is shown and logged, and never rejects (34-09)", async () => {
  await withAppLogs(async (logs) => {
    const errors: (string | null)[] = [];
    await runSyncAction(() => Promise.reject(new Error("database is locked")), (e) => errors.push(e));
    assert.equal(errors.length, 2);
    assert.equal(errors[0], null);
    assert.match(errors[1] ?? "", /could not be saved.*database is locked/);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "offline-sync");
    assert.match(logs[0]?.detail ?? "", /database is locked/);
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { ownedOrgsOrError } from "../ui/owned-orgs";

const org = { id: "o1", name: "Lab", ownerId: "u1" };

test("the owned labs come through when the read succeeds (32-31)", async () => {
  const logs = await withAppLogs(async (logs) => {
    const result = await ownedOrgsOrError(() => Promise.resolve([org]));
    assert.deepEqual(result, { orgs: [org], error: null });
    return logs;
  });
  assert.equal(logs.length, 0);
});

test("a failed read shows an error and logs it, rather than hiding the code panels (32-31)", async () => {
  const logs = await withAppLogs(async (logs) => {
    const result = await ownedOrgsOrError(() => Promise.reject(new Error("503")));
    assert.deepEqual(result.orgs, []);
    assert.match(result.error ?? "", /labs you own could not load/i);
    return logs;
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.level, "warn");
  assert.equal(logs[0]!.source, "org");
  assert.equal(logs[0]!.detail, "503");
});

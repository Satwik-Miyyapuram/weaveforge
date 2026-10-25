import { test } from "node:test";
import assert from "node:assert/strict";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { assetOrNull, hashTargetId } from "../ui/vault-markdown-helpers";

test("a percent-encoded hash decodes to the heading id (34-14)", () => {
  assert.equal(hashTargetId("Caf%C3%A9%20notes"), "Café notes");
  assert.equal(hashTargetId("^block-1"), "^block-1");
});

test("a malformed hash is used as written instead of throwing (34-14)", () => {
  assert.equal(hashTargetId("%E0"), "%E0");
  assert.equal(hashTargetId("50%"), "50%");
});

test("an asset that loads is returned and nothing is logged (34-15)", async () => {
  await withAppLogs(async (logs) => {
    const blob = new Blob(["png"]);
    assert.equal(await assetOrNull(async () => blob, "a/b.png"), blob);
    assert.equal(logs.length, 0);
  });
});

test("an asset that fails is dropped and logged with its path (34-15)", async () => {
  await withAppLogs(async (logs) => {
    const got = await assetOrNull(() => Promise.reject(new Error("403 Forbidden")), "a/b.png");
    assert.equal(got, null);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "vault");
    assert.match(logs[0]?.detail ?? "", /a\/b\.png.*403 Forbidden/);
  });
});

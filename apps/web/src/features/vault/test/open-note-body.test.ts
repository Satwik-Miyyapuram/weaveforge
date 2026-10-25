import { test } from "node:test";
import assert from "node:assert/strict";
import type { VaultPage } from "@weaveforge/core";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { openNoteBody } from "../ui/vault-screen/open-note-body";

const page = { id: "n1", title: "Note", body: "" } as VaultPage;

test("an opened note comes back with no error (34-10)", async () => {
  assert.deepEqual(await openNoteBody(async () => page, "n1"), { page, error: null });
});

test("a note that is gone says so instead of loading forever (34-10)", async () => {
  const result = await openNoteBody(async () => null, "n1");
  assert.equal(result.page, null);
  assert.match(result.error ?? "", /no longer exists/);
});

test("a note that cannot be read shows why and is logged (34-10)", async () => {
  await withAppLogs(async (logs) => {
    const result = await openNoteBody(() => Promise.reject(new Error("offline")), "n1");
    assert.equal(result.page, null);
    assert.match(result.error ?? "", /could not open.*offline/i);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "vault");
  });
});

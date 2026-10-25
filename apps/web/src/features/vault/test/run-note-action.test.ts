import { test } from "node:test";
import assert from "node:assert/strict";

import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { runNoteAction } from "../ui/vault-screen/run-note-action";

test("a note action that works is busy around it, clears the error and reports success (34-11..13)", async () => {
  await withAppLogs(async (logs) => {
    const calls: string[] = [];
    const ok = await runNoteAction(
      (b) => calls.push(`busy:${b}`),
      (e) => calls.push(`error:${e}`),
      async () => {
        calls.push("run");
      },
    );
    assert.equal(ok, true);
    assert.deepEqual(calls, ["busy:true", "error:null", "run", "busy:false"]);
    assert.equal(logs.length, 0);
  });
});

test("a note action that fails is shown and logged, frees the button, and never rejects (34-11..13)", async () => {
  await withAppLogs(async (logs) => {
    const calls: string[] = [];
    const ok = await runNoteAction(
      (b) => calls.push(`busy:${b}`),
      (e) => calls.push(`error:${e}`),
      () => Promise.reject(new Error("row is locked")),
    );
    assert.equal(ok, false);
    assert.equal(calls.at(-1), "busy:false");
    assert.ok(calls.some((c) => /^error:.*row is locked/.test(c)));
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.source, "vault");
    assert.match(logs[0]?.detail ?? "", /row is locked/);
  });
});

test("a non-Error rejection still shows a message (34-11..13)", async () => {
  await withAppLogs(async () => {
    const errors: (string | null)[] = [];
    const ok = await runNoteAction(() => {}, (e) => errors.push(e), () => Promise.reject("offline"));
    assert.equal(ok, false);
    assert.match(errors.at(-1) ?? "", /offline/);
  });
});

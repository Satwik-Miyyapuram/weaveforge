import assert from "node:assert/strict";
import test from "node:test";

import { runBusy } from "../ui/run-busy";

function recorder() {
  const busy: boolean[] = [];
  const errors: (string | null)[] = [];
  return {
    busy,
    errors,
    setBusy: (value: boolean) => void busy.push(value),
    setError: (value: string | null) => void errors.push(value),
  };
}

test("a successful action clears the error and frees the button", async () => {
  const r = recorder();
  let ran = false;
  await runBusy(r.setBusy, r.setError, async () => {
    assert.deepEqual(r.busy, [true], "busy while it runs");
    ran = true;
  });
  assert.ok(ran);
  assert.deepEqual(r.busy, [true, false]);
  assert.deepEqual(r.errors, [null]);
});

test("a failed action shows its message and still frees the button", async () => {
  const r = recorder();
  await runBusy(r.setBusy, r.setError, async () => {
    throw new Error("Invalid login credentials");
  });
  assert.deepEqual(r.busy, [true, false]);
  assert.deepEqual(r.errors, [null, "Invalid login credentials"]);
});

test("a thrown string is shown as written", async () => {
  const r = recorder();
  await runBusy(r.setBusy, r.setError, () => Promise.reject("Too many requests"));
  assert.deepEqual(r.errors, [null, "Too many requests"]);
  assert.equal(r.busy.at(-1), false);
});

test("runBusy itself never rejects", async () => {
  const r = recorder();
  await assert.doesNotReject(runBusy(r.setBusy, r.setError, () => Promise.reject(new Error("x"))));
});

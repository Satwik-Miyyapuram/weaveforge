/**
 * A screen action that fails shows its error instead of rejecting unhandled
 * (B66: 30-05 milestone status, 30-06 section status, 30-07 section delete).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runReported } from "@/lib/run-reported";

test("a failed action reports its message and resolves false", async () => {
  const errors: string[] = [];
  let settled = 0;
  const ok = await runReported(() => Promise.reject(new Error("permission denied")), (m) => errors.push(m), () => settled++);
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /permission denied/);
  assert.equal(settled, 1);
});

test("a successful action reports nothing and resolves true", async () => {
  const errors: string[] = [];
  let settled = 0;
  const ok = await runReported(async () => "done", (m) => errors.push(m), () => settled++);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.equal(settled, 1);
});

test("an action that throws synchronously is reported too", async () => {
  const errors: string[] = [];
  const ok = await runReported(() => { throw new Error("boom"); }, (m) => errors.push(m));
  assert.equal(ok, false);
  assert.match(errors[0]!, /boom/);
});

test("settle runs even when onError throws, and the error still surfaces", async () => {
  let settled = 0;
  await assert.rejects(
    runReported(() => Promise.reject(new Error("x")), () => { throw new Error("render failed"); }, () => settled++),
    /render failed/,
  );
  assert.equal(settled, 1);
});

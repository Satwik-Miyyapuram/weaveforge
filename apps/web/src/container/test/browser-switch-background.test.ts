import assert from "node:assert/strict";
import { test } from "node:test";
import { runBrowserSwitchInBackground } from "../browser-switch-background";
import type { SwitchDecision } from "../browser-export-switch";

/**
 * P2-4. The 0.9.7 export runs off the startup path: the caller gets a promise it can ignore,
 * a hung export settles to null at the timeout, and a failing export never rejects.
 */

test("(P2-4) container starts when the export hangs: the call returns at once and the run is started", async () => {
  let started = 0;
  let resolveRun: (d: SwitchDecision) => void = () => {};
  const run = () => {
    started += 1;
    return new Promise<SwitchDecision>((resolve) => {
      resolveRun = resolve;
    });
  };
  const pending = runBrowserSwitchInBackground(run, 1000);
  assert.equal(started, 1);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);
  resolveRun({ switch: false, reason: "no-session" });
  assert.deepEqual(await pending, { switch: false, reason: "no-session" });
});

test("(P2-4) a run that outlives the timeout settles to null, so the caller can fall back", async () => {
  const out = await runBrowserSwitchInBackground(() => new Promise<SwitchDecision>(() => {}), 20);
  assert.equal(out, null);
});

test("(P2-4) a run that throws settles to null and never rejects", async () => {
  const out = await runBrowserSwitchInBackground(async () => {
    throw new Error("opfs locked");
  }, 1000);
  assert.equal(out, null);
});

test("(P2-4) a verified run passes its decision through unchanged", async () => {
  const decision: SwitchDecision = { switch: false, reason: "not-verified" };
  assert.deepEqual(await runBrowserSwitchInBackground(async () => decision, 1000), decision);
});

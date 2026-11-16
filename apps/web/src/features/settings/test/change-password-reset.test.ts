/**
 * React clears `event.currentTarget` once the handler yields, so reading it
 * after `await updatePassword()` threw: the password changed but the screen
 * said it failed. The form is captured before the await.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../ui/account-info-panel.tsx", import.meta.url), "utf8");

test("changePassword never reads currentTarget after awaiting", () => {
  const body = panel.slice(panel.indexOf("async function changePassword"), panel.indexOf("async function changePassword") + 900);
  const afterAwait = body.slice(body.indexOf("await updatePassword"));
  assert.doesNotMatch(afterAwait, /currentTarget/);
  assert.match(body, /const form = event\.currentTarget;/);
  assert.match(afterAwait, /form\.reset\(\);/);
});

/** E12: Continue after a local-only upgrade opens the workspace, not the sign-in screen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { continueAfterUpgrade } from "../migrate-097-continue";

async function run(signedIn: () => Promise<boolean>) {
  const calls: string[] = [];
  await continueAfterUpgrade(signedIn, () => calls.push("local"), () => calls.push("reload"));
  return calls;
}

test("no account: local mode goes on before the reload", async () => {
  assert.deepEqual(await run(async () => false), ["local", "reload"]);
});

test("signed in: the reload keeps the account", async () => {
  assert.deepEqual(await run(async () => true), ["reload"]);
});

test("an auth that cannot answer keeps the choice and still reloads", async () => {
  assert.deepEqual(await run(async () => Promise.reject(new Error("not ready"))), ["reload"]);
});

test("the desktop gate's Continue goes through it", () => {
  const src = readFileSync(fileURLToPath(new URL("../migrate-097-gate.tsx", import.meta.url)), "utf8");
  const desktopScreen = src.slice(src.indexOf("runExport={desktopRunner}"), src.indexOf("{webRunner && webOpen"));
  assert.match(desktopScreen, /continueAfterUpgrade\(/);
  assert.match(desktopScreen, /setLocalMode\(true\)/);
});

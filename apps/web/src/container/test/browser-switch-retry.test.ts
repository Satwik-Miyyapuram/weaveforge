import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SWITCH_RETRY_TEXT,
  clearSwitchReloadGuard,
  isSwitchRetryNeeded,
  needsSwitchRetry,
  retrySwitch,
  setSwitchRetryNeeded,
  subscribeSwitchRetry,
} from "../browser-switch-retry";

/**
 * Item 3. A startup run that does not switch for a retryable reason shows the "files aren't ready"
 * banner. Retry runs the switch again and reloads into files mode only when it switches.
 */

const WIRING = { close: async () => {} } as never;

test("(item3) the banner text says the files are not ready yet", () => {
  assert.equal(SWITCH_RETRY_TEXT, "Your files aren't ready yet.");
});

test("(item3) not-verified, error and a timed-out run all show the banner", () => {
  for (const reason of ["not-verified", "error"] as const) {
    assert.equal(needsSwitchRetry({ switch: false, reason }), true, reason);
  }
  assert.equal(needsSwitchRetry(null), true);
});

test("(item3 P3) no-session never shows the banner: there is no account to retry for", () => {
  assert.equal(needsSwitchRetry({ switch: false, reason: "no-session" }), false);
});

test("(item3) desktop and a switched run never show the banner", () => {
  assert.equal(needsSwitchRetry({ switch: false, reason: "desktop" }), false);
  assert.equal(needsSwitchRetry({ switch: true, wiring: WIRING }), false);
});

test("(item3) Retry runs the switch again and reloads only when it switches", async () => {
  let runs = 0;
  let reloads = 0;
  setSwitchRetryNeeded(true);

  await retrySwitch(
    async () => {
      runs += 1;
      return { switch: false, reason: "not-verified" };
    },
    () => {
      reloads += 1;
    },
  );
  assert.equal(runs, 1);
  assert.equal(reloads, 0);
  assert.equal(isSwitchRetryNeeded(), true);

  await retrySwitch(
    async () => {
      runs += 1;
      return { switch: true, wiring: WIRING };
    },
    () => {
      reloads += 1;
    },
  );
  assert.equal(runs, 2);
  assert.equal(reloads, 1);
  assert.equal(isSwitchRetryNeeded(), false);
});

test("(item3 P2) a second switched run in the same session shows the banner and does not reload again", async () => {
  clearSwitchReloadGuard();
  let reloads = 0;
  const onSwitched = () => {
    reloads += 1;
  };
  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), onSwitched);
  assert.equal(reloads, 1);
  assert.equal(isSwitchRetryNeeded(), false);

  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), onSwitched);
  assert.equal(reloads, 1, "the reload guard stops a second reload");
  assert.equal(isSwitchRetryNeeded(), true);
  clearSwitchReloadGuard();
  setSwitchRetryNeeded(false);
});

test("(item3 P2) clearing the reload guard lets a switched run reload again", async () => {
  clearSwitchReloadGuard();
  let reloads = 0;
  const onSwitched = () => {
    reloads += 1;
  };
  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), onSwitched);
  clearSwitchReloadGuard();
  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), onSwitched);
  assert.equal(reloads, 2);
  clearSwitchReloadGuard();
  setSwitchRetryNeeded(false);
});

test("(item3 P4) a read-only start keeps the banner when Retry finds no session; a server start does not", async () => {
  clearSwitchReloadGuard();
  setSwitchRetryNeeded(true);
  await retrySwitch(async () => ({ switch: false, reason: "no-session" }), () => {}, { readOnly: true });
  assert.equal(isSwitchRetryNeeded(), true, "read-only stays read-only: the banner stays while signed out");

  setSwitchRetryNeeded(true);
  await retrySwitch(async () => ({ switch: false, reason: "no-session" }), () => {}, { readOnly: false });
  assert.equal(isSwitchRetryNeeded(), false, "a server start with no session has nothing to retry");
  setSwitchRetryNeeded(false);
});

test("(item3) the app shell mounts the retry banner beside the release notice", () => {
  const shell = readFileSync(fileURLToPath(new URL("../../app/app-shell.tsx", import.meta.url)), "utf8");
  assert.match(shell, /import \{ SwitchRetryBanner \} from "\.\/switch-retry-banner";/);
  assert.match(shell, /<SwitchRetryBanner \/>/);
});

test("(item3) subscribers hear each change of the banner state and can unsubscribe", () => {
  let heard = 0;
  const off = subscribeSwitchRetry(() => {
    heard += 1;
  });
  setSwitchRetryNeeded(true);
  setSwitchRetryNeeded(false);
  off();
  setSwitchRetryNeeded(true);
  assert.equal(heard, 2);
  setSwitchRetryNeeded(false);
});

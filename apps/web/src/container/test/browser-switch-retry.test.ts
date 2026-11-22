import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SWITCH_RETRY_TEXT,
  clearSwitchReloadGuard,
  isSwitchRetryNeeded,
  needsSwitchRetry,
  recordReadOnlyStart,
  retrySwitch,
  retrySwitchNow,
  setSwitchRetryNeeded,
  startSwitchRetryOnSignIn,
  subscribeSwitchRetry,
} from "../browser-switch-retry";
import type { SwitchDecision } from "../browser-export-switch";

/**
 * Item 3. A startup run that does not switch for a retryable reason shows the "moving your data
 * to files" banner. Retry runs the switch again and reloads into files mode only when it switches.
 */

const WIRING = { close: async () => {} } as never;

test("(item3) the banner text says the data is moving to files and the page is read-only", () => {
  assert.equal(SWITCH_RETRY_TEXT, "Moving your data to files… read-only until done.");
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
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);

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
  recordReadOnlyStart(true);
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
  recordReadOnlyStart(true);
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

test("(item3 P4) a read-only start keeps the banner when Retry finds no session", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  await retrySwitch(async () => ({ switch: false, reason: "no-session" }), () => {});
  assert.equal(isSwitchRetryNeeded(), true, "read-only stays read-only: the banner stays while signed out");
  recordReadOnlyStart(false);
});

test("(item1 P2) Retry while signed out on a read-only start keeps the banner, through the banner's own call", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  // The banner's Retry calls retrySwitch with no options; the read-only start is read from the module.
  await retrySwitch(async () => ({ switch: false, reason: "no-session" }), () => {});
  assert.equal(isSwitchRetryNeeded(), true);
  recordReadOnlyStart(false);
  setSwitchRetryNeeded(false);
});

test("(098 item1) the switch never runs on a page that did not start read-only", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(false);
  let runs = 0;
  let reloads = 0;
  const out = await retrySwitch(
    async () => {
      runs += 1;
      return { switch: true, wiring: WIRING };
    },
    () => {
      reloads += 1;
    },
  );
  assert.equal(out, null);
  assert.equal(runs, 0, "a writable page never exports: a write could land after the snapshot");
  assert.equal(reloads, 0);
  recordReadOnlyStart(true);
  await retrySwitch(
    async () => {
      runs += 1;
      return { switch: false, reason: "not-verified" };
    },
    () => {},
  );
  assert.equal(runs, 1, "a read-only page runs the switch");
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 P2) a repeat switch that cannot reload closes its files wiring", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let closed = 0;
  const wiring = { close: async () => void (closed += 1) } as never;
  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), () => {});
  await retrySwitch(async () => ({ switch: true, wiring }), () => {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(closed, 1, "the page stays on the read-only backend, so the unused wiring is closed");
  assert.equal(isSwitchRetryNeeded(), true);
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 item2) retrySwitchNow re-runs the last switch; with none recorded it does nothing", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let reloads = 0;
  await retrySwitch(
    async () => {
      runs += 1;
      return runs === 1 ? { switch: false, reason: "no-session" } : { switch: true, wiring: WIRING };
    },
    () => {
      reloads += 1;
    },
  );
  assert.equal(runs, 1);
  await retrySwitchNow();
  assert.equal(runs, 2);
  assert.equal(reloads, 1);
  assert.equal(isSwitchRetryNeeded(), false);
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 item2) a retry while a run is in flight joins it: never two exports at once", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let finish: (d: SwitchDecision) => void = () => {};
  const first = retrySwitch(
    () => {
      runs += 1;
      return new Promise<SwitchDecision>((resolve) => {
        finish = resolve;
      });
    },
    () => {},
  );
  const second = retrySwitchNow();
  assert.equal(runs, 1);
  finish({ switch: false, reason: "not-verified" });
  assert.deepEqual(await first, { switch: false, reason: "not-verified" });
  assert.deepEqual(await second, { switch: false, reason: "not-verified" });
  assert.equal(runs, 1);
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 P1) a retry after a timed-out run starts no second export while the first still runs", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let finish: (d: SwitchDecision) => void = () => {};
  const hung = () => {
    runs += 1;
    return new Promise<SwitchDecision>((resolve) => {
      finish = resolve;
    });
  };
  const out = await retrySwitch(hung, () => {}, 10);
  assert.equal(out, null, "the first run timed out");
  assert.equal(await retrySwitchNow(), null);
  assert.equal(runs, 1, "the timed-out export still runs, so no second export starts");
  finish({ switch: false, reason: "not-verified" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await retrySwitch(async () => {
    runs += 1;
    return { switch: false, reason: "not-verified" };
  }, () => {});
  assert.equal(runs, 2, "once it settles, Retry runs again");
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

type AuthCb = (event: string) => void;
function fakeAuth() {
  const cbs = new Set<AuthCb>();
  return {
    cbs,
    emit: (event: string) => {
      for (const cb of cbs) cb(event);
    },
    onAuthStateChange(cb: AuthCb) {
      cbs.add(cb);
      return { data: { subscription: { unsubscribe: () => void cbs.delete(cb) } } };
    },
  };
}

test("(098 item2) signing in re-runs the switch while the banner shows; other events do not", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  await retrySwitch(
    async () => {
      runs += 1;
      return { switch: false, reason: "no-session" };
    },
    () => {},
  );
  assert.equal(runs, 1);
  const auth = fakeAuth();
  const stop = startSwitchRetryOnSignIn(auth);
  auth.emit("TOKEN_REFRESHED");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1);
  auth.emit("SIGNED_IN");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 2);
  stop();
  auth.emit("SIGNED_IN");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 2, "after stop, sign-in no longer re-runs");
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 item2) sign-in does nothing when no retry is needed, and watching twice subscribes once", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let reloads = 0;
  await retrySwitch(
    async () => {
      runs += 1;
      return { switch: true, wiring: WIRING };
    },
    () => {
      reloads += 1;
    },
  );
  assert.equal(runs, 1);
  assert.equal(isSwitchRetryNeeded(), false, "switched: no banner");
  const auth = fakeAuth();
  const stop1 = startSwitchRetryOnSignIn(auth);
  const stop2 = startSwitchRetryOnSignIn(auth);
  assert.equal(auth.cbs.size, 1);
  auth.emit("SIGNED_IN");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1, "no banner, so sign-in starts no export");
  stop1();
  stop2();
  assert.equal(auth.cbs.size, 0);
});

test("(098 P2) a reload that throws keeps the banner and Retry still resolves", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  const out = await retrySwitch(
    async () => ({ switch: true, wiring: WIRING }),
    () => {
      throw new Error("reload blocked");
    },
  );
  assert.equal(out?.switch, true, "resolves, never rejects");
  assert.equal(isSwitchRetryNeeded(), true, "no reload happened, so the page is still read-only");
  let reloads = 0;
  await retrySwitch(async () => ({ switch: true, wiring: WIRING }), () => void (reloads += 1));
  assert.equal(reloads, 1, "the failed reload did not use up the guard: Retry reloads");
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 P2) signing in during a signed-out run re-runs once that run settles", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let finish: (d: SwitchDecision) => void = () => {};
  const first = retrySwitch(
    () => {
      runs += 1;
      if (runs === 1) {
        return new Promise<SwitchDecision>((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve<SwitchDecision>({ switch: false, reason: "not-verified" });
    },
    () => {},
  );
  const auth = fakeAuth();
  const stop = startSwitchRetryOnSignIn(auth);
  auth.emit("SIGNED_IN");
  assert.equal(runs, 1, "no second export while the first runs");
  finish({ switch: false, reason: "no-session" });
  await first;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 2, "the sign-in re-run starts after the signed-out run settles");
  stop();
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
});

test("(098 P2) signing in during a timed-out export re-runs once that export settles", async () => {
  clearSwitchReloadGuard();
  recordReadOnlyStart(true);
  let runs = 0;
  let finish: (d: SwitchDecision) => void = () => {};
  const out = await retrySwitch(
    () => {
      runs += 1;
      if (runs === 1) {
        return new Promise<SwitchDecision>((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve<SwitchDecision>({ switch: false, reason: "not-verified" });
    },
    () => {},
    10,
  );
  assert.equal(out, null, "timed out");
  const auth = fakeAuth();
  const stop = startSwitchRetryOnSignIn(auth);
  auth.emit("SIGNED_IN");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 1, "no second export while the timed-out one still runs");
  finish({ switch: false, reason: "no-session" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(runs, 2, "the sign-in re-run starts after the export settles");
  stop();
  recordReadOnlyStart(false);
  clearSwitchReloadGuard();
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
